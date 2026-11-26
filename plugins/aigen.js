const axios = require('axios');

module.exports = {
    command: ['gen', 'gptimage', 'imagine'],
    description: 'Generate AI images',
    ownerOnly: false,

    handler: async ({ socket, msg, sender, args }) => {
        try {
            const prompt = args.join(" ");

            if (!prompt) {
                return await socket.sendMessage(sender, {
                    text: "❌ *Please provide a prompt!*\n\n📌 *Example:* `.gen A beautiful anime girl in a dark forest`"
                }, { quoted: msg });
            }

            // Waiting Reaction
            await socket.sendMessage(sender, { react: { text: '🎨', key: msg.key } });

            // API URL
            const apiUrl = `https://api.ikyyxd.my.id/ai/gptimage?text=${encodeURIComponent(prompt)}`;

            // Fetch image buffer
            const response = await axios.get(apiUrl, {
                responseType: 'arraybuffer'
            });

            const imageBuffer = Buffer.from(response.data, 'utf-8');

            // Send Image
            await socket.sendMessage(sender, {
                image: imageBuffer,
                caption: `✨ *Prompt:* ${prompt}`
            }, { quoted: msg });

            // Success Reaction
            await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

        } catch (error) {
            console.error("Image Gen Error:", error);
            await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
            await socket.sendMessage(sender, {
                text: "❌ An error occurred while generating the image. Please try again later."
            }, { quoted: msg });
        }
    }
};
