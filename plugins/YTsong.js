const axios = require('axios');
const yts = require('yt-search'); // yt-search NPM package එක එකතු කර ඇත

module.exports = {
    command: ['song2', 'play2', 'ytmp3'],
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

            // මුල්ම සින්දුව තෝරාගැනීම
            const song = videos[0];

            // Option Menu එක සමඟ Thumbnail එක යැවීම
            const captionText = `🎵 *VORTEX SONG DOWNLOADER* 🎵\n\n` +
                                `📌 *Title:* ${song.title}\n` +
                                `⏱️ *Duration:* ${song.timestamp}\n` +
                                `👁️ *Views:* ${song.views ? song.views.toLocaleString() : 'N/A'}\n` +
                                `🔗 *URL:* ${song.url}\n\n` +
                                `Please reply with your option:\n\n` +
                                `1️⃣ Reply *1* or *AUDIO* (As Audio File 🎵)\n` +
                                `2️⃣ Reply *2* or *DOC* (As Document File 📄)\n\n` +
                                `*Made by Pansilu Nethmina*`;

            const sentMsg = await socket.sendMessage(sender, {
                image: { url: song.thumbnail },
                caption: captionText
            }, { quoted: msg });

            const messageID = sentMsg.key.id;

            // 2. User ගෙන් එන Reply එක Catch කරන Listener එක
            const handler = async (msgData) => {
                const receivedMsg = msgData.messages[0];
                if (!receivedMsg?.message || !receivedMsg.key?.remoteJid) return;

                const isReplyToMenu = receivedMsg.message.extendedTextMessage?.contextInfo?.stanzaId === messageID;

                if (isReplyToMenu) {
                    const text = (receivedMsg.message.conversation || receivedMsg.message.extendedTextMessage?.text || '').trim().toUpperCase();
                    const senderID = receivedMsg.key.remoteJid;

                    if (text === '1' || text === 'AUDIO' || text === '2' || text === 'DOC' || text === 'DOCUMENT') {
                        socket.ev.off("messages.upsert", handler);

                        await socket.sendMessage(senderID, { react: { text: '⬇️', key: receivedMsg.key } });

                        // Poddax API එකෙන් JSON ගෙන ඒම (URL Encode කිරීම ඉවත් කර ඇත)
                        const dlApi = `https://poddax-api.dev/ytmp3?url=${song.url}`;

                        try {
                            const { data: dlData } = await axios.get(dlApi);
                            const downloadUrl = dlData?.result?.downloadUrl;

                            if (!downloadUrl) {
                                await socket.sendMessage(senderID, { react: { text: '❌', key: receivedMsg.key } });
                                return await socket.sendMessage(senderID, { text: "❌ *Failed to fetch download link. Try again!*" }, { quoted: receivedMsg });
                            }

                            // 1 නම් Audio, 2 නම් Document
                            if (text === '1' || text === 'AUDIO') {
                                await socket.sendMessage(senderID, {
                                    audio: { url: downloadUrl },
                                    mimetype: 'audio/mp4',
                                    fileName: `${song.title}.mp3`
                                }, { quoted: receivedMsg });
                            } else if (text === '2' || text === 'DOC' || text === 'DOCUMENT') {
                                await socket.sendMessage(senderID, {
                                    document: { url: downloadUrl },
                                    mimetype: 'audio/mpeg',
                                    fileName: `${song.title}.mp3`,
                                    caption: `✅ *${song.title}*\n\n*Made by Pansilu Nethmina*`
                                }, { quoted: receivedMsg });
                            }

                            await socket.sendMessage(senderID, { react: { text: '✅', key: receivedMsg.key } });

                        } catch (e) {
                            console.error("API Fetch Error:", e.message);
                            await socket.sendMessage(senderID, { react: { text: '❌', key: receivedMsg.key } });
                            await socket.sendMessage(senderID, { text: `❌ *Download API Error: ${e.response?.status || e.message} (Server Down or Invalid Link)*` }, { quoted: receivedMsg });
                        }

                    } else {
                        await socket.sendMessage(senderID, {
                            text: "❌ Invalid Option! Please reply with *1* (Audio) or *2* (Document)."
                        }, { quoted: receivedMsg });
                    }
                }
            };

            socket.ev.on("messages.upsert", handler);

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
