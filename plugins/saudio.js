const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
const fsp = require('fs/promises');
const nodePath = require('path');
const nodeOs = require('os');
const WebP = require('node-webpmux');
const ffmpegPath = require('ffmpeg-static');
const {
    proto,
    prepareWAMessageMedia,
    downloadMediaMessage,
    normalizeMessageContent
} = require('baileys');

const execFileAsync = promisify(execFile);
const normalizeContent = normalizeMessageContent || ((m) => m);

/* ---------------- Config ---------------- */
const AUDIO_LIMIT_SEC = 25;
const SESSION_TTL_SEC = 60;
const MAX_STICKER_BYTES = 880 * 1024;

const audioSessions = (globalThis.__audioStickerSessions ||= new Map());

const MEDIA_TYPES = {
    stickerMessage: 'sticker',
    imageMessage: 'image',
    videoMessage: 'video',
    audioMessage: 'audio'
};

const SCALE_FILTER =
    'scale=512:512:force_original_aspect_ratio=decrease,format=rgba,' +
    'pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000,setsar=1';

/* ---------------- Session helpers ---------------- */
function endSession(key) {
    const s = audioSessions.get(key);
    if (s) clearTimeout(s.timer);
    audioSessions.delete(key);
}

/* ---------------- Media extraction ---------------- */
function describeMedia(content, download) {
    if (!content) return null;
    for (const [field, kind] of Object.entries(MEDIA_TYPES)) {
        const part = content[field];
        if (part) {
            return {
                kind,
                seconds: Number(part.seconds || 0),
                animated: Boolean(part.isAnimated),
                download
            };
        }
    }
    return null;
}

function extractMedia(socket, msg) {
    const fetchBuffer = (m) =>
        downloadMediaMessage(
            m,
            'buffer',
            {},
            { logger: socket.logger, reuploadRequest: socket.updateMediaMessage }
        );

    const content = normalizeContent(msg.message);
    const direct = describeMedia(content, () => fetchBuffer(msg));
    if (direct) return direct;

    const ctxInfo = content?.extendedTextMessage?.contextInfo;
    if (!ctxInfo?.quotedMessage) return null;

    return describeMedia(
        normalizeContent(ctxInfo.quotedMessage),
        () =>
            fetchBuffer({
                key: {
                    remoteJid: msg.key.remoteJid,
                    id: ctxInfo.stanzaId,
                    participant: ctxInfo.participant
                },
                message: ctxInfo.quotedMessage
            })
    );
}

/* ---------------- ffmpeg wrapper ---------------- */
async function runFfmpeg(inputBuffer, inExt, outExt, args) {
    const tag = crypto.randomBytes(6).toString('hex');
    const src = nodePath.join(nodeOs.tmpdir(), `aud_${tag}.${inExt}`);
    const dst = nodePath.join(nodeOs.tmpdir(), `aud_${tag}_out.${outExt}`);
    try {
        await fsp.writeFile(src, inputBuffer);
        const { stderr } = await execFileAsync(ffmpegPath || 'ffmpeg', ['-y', '-i', src, ...args, dst], {
            maxBuffer: 32 * 1024 * 1024
        });
        return { data: await fsp.readFile(dst), stderr };
    } finally {
        await fsp.unlink(src).catch(() => {});
        await fsp.unlink(dst).catch(() => {});
    }
}

/* ---------------- Sticker building ---------------- */
async function videoToWebp(buffer) {
    const attempts = [
        [10, 50],
        [8, 36],
        [6, 24],
        [5, 16]
    ]; // [fps, quality]

    let result = null;
    for (const [fps, quality] of attempts) {
        const { data } = await runFfmpeg(buffer, 'mp4', 'webp', [
            '-t', String(AUDIO_LIMIT_SEC),
            '-vf', `fps=${fps},${SCALE_FILTER}`,
            '-c:v', 'libwebp',
            '-lossless', '0',
            '-compression_level', '6',
            '-q:v', String(quality),
            '-loop', '0',
            '-preset', 'picture',
            '-an',
            '-vsync', '0'
        ]);
        result = data;
        if (data.length <= MAX_STICKER_BYTES) break;
    }
    return result;
}

async function imageToWebp(buffer) {
    const { data } = await runFfmpeg(buffer, 'jpg', 'webp', [
        '-vf', SCALE_FILTER,
        '-c:v', 'libwebp',
        '-lossless', '0',
        '-q:v', '80',
        '-an'
    ]);
    return data;
}

function buildExif(pack, author) {
    const meta = {
        'sticker-pack-id': `audio.sticker.${crypto.randomBytes(4).toString('hex')}`,
        'sticker-pack-name': pack,
        'sticker-pack-publisher': author,
        emojis: ['🔊']
    };
    const header = Buffer.from([
        0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00,
        0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x16, 0x00, 0x00, 0x00
    ]);
    const json = Buffer.from(JSON.stringify(meta), 'utf-8');
    const exif = Buffer.concat([header, json]);
    exif.writeUIntLE(json.length, 14, 4);
    return exif;
}

