const axios = require('axios');

module.exports = {
    command: ['mediafire', 'mfdl'],
    description: 'Download files from Mediafire',
    ownerOnly: false,

    handler: async ({ socket, msg, sender, args }) => {
        try {
            const url = args[0];

            if (!url || !url.includes('mediafire.com')) {
                return await socket.sendMessage(sender, { 
                    text: "📌 *Please provide a valid Mediafire URL!*\nExample: `.mediafire https://www.mediafire.com/file/...`" 
                }, { quoted: msg });
            }

            // Loading reaction
            await socket.sendMessage(sender, { react: { text: '⏳', key: msg.key } });

            // API එකට request එක යවනවා
            const apiUrl = `https://apis.davidcyriltech.my.id/mediafire?url=${encodeURIComponent(url)}`;
            const { data } = await axios.get(apiUrl);

            if (!data || !data.downloadLink) {
                return await socket.sendMessage(sender, { text: "❌ *Failed to get download link! Check the URL.*" }, { quoted: msg });
            }

            // File එක Document එකක් විදිහට යවනවා
            await socket.sendMessage(sender, {
                document: { url: data.downloadLink },
                mimetype: data.mimeType || 'application/octet-stream',
                fileName: data.fileName || 'file.zip',
                caption: `✅ *Mediafire Download Successful*\n\n📄 *Name:* ${data.fileName}\n⚖️ *Size:* ${data.size}\n\n*Made by Pansilu Nethmina*`
            }, { quoted: msg });

            await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

        } catch (error) {
            console.error("Mediafire Error:", error);
            await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
            await socket.sendMessage(sender, { text: "❌ *Error downloading file!*" }, { quoted: msg });
        }
    }
};
