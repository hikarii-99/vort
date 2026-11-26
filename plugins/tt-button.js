const axios = require('axios');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { generateWAMessageFromContent, proto, prepareWAMessageMedia } = require('baileys');

const plugin = {
    command: ['tt', 'tiktok', 'ttdl'],
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

            // Waiting Reaction එක දැමීම
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
                            `👁️ *Views:* ${data.views?.toLocaleString() || '0'} | ❤️ *Likes:* ${data.likes?.toLocaleString() || '0'}`;

            // Image Media Prepare කිරීම
            const media = await prepareWAMessageMedia(
                { image: { url: data.cover || 'https://files.catbox.moe/jcx2qo.jpg' } },
                { upload: socket.waUploadToServer }
            );

            // Interactive Button Message එක සාදාගැනීම
            const interactiveMsg = proto.Message.InteractiveMessage.create({
                body: proto.Message.InteractiveMessage.Body.create({ text: caption }),
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
                                title: " Select Download Format",
                                sections: [
                                    {
                                        title: "AVAILABLE OPTIONS",
                                        rows: [
                                            { title: "No Watermark Video", description: "Download video without TikTok watermark", id: "1" },
                                            { title: "Watermark Video", description: "Download original video with watermark", id: "2" },
                                            { title: "Audio MP3", description: "Download audio track only", id: "3" }
                                        ]
                                    }
                                ]
                            })
                        }
                    ]
                }),
                contextInfo: {
                    mentionedJid: [sender]
                }
            });

            // Message එක Generate කර යැවීම
            const fullMsg = generateWAMessageFromContent(
                sender,
                {
                    viewOnceMessage: {
                        message: {
                            interactiveMessage: interactiveMsg
                        }
                    }
                },
                { quoted: msg }
            );

            await socket.relayMessage(sender, fullMsg.message, { messageId: fullMsg.key.id });
            const messageID = fullMsg.key.id;

            await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

            // User Choice Handler
            const handler = async (msgData) => {
                const receivedMsg = msgData.messages?.[0];
                if (!receivedMsg?.message || !receivedMsg.key?.remoteJid) return;

                const message = receivedMsg.message;
                const senderID = receivedMsg.key.remoteJid;
                let selectedOption = '';

                // List Button Response
                if (message.interactiveResponseMessage?.nativeFlowResponseMessage) {
                    try {
                        const params = JSON.parse(message.interactiveResponseMessage.nativeFlowResponseMessage.paramsJson);
                        selectedOption = params.id || params.rowId || '';
                    } catch (e) {}
                } 
                // Manual Text Reply (1, 2, 3)
                else if (message.extendedTextMessage?.contextInfo?.stanzaId === messageID) {
                    selectedOption = (message.conversation || message.extendedTextMessage?.text || '').trim().toUpperCase();
                }

                let selectedUrl = null;
                let type = '';
                let label = '';

                if (selectedOption === '1' || selectedOption === 'NO-WM' || selectedOption === 'NOWM') {
                    selectedUrl = data.nowm || data.hd || data.wm;
                    type = 'video';
                    label = 'No Watermark Video';
                } else if (selectedOption === '2' || selectedOption === 'WM') {
                    selectedUrl = data.wm || data.nowm;
                    type = 'video';
                    label = 'Watermark Video';
                } else if (selectedOption === '3' || selectedOption === 'AUDIO' || selectedOption === 'MP3') {
                    selectedUrl = data.music;
                    type = 'audio';
                    label = 'Audio Track';
                }

                if (selectedUrl) {
                    // duplicate messages පාලනයට listener එක අයින් කිරීම
                    socket.ev.off("messages.upsert", handler);

                    await socket.sendMessage(senderID, { react: { text: '⬇️', key: receivedMsg.key } });

                    try {
                        const ext = type === 'audio' ? 'mp3' : 'mp4';
                        const fileName = `tt_${Date.now()}.${ext}`;
                        const filePath = path.join(os.tmpdir(), fileName);

                        // Media File එක Download කිරීම
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
                                caption: `✅ *TikTok ${label} Downloaded*`
                            }, { quoted: receivedMsg });
                        }

                        // Temp File එක Delete කිරීම
                        if (fs.existsSync(filePath)) {
                            fs.unlinkSync(filePath);
                        }

                        await socket.sendMessage(senderID, { react: { text: '✅', key: receivedMsg.key } });

                    } catch (err) {
                        console.error('TikTok Download Error:', err);
                        await socket.sendMessage(senderID, { react: { text: '❌', key: receivedMsg.key } });
                        await socket.sendMessage(senderID, { 
                            text: `❌ Download failed: ${err.message}` 
                        }, { quoted: receivedMsg });
                    }
                }
            };

            socket.ev.on("messages.upsert", handler);

            // විනාඩි 5කට පසු Timeout Clean Up
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

module.exports = plugin;
