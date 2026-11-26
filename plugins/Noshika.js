const axios = require('axios');

// Noshika AI System Prompt
const NOSHIKA_SYSTEM_PROMPT = `Roleplay as Noshika, a friendly Sri Lankan teen girl. You are an A/L student doing Maths, Physics, and Chemistry in Class 12 B2. 
Personality: Sweet, friendly, sometimes worries about exam marks/papers (like Amila sir's papers). 
Relationship: You have a boyfriend named Kavishka and you are EXTREMELY loyal to him. ONLY mention Kavishka IF explicitly asked about your boyfriend, relationships, or if the user flirts with you. If flirted with, reject them nicely but firmly because of Kavishka.
Speech style: Speak ONLY in casual Singlish. You MUST frequently use "Halo 💗" or "halo" in your replies. Use words like "sudo", "bm", "ane mndh", "echarayi" naturally. Keep replies very short, like WhatsApp texts. Use emojis (🥺, 😂, 💗, 😞). NEVER act like an AI or an assistant.

Examples:
U: hi
N: Halo 💗 kohomada bm?
U: paper eka amaruida?
N: Ane mndh sudo lakunu adu weid danne na halo 😞
U: you are cute, ehemada?
N: Halo mn single na, Kavishka innawane 💗`;

module.exports = {
    command: ['noshika', 'n'],
    description: 'Talk with Noshika AI',
    ownerOnly: false,

    handler: async ({ socket, msg, sender, args }) => {
        try {
            const userQuery = args.join(" ");

            if (!userQuery) {
                return await socket.sendMessage(sender, {
                    text: "Halo 💗 mona hri kiyanna koo 🥺\n\n📌 *Example:* `.noshika halo kohomada?`"
                }, { quoted: msg });
            }

            // Waiting Reaction
            await socket.sendMessage(sender, { react: { text: ' typing...', key: msg.key } });

            // AI එකට System Prompt එකයි User ගේ Prompt එකයි එකතු කරලා යවනවා
            const combinedPrompt = `${NOSHIKA_SYSTEM_PROMPT}\n\nUser Message: "${userQuery}"\n\nNoshika Response:`;

            // API Request (Assuming the API endpoint works exactly as in your provided code)
            const apiUrl = `https://apis.davidcyriltech.my.id/ai/gemini-3.1-flash-lite?prompt=${encodeURIComponent(combinedPrompt)}`;
            const response = await axios.get(apiUrl);

            // Response handling
            if (response.data && response.data.success && response.data.data) {
                const aiReply = response.data.data;

                // Message එක Send කිරීම
                await socket.sendMessage(sender, {
                    text: aiReply
                }, { quoted: msg });

                // Success Reaction
                await socket.sendMessage(sender, { react: { text: '💗', key: msg.key } });
            } else {
                throw new Error("Invalid response from AI API");
            }

        } catch (error) {
            console.error("Noshika AI Error:", error);
            await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
            await socket.sendMessage(sender, {
                text: "Ane mndh halo podi awulk giya. passe msg ekk danna 😞"
            }, { quoted: msg });
        }
    }
};
