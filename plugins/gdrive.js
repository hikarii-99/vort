const axios = require('axios');

module.exports = {
    command: ['gdrive', 'gddl'],
    description: 'Download files from Google Drive',
    ownerOnly: false,

    handler: async ({ socket, msg, sender, args }) => {
        try {
            const url = args[0];

            if (!url || !url.includes('drive.google.com')) {
                return await socket.sendMessage(sender, { 
                    text: "📌 *Please provide a valid Google Drive URL!*\nExample: `.gdrive https://drive.google.com/file/d/...`" 
                }, { quoted: msg });
            }

            // Loading reaction
            await socket.sendMessage(sender, { react: { text: '⏳', key: msg.key } });

            // API එකට request එක යවනවා
            const apiUrl = `https://apis.davidcyriltech.my.id/gdrive?url=${encodeURIComponent(url)}`;
            const { data } = await axios.get(apiUrl);

            if (!data || !data.success || !data.download_link) {
                return await socket.sendMessage(sender, { text: "❌ *Failed to get download link! Check the URL or permissions.*" }, { quoted: msg });
            }

            // File එක Document එකක් විදිහට යවනවා
            await socket.sendMessage(sender, {
                document: { url: data.download_link },
                mimetype: data.mimeType || 'application/octet-stream',
                fileName: data.name || 'file.zip',
                caption: `✅ *Google Drive Download Successful*\n\n📄 *Name:* ${data.name}\n⚖️ *Size:* ${data.size}\n\n*Made by Pansilu Nethmina*`
            }, { quoted: msg });

            await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

        } catch (error) {
            console.error("GDrive Error:", error);
            await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
            await socket.sendMessage(sender, { text: "❌ *Error downloading file from Drive!*" }, { quoted: msg });
        }
    }
};
