const fs = require('fs');
const path = require('path');
const { TelegramClient } = require('teleproto');
const { StringSession } = require('teleproto/sessions');
const { NewMessage } = require('teleproto/events');

// API Details
const TG_API_ID = 38283171;
const TG_API_HASH = '7e20fe6ddcfbc41eeb4fb9950eaa6133';
const TG_SESSION = '1BQANOTEuMTA4LjU2LjEwMQG7dIaFVWiPbqPcY9wd3Qaym/ja104O/Cp2DOd5n7hAhqElKHSwGMlNNiiRqFRnA44Zgzm6EWHddbKyYUPy5rhKV/J7S6Bm4rQP5cpgQXOC6gmApdULugCHaQ6Gio9vPMgcVd6aMRQw+Q79hxvvpjmXb12DYvrFdmasL1UgD2LVbS/7N9JKujzqAb7WnWYOZLvgU2NYEpeT5nt6U8sNXoSfGrKJazMfdQOBcTO+Du8BHqRpqm0uvpXE6EgnNgU1djAYCbyJUL4Wr+El4BavxJHYVPYrvnuCL9qVDAWQ9couKg6iZ3XVQXBBXESewjwJKkVrVBvr6jrujFRN0Ni8EXhFmA==';

const SEARCH_BOT = 'sdc_lk_bot';   // ← the correct search bot

const client = new TelegramClient(
    new StringSession(TG_SESSION),
    TG_API_ID,
    TG_API_HASH,
    { connectionRetries: 5, useWSS: false }
);

let isConnected = false;
async function getTelegramClient() {
    if (!isConnected) {
        await client.connect();
        if (!(await client.checkAuthorization())) {
            throw new Error('Telegram Session එක වලංගු නැත. අලුත් එකක් ලබාගන්න.');
        }
        isConnected = true;
    }
    return client;
}

function formatBytes(bytes) {
    if (!bytes || bytes === 0) return 'Unknown';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
}

/** Wait for a message from a specific bot that contains media OR an Open Link button */
async function waitForBotMessage(tgClient, botEntity, timeout = 90000, filterFn = null) {
    return new Promise((resolve, reject) => {
        let resolved = false;

        const timer = setTimeout(() => {
            if (resolved) return;
            resolved = true;
            tgClient.removeEventHandler(handler);
            reject(new Error('Bot එකෙන් පිළිතුරු ලැබීමට තිබූ කාලය ඉකුත් විය.'));
        }, timeout);

        async function handler(event) {
            try {
                if (resolved) return;
                const msg = event.message;
                if (!msg) return;

                const senderId = msg.senderId ? msg.senderId.toString() : null;
                if (senderId !== botEntity.id.toString()) return;

                // Optional custom filter
                if (filterFn && !filterFn(msg)) return;

                resolved = true;
                clearTimeout(timer);
                tgClient.removeEventHandler(handler);
                resolve(msg);
            } catch (e) {}
        }

        tgClient.addEventHandler(handler, new NewMessage({}));
    });
}

/** Extract t.me/bot?start=xxx from any message (buttons or text) */
function extractBotLink(msg) {
    // 1. Check reply markup buttons
    if (msg.replyMarkup && msg.replyMarkup.rows) {
        for (const row of msg.replyMarkup.rows) {
            for (const btn of row.buttons) {
                if (btn.url && btn.url.includes('t.me/')) {
                    const match = btn.url.match(/t\.me\/([^?\/\s]+)\?start=([a-zA-Z0-9_-]+)/);
                    if (match) {
                        return { botUsername: match[1], startParam: match[2] };
                    }
                }
            }
        }
    }

    // 2. Check message text
    if (msg.message) {
        const match = msg.message.match(/t\.me\/([^?\/\s]+)\?start=([a-zA-Z0-9_-]+)/);
        if (match) {
            return { botUsername: match[1], startParam: match[2] };
        }
    }

    return null;
}

