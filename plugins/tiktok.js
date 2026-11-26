const axios = require('axios');
const fs = require('fs');
const os = require('os');
const path = require('path');

module.exports = {
    command: ['tt2', 'tiktok2', 'ttdl'],
    description: 'Download TikTok videos without watermark, with watermark or audio',
    ownerOnly: false,

    handler: async ({ socket, msg, sender, args }) => {
        try {
            const urlInput = args[0];

            if (!urlInput || (!urlInput.includes('tiktok.com') && !urlInput.includes('vt.tiktok.com'))) {
                return await socket.sendMessage(sender, {
                    text: "❌ Please provide a valid TikTok video URL!\n📌 *Example:* `.tt https://www.tiktok.com/@alunoria/video/7657604429323029774`"
                }, { quoted: msg });
            }

            // Waiting Reaction එක දානවා
            await socket.sendMessage(sender, { react: { text: '⏳', key: msg.key } });

            // PoddaX TikTok API එකෙන් Data ගෙන ඒම
            const apiUrl = `https://poddax-api.dev/tiktok?url=${encodeURIComponent(urlInput)}`;
            const { data } = await axios.get(apiUrl);

            if (!data || !data.status || (!data.nowm && !data.wm)) {
                await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
                return await socket.sendMessage(sender, {
                    text: "❌ Failed to fetch TikTok video details. Please check the link and try again!"
                }, { quoted: msg });
            }

            const caption = `🎬 *VORTEX MD TIKTOK DOWNLOADER* 🎬\n\n` +
                            `📌 *Title:* ${data.title || 'TikTok Video'}\n` +
                            `👤 *Author:* ${data.author || 'N/A'} (@${data.username || ''})\n` +
                            `⏱️ *Duration:* ${data.duration ? data.duration + 's' : 'N/A'}\n` +
                            `👁️ *Views:* ${data.views?.toLocaleString() || '0'} | ❤️ *Likes:* ${data.likes?.toLocaleString() || '0'}\n\n` +
                            `Please reply to this message with option:\n\n` +
                            `1️⃣ Reply *1* or *NO-WM* (No Watermark Video)\n` +
                            `2️⃣ Reply *2* or *WM* (With Watermark Video)\n` +
                            `3️⃣ Reply *3* or *AUDIO* (Audio MP3 Only)\n\n`
                            ;

            // Cover Image එකත් එක්ක Options මැසේජ් එක යැවීම
            const sentMsg = await socket.sendMessage(sender, {
                image: { url: data.cover || 'https://files.catbox.moe/jcx2qo.jpg' },
                caption: caption
            }, { quoted: msg });

            const messageID = sentMsg.key.id;

            // User ගෙන් එන Reply එක Catch කරන Listener එක
            const handler = async (msgData) => {
                const receivedMsg = msgData.messages[0];
                if (!receivedMsg?.message || !receivedMsg.key?.remoteJid) return;

                // යවපු මැසේජ් එකටමද Reply කරලා තියෙන්නේ කියලා බලනවා
                const isReplyToMenu = receivedMsg.message.extendedTextMessage?.contextInfo?.stanzaId === messageID;

                if (isReplyToMenu) {
                    const text = (receivedMsg.message.conversation || receivedMsg.message.extendedTextMessage?.text || '').trim().toUpperCase();
                    const senderID = receivedMsg.key.remoteJid;

                    let selectedUrl = null;
                    let type = ''; // 'video' or 'audio'
                    let label = '';

                    if (text === '1' || text === 'NO-WM' || text === 'NOWM') {
                        selectedUrl = data.nowm || data.hd || data.wm;
                        type = 'video';
                        label = 'No Watermark Video';
                    } else if (text === '2' || text === 'WM') {
                        selectedUrl = data.wm || data.nowm;
                        type = 'video';
                        label = 'Watermark Video';
                    } else if (text === '3' || text === 'AUDIO' || text === 'MP3') {
                        selectedUrl = data.music;
                        type = 'audio';
                        label = 'Audio Track';
                    }

                    if (selectedUrl) {
                        await socket.sendMessage(senderID, { react: { text: '⬇️', key: receivedMsg.key } });

                        try {
                            const ext = type === 'audio' ? 'mp3' : 'mp4';
                            const fileName = `tt_${Date.now()}.${ext}`;
                            const filePath = path.join(os.tmpdir(), fileName);

                            // Media File එක Download කරගැනීම
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

                            // Media එක User ට යැවීම
                            if (type === 'audio') {
                                await socket.sendMessage(senderID, {
                                    audio: { url: filePath },
                                    mimetype: 'audio/mp4',
                                    ptt: false
                                }, { quoted: receivedMsg });
                            } else {
                                await socket.sendMessage(senderID, {
                                    video: { url: filePath },
                                    mimetype: 'video/mp4',
                                    caption: `✅ *TikTok ${label} Downloaded*\n\n*Made by Pansilu Nethmina*`
                                }, { quoted: receivedMsg });
                            }

                            // Temp File එක මකා දැමීම
                            if (fs.existsSync(filePath)) {
                                fs.unlinkSync(filePath);
                            }

                            await socket.sendMessage(senderID, { react: { text: '✅', key: receivedMsg.key } });

                            // වැඩේ ඉවර නිසා Listener එක නවත්වනවා
                            socket.ev.off("messages.upsert", handler);

                        } catch (err) {
                            console.error('TikTok Download Error:', err);
                            await socket.sendMessage(senderID, { react: { text: '❌', key: receivedMsg.key } });
                            await socket.sendMessage(senderID, { 
                                text: `❌ Download failed: ${err.message}` 
                            }, { quoted: receivedMsg });
                        }

                    } else {
                        await socket.sendMessage(senderID, {
                            text: "❌ Invalid Choice! Please reply with *1* (No WM), *2* (WM), or *3* (Audio)."
                        }, { quoted: receivedMsg });
                    }
                }
            };

            // Event Listener එක Activate කිරීම
            socket.ev.on("messages.upsert", handler);

            // විනාඩි 5 කින් Automatic Listener එක අයින් වෙනවා (Memory Safe)
            setTimeout(() => {
                socket.ev.off("messages.upsert", handler);
            }, 300000);

        } catch (error) {
            console.error("TikTok Command Error:", error);
            await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
            await socket.sendMessage(sender, { 
                text: `❌ Error: ${error.message}` 
            }, { quoted: msg });
        }
    }
};
