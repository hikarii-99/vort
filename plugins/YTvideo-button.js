const axios = require('axios');
const yts = require('yt-search');
const { generateWAMessageFromContent, proto, prepareWAMessageMedia } = require('baileys');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const API_BASE = 'https://vortex-api-theta.vercel.app/download/ytmp4';
const QUALITIES = ['144', '240', '360', '480', '720', '1080'];

async function searchYT(query) {
    const r = await yts(query);
    const videos = r.videos;
    if (!videos.length) throw new Error('No results found');
    return videos[0];
}

// 1. Primary & Fallback Download API
async function downloadYT(url, quality) {
    // පළමු උත්සාහය: Vortex API
    try {
        const { data } = await axios.get(`${API_BASE}?url=${encodeURIComponent(url)}&quality=${quality}`, { timeout: 30000 });
        if (data && data.status && data.result?.dl_link) {
            return data.result;
        }
    } catch (err) {
        console.warn('Vortex API failed, trying fallback API...');
    }

    // දෙවන උත්සාහය: Backup YTMP4 API (Failover)
    try {
        const res = await axios.get(`https://api.siputzx.my.id/api/d/ytmp4?url=${encodeURIComponent(url)}`, { timeout: 30000 });
        if (res.data?.status && res.data?.data?.dl) {
            return {
                title: res.data.data.title,
                dl_link: res.data.data.dl
            };
        }
    } catch (e) {
        // තුන්වන උත්සාහය: තවත් Backup API එකක්
        const res2 = await axios.get(`https://api.giftedtech.my.id/api/download/ytmp4?apikey=gifted&url=${encodeURIComponent(url)}`, { timeout: 30000 });
        if (res2.data?.success && res2.data?.result?.download_url) {
            return {
                title: res2.data.result.title,
                dl_link: res2.data.result.download_url
            };
        }
    }

    throw new Error('All download APIs failed. YouTube might have blocked requests.');
}

