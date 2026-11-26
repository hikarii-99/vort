const axios = require('axios');
const fs = require('fs');
const os = require('os');
const path = require('path');

module.exports = {
    command: ['fb2', 'facebook2', 'fbdl2'],
    description: 'Download Facebook videos in SD or HD quality',
    ownerOnly: false,

    handler: async ({ socket, msg, sender, args }) => {
        try {
            const urlInput = args[0];

            if (!urlInput || (!urlInput.includes('facebook.com') && !urlInput.includes('fb.watch'))) {
                return await socket.sendMessage(sender, {
                    text: "❌ Please provide a valid Facebook video URL!\n📌 *Example:* `.fb https://www.facebook.com/share/v/15fNp5gHK4/`"
                }, { quoted: msg });
            }

            await socket.sendMessage(sender, { react: { text: '⏳', key: msg.key } });

            const apiUrl = `https://poddax-api.dev/fb?url=${encodeURIComponent(urlInput)}`;
            const { data } = await axios.get(apiUrl);

            if (!data || !data.status || !data.data) {
                await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
                return await socket.sendMessage(sender, {
                    text: "❌ Failed to fetch video details. Please check the link and try again!"
                }, { quoted: msg });
            }

            const videoInfo = data.data;

            const sdUrl = videoInfo.novideo || videoInfo.hdvideo || null;
            const hdUrl = videoInfo.hdvideo || null;

            if (!sdUrl && !hdUrl) {
                await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
                return await socket.sendMessage(sender, {
                    text: "❌ No downloadable video link found!"
                }, { quoted: msg });
            }

            const caption = `🎬 *VORTEX MD FB DOWNLOADER* 🎬\n\n` +
                            `📌 *Title:* ${videoInfo.title || 'Facebook Video'}\n` +
                            `⏱️ *Duration:* ${videoInfo.duration || 'N/A'}\n\n` +
                            `Please reply to this message with quality:\n\n` +
                            `1️⃣ Reply *SD* or *1* (Standard Quality)\n` +
                            `2️⃣ Reply *HD* or *2* (High Quality)\n\n` +
                            `╔══════════⚔️═══════════╗\n` +
                            `          *Made by Pansilu Nethmina*\n` +
                            `           ᐯㄖ尺ㄒ乇乂 几ᗪ 爪乇几卄\n` +
                            `╚══════════⚔️═══════════╝`;

            const sentMsg = await socket.sendMessage(sender, {
                image: { url: videoInfo.thumbnail || 'https://files.catbox.moe/jcx2qo.jpg' },
                caption: caption
            }, { quoted: msg });

            const messageID = sentMsg.key.id;

            const handler = async (msgData) => {
                const receivedMsg = msgData.messages[0];
                if (!receivedMsg?.message || !receivedMsg.key?.remoteJid) return;

                const isReplyToMenu = receivedMsg.message.extendedTextMessage?.contextInfo?.stanzaId === messageID;

                if (isReplyToMenu) {
                    const text = (receivedMsg.message.conversation || receivedMsg.message.extendedTextMessage?.text || '').trim().toUpperCase();
                    const senderID = receivedMsg.key.remoteJid;

                    let selectedUrl = null;
                    let selectedQuality = '';

                    if (text === 'SD' || text === '1') {
                        selectedUrl = sdUrl;
                        selectedQuality = 'SD';
                    } else if (text === 'HD' || text === '2') {
                        selectedUrl = hdUrl || sdUrl;
                        selectedQuality = hdUrl ? 'HD' : 'SD (HD unavailable)';
                    }

                    if (selectedUrl) {
                        await socket.sendMessage(senderID, { react: { text: '⬇️', key: receivedMsg.key } });

                        try {
                            const fileName = `fb_video_${Date.now()}.mp4`;
                            const filePath = path.join(os.tmpdir(), fileName);

                            const response = await axios({
                                url: selectedUrl,
                                method: 'GET',
                                responseType: 'stream'
                            });

                            const writer = fs.createWriteStream(filePath);
                            response.data.pipe(writer);

                            await new Promise((resolve, reject) => {
                                writer.on('finish', resolve);
                                writer.on('error', reject);
                            });

                            await socket.sendMessage(senderID, {
                                video: { url: filePath },
                                mimetype: 'video/mp4',
                                caption: `✅ *FB Video Downloaded (${selectedQuality})*\n\n*Made by Pansilu Nethmina*`
                            }, { quoted: receivedMsg });

                            if (fs.existsSync(filePath)) {
                                fs.unlinkSync(filePath);
                            }

                            await socket.sendMessage(senderID, { react: { text: '✅', key: receivedMsg.key } });

                            socket.ev.off("messages.upsert", handler);

                        } catch (err) {
                            console.error('FB Download Error:', err);
                            await socket.sendMessage(senderID, { react: { text: '❌', key: receivedMsg.key } });
                            await socket.sendMessage(senderID, { 
                                text: `❌ Download failed: ${err.message}` 
                            }, { quoted: receivedMsg });
                        }

                    } else {
                        await socket.sendMessage(senderID, {
                            text: "❌ Invalid Choice! Please reply with *SD* or *HD* (or *1* / *2*)."
                        }, { quoted: receivedMsg });
                    }
                }
            };

            socket.ev.on("messages.upsert", handler);

            setTimeout(() => {
                socket.ev.off("messages.upsert", handler);
            }, 300000);

        } catch (error) {
            console.error("FB Command Error:", error);
            await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
            await socket.sendMessage(sender, { 
                text: `❌ Error: ${error.message}` 
            }, { quoted: msg });
        }
    }
};
