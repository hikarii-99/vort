const axios = require('axios');
const yts = require('yt-search');
const { generateWAMessageFromContent, proto, prepareWAMessageMedia } = require('baileys');

const plugin = {
    command: ['song', 'play2', 'ytmp3'],
    description: 'Search and download songs as Audio or Document',
    ownerOnly: false,

    handler: async ({ socket, msg, sender, args }) => {
        try {
            const query = args.join(" ");

            if (!query) {
                return await socket.sendMessage(sender, { 
                    text: "📌 *Please provide a song name or YouTube link!*\nExample: `.song Alan Walker Faded`" 
                }, { quoted: msg });
            }

            // Waiting Reaction
            await socket.sendMessage(sender, { react: { text: '⏳', key: msg.key } });

            // 1. yt-search හරහා සින්දුව හොයාගැනීම
            const searchResults = await yts(query);
            const videos = searchResults.videos;

            if (!videos || videos.length === 0) {
                await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
                return await socket.sendMessage(sender, { text: "❌ *No songs found for your search query!*" }, { quoted: msg });
            }

            const song = videos[0];

            const captionText = `🎵 *VORTEX SONG DOWNLOADER* 🎵\n\n` +
                                `📌 *Title:* ${song.title}\n` +
                                `⏱️ *Duration:* ${song.timestamp}\n` +
                                `👁️ *Views:* ${song.views ? song.views.toLocaleString() : 'N/A'}\n` +
                                `🔗 *URL:* ${song.url}`;

            // Image Media Prepare කිරීම
            const media = await prepareWAMessageMedia(
                { image: { url: song.thumbnail } },
                { upload: socket.waUploadToServer }
            );

            // Interactive Dropdown Button Message එක සැකසීම
            const interactiveMsg = proto.Message.InteractiveMessage.create({
                body: proto.Message.InteractiveMessage.Body.create({ text: captionText }),
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
                                title: " Select Audio Format",
                                sections: [
                                    {
                                        title: "AVAILABLE FORMATS",
                                        rows: [
                                            { title: "Audio File", description: "Download as playable MP3 audio", id: "1" },
                                            { title: "Document File", description: "Download as audio document file", id: "2" }
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

            // 2. User Response Catch කරන Handler එක
            const handler = async (msgData) => {
                const receivedMsg = msgData.messages?.[0];
                if (!receivedMsg?.message || !receivedMsg.key?.remoteJid) return;

                const message = receivedMsg.message;
                const senderID = receivedMsg.key.remoteJid;
                let selectedOption = '';

                // Dropdown Button Select Response
                if (message.interactiveResponseMessage?.nativeFlowResponseMessage) {
                    try {
                        const params = JSON.parse(message.interactiveResponseMessage.nativeFlowResponseMessage.paramsJson);
                        selectedOption = params.id || params.rowId || '';
                    } catch (e) {}
                } 
                // Context reply (manual number text)
                else if (message.extendedTextMessage?.contextInfo?.stanzaId === messageID) {
                    selectedOption = (message.conversation || message.extendedTextMessage?.text || '').trim().toUpperCase();
                }

                if (selectedOption === '1' || selectedOption === 'AUDIO' || selectedOption === '2' || selectedOption === 'DOC' || selectedOption === 'DOCUMENT') {
                    // Duplicate යෑම වැළැක්වීමට Listener එක වහාම අක්‍රිය කිරීම
                    socket.ev.off("messages.upsert", handler);

                    await socket.sendMessage(senderID, { react: { text: '⬇️', key: receivedMsg.key } });

                    const dlApi = `https://poddax-api.dev/ytmp3?url=${song.url}`;

                    try {
                        const { data: dlData } = await axios.get(dlApi);
                        const downloadUrl = dlData?.result?.downloadUrl;

                        if (!downloadUrl) {
                            await socket.sendMessage(senderID, { react: { text: '❌', key: receivedMsg.key } });
                            return await socket.sendMessage(senderID, { text: "❌ *Failed to fetch download link. Try again!*" }, { quoted: receivedMsg });
                        }

                        // 1 නම් Audio, 2 නම් Document
                        if (selectedOption === '1' || selectedOption === 'AUDIO') {
                            await socket.sendMessage(senderID, {
                                audio: { url: downloadUrl },
                                mimetype: 'audio/mp4',
                                fileName: `${song.title}.mp3`
                            }, { quoted: receivedMsg });
                        } else if (selectedOption === '2' || selectedOption === 'DOC' || selectedOption === 'DOCUMENT') {
                            await socket.sendMessage(senderID, {
                                document: { url: downloadUrl },
                                mimetype: 'audio/mpeg',
                                fileName: `${song.title}.mp3`,
                                caption: `✅ *${song.title}* `
                            }, { quoted: receivedMsg });
                        }

                        await socket.sendMessage(senderID, { react: { text: '✅', key: receivedMsg.key } });

                    } catch (e) {
                        console.error("API Fetch Error:", e.message);
                        await socket.sendMessage(senderID, { react: { text: '❌', key: receivedMsg.key } });
                        await socket.sendMessage(senderID, { text: `❌ *Download API Error: ${e.response?.status || e.message} (Server Down or Invalid Link)*` }, { quoted: receivedMsg });
                    }
                }
            };

            socket.ev.on("messages.upsert", handler);

            // Timeout Clean Up
            setTimeout(() => {
                socket.ev.off("messages.upsert", handler);
            }, 300000);

        } catch (error) {
            console.error("Song Downloader Error:", error);
            await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
            await socket.sendMessage(sender, { text: `❌ *Error: ${error.message}*` }, { quoted: msg });
        }
    }
};

module.exports = plugin;
