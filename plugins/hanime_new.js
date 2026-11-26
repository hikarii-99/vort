const axios = require('axios');

module.exports = {
    command: ['hanime3'],
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

            // 1. අලුත් Search API එකෙන් ප්‍රතිඵල ලබා ගැනීම
            const searchApi = `https://poddax-api.dev/hanime2/search?text=${encodeURIComponent(query)}`;
            const { data: searchData } = await axios.get(searchApi);

            if (!searchData || !searchData.status || !searchData.result || searchData.result.length === 0) {
                await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
                return await socket.sendMessage(sender, { text: "❌ *No results found!*" }, { quoted: msg });
            }

            const results = searchData.result;
            const numberEmojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
            
            // Clean UI එකක් සමඟ ලැයිස්තුව සැකසීම
            let listText = `🔍 *SEARCH RESULTS: ${query.toUpperCase()}*\n\n`;
            results.forEach((item, index) => {
                const prefix = index < 10 ? numberEmojis[index] : `*${index + 1}.*`;
                listText += `${prefix} ${item.title}\n`;
            });
            listText += `\n📥 *Reply with the number of your choice to download.*`;

            // Thumbnail එක නැත්නම් Custom Image එක යෙදීම
            const fallbackImage = "https://u.pone.rs/iyhqahtk.jpg";
            const firstImage = results[0]?.thumbnail || fallbackImage;

            const searchMsg = await socket.sendMessage(sender, {
                image: { url: firstImage },
                caption: listText
            }, { quoted: msg });

            const searchMsgId = searchMsg.key.id;

            // 2. User ගෙන් එන Reply Catch කරන Listener එක
            const stepHandler = async (msgData) => {
                const receivedMsg = msgData.messages[0];
                if (!receivedMsg?.message || !receivedMsg.key?.remoteJid) return;

                const senderID = receivedMsg.key.remoteJid;
                const quotedId = receivedMsg.message.extendedTextMessage?.contextInfo?.stanzaId;
                const text = (receivedMsg.message.conversation || receivedMsg.message.extendedTextMessage?.text || '').trim();

                if (quotedId === searchMsgId) {
                    const selection = parseInt(text);
                    if (isNaN(selection) || selection < 1 || selection > results.length) {
                        return socket.sendMessage(senderID, { text: "❌ *Invalid selection! Please enter a valid number.*" }, { quoted: receivedMsg });
                    }

                    const selectedAnime = results[selection - 1];
                    
                    // Reply කළ පසු Listener එක අක්‍රිය කිරීම
                    socket.ev.off("messages.upsert", stepHandler); 

                    await socket.sendMessage(senderID, { react: { text: '⬇️', key: receivedMsg.key } });

                    // අලුත් Download API එකෙන් Video ලින්ක් එක ලබා ගැනීම
                    const dlApi = `https://poddax-api.dev/hanime2/dl?url=${selectedAnime.url}`;
                    try {
                        const { data: dlData } = await axios.get(dlApi);
                        
                        if (!dlData || !dlData.status || !dlData.result || !dlData.result.DownloadUrl) {
                            await socket.sendMessage(senderID, { react: { text: '❌', key: receivedMsg.key } });
                            return socket.sendMessage(senderID, { text: "❌ *Download link not found!*" }, { quoted: receivedMsg });
                        }

                        const downloadUrl = dlData.result.DownloadUrl;
                        const videoTitle = dlData.result.title || selectedAnime.title;
                        
                        // වීඩියෝව Document එකක් ලෙස යැවීම
                        await socket.sendMessage(senderID, {
                            document: { url: downloadUrl },
                            mimetype: 'video/mp4',
                            fileName: `${videoTitle}.mp4`,
                            caption: `✅ *${videoTitle}*`
                        }, { quoted: receivedMsg });
                        
                        await socket.sendMessage(senderID, { react: { text: '✅', key: receivedMsg.key } });

                    } catch (err) {
                        await socket.sendMessage(senderID, { react: { text: '❌', key: receivedMsg.key } });
                        socket.sendMessage(senderID, { text: "❌ *Error fetching download link!*" }, { quoted: receivedMsg });
                    }
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
