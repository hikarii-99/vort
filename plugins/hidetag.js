module.exports = {
    command: ['hidetag', 'htag', 'tagall'],
    description: 'Tag all members without showing their names',
    ownerOnly: false,

    handler: async ({ socket, msg, sender, args, isGroup }) => {
        try {
            if (!isGroup) {
                return await socket.sendMessage(sender, { 
                    text: "❌ *This command can only be used in groups!*" 
                }, { quoted: msg });
            }

            // Group Metadata එක හරහා Members ලාගේ ලැයිස්තුව ලබා ගැනීම
            const groupMetadata = await socket.groupMetadata(sender);
            const participants = groupMetadata.participants || [];

            if (participants.length === 0) {
                return await socket.sendMessage(sender, { 
                    text: "❌ *Failed to fetch group participants!*" 
                }, { quoted: msg });
            }

            // Quoted message එකක් ඇත්නම් එහි Text එක ලබාගැනීම
            const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            const quotedText = quotedMsg?.conversation || 
                               quotedMsg?.extendedTextMessage?.text || 
                               quotedMsg?.imageMessage?.caption || 
                               quotedMsg?.videoMessage?.caption;

            // Text එකක් නැත්නම් Default Message එකක් යෙදීම
            let messageText = args.join(" ") || quotedText || "Hi everyone! 👋";

            // Group එකේ සියලුම සාමාජිකයින්ට Mention කරමින් Message එක යැවීම
            await socket.sendMessage(sender, { 
                text: messageText, 
                mentions: participants.map(p => p.id) 
            });

        } catch (err) {
            console.error("HIDETAG ERROR:", err);
            await socket.sendMessage(sender, { 
                text: "❌ *Error occurred while executing hidetag!*" 
            }, { quoted: msg });
        }
    }
};
