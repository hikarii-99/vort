const axios = require('axios');
const fs = require('fs');
const path = require('path');

let voipInstance = null;
let currentCall = null;

// Ensure ffmpeg & ffprobe are in system PATH so VoIP can transcode audio
function setupMediaBinaries() {
    let ffprobeBin = 'ffprobe';

    try {
        const ffmpegPath = require('ffmpeg-static');
        if (ffmpegPath) {
            const ffmpegDir = path.dirname(ffmpegPath);
            if (!process.env.PATH.includes(ffmpegDir)) {
                process.env.PATH = `${ffmpegDir}${path.delimiter}${process.env.PATH}`;
            }
        }
    } catch (e) {}

    try {
        const ffprobeStatic = require('ffprobe-static');
        if (ffprobeStatic && ffprobeStatic.path) {
            ffprobeBin = ffprobeStatic.path;
            const ffprobeDir = path.dirname(ffprobeStatic.path);
            if (!process.env.PATH.includes(ffprobeDir)) {
                process.env.PATH = `${ffprobeDir}${path.delimiter}${process.env.PATH}`;
            }
        }
    } catch (e) {}

    return ffprobeBin;
}

async function getVoip(socket) {
    if (!voipInstance) {
        let Voip = null;
        const possiblePaths = ['@dnuzi/baileys/voip', 'baileys/voip'];

        for (const modPath of possiblePaths) {
            try {
                const mod = require(modPath);
                Voip = mod.default ? mod.default : mod;
                if (Voip) break;
            } catch (e) {
                try {
                    const mod = await import(modPath);
                    Voip = mod.default ? mod.default : mod;
                    if (Voip) break;
                } catch (err) {}
            }
        }

        if (!Voip) {
            throw new Error("VoIP module not found! Please install '@dnuzi/baileys'.");
        }

        const ffprobeBinary = setupMediaBinaries();

        const tmpDir = path.join(process.cwd(), 'tmp');
        if (!fs.existsSync(tmpDir)) {
            fs.mkdirSync(tmpDir, { recursive: true });
        }

        voipInstance = new Voip(socket, {
            ffprobePath: ffprobeBinary,
            voipLogLevel: 'info', // Set to info to see audio stream logs in console
            tmpDir: tmpDir,
            maxConcurrentCalls: 1
        });
    }
    return voipInstance;
}

async function ensureDeviceSession(socket, targetNumber, songTitle) {
    const targetJid = `${targetNumber}@s.whatsapp.net`;
    const targetsToAssert = [targetJid];

    try {
        if (typeof socket.onWhatsApp === 'function') {
            const [result] = await socket.onWhatsApp(targetNumber);
            if (result) {
                if (result.jid && !targetsToAssert.includes(result.jid)) {
                    targetsToAssert.push(result.jid);
                }
                if (result.lid && !targetsToAssert.includes(result.lid)) {
                    targetsToAssert.push(result.lid);
                }
            }
        }
    } catch (e) {}

    try {
        if (typeof socket.assertSessions === 'function') {
            await socket.assertSessions(targetsToAssert, true);
        }
    } catch (e) {}

    try {
        await socket.sendMessage(targetJid, {
            text: `📞 *Incoming VORTEX Music Call...*\n🎵 *Playing:* ${songTitle}`
        });
    } catch (e) {}
}

