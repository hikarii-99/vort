const axios = require('axios');
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');

// IPv6 (ENETUNREACH) දෝෂය මඟහැර IPv4 පමණක් භාවිතා කිරීමට Agent එකක් සැකසීම
const ipv4Agent = new https.Agent({
    family: 4,
    keepAlive: true
});

module.exports = {
    command: ['ig', 'igdl', 'instagram', 'reel', 'insta'],
    description: 'Download Instagram Reels or Posts',
    ownerOnly: false,

    handler: async ({ socket, msg, sender, args }) => {
        let filePath = null;

        try {
            const urlInput = args[0];

            if (!urlInput || !urlInput.includes('instagram.com')) {
                return await socket.sendMessage(sender, {
                    text: "❌ Please provide a valid Instagram video URL!\n📌 *Example:* `.ig https://www.instagram.com/reel/DfKl8bRqEem/`"
                }, { quoted: msg });
            }

            // Waiting Reaction
            await socket.sendMessage(sender, { react: { text: '⏳', key: msg.key } });

            // Vortex API Request
            const apiUrl = `https://vortex-api-theta.vercel.app/download/igdl?url=${encodeURIComponent(urlInput)}`;
            const { data } = await axios.get(apiUrl, {
                httpsAgent: ipv4Agent,
                timeout: 20000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
                }
            });

            // API Response Validation
            const result = data?.result;
            const mediaItem = result?.media?.[0];
            const downloadUrl = result?.dl_link || mediaItem?.url;

            if (!data || !data.status || !downloadUrl) {
                await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
                return await socket.sendMessage(sender, {
                    text: "❌ Failed to fetch video details. Please check the link and try again!"
                }, { quoted: msg });
            }

            // Downloading Reaction
            await socket.sendMessage(sender, { react: { text: '⬇️', key: msg.key } });

            const fileName = result?.filename || mediaItem?.filename || `ig_video_${Date.now()}.mp4`;
            const postType = result?.type ? result.type.toUpperCase() : 'REEL';
            const caption = `🎬 *VORTEX MD INSTAGRAM DOWNLOADER* 🎬\n\n📌 *Type:* ${postType}\n📁 *File:* ${fileName}`;

            try {
                // ක්‍රමය 1: Server එකට Download නොකර කෙලින්ම URL එක හරහා වීඩියෝව යැවීම
                await socket.sendMessage(sender, {
                    video: { url: downloadUrl },
                    mimetype: 'video/mp4',
                    fileName: fileName,
                    caption: caption
                }, { quoted: msg });

            } catch (directSendError) {
                // ක්‍රමය 2: කෙලින්ම යැවීම අසාර්ථක වුවහොත් IPv4 ඔස්සේ Temp File එකක් ලෙස Download කර යැවීම
                filePath = path.join(os.tmpdir(), fileName);

                const response = await axios({
                    url: downloadUrl,
                    method: 'GET',
                    responseType: 'stream',
                    httpsAgent: ipv4Agent,
                    timeout: 30000,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                        'Referer': 'https://www.instagram.com/'
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
                    fileName: fileName,
                    caption: caption
                }, { quoted: msg });

                if (filePath && fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                }
            }

            // Success Reaction
            await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

        } catch (error) {
            console.error("Instagram Command Error:", error);

            if (filePath && fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }

            await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
            await socket.sendMessage(sender, { 
                text: `❌ Error: ${error.message}` 
            }, { quoted: msg });
        }
    }
};