async function buildSticker(buffer, kind, pack, author) {
    let webpData = buffer;
    if (kind === 'video') webpData = await videoToWebp(buffer);
    else if (kind === 'image') webpData = await imageToWebp(buffer);

    const img = new WebP.Image();
    await img.load(webpData);
    img.exif = buildExif(pack, author);
    return img.save(null);
}

/* ---------------- Voice note building ---------------- */
async function buildVoiceNote(socket, buffer, ext, fallbackSec = 0) {
    const { data, stderr } = await runFfmpeg(buffer, ext, 'ogg', [
        '-vn',
        '-map', '0:a:0',
        '-t', String(AUDIO_LIMIT_SEC),
        '-af', 'aresample=48000:async=1:first_pts=0',
        '-c:a', 'libopus',
        '-b:a', '48k',
        '-vbr', 'on',
        '-compression_level', '10',
        '-ac', '1',
        '-ar', '48000',
        '-application', 'audio',
        '-avoid_negative_ts', 'make_zero',
        '-f', 'ogg'
    ]);

    if (data.length < 200) throw new Error('Audio is empty or too short.');

    const lastTime = [...stderr.matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)].pop();
    const measured = lastTime ? +lastTime[1] * 3600 + +lastTime[2] * 60 + +lastTime[3] : 0;

    const { audioMessage } = await prepareWAMessageMedia(
        { audio: data, mimetype: 'audio/ogg; codecs=opus', ptt: true },
        { upload: socket.waUploadToServer }
    );

    audioMessage.seconds = Math.max(1, Math.min(AUDIO_LIMIT_SEC, Math.round(measured || fallbackSec || 5)));
    audioMessage.ptt = true;
    audioMessage.mimetype = 'audio/ogg; codecs=opus';

    if (!audioMessage.waveform?.length) {
        audioMessage.waveform = Buffer.from(
            Array.from({ length: 64 }, (_, i) => 18 + (data[(i * 19 + 7) % data.length] % 76))
        );
    }
    return audioMessage;
}

/* ---------------- Protobuf patch + sending ---------------- */
function patchProtobuf(protoRoot) {
    const Msg = protoRoot?.Message;
    if (!Msg || Msg.__audioStickerPatched) return;

    if (Msg.StickerMessage) {
        const origStickerEncode = Msg.StickerMessage.encode;
        Msg.StickerMessage.encode = function (message, writer) {
            const attached = message?.audioMessage;
            if (attached) delete message.audioMessage;
            const w = origStickerEncode.call(this, message, writer);
            if (attached && Msg.AudioMessage) {
                message.audioMessage = attached;
                Msg.AudioMessage.encode(attached, w.uint32(210).fork()).ldelim();
            }
            return w;
        };

        const origStickerFromObject = Msg.StickerMessage.fromObject;
        if (typeof origStickerFromObject === 'function') {
            Msg.StickerMessage.fromObject = function (obj) {
                const out = origStickerFromObject.call(this, obj);
                if (obj?.audioMessage) {
                    out.audioMessage = Msg.AudioMessage?.fromObject
                        ? Msg.AudioMessage.fromObject(obj.audioMessage)
                        : obj.audioMessage;
                }
                return out;
            };
        }
    }

    const origMsgEncode = Msg.encode;
    Msg.encode = function (message, writer) {
        const wrapper = message?.audioStickerMessage;
        if (wrapper) {
            delete message.stickerMessage;
            delete message.audioStickerMessage;
        }
        const w = origMsgEncode.call(this, message, writer);
        if (wrapper && Msg.FutureProofMessage) {
            message.audioStickerMessage = wrapper;
            Msg.FutureProofMessage.encode(wrapper, w.uint32(1074).fork()).ldelim();
        }
        return w;
    };

    const origMsgFromObject = Msg.fromObject;
    if (typeof origMsgFromObject === 'function') {
        Msg.fromObject = function (obj) {
            const out = origMsgFromObject.call(this, obj);
            if (obj?.audioStickerMessage) {
                const inner = obj.audioStickerMessage.message || obj.audioStickerMessage;
                const innerAudio = obj.audioStickerMessage.message?.stickerMessage?.audioMessage;
                if (inner?.stickerMessage && innerAudio) inner.stickerMessage.audioMessage = innerAudio;
                out.audioStickerMessage = { message: inner };
                delete out.stickerMessage;
                if (inner) Object.setPrototypeOf(out, inner);
            }
            return out;
        };
    }

    Msg.__audioStickerPatched = true;
}

async function sendAudioSticker(socket, chatId, stickerBuffer, animated, audioMessage) {
    patchProtobuf(proto);
    const prepared = await prepareWAMessageMedia(
        { sticker: stickerBuffer, isAnimated: animated },
        { upload: socket.waUploadToServer }
    );
    prepared.stickerMessage.isAnimated = Boolean(animated);
    prepared.stickerMessage.audioMessage = audioMessage;

    await socket.relayMessage(
        chatId,
        {
            __proto__: prepared,
            audioStickerMessage: { message: prepared },
            messageContextInfo: { messageSecret: crypto.randomBytes(32) }
        },
        {}
    );
}