module.exports = {
    command: ['cartoon', 'csearch'],
    description: 'Download Sinhala Dubbed Cartoons to temp disk and upload',
    ownerOnly: false,

    handler: async ({ socket, msg, sender, args }) => {
        let posterPath = null;
        let videoPath = null;

        try {
            const query = args.join(' ').trim();
            if (!query) {
                return await socket.sendMessage(
                    sender,
                    { text: '⚠️ *කරුණාකර Cartoon එකේ නම ඇතුළත් කරන්න!*\n\n*Example:* `.cartoon The Croods`' },
                    { quoted: msg }
                );
            }

            await socket.sendMessage(sender, { react: { text: '🔍', key: msg.key } });

            const tg = await getTelegramClient();
            const searchBot = await tg.getEntity(SEARCH_BOT);

            // ──────────────────────────────────────────────
            // 1. Send search query to @sdc_lk_bot
            // ──────────────────────────────────────────────
            await tg.sendMessage(searchBot, { message: query });

            // Wait for first reply from the search bot
            let firstMsg = await waitForBotMessage(tg, searchBot, 60000);

            // ──────────────────────────────────────────────
            // 2. If it is a "Found X results – Choose one" list → pick the first option
            // ──────────────────────────────────────────────
            if (firstMsg.message && /Found \d+ results/i.test(firstMsg.message)) {
                let firstOption = null;

                // Try to get the first button text
                if (firstMsg.replyMarkup && firstMsg.replyMarkup.rows) {
                    for (const row of firstMsg.replyMarkup.rows) {
                        for (const btn of row.buttons) {
                            if (btn.text && !/cancel/i.test(btn.text)) {
                                firstOption = btn.text;
                                break;
                            }
                        }
                        if (firstOption) break;
                    }
                }

                // Fallback: try to parse from text
                if (!firstOption) {
                    const lines = firstMsg.message.split('\n').map(l => l.trim()).filter(Boolean);
                    for (const line of lines) {
                        if (line && !/Found|Choose|Cancel/i.test(line) && line.length > 3) {
                            firstOption = line;
                            break;
                        }
                    }
                }

                if (firstOption) {
                    await tg.sendMessage(searchBot, { message: firstOption });
                    // Wait for the real details message (poster + Open Link)
                    firstMsg = await waitForBotMessage(tg, searchBot, 60000, (m) => {
                        // Prefer message that has media or Open Link
                        return !!(m.media || (m.replyMarkup && extractBotLink(m)));
                    });
                }
            }

            const targetMsg = firstMsg;
            const captionText = targetMsg.message || 'No Details Provided';

            // ──────────────────────────────────────────────
            // 3. Download poster (if available)
            // ──────────────────────────────────────────────
            const tempDir = path.join(process.cwd(), 'temp_cartoons');
            if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

            if (targetMsg.media && targetMsg.media.photo) {
                posterPath = path.join(tempDir, `poster_${Date.now()}.jpg`);
                await tg.downloadMedia(targetMsg.media, { outputFile: posterPath });

                if (fs.existsSync(posterPath)) {
                    await socket.sendMessage(
                        sender,
                        {
                            image: { url: posterPath },
                            caption: `🎬 *Cartoon Found!*\n\n${captionText}\n\n⏳ Video file එක Disk එකට Download වෙමින් පවතී...`
                        },
                        { quoted: msg }
                    );
                }
            } else {
                await socket.sendMessage(
                    sender,
                    { text: `🎬 *Cartoon Found!*\n\n${captionText}\n\n⏳ Video file එක Disk එකට Download වෙමින් පවතී...` },
                    { quoted: msg }
                );
            }

            // ──────────────────────────────────────────────
            // 4. Extract Open Link → bot username + start param
            // ──────────────────────────────────────────────
            const linkInfo = extractBotLink(targetMsg);

            if (!linkInfo) {
                throw new Error('Video එක Download කිරීමට අදාළ Bot Link එක හමු වුණේ නැත. (Open Link button නැත)');
            }

            const { botUsername, startParam } = linkInfo;

            // ──────────────────────────────────────────────
            // 5. Start the video bot and wait for the media
            // ──────────────────────────────────────────────
            const videoBot = await tg.getEntity(botUsername);
            await tg.sendMessage(videoBot, { message: `/start ${startParam}` });

            const videoMsg = await waitForBotMessage(tg, videoBot, 120000, (m) => !!m.media);

            if (!videoMsg || !videoMsg.media) {
                throw new Error('Bot එකෙන් Video File එක ලැබුණේ නැත.');
            }

            let videoName = `cartoon_${Date.now()}.mp4`;
            let fileSize = 0;

            if (videoMsg.media.document) {
                fileSize = Number(videoMsg.media.document.size) || 0;
                const attr = videoMsg.media.document.attributes?.find(a => a.className === 'DocumentAttributeFilename');
                if (attr) videoName = attr.fileName;
            }

            videoPath = path.join(tempDir, `temp_\( {Date.now()}_ \){videoName}`);

            await socket.sendMessage(
                sender,
                { text: `⬇️ *Downloading Video to Disk...*\n\n📄 File: ${videoName}\n📦 Size: ${formatBytes(fileSize)}` },
                { quoted: msg }
            );

            await tg.downloadMedia(videoMsg.media, {
                outputFile: videoPath,
                workers: 4
            });

            if (!fs.existsSync(videoPath) || fs.statSync(videoPath).size === 0) {
                throw new Error('Video එක Disk එකට Download වීම අසාර්ථක විය.');
            }

            const downloadedSize = fs.statSync(videoPath).size;
            const MAX_DIRECT_VIDEO_SIZE = 64 * 1024 * 1024; // 64 MB

            await socket.sendMessage(
                sender,
                { text: `📤 *Uploading to WhatsApp...*\n\n📄 File: ${videoName}\n📦 Size: ${formatBytes(downloadedSize)}` },
                { quoted: msg }
            );

            // ──────────────────────────────────────────────
            // 6. Send to WhatsApp
            // ──────────────────────────────────────────────
            if (downloadedSize <= MAX_DIRECT_VIDEO_SIZE) {
                await socket.sendMessage(
                    sender,
                    {
                        video: { url: videoPath },
                        caption: `✅ *Downloaded Successfully*\n📄 ${videoName}\n📦 ${formatBytes(downloadedSize)}`,
                        mimetype: 'video/mp4'
                    },
                    { quoted: msg }
                );
            } else {
                await socket.sendMessage(
                    sender,
                    {
                        document: { url: videoPath },
                        fileName: videoName,
                        mimetype: 'video/mp4',
                        caption: `✅ *Downloaded Successfully*\n📄 ${videoName}\n📦 ${formatBytes(downloadedSize)}`
                    },
                    { quoted: msg }
                );
            }

            await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

        } catch (err) {
            console.error('Cartoon Disk Download Error:', err);
            await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
            await socket.sendMessage(
                sender,
                { text: `❌ *දෝෂයක් සිදු විය:*\n${err.message || err}` },
                { quoted: msg }
            );
        } finally {
            // Clean temp files after a short delay
            setTimeout(() => {
                if (posterPath && fs.existsSync(posterPath)) {
                    try { fs.unlinkSync(posterPath); } catch (e) {}
                }
                if (videoPath && fs.existsSync(videoPath)) {
                    try {
                        fs.unlinkSync(videoPath);
                        console.log(`[+] Temp Video Deleted Successfully: ${videoPath}`);
                    } catch (e) {
                        console.error('[-] Temp Video Deletion Failed:', e);
                    }
                }
            }, 4000);
        }
    }
};