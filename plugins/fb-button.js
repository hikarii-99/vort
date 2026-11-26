const axios = require('axios');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { generateWAMessageFromContent, proto, prepareWAMessageMedia } = require('baileys');

module.exports = {
    command: ['fb', 'facebook', 'fbdl'],
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

            const sdUrl = videoInfo.novideo ? videoInfo.novideo : (videoInfo.hdvideo ? videoInfo.hdvideo : null);
            const hdUrl = videoInfo.hdvideo ? videoInfo.hdvideo : null;

            if (!sdUrl && !hdUrl) {
                await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
                return await socket.sendMessage(sender, {
                    text: "❌ No downloadable video link found!"
                }, { quoted: msg });
            }

            const thumbUrl = videoInfo.thumbnail ? videoInfo.thumbnail : 'https://files.catbox.moe/jcx2qo.jpg';
            let media;
            try {
                media = await prepareWAMessageMedia(
                    { image: { url: thumbUrl } },
                    { upload: socket.waUploadToServer }
                );
            } catch (e) {
                media = await prepareWAMessageMedia(
                    { image: { url: 'https://files.catbox.moe/jcx2qo.jpg' } },
                    { upload: socket.waUploadToServer }
                );
            }

            const bodyText = `🎬 *VORTEX MD FB DOWNLOADER* 🎬\n\n` +
                             `📌 *Title:* ${videoInfo.title ? videoInfo.title : 'Facebook Video'}\n` +
                             `⏱️ *Duration:* ${videoInfo.duration ? videoInfo.duration : 'N/A'}\n\n` +
                             `Select your preferred video quality below:`;

            const footerText = `Made by Pansilu Nethmina | ᐯㄖ尺ㄒ乇乂 几ᗪ 爪乇几卄`;

            // Unique session ID to match button clicks reliably even if JID/LID changes
            const sessionTag = Date.now().toString(36);
            const sdId = `fb_sd_${sessionTag}`;
            const hdId = `fb_hd_${sessionTag}`;

            const rows = [];
            if (hdUrl) {
                rows.push({
                    title: '🌟 Download HD (High Quality)',
                    description: 'Best quality MP4 video',
                    id: hdId
                });
            }
            if (sdUrl) {
                rows.push({
                    title: '🎥 Download SD (Standard)',
                    description: 'Fast download, smaller file size',
                    id: sdId
                });
            }

            const buttons = [
                {
                    name: 'single_select',
                    buttonParamsJson: JSON.stringify({
                        title: '📥 Select Video Quality',
                        sections: [
                            {
                                title: 'AVAILABLE QUALITIES',
                                rows: rows
                            }
                        ]
                    })
                }
            ];

            // Also include Quick Reply buttons so user can tap directly
            if (hdUrl) {
                buttons.push({
                    name: 'quick_reply',
                    buttonParamsJson: JSON.stringify({
                        display_text: '🌟 Download HD',
                        id: hdId
                    })
                });
            }
            if (sdUrl) {
                buttons.push({
                    name: 'quick_reply',
                    buttonParamsJson: JSON.stringify({
                        display_text: '🎥 Download SD',
                        id: sdId
                    })
                });
            }

            const interactiveMsg = proto.Message.InteractiveMessage.create({
                body: proto.Message.InteractiveMessage.Body.create({ text: bodyText }),
                footer: proto.Message.InteractiveMessage.Footer.create({ text: footerText }),
                header: proto.Message.InteractiveMessage.Header.create({
                    hasMediaAttachment: true,
                    imageMessage: media.imageMessage
                }),
                nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
                    buttons: buttons
                }),
                contextInfo: { mentionedJid: [sender] }
            });

            const fullMsg = generateWAMessageFromContent(
                sender,
                { viewOnceMessage: { message: { interactiveMessage: interactiveMsg } } },
                { quoted: msg }
            );

            await socket.relayMessage(sender, fullMsg.message, { messageId: fullMsg.key.id });
            const messageID = fullMsg.key.id;

            await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

            const handler = async (msgData) => {
                const receivedMsg = msgData.messages ? msgData.messages[0] : null;
                if (!receivedMsg || !receivedMsg.message) return;

                // Unwrap ephemeral or viewOnce wrappers if present
                const message = receivedMsg.message.ephemeralMessage?.message ||
                                receivedMsg.message.viewOnceMessage?.message ||
                                receivedMsg.message.viewOnceMessageV2?.message ||
                                receivedMsg.message;

                let rawButtonId = '';
                let rawButtonText = '';

                // 1. Native Flow Response (single_select & quick_reply)
                if (message.interactiveResponseMessage?.nativeFlowResponseMessage) {
                    try {
                        const params = JSON.parse(message.interactiveResponseMessage.nativeFlowResponseMessage.paramsJson || '{}');
                        rawButtonId = params.id || params.rowId || params.selectedRowId || '';
                    } catch (e) {}
                    rawButtonText = message.interactiveResponseMessage?.body?.text || '';
                }
                // 2. Template Button Reply
                else if (message.templateButtonReplyMessage) {
                    rawButtonId = message.templateButtonReplyMessage.selectedId || '';
                    rawButtonText = message.templateButtonReplyMessage.selectedDisplayText || '';
                }
                // 3. Legacy Buttons Response
                else if (message.buttonsResponseMessage) {
                    rawButtonId = message.buttonsResponseMessage.selectedButtonId || '';
                    rawButtonText = message.buttonsResponseMessage.selectedDisplayText || '';
                }
                // 4. List Response
                else if (message.listResponseMessage) {
                    rawButtonId = message.listResponseMessage.singleSelectReply?.selectedRowId || '';
                    rawButtonText = message.listResponseMessage.title || '';
                }

                // Check if reply is quoting our menu message
                const contextInfo = message.extendedTextMessage?.contextInfo ||
                                    message.interactiveResponseMessage?.contextInfo ||
                                    message.templateButtonReplyMessage?.contextInfo ||
                                    message.buttonsResponseMessage?.contextInfo;

                const isReplyToMenu = contextInfo?.stanzaId === messageID;

                let choice = '';

                // Match by unique button ID
                if (rawButtonId === sdId) {
                    choice = 'SD';
                } else if (rawButtonId === hdId) {
                    choice = 'HD';
                }
                // Match if it quotes our message (either via quick_reply text or normal text reply)
                else if (isReplyToMenu) {
                    const text = (rawButtonText || message.conversation || message.extendedTextMessage?.text || '').trim().toUpperCase();
                    if (text.includes('SD') || text === '1') choice = 'SD';
                    else if (text.includes('HD') || text === '2') choice = 'HD';
                }

                if (!choice) return;

                let selectedUrl = null;
                let selectedQuality = '';

                if (choice === 'SD') {
                    selectedUrl = sdUrl;
                    selectedQuality = 'SD';
                } else if (choice === 'HD') {
                    selectedUrl = hdUrl ? hdUrl : sdUrl;
                    selectedQuality = hdUrl ? 'HD' : 'SD (HD unavailable)';
                }

                if (selectedUrl) {
                    socket.ev.off("messages.upsert", handler);

                    // Send video to original chat (`sender`) to avoid @lid delivery issues
                    await socket.sendMessage(sender, { react: { text: '⬇️', key: receivedMsg.key } });

                    try {
                        const fileName = `fb_video_${Date.now()}.mp4`;
                        const filePath = path.join(os.tmpdir(), fileName);

                        const response = await axios({
                            url: selectedUrl,
                            method: 'GET',
                            responseType: 'stream',
                            timeout: 60000,
                            headers: {
                                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
                            }
                        });

                        const writer = fs.createWriteStream(filePath);
                        response.data.pipe(writer);

                        await new Promise((resolve, reject) => {
                            writer.on('finish', resolve);
                            writer.on('error', reject);
                        });

                        await socket.sendMessage(sender, {
                            video: { url: filePath },
                            mimetype: 'video/mp4',
                            caption: `✅ *FB Video Downloaded (${selectedQuality})*\n\n*Made by Pansilu Nethmina*`
                        }, { quoted: receivedMsg });

                        if (fs.existsSync(filePath)) {
                            fs.unlinkSync(filePath);
                        }

                        await socket.sendMessage(sender, { react: { text: '✅', key: receivedMsg.key } });

                    } catch (err) {
                        console.error('FB Download Error:', err);
                        await socket.sendMessage(sender, { react: { text: '❌', key: receivedMsg.key } });
                        await socket.sendMessage(sender, { 
                            text: `❌ Download failed: ${err.message}` 
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