/* ---------------- Plugin ---------------- */
module.exports = {
    command: ['saudio', 'audiosticker'],
    description: 'Create Audio Stickers from videos, photos, or stickers + audio',
    ownerOnly: false,

    handler: async ({ socket, msg, sender, args, prefix }) => {
        try {
            const participant = msg.key?.participant || sender;
            const sessionKey = `${sender}:${participant}`;
            const activeSession = audioSessions.get(sessionKey);
            const textArgs = args.join(' ').trim();
            const cmd = `${prefix}saudio`;

            // --- Cancel session ---
            if (/^(cancel|stop)$/i.test(textArgs)) {
                if (!activeSession) {
                    return await socket.sendMessage(
                        sender,
                        { text: '❌ There is no active Audio Sticker session.' },
                        { quoted: msg }
                    );
                }
                endSession(sessionKey);
                return await socket.sendMessage(
                    sender,
                    { text: '✅ Audio Sticker session cancelled.' },
                    { quoted: msg }
                );
            }

            // --- Find media (own message or quoted) ---
            const media = extractMedia(socket, msg);
            if (!media) {
                return await socket.sendMessage(
                    sender,
                    {
                        text:
                            `🔊 *VORTEX MD | Audio Sticker*\n\n` +
                            `Send or reply to a video / photo / sticker with *${cmd}*\n\n` +
                            `• *Video:* Becomes a sticker with sound right away\n` +
                            `• *Photo / Sticker:* Starts a ${SESSION_TTL_SEC}s session, then reply to an audio / VN with *${cmd}*\n` +
                            `• *Pack info:* ${cmd} Pack|Author\n` +
                            `• *Cancel:* ${cmd} cancel\n\n` +
                            `> *Powered by VORTEX*`
                    },
                    { quoted: msg }
                );
            }

            // --- Session active + audio/video reply -> merge ---
            if (activeSession && (media.kind === 'audio' || media.kind === 'video')) {
                await socket.sendMessage(sender, { react: { text: '⏳', key: msg.key } });

                const voice = await buildVoiceNote(
                    socket,
                    await media.download(),
                    media.kind === 'video' ? 'mp4' : 'ogg',
                    media.seconds
                );

                await sendAudioSticker(socket, sender, activeSession.sticker, activeSession.animated, voice);
                endSession(sessionKey);
                return await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });
            }

            // --- Audio sent without an active sticker session ---
            if (media.kind === 'audio') {
                return await socket.sendMessage(
                    sender,
                    { text: `⚠️ Send or reply to a photo / sticker first with *${cmd}*, then reply to the audio.` },
                    { quoted: msg }
                );
            }

            // --- Build the sticker ---
            await socket.sendMessage(sender, { react: { text: '⏳', key: msg.key } });

            let [pack, author] = textArgs.split('|').map((v) => v.trim());
            pack = pack || global.stickpack || 'VORTEX MD';
            author = author || global.stickauth || 'VORTEX BOT';

            const original = await media.download();
            const stickerBuf = await buildSticker(original, media.kind, pack, author);
            const isAnimated = media.kind === 'video' || (media.kind === 'sticker' && media.animated);

            // --- Video: use its own audio track ---
            let delivered = false;
            if (media.kind === 'video') {
                try {
                    const voice = await buildVoiceNote(socket, original, 'mp4', media.seconds);
                    await sendAudioSticker(socket, sender, stickerBuf, true, voice);
                    delivered = true;
                } catch (err) {
                    console.error('[saudio] no usable audio in video, opening session:', err.message);
                }
            }

            if (delivered) {
                return await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });
            }

            // --- Photo / sticker / silent video: wait for audio ---
            endSession(sessionKey);
            const timer = setTimeout(() => {
                if (audioSessions.delete(sessionKey)) {
                    socket.sendMessage(
                        sender,
                        { text: '⏳ Audio Sticker session expired. Send the photo/sticker again to restart.' },
                        { quoted: msg }
                    );
                }
            }, SESSION_TTL_SEC * 1000);

            audioSessions.set(sessionKey, {
                sticker: stickerBuf,
                animated: isAnimated,
                timer
            });

            await socket.sendMessage(sender, { react: { text: '🎵', key: msg.key } });
            await socket.sendMessage(
                sender,
                {
                    text:
                        `🔊 *Audio Sticker session started* (${SESSION_TTL_SEC} seconds)\n\n` +
                        `Now reply to a voice note / audio / video with *${cmd}*\n` +
                        `Cancel with *${cmd} cancel*`
                },
                { quoted: msg }
            );
        } catch (err) {
            console.error('Audio sticker plugin error:', err.message);
            await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
            await socket.sendMessage(
                sender,
                { text: '❌ *Audio Sticker Error:* ' + err.message },
                { quoted: msg }
            );
        }
    }
};
