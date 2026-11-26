const axios = require('axios');
const yts = require('yt-search');

const API_BASE = 'https://vortex-api-theta.vercel.app/download/ytmp4';

const QUALITIES = ['144', '240', '360', '480', '720', '1080'];

async function searchYT(query) {
    const r = await yts(query);
    const videos = r.videos;
    if (!videos.length) throw new Error('No results found');
    return videos[0];
}

async function downloadYT(url, quality) {
    const { data } = await axios.get(`${API_BASE}?url=${encodeURIComponent(url)}&quality=${quality}`, { timeout: 60000 });
    if (!data.status || !data.result?.dl_link) throw new Error('Download failed');
    return data.result;
}

module.exports = {
    command: ['yt2', 'ytdl2', 'youtube2', 'video2'],
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

            // URL ද name ද check
            const isUrl = /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|shorts\/))([\w-]+)/.test(input);
            let videoUrl, ytdata;

            if (isUrl) {
                videoUrl = input.split('&')[0]; // clean url
                await socket.sendMessage(sender, { text: '🔄 *Loading video info...*' }, { quoted: msg });

                // Get basic info from search or use URL directly
                try {
                    const videoId = videoUrl.match(/(?:youtu\.be\/|v=)([\w-]+)/)?.[1];
                    ytdata = {
                        title: 'YouTube Video',
                        url: videoUrl,
                        thumbnail: videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : null,
                        author: { name: 'YouTube' },
                        views: 'N/A',
                        timestamp: 'N/A',
                        ago: 'N/A'
                    };
                } catch (e) {
                    ytdata = { title: 'YouTube Video', url: videoUrl };
                }
            } else {
                await socket.sendMessage(sender, { text: `🔍 *Searching: ${input}...*` }, { quoted: msg });
                ytdata = await searchYT(input);
                videoUrl = ytdata.url;
            }

            // Build menu
            const menuCaption = `━━━[ 🎬 𝙑𝙄𝘿𝙀𝙊 𝘿𝙊𝙒𝙉𝙇𝙊𝘼𝘿𝙀𝙍 🎬 ]━━━╮\n\n` +
                `📌 *Title:* ${ytdata.title}\n` +
                `🎬 *Channel:* ${ytdata.author?.name || 'YouTube'}\n` +
                `👁️ *Views:* ${ytdata.views || 'N/A'}\n` +
                `⏱️ *Duration:* ${ytdata.timestamp || 'N/A'}\n` +
                `🕒 *Uploaded:* ${ytdata.ago || 'N/A'}\n` +
                `🔗 *Link:* ${videoUrl}\n\n` +
                `━━━━━━━━━━━━━━━━━━━━━━\n` +
                `🔢 *Select Quality & Format:*\n\n` +
                `🎥 *Video Formats*\n\n` +
                ` 1.1 | 144p\n` +
                ` 1.2 | 240p\n` +
                ` 1.3 | 360p\n` +
                ` 1.4 | 480p\n` +
                ` 1.5 | 720p\n` +
                ` 1.6 | 1080p\n\n` +
                `📁 *Document Formats*\n\n` +
                ` 2.1 | 144p\n` +
                ` 2.2 | 240p\n` +
                ` 2.3 | 360p\n` +
                ` 2.4 | 480p\n` +
                ` 2.5 | 720p\n` +
                ` 2.6 | 1080p\n\n` +
                `💬 *Reply with a number to download.*\n\n` +
                `╰━━━[ 𝕍𝕆ℝ𝕋𝔼𝕏 𝕄𝔻 ]━━━╯`;

            const thumb = ytdata.thumbnail || ytdata.image;
            let menuMsg;
            if (thumb) {
                menuMsg = await socket.sendMessage(sender, {
                    image: { url: thumb },
                    caption: menuCaption
                }, { quoted: msg });
            } else {
                menuMsg = await socket.sendMessage(sender, {
                    text: menuCaption
                }, { quoted: msg });
            }

            const menuMsgId = menuMsg.key.id;

            // ── Reply Listener ──
            const replyHandler = async ({ messages }) => {
                const reply = messages[0];
                if (!reply?.message) return;
                const isReply = reply.message?.extendedTextMessage?.contextInfo?.stanzaId === menuMsgId;
                if (!isReply) return;

                const replyText = (reply.message.conversation || reply.message.extendedTextMessage?.text || '').trim();
                const match = replyText.match(/^([12])\.([1-6])$/);

                if (!match) {
                    return await socket.sendMessage(reply.key.remoteJid, {
                        text: `❌ *Invalid option!*\nEnter 1.1 to 1.6 (Video) or 2.1 to 2.6 (Document)`
                    }, { quoted: reply });
                }

                socket.ev.off('messages.upsert', replyHandler);

                const formatType = match[1]; // 1=video, 2=document
                const qualityIndex = parseInt(match[2]) - 1;
                const quality = QUALITIES[qualityIndex];
                const isVideo = formatType === '1';

                await socket.sendMessage(reply.key.remoteJid, { react: { text: '⏳', key: reply.key } });
                await socket.sendMessage(reply.key.remoteJid, {
                    text: `⬇️ *Downloading ${quality}p ${isVideo ? 'Video' : 'Document'}...*`
                }, { quoted: reply });

                try {
                    const result = await downloadYT(videoUrl, quality);
                    const dlUrl = result.dl_link;
                    const title = result.title || ytdata.title;

                    const caption = `🎬 *VORTEX MD | YouTube Downloader*\n\n` +
                        `📌 *${title}*\n` +
                        `🎬 Quality: ${quality}p\n` +
                        `📁 Format: ${isVideo ? 'Video' : 'Document'}\n\n` +
                        `> *Powered by VORTEX MD*`;

                    const fileName = title.replace(/[^a-zA-Z0-9\s]/g, '').trim().replace(/\s+/g, '_') + `_${quality}p.mp4`;

                    if (isVideo) {
                        await socket.sendMessage(reply.key.remoteJid, {
                            video: { url: dlUrl },
                            mimetype: 'video/mp4',
                            caption: caption
                        }, { quoted: reply });
                    } else {
                        await socket.sendMessage(reply.key.remoteJid, {
                            document: { url: dlUrl },
                            mimetype: 'video/mp4',
                            fileName: fileName,
                            caption: caption
                        }, { quoted: reply });
                    }

                    await socket.sendMessage(reply.key.remoteJid, { react: { text: '✅', key: reply.key } });

                } catch (e) {
                    console.error('YT download error:', e.message);
                    await socket.sendMessage(reply.key.remoteJid, {
                        text: `❌ *Download failed:* ${e.message}\n\nTry a lower quality.`
                    }, { quoted: reply });
                    await socket.sendMessage(reply.key.remoteJid, { react: { text: '❌', key: reply.key } });
                }
            };

            socket.ev.on('messages.upsert', replyHandler);
            setTimeout(() => socket.ev.off('messages.upsert', replyHandler), 5 * 60 * 1000);

        } catch (err) {
            console.error('YT plugin error:', err.message);
            await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
            await socket.sendMessage(sender, {
                text: `❌ *Error:* ${err.message}`
            }, { quoted: msg });
        }
    }
};