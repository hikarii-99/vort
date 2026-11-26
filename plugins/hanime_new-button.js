const axios = require('axios');
const https = require('https');
const { generateWAMessageFromContent, proto, prepareWAMessageMedia } = require('baileys');

// Memory Map to store active user sessions
const activeSessions = new Map();

// Force IPv4 to prevent ENETUNREACH & ETIMEDOUT errors
const httpsAgent = new https.Agent({
    family: 4,
    keepAlive: true,
    timeout: 60000
});

const delay = (ms) => new Promise(r => setTimeout(r, ms));

// Clear existing user session and free up memory
function clearUserSession(socket, senderID) {
    if (activeSessions.has(senderID)) {
        const oldSession = activeSessions.get(senderID);
        if (oldSession.stepHandler) socket.ev.off('messages.upsert', oldSession.stepHandler);
        if (oldSession.timeout) clearTimeout(oldSession.timeout);
        activeSessions.delete(senderID);
    }
}

module.exports = {
    command: ['hanime'],
    description: 'Search and download hanime videos',
    ownerOnly: false,

    handler: async ({ socket, msg, sender, args, prefix = '.' }) => {
        try {
            const query = args.join(" ").trim();

            if (!query) {
                return await socket.sendMessage(sender, { 
                    text: `📌 *Please provide a search term!*\nExample: \`${prefix}hanime amanee\`\n\n> *Powered by VORTEX*` 
                }, { quoted: msg });
            }

            // Clear previous session when starting a new search
            clearUserSession(socket, sender);

            await socket.sendMessage(sender, { react: { text: '🔍', key: msg.key } });

            // 1. Fetch search results from API
            const searchApi = `https://poddax-api.dev/hanime2/search?text=${encodeURIComponent(query)}`;
            const { data: searchData } = await axios.get(searchApi, { httpsAgent, timeout: 20000 });

            if (!searchData || !searchData.status || !searchData.result || searchData.result.length === 0) {
                await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
                return await socket.sendMessage(sender, { text: "❌ *No results found!*" }, { quoted: msg });
            }

            // Limit search results to top 12
            const topResults = searchData.result.slice(0, 12);

            const fallbackImage = "https://u.pone.rs/iyhqahtk.jpg";
            const firstImage = topResults[0]?.thumbnail || fallbackImage;

            let media;
            try {
                media = await prepareWAMessageMedia(
                    { image: { url: firstImage } },
                    { upload: socket.waUploadToServer }
                );
            } catch (e) {
                media = await prepareWAMessageMedia(
                    { image: { url: fallbackImage } },
                    { upload: socket.waUploadToServer }
                );
            }

            // Build button rows (Prefix IDs with "hanime_dl_" to avoid conflicts)
            const rows = topResults.map((item, index) => ({
                title: `${index + 1}. ${item.title.slice(0, 24)}`,
                description: item.title,
                id: `hanime_dl_${index + 1}`
            }));

            const interactiveMsg = proto.Message.InteractiveMessage.create({
                body: proto.Message.InteractiveMessage.Body.create({ 
                    text: `🔞 *VORTEX MD | Hanime Search*\n\n🔍 *Query:* ${query}\n📊 *Showing:* Top ${topResults.length} Results\n\n*(Select an option from the button below to download. You can select multiple videos from this list)*` 
                }),
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
                                title: " Select Video",
                                sections: [
                                    {
                                        title: "TOP 12 SEARCH RESULTS",
                                        rows: rows
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
            const searchMsgId = fullMsg.key.id;

            await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

            // 2. Listener to handle button selection or number reply
            const stepHandler = async (msgData) => {
                const receivedMsg = msgData.messages?.[0];
                if (!receivedMsg?.message || receivedMsg.key?.remoteJid !== sender) return;

                const message = receivedMsg.message;
                const senderID = receivedMsg.key.remoteJid;
                let selectedOption = '';

                if (message.interactiveResponseMessage?.nativeFlowResponseMessage) {
                    try {
                        const params = JSON.parse(message.interactiveResponseMessage.nativeFlowResponseMessage.paramsJson);
                        const rawId = params.id || params.rowId || '';
                        if (rawId.startsWith('hanime_dl_')) {
                            selectedOption = rawId.replace('hanime_dl_', '');
                        }
                    } catch (e) {}
                } else if (message.extendedTextMessage?.contextInfo?.stanzaId === searchMsgId) {
                    selectedOption = (message.conversation || message.extendedTextMessage?.text || '').trim();
                }

                const selection = parseInt(selectedOption);

                if (!isNaN(selection) && selection >= 1 && selection <= topResults.length) {
                    const session = activeSessions.get(senderID);

                    // Queue lock to prevent simultaneous downloads
                    if (session && session.isDownloading) {
                        return await socket.sendMessage(senderID, { 
                            text: "⏳ *A video is already downloading. Please wait until it finishes before selecting the next one!*" 
                        }, { quoted: receivedMsg });
                    }

                    if (session) {
                        session.isDownloading = true;
                        // Extend session timeout by 30 minutes on each selection
                        clearTimeout(session.timeout);
                        session.timeout = setTimeout(() => clearUserSession(socket, senderID), 30 * 60 * 1000);
                    }

                    const selectedAnime = topResults[selection - 1];
                    await socket.sendMessage(senderID, { react: { text: '⬇️', key: receivedMsg.key } });

                    const dlApi = `https://poddax-api.dev/hanime2/dl?url=${encodeURIComponent(selectedAnime.url)}`;
                    
                    try {
                        const { data: dlData } = await axios.get(dlApi, { httpsAgent, timeout: 20000 });
                        
                        if (!dlData || !dlData.status || !dlData.result || !dlData.result.DownloadUrl) {
                            if (session) session.isDownloading = false;
                            await socket.sendMessage(senderID, { react: { text: '❌', key: receivedMsg.key } });
                            return await socket.sendMessage(senderID, { text: "❌ *Download link not found!*" }, { quoted: receivedMsg });
                        }

                        const downloadUrl = dlData.result.DownloadUrl;
                        const videoTitle = dlData.result.title || selectedAnime.title;
                        const safeFileName = videoTitle.replace(/[^a-zA-Z0-9_-]/g, '_') + ".mp4";

                        // Auto-Retry mechanism for video stream download & upload
                        const maxUploadRetries = 3;
                        let uploadSuccess = false;
                        let lastError = null;

                        for (let attempt = 1; attempt <= maxUploadRetries; attempt++) {
                            try {
                                if (attempt > 1) {
                                    await socket.sendMessage(senderID, { react: { text: '🔄', key: receivedMsg.key } });
                                }

                                const videoStreamRes = await axios.get(downloadUrl, {
                                    responseType: 'stream',
                                    timeout: 60000,
                                    httpsAgent: httpsAgent,
                                    headers: {
                                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36"
                                    }
                                });

                                await socket.sendMessage(senderID, {
                                    document: { stream: videoStreamRes.data },
                                    mimetype: 'video/mp4',
                                    fileName: safeFileName,
                                    caption: `✅ *${videoTitle}*\n\n💡 _Select another video from the list above to download the next one._\n\n> *Powered by VORTEX*`
                                }, { quoted: receivedMsg });

                                await socket.sendMessage(senderID, { react: { text: '✅', key: receivedMsg.key } });
                                uploadSuccess = true;
                                break;

                            } catch (e) {
                                lastError = e;
                                console.error(`Hanime upload attempt ${attempt}/${maxUploadRetries} failed:`, e.message);
                                if (attempt < maxUploadRetries) {
                                    await delay(3000);
                                }
                            }
                        }

                        if (!uploadSuccess) {
                            await socket.sendMessage(senderID, { react: { text: '❌', key: receivedMsg.key } });
                            await socket.sendMessage(senderID, {
                                text: `❌ *Failed to upload video after ${maxUploadRetries} attempts:*\n${lastError?.message || "Unknown Error"}\n\n📥 *Direct Link:*\n${downloadUrl}`
                            }, { quoted: receivedMsg });
                        }

                    } catch (err) {
                        await socket.sendMessage(senderID, { react: { text: '❌', key: receivedMsg.key } });
                        await socket.sendMessage(senderID, { text: "❌ *Error fetching download link:* " + err.message }, { quoted: receivedMsg });
                    } finally {
                        if (session) session.isDownloading = false;
                    }
                }
            };

            socket.ev.on("messages.upsert", stepHandler);

            // Automatically clear session after 30 minutes of inactivity
            const sessionTimeout = setTimeout(() => clearUserSession(socket, sender), 30 * 60 * 1000);

            activeSessions.set(sender, {
                stepHandler: stepHandler,
                timeout: sessionTimeout,
                isDownloading: false
            });

        } catch (error) {
            console.error("Hanime Downloader Error:", error);
            await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
            await socket.sendMessage(sender, { text: `❌ *Error: ${error.message}*` }, { quoted: msg });
        }
    }
};
