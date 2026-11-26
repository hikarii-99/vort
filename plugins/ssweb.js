const axios = require('axios');

module.exports = {
    command: ['ss', 'ssweb', 'screenshot'],
    description: 'Take a full screenshot of any website',
    ownerOnly: false,

    handler: async ({ socket, msg, sender, args }) => {
        try {
            let urlInput = args[0];

            if (!urlInput) {
                return await socket.sendMessage(sender, {
                    text: "❌ Please provide a website URL!\n📌 *Example:* `.ss https://vortex-yt-downloader.vercel.app/`"
                }, { quoted: msg });
            }

            // HTTP / HTTPS Auto-Add
            if (!urlInput.startsWith('http://') && !urlInput.startsWith('https://')) {
                urlInput = 'https://' + urlInput;
            }

            // Waiting Reaction
            await socket.sendMessage(sender, { react: { text: '⏳', key: msg.key } });

            const apiUrl = `https://apis.davidcyriltech.my.id/ssweb?url=${encodeURIComponent(urlInput)}`;

            // API එකෙන් Binary Image Buffer එක ලබා ගැනීම
            const response = await axios.get(apiUrl, {
                responseType: 'arraybuffer'
            });

            const imageBuffer = Buffer.from(response.data, 'binary');

            const caption = `📸 *VORTEX MD WEB SCREENSHOT* 📸\n\n` +
                            `🌐 *URL:* ${urlInput}\n\n` ;

            // Buffer එක කෙලින්ම Image එකක් ලෙස යැවීම
            await socket.sendMessage(sender, {
                image: imageBuffer,
                caption: caption
            }, { quoted: msg });

            // Success Reaction
            await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

        } catch (error) {
            console.error("SSWeb Command Error:", error);
            await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
            await socket.sendMessage(sender, { 
                text: `❌ Failed to capture screenshot: ${error.message}` 
            }, { quoted: msg });
        }
    }
};
