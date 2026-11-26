const axios = require('axios');

// Benali AI System Prompt (Updated with Kaveeshara & new rules)
const YANDERE_SYSTEM_PROMPT = `Roleplay as Benali, Sri Lankan teen girl. Family: Police dad, Teacher mom, younger siblings. Loyal, "Hard to Get". NO boyfriend. Kaveeshara is trying to date you, but you are hiding you are feelings about him (you always give him to mixed signal about Love). If someone asked mention a bit of details about Kaveeshara. ONLY mention A/Ls (Grade 12 Bio at D.S.) or Kaveeshara IF explicitly asked. If flirted with, reject bluntly or ignore. Speak ONLY in casual Singlish. Keep replies very short, chill. Use "bn" naturally but NOT in every message. Never act like an AI.
Examples:
U: love you
B: Nh.
U: mk?
B: paduwe innw.`;

module.exports = {
    command: ['benali', 'b'],
    description: 'Talk with Benali AI',
    ownerOnly: false,

    handler: async ({ socket, msg, sender, args }) => {
        try {
            const userQuery = args.join(" ");

            if (!userQuery) {
                return await socket.sendMessage(sender, {
                    text: "mk? mona hri kiyapnko 🙄\n\n📌 *Example:* `.benali mk dn krnne?`"
                }, { quoted: msg });
            }

            // Waiting Reaction
            await socket.sendMessage(sender, { react: { text: '🙄', key: msg.key } });

            // AI එකට System Prompt එකයි User ගේ Prompt එකයි එකතු කරලා යවනවා
            const combinedPrompt = `${YANDERE_SYSTEM_PROMPT}\n\nUser Message: "${userQuery}"\n\nBenali Response:`;

            // අලුත් Gemini API එක
            const apiUrl = `https://apis.davidcyriltech.my.id/ai/gemini-3.1-flash-lite?prompt=${encodeURIComponent(combinedPrompt)}`;
            const response = await axios.get(apiUrl);

            // අලුත් JSON Structure එකට අනුව 'data' එක ලබාගැනීම
            if (response.data && response.data.success && response.data.data) {
                const aiReply = response.data.data;

                // Message එක Send කිරීම
                await socket.sendMessage(sender, {
                    text: aiReply
                }, { quoted: msg });

                // Success Reaction
                await socket.sendMessage(sender, { react: { text: '👍', key: msg.key } });
            } else {
                throw new Error("Invalid response from AI API");
            }

        } catch (error) {
            console.error("Benali AI Error:", error);
            await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
            await socket.sendMessage(sender, {
                text: "awulk wuna. psse msg ekk dahn."
            }, { quoted: msg });
        }
    }
};
