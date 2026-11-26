const axios = require('axios');

module.exports = {
    command: ['xvideo', 'xvd'],
    description: 'Search and download xvideos',
    ownerOnly: false,

    handler: async ({ socket, msg, sender, args }) => {
        try {
            const query = args.join(" ");
            if (!query) return await socket.sendMessage(sender, { text: "📌 *Enter a video name to search!*\nExample: `.video cat`" });

            // Search කරනවා
            const searchApi = `https://apis.davidcyriltech.my.id/search/xvideo?text=${encodeURIComponent(query)}`;
            const { data } = await axios.get(searchApi);

            if (!data.success || !data.result || data.result.length === 0) {
                return await socket.sendMessage(sender, { text: "❌ *No videos found!*" });
            }

            const results = data.result.slice(0, 5);
            let messageText = `🎬 *Video Search Results for: "${query}"*\n\n`;
            results.forEach((v, i) => {
                messageText += `${i + 1}️⃣ *${v.title}*\n⏱️ Duration: ${v.duration}\n\n`;
            });
            messageText += `*Reply with the number (1-5) to download the video.*`;

            // මුල්ම එකේ Thumbnail එකත් එක්ක යවනවා
            const sentMsg = await socket.sendMessage(sender, {
                image: { url: results[0].thumbnail },
                caption: messageText
            }, { quoted: msg });

            const messageID = sentMsg.key.id;

            // Reply එක Listener එකක් හරහා ගන්නවා
            const handler = async (msgData) => {
                const receivedMsg = msgData.messages[0];
                if (!receivedMsg?.message || !receivedMsg.key?.remoteJid) return;

                const isReply = receivedMsg.message.extendedTextMessage?.contextInfo?.stanzaId === messageID;
                if (!isReply) return;

                const choice = parseInt((receivedMsg.message.conversation || receivedMsg.message.extendedTextMessage?.text || '').trim());
                if (choice >= 1 && choice <= 5) {
                    const selectedVideo = results[choice - 1];
                    socket.ev.off("messages.upsert", handler); // Listener අයින් කරනවා

                    await socket.sendMessage(sender, { react: { text: '⏳', key: receivedMsg.key } });

                    // Download details ගන්නවා
                    const dlApi = `https://apis.davidcyriltech.my.id/xvideo?url=${encodeURIComponent(selectedVideo.url)}`;
                    const dlRes = await axios.get(dlApi);

                    if (dlRes.data && dlRes.data.download_url) {
                        // Document එකක් විදිහට යවනවා
                        await socket.sendMessage(sender, {
                            document: { url: dlRes.data.download_url },
                            mimetype: 'video/mp4',
                            fileName: `${dlRes.data.title || 'video'}.mp4`,
                            caption: `✅ *Download: ${dlRes.data.title}*\n\n*Made by Pansilu Nethmina*`
                        }, { quoted: receivedMsg });
                    }
                }
            };

            socket.ev.on("messages.upsert", handler);
            setTimeout(() => socket.ev.off("messages.upsert", handler), 300000); // විනාඩි 5න් expired

        } catch (error) {
            await socket.sendMessage(sender, { text: "❌ *Error fetching video!*" });
        }
    }
};