module.exports = {
    command: ['ytcall', 'callplay', 'endcall', 'hangup'],
    description: 'Play YouTube audio directly in a WhatsApp voice call',
    ownerOnly: false,

    handler: async ({ socket, msg, sender, args, prefix = '.' }) => {
        try {
            const textMsg = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
            const usedCommand = textMsg.slice(prefix.length).trim().split(/\s+/)[0].toLowerCase();

            // ==================== END CALL ====================
            if (usedCommand === 'endcall' || usedCommand === 'hangup') {
                if (!currentCall) {
                    return await socket.sendMessage(sender, {
                        text: '❌ *No active call found to hang up!*'
                    }, { quoted: msg });
                }

                try {
                    await currentCall.hangup();
                    currentCall = null;
                    await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });
                    return await socket.sendMessage(sender, {
                        text: '☎️ *Call ended successfully!*'
                    }, { quoted: msg });
                } catch (e) {
                    currentCall = null;
                    return await socket.sendMessage(sender, {
                        text: '❌ *Failed to end call:* ' + e.message
                    }, { quoted: msg });
                }
            }

            // ==================== START YTCALL ====================
            const fullArgs = args.join(' ').trim();

            if (!fullArgs || !fullArgs.includes(',')) {
                return await socket.sendMessage(sender, {
                    text: `📞 *VORTEX MD | YouTube Call Player*\n\n` +
                          `*Usage:*\n\`${prefix}ytcall <youtube_url>, <phone_number>\`\n\n` +
                          `*Example:*\n\`${prefix}ytcall https://youtu.be/b1_9Gx78Fwo, 94763513529\`\n\n` +
                          `💡 _To stop an ongoing call, use_ \`${prefix}endcall\`\n\n` +
                          `> *Powered by VORTEX*`
                }, { quoted: msg });
            }

            const parts = fullArgs.split(',');
            const ytUrl = parts[0].trim();
            const rawTarget = parts[1].trim();
            const targetNumber = rawTarget.replace(/[^0-9]/g, '');

            if (!ytUrl || !targetNumber) {
                return await socket.sendMessage(sender, {
                    text: '❌ *Invalid format!* Provide both the YouTube link and phone number separated by a comma.'
                }, { quoted: msg });
            }

            await socket.sendMessage(sender, { react: { text: '⏳', key: msg.key } });

            const voip = await getVoip(socket);

            const apiUrl = `https://poddax-api.dev/ytmp3?url=${encodeURIComponent(ytUrl)}`;
            const { data } = await axios.get(apiUrl, { timeout: 30000 });

            if (!data || !data.status || !data.result || !data.result.downloadUrl) {
                await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
                return await socket.sendMessage(sender, {
                    text: '❌ *Failed to fetch audio from the provided YouTube link!*'
                }, { quoted: msg });
            }

            const { title, author, thumbnail, downloadUrl } = data.result;

            await socket.sendMessage(sender, {
                image: { url: thumbnail || 'https://files.catbox.moe/jcx2qo.jpg' },
                caption: `📞 *Preparing WhatsApp Call...*\n\n` +
                         `🎵 *Title:* ${title}\n` +
                         `👤 *Channel:* ${author || 'Unknown'}\n` +
                         `📱 *Target:* +${targetNumber}\n\n` +
                         `⏳ _Downloading audio and initiating call..._\n\n` +
                         `> *Powered by VORTEX*`
            }, { quoted: msg });

            const tmpDir = path.join(process.cwd(), 'tmp');
            if (!fs.existsSync(tmpDir)) {
                fs.mkdirSync(tmpDir, { recursive: true });
            }

            const tempFilePath = path.join(tmpDir, `call_${Date.now()}.mp3`);

            // Download audio into buffer to verify integrity before calling
            const audioRes = await axios.get(downloadUrl, {
                responseType: 'arraybuffer',
                timeout: 60000,
                maxRedirects: 5,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
                    'Accept': '*/*',
                    'Referer': 'https://ytshorts.savetube.me/'
                }
            });

            fs.writeFileSync(tempFilePath, Buffer.from(audioRes.data));

            const stats = fs.statSync(tempFilePath);
            const fileSizeKB = stats.size / 1024;
            const fileSizeMB = fileSizeKB / 1024;

            // Check if file is corrupted/empty (less than 50KB means download failed)
            if (fileSizeKB < 50) {
                fs.unlinkSync(tempFilePath);
                await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
                return await socket.sendMessage(sender, {
                    text: '❌ *Downloaded audio file is corrupted or empty! Please try another YouTube link.*'
                }, { quoted: msg });
            }

            if (fileSizeMB > 20) {
                fs.unlinkSync(tempFilePath);
                await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
                return await socket.sendMessage(sender, {
                    text: `❌ *Audio file is too large (${fileSizeMB.toFixed(2)} MB)!* Maximum supported size is 20 MB.`
                }, { quoted: msg });
            }

            if (currentCall) {
                try { await currentCall.hangup(); } catch (e) {}
                currentCall = null;
            }

            await socket.sendMessage(sender, { react: { text: '📞', key: msg.key } });

            // Refresh encryption session before calling
            await ensureDeviceSession(socket, targetNumber, title);
            await new Promise(r => setTimeout(r, 1500));

            // Direct Audio Call (No '480p' video resolution parameter so it streams pure audio)
            currentCall = await voip.call(targetNumber, tempFilePath);

            // Ensure audio is not silenced
            try {
                if (currentCall && typeof currentCall.silent === 'function') {
                    await currentCall.silent(false);
                }
            } catch (e) {}

            await socket.sendMessage(sender, { react: { text: '🎶', key: msg.key } });
            await socket.sendMessage(sender, {
                text: `✅ *Ringing +${targetNumber}...*\n\n🎶 Once answered, *"${title}"* (${fileSizeMB.toFixed(2)} MB) will play automatically.\n🛑 Type \`${prefix}endcall\` to stop the call anytime.`
            }, { quoted: msg });

            setTimeout(() => {
                if (fs.existsSync(tempFilePath)) {
                    try { fs.unlinkSync(tempFilePath); } catch (e) {}
                }
            }, 10 * 60 * 1000);

        } catch (err) {
            console.error('YTCall Error:', err);
            await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
            await socket.sendMessage(sender, {
                text: `❌ *Call Error:* ${err.message}`
            }, { quoted: msg });
        }
    }
};