// 2. Server Block නොවී File එක බාගැනීම
async function downloadToFile(url, filePath) {
    const response = await axios({
        url,
        method: 'GET',
        responseType: 'stream',
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Accept': '*/*',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive'
        },
        timeout: 120000
    });

    return new Promise((resolve, reject) => {
        const writer = fs.createWriteStream(filePath);
        response.data.pipe(writer);
        let error = null;
        writer.on('error', err => {
            error = err;
            writer.close();
            reject(err);
        });
        writer.on('close', () => {
            if (!error) resolve(true);
        });
    });
}

module.exports = {
    command: ['yt', 'ytdl', 'youtube', 'video'],
    description: 'Download YouTube Videos',

    handler: async ({ socket, msg, sender, args, prefix }) => {
        try {
            const input = args.join(' ').trim();

            if (!input) {
                return await socket.sendMessage(sender, {
                    text: `━━━[ 🎬 𝙑𝙄𝘿𝙀𝙊 𝘿𝙊𝙒𝙉𝙇𝙊𝘼𝘿𝙀𝙍 🎬 ]━━━╮\n\n` +
                        `*Usage:*\n` +
                        `${prefix}yt <video name>\n` +
                        `${prefix}yt <youtube url>\n\n` +
                        `*Example:*\n` +
                        `${prefix}yt Alan Walker Faded\n` +
                        `${prefix}yt https://youtu.be/xxxxx\n\n` +
                        `╰━━━[ 𝕍𝕆ℝ𝕋𝔼𝕏 𝕄𝔻 ]━━━╯`
                }, { quoted: msg });
            }

            await socket.sendMessage(sender, { react: { text: '🔍', key: msg.key } });

            const isUrl = /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|shorts\/))([\w-]+)/.test(input);
            let videoUrl, ytdata;

            if (isUrl) {
                videoUrl = input.split('&')[0];
                try {
                    const videoId = videoUrl.match(/(?:youtu\.be\/|v=|shorts\/)([\w-]+)/)?.[1];
                    if (videoId) {
                        const videoDetails = await yts({ videoId });
                        ytdata = videoDetails;
                    } else {
                        ytdata = { title: 'YouTube Video', url: videoUrl };
                    }
                } catch (e) {
                    ytdata = { title: 'YouTube Video', url: videoUrl };
                }
            } else {
                ytdata = await searchYT(input);
                videoUrl = ytdata.url;
            }

            const menuCaption = `━━━[ 🎬 𝙑𝙄𝘿𝙀𝙊 𝘿𝙊𝙒𝙉𝙇𝙊𝘼𝘿𝙀𝙍 🎬 ]━━━╮\n\n` +
                `📌 *Title:* ${ytdata.title || 'YouTube Video'}\n` +
                `🎬 *Channel:* ${ytdata.author?.name || 'YouTube'}\n` +
                `👁️ *Views:* ${ytdata.views || 'N/A'}\n` +
                `⏱️ *Duration:* ${ytdata.timestamp || 'N/A'}\n` +
                `🕒 *Uploaded:* ${ytdata.ago || 'N/A'}\n` +
                `🔗 *Link:* ${videoUrl}\n\n` +
                `╰━━━[ 𝕍𝕆ℝ𝕋𝔼𝕏 𝕄𝔻 ]━━━╯`;

            const thumb = ytdata.thumbnail || ytdata.image || 'https://files.catbox.moe/jcx2qo.jpg';

            const media = await prepareWAMessageMedia(
                { image: { url: thumb } },
                { upload: socket.waUploadToServer }
            );

            const interactiveMsg = proto.Message.InteractiveMessage.create({
                body: proto.Message.InteractiveMessage.Body.create({ text: menuCaption }),
                footer: proto.Message.InteractiveMessage.Footer.create({ text: "© POWERED BY VORTEX BOT TEAM" }),
                header: proto.Message.InteractiveMessage.Header.create({
                    hasMediaAttachment: true,
                    imageMessage: media.imageMessage
                }),
                nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
                    buttons: [
                        {
                            name: "single_select",
                            buttonParamsJson: JSON.stringify({
                                title: "🎥 Download Video",
                                sections: [
                                    {
                                        title: "SELECT VIDEO QUALITY",
                                        rows: [
                                            { title: "144p Video", description: "Low quality", id: "1.1" },
                                            { title: "240p Video", description: "Standard low", id: "1.2" },
                                            { title: "360p Video", description: "Mobile quality", id: "1.3" },
                                            { title: "480p Video", description: "Medium quality", id: "1.4" },
                                            { title: "720p Video", description: "HD quality", id: "1.5" },
                                            { title: "1080p Video", description: "Full HD", id: "1.6" }
                                        ]
                                    }
                                ]
                            })
                        },
                        {
                            name: "single_select",
                            buttonParamsJson: JSON.stringify({
                                title: "📁 Download Document",
                                sections: [
                                    {
                                        title: "SELECT DOCUMENT QUALITY",
                                        rows: [
                                            { title: "144p Document", description: "Low quality file", id: "2.1" },
                                            { title: "240p Document", description: "Standard low file", id: "2.2" },
                                            { title: "360p Document", description: "Standard file", id: "2.3" },
                                            { title: "480p Document", description: "Medium file", id: "2.4" },
                                            { title: "720p Document", description: "HD file", id: "2.5" },
                                            { title: "1080p Document", description: "Full HD file", id: "2.6" }
                                        ]
                                    }
                                ]
                            })
                        }
                    ]
                }),
                contextInfo: { mentionedJid: [sender] }
            });

            const fullMsg = generateWAMessageFromContent(
                sender,
                { viewOnceMessage: { message: { interactiveMessage: interactiveMsg } } },
                { quoted: msg }
            );

            await socket.relayMessage(sender, fullMsg.message, { messageId: fullMsg.key.id });
            const menuMsgId = fullMsg.key.id;

            await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

            const replyHandler = async (msgData) => {
                const reply = msgData.messages?.[0];
                if (!reply?.message || !reply.key?.remoteJid) return;

                const message = reply.message;
                const senderID = reply.key.remoteJid;

                if (senderID !== sender) return;

                let selectedOption = '';

                if (message.interactiveResponseMessage?.nativeFlowResponseMessage) {
                    try {
                        const params = JSON.parse(message.interactiveResponseMessage.nativeFlowResponseMessage.paramsJson);
                        selectedOption = params.id || params.rowId || '';
                    } catch (e) {}
                } else if (message.extendedTextMessage?.contextInfo?.stanzaId === menuMsgId) {
                    selectedOption = (message.conversation || message.extendedTextMessage?.text || '').trim();
                }

                const match = selectedOption.match(/^([12])\.([1-6])$/);

                if (match) {
                    socket.ev.off('messages.upsert', replyHandler);

                    const formatType = match[1]; 
                    const qualityIndex = parseInt(match[2]) - 1;
                    const quality = QUALITIES[qualityIndex];
                    const isVideo = formatType === '1';

                    await socket.sendMessage(senderID, { react: { text: '⏳', key: reply.key } });

                    let tempFilePath = '';

                    try {
                        const result = await downloadYT(videoUrl, quality);
                        const dlUrl = result.dl_link;

                        const title = (ytdata.title && ytdata.title !== 'YouTube Video')
                            ? ytdata.title
                            : (result.title && result.title !== 'YouTube Video' ? result.title : 'YouTube Video');

                        const caption = `🎬 *VORTEX MD | YouTube Downloader*\n\n` +
                            `📌 *${title}*\n` +
                            `🎬 Quality: ${quality}p\n` +
                            `📁 Format: ${isVideo ? 'Video' : 'Document'}\n\n` +
                            `> *Powered by VORTEX MD*`;

                        const safeTitle = title.replace(/[^a-zA-Z0-9\s_-]/g, '').trim().replace(/\s+/g, '_') || 'video';
                        const fileName = `${safeTitle}_${quality}p.mp4`;

                        tempFilePath = path.join(__dirname, `${crypto.randomBytes(6).toString('hex')}.mp4`);
                        
                        await downloadToFile(dlUrl, tempFilePath);

                        const stats = fs.statSync(tempFilePath);
                        if (stats.size < 10000) { 
                            throw new Error("File blocked or corrupted (Size too small).");
                        }

                        if (isVideo) {
                            await socket.sendMessage(senderID, {
                                video: { url: tempFilePath },
                                mimetype: 'video/mp4',
                                caption: caption
                            }, { quoted: reply });
                        } else {
                            await socket.sendMessage(senderID, {
                                document: { url: tempFilePath },
                                mimetype: 'video/mp4',
                                fileName: fileName,
                                caption: caption
                            }, { quoted: reply });
                        }

                        await socket.sendMessage(senderID, { react: { text: '✅', key: reply.key } });

                    } catch (e) {
                        console.error('YT download error:', e.message);
                        await socket.sendMessage(senderID, {
                            text: `❌ *Download failed:* ${e.message}\n\nPlease try again in a few moments.`
                        }, { quoted: reply });
                        await socket.sendMessage(senderID, { react: { text: '❌', key: reply.key } });
                    } finally {
                        if (tempFilePath && fs.existsSync(tempFilePath)) {
                            try { fs.unlinkSync(tempFilePath); } catch (err) {}
                        }
                    }
                }
            };

            socket.ev.on('messages.upsert', replyHandler);
            setTimeout(() => socket.ev.off('messages.upsert', replyHandler), 5 * 60 * 1000);

        } catch (err) {
            console.error('YT plugin error:', err.message);
            await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
            await socket.sendMessage(sender, { text: `❌ *Error:* ${err.message}` }, { quoted: msg });
        }
    }
};
