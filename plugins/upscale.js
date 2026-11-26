const axios = require('axios');
const FormData = require('form-data');
const { downloadContentFromMessage } = require('baileys');

module.exports = {
    command: ['upscale', 'hd', 'enhance'],
    description: 'Upscale an image to x4 quality by replying to an image or sending a link',
    ownerOnly: false,

    handler: async ({ socket, msg, sender, args }) => {
        try {
            let imageUrl = args[0];

            // Quoted හෝ Caption කරලා එවපු Image එකක්දැයි පරීක්ෂා කිරීම
            const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            const imageMsg = msg.message?.imageMessage || quoted?.imageMessage;

            if (!imageUrl && !imageMsg) {
                return await socket.sendMessage(sender, {
                    text: "❌ Please reply to an image or send an image with caption `.hd`!\n📌 *Or use:* `.hd <image_url>`"
                }, { quoted: msg });
            }

            // Waiting Reaction
            await socket.sendMessage(sender, { react: { text: '⏳', key: msg.key } });

            // Image එකක් Reply/Caption කර ඇත්නම් එය Catbox වලට Upload කර URL එක ලබාගැනීම
            if (imageMsg) {
                const stream = await downloadContentFromMessage(imageMsg, 'image');
                let buffer = Buffer.from([]);
                for await (const chunk of stream) {
                    buffer = Buffer.concat([buffer, chunk]);
                }

                // Catbox.moe එකට Image Buffer එක Upload කිරීම
                const form = new FormData();
                form.append('reqtype', 'fileupload');
                form.append('fileToUpload', buffer, { filename: 'image.jpg' });

                const uploadRes = await axios.post('https://catbox.moe/user/api.php', form, {
                    headers: form.getHeaders()
                });

                imageUrl = uploadRes.data;
            }

            if (!imageUrl || typeof imageUrl !== 'string') {
                await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
                return await socket.sendMessage(sender, { text: "❌ Failed to process image!" }, { quoted: msg });
            }

            // API එක හරහා Upscale කර ගැනීම (scale=4)
            const apiUrl = `https://apis.davidcyriltech.my.id/tools/iloveimg?url=${encodeURIComponent(imageUrl.trim())}&scale=4`;

            const response = await axios.get(apiUrl, {
                responseType: 'arraybuffer'
            });

            const imageBuffer = Buffer.from(response.data, 'binary');

            const caption = `✨ *VORTEX MD IMAGE UPSCALER* ✨\n\n` +
                            `📈 *Quality:* x4 Enhanced\n\n` +
                            `╔══════════⚔️═══════════╗\n` +
                            `          *Made by Pansilu Nethmina*\n` +
                            `           ᐯㄖ尺ㄒ乇乂 几ᗪ 爪乇几卄\n` +
                            `╚══════════⚔️═══════════╝`;

            // Upscaled Image එක User ට යැවීම
            await socket.sendMessage(sender, {
                image: imageBuffer,
                caption: caption
            }, { quoted: msg });

            // Success Reaction
            await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

        } catch (error) {
            console.error("Upscale Command Error:", error);
            await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
            await socket.sendMessage(sender, { 
                text: `❌ Failed to upscale image: ${error.message}` 
            }, { quoted: msg });
        }
    }
};
