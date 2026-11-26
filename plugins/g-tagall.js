module.exports = {
    command: ['tagall', 'everyone', 'all'],
    description: 'Mention all members in the group visibly',
    ownerOnly: false,

    handler: async ({ socket, msg, sender, args, isGroup }) => {
        try {
            if (!isGroup) {
                return await socket.sendMessage(sender, { 
                    text: "❌ *This command can only be used in groups!*" 
                }, { quoted: msg });
            }

            await socket.sendMessage(sender, { react: { text: '⏳', key: msg.key } });

            // Group Metadata එක හරහා Participants ලබා ගැනීම
            const metadata = await socket.groupMetadata(sender);
            const participants = metadata.participants || [];

            if (participants.length === 0) {
                await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
                return await socket.sendMessage(sender, { 
                    text: "❌ *Failed to fetch group participants!*" 
                }, { quoted: msg });
            }

            // Quoted message එකක Text එකක් ඇත්නම් එය ලබාගැනීම
            const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            const quotedText = quotedMsg?.conversation || 
                               quotedMsg?.extendedTextMessage?.text || 
                               quotedMsg?.imageMessage?.caption || 
                               quotedMsg?.videoMessage?.caption;

            let customMessage = args.join(" ") || quotedText || "Hey everyone! 👋";

            let teks = `📢 *TAG ALL MEMBERS*\n\n` +
                       `📝 *Message:* ${customMessage}\n\n` +
                       `✨ *Group Members:*\n`;

            for (let mem of participants) {
                teks += `🔹 @${mem.id.split("@")[0]}\n`;
            }

            teks += `\n📊 *Total:* ${participants.length}\n\n` +
                    `🚀 *Powered by Bot*`;

            await socket.sendMessage(sender, { 
                text: teks, 
                mentions: participants.map(p => p.id) 
            }, { quoted: msg });

            await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

        } catch (err) {
            console.error("TAGALL ERROR:", err);
            await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
            await socket.sendMessage(sender, { 
                text: "❌ *Failed to tag members!*" 
            }, { quoted: msg });
        }
    }
};
