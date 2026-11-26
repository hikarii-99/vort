const axios = require('axios');

module.exports = {
    command: ['tharushi', 'tharuu', 'ai', 'bot'],
    description: 'Chat with Tharushi (Tsundere AI)',
    ownerOnly: false,

    handler: async ({ socket, msg, sender, args, prefix }) => {
        try {
            // User ගේ ප්‍රශ්නය අරගන්නවා
            const userPrompt = args.join(' ');

            if (!userPrompt) {
                return await socket.sendMessage(sender, {
                    text: `😒 *මොකද නිකන් හූල්ලන්නේ? මොනවා හරි අහන්නකෝ!*\n\n*Usage:* ${prefix}tharuu <ඔයාගේ ප්‍රශ්නය>`
                }, { quoted: msg });
            }

            // Thinking reaction එකක් දානවා
            await socket.sendMessage(sender, {
                react: { text: '💭', key: msg.key }
            });

            // AI එකට දෙන Tsundere Personality එක සහ Rules
            const systemPrompt = `You are Tharushi (nickname: Tharuu), a cute Sinhala/English Tsundere AI girl.
Personality Rules:
1. You act slightly sharp, sassy, annoyed, or reluctant on the outside (e.g. "hmph!", "මට වැඩ තියෙනවා හැබැයි උත්තර දෙන්නම්...", "ඕකවත් දන්නේ නැද්ද?"), but inside you are sweet, caring, and helpful.
2. If asked who created/made you, say that your master/creator is Pansilu Nethmina (be proud/slightly bashful about him).
3. If the user talks in Sinhala or Singlish, strictly respond in cute natural Sinhala with Tsundere expressions. If in English, reply in English.
4. Keep replies short, engaging, and perfect for WhatsApp chat.
5.Don't mention your master's name except someone ask about him.It feel unconfortable.

User says: "${userPrompt}"`;

            // API Call එක
            const apiUrl = `https://apis.davidcyriltech.my.id/ai/gemini-3.1-flash-lite?prompt=${encodeURIComponent(systemPrompt)}`;
            const response = await axios.get(apiUrl, { timeout: 20000 });
            const data = response.data;

            if (!data || !data.success || !data.data) {
                return await socket.sendMessage(sender, {
                    text: '😒 *අනෙමන්දා.. මට උත්තර දෙන්න හිතෙන්නෙ නෑ දැන්! (API Error)*'
                }, { quoted: msg });
            }

            const aiResponse = data.data;

            // AI එකේ උත්තරය යවනවා
            await socket.sendMessage(sender, {
                text: aiResponse
            }, { quoted: msg });

            // Done reaction
            await socket.sendMessage(sender, {
                react: { text: '🌸', key: msg.key }
            });

        } catch (err) {
            console.error('Tharushi AI plugin error:', err.message);
            await socket.sendMessage(sender, {
                text: '🙄 *එකපාරටම මොකක් හරි අවුලක් ගියා! ආයෙ අහන්න එන්න එපා හොඳේ... (Error)*'
            }, { quoted: msg });
        }
    }
};
