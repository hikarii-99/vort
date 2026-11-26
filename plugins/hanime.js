const axios = require('axios');

module.exports = {
    command: ['hanime2'],
    description: 'Search and download hanime videos',
    ownerOnly: false,

    handler: async ({ socket, msg, sender, args }) => {
        try {
            const query = args.join(" ");

            if (!query) {
                return await socket.sendMessage(sender, { 
                    text: "📌 *Please provide a search term!*\nExample: `.hanime amanee`" 
                }, { quoted: msg });
            }

            await socket.sendMessage(sender, { react: { text: '⏳', key: msg.key } });

            // 1. Search API එකෙන් ප්‍රතිඵල ලබා ගැනීම
            const searchApi = `https://poddax-api.dev/hanime/search?text=${encodeURIComponent(query)}`;
            const { data: searchData } = await axios.get(searchApi);

            if (!searchData || !searchData.status || !searchData.result || searchData.result.length === 0) {
                await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
                return await socket.sendMessage(sender, { text: "❌ *No results found!*" }, { quoted: msg });
            }

            const results = searchData.result;
            const numberEmojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
            
            // Search ලැයිස්තුව නිර්මාණය කිරීම (Clean UI)
            let listText = `🔍 *SEARCH RESULTS: ${query.toUpperCase()}*\n\n`;
            results.forEach((item, index) => {
                const prefix = index < 10 ? numberEmojis[index] : `*${index + 1}.*`;
                listText += `${prefix} ${item.title}\n`;
            });
            listText += `\n📥 *Reply with the number of your choice to proceed.*`;

            const searchMsg = await socket.sendMessage(sender, {
                image: { url: "https://u.pone.rs/iyhqahtk.jpg" },
                caption: listText
            }, { quoted: msg });

            const searchMsgId = searchMsg.key.id;
            let resolutionMsgId = null;
            let selectedAnimeTitle = "";
            let dlResults = [];

            // 2. User ගෙන් එන Reply Catch කරන Listener එක
            const stepHandler = async (msgData) => {
                const receivedMsg = msgData.messages[0];
                if (!receivedMsg?.message || !receivedMsg.key?.remoteJid) return;

                const senderID = receivedMsg.key.remoteJid;
                const quotedId = receivedMsg.message.extendedTextMessage?.contextInfo?.stanzaId;
                const text = (receivedMsg.message.conversation || receivedMsg.message.extendedTextMessage?.text || '').trim();

                // පියවර 1: Search ප්‍රතිඵලයකට Reply කිරීම
                if (quotedId === searchMsgId) {
                    const selection = parseInt(text);
                    if (isNaN(selection) || selection < 1 || selection > results.length) {
                        return socket.sendMessage(senderID, { text: "❌ *Invalid selection! Please enter a valid number.*" }, { quoted: receivedMsg });
                    }

                    const selectedAnime = results[selection - 1];
                    selectedAnimeTitle = selectedAnime.title;
                    
                    await socket.sendMessage(senderID, { react: { text: '🔄', key: receivedMsg.key } });

                    // Download API එකෙන් Resolutions ලබා ගැනීම
                    const dlApi = `https://poddax-api.dev/hanime/download?url=${selectedAnime.url}`;
                    try {
                        const { data: dlData } = await axios.get(dlApi);
                        
                        if (!dlData || !dlData.status || !dlData.result || dlData.result.length === 0) {
                            return socket.sendMessage(senderID, { text: "❌ *Download links not found!*" }, { quoted: receivedMsg });
                        }

                        dlResults = dlData.result;
                        
                        // Resolutions ලැයිස්තුව නිර්මාණය කිරීම (Clean UI)
                        let resText = `🎬 *${selectedAnimeTitle}*\n\n`;
                        dlResults.forEach((res, idx) => {
                            const prefix = idx < 10 ? numberEmojis[idx] : `*${idx + 1}.*`;
                            resText += `${prefix} ${res.name}\n`;
                        });
                        resText += `\n📥 *Reply with the number of your preferred quality.*`;

                        // Image එකත් එක්කම Resolution ලැයිස්තුව යැවීම
                        const resMsg = await socket.sendMessage(senderID, {
                            image: { url: "https://u.pone.rs/iyhqahtk.jpg" },
                            caption: resText
                        }, { quoted: receivedMsg });

                        resolutionMsgId = resMsg.key.id;

                    } catch (err) {
                        socket.sendMessage(senderID, { text: "❌ *Error fetching download links!*" }, { quoted: receivedMsg });
                    }
                }

                // පියවර 2: Resolution එකකට Reply කිරීම (වීඩියෝව යැවීම)
                if (quotedId === resolutionMsgId) {
                    const resSelection = parseInt(text);
                    if (isNaN(resSelection) || resSelection < 1 || resSelection > dlResults.length) {
                        return socket.sendMessage(senderID, { text: "❌ *Invalid selection! Please enter a valid number.*" }, { quoted: receivedMsg });
                    }

                    const selectedDownload = dlResults[resSelection - 1];
                    
                    socket.ev.off("messages.upsert", stepHandler); 

                    await socket.sendMessage(senderID, { react: { text: '⬇️', key: receivedMsg.key } });

                    await socket.sendMessage(senderID, {
                        document: { url: selectedDownload.url },
                        mimetype: 'video/mp4',
                        fileName: `${selectedAnimeTitle} [${selectedDownload.name}].mp4`,
                        caption: `✅ *${selectedAnimeTitle}*\n⚙️ *Quality:* ${selectedDownload.name}`
                    }, { quoted: receivedMsg });
                    
                    await socket.sendMessage(senderID, { react: { text: '✅', key: receivedMsg.key } });
                }
            };

            socket.ev.on("messages.upsert", stepHandler);

            setTimeout(() => {
                socket.ev.off("messages.upsert", stepHandler);
            }, 300000); 

        } catch (error) {
            console.error("Hanime Downloader Error:", error);
            await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
            await socket.sendMessage(sender, { text: `❌ *Error: ${error.message}*` }, { quoted: msg });
        }
    }
};
