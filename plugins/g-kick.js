const { jidNormalizedUser } = require('baileys');

module.exports = {
    command: ['kick', 'remove'],
    description: 'Remove a member from the group',
    ownerOnly: false,

    handler: async ({ socket, msg, sender, args, isGroup }) => {
        try {
            if (!isGroup) {
                return await socket.sendMessage(sender, { 
                    text: "❌ *This command can only be used in groups!*" 
                }, { quoted: msg });
            }

            // User Admin ද කියා පමණක් Check කිරීම
            const groupMetadata = await socket.groupMetadata(sender);
            const participants = groupMetadata.participants || [];
            
            const groupAdmins = participants
                .filter(p => p.admin !== null)
                .map(p => jidNormalizedUser(p.id));

            const rawUserJid = msg.key.participant || msg.participant;
            const userJid = jidNormalizedUser(rawUserJid);

            if (!groupAdmins.includes(userJid)) {
                return await socket.sendMessage(sender, { 
                    text: "❌ *Only group admins can use this command!*" 
                }, { quoted: msg });
            }

            // Target User ව සොයා ගැනීම
            let rawTarget = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || 
                            msg.message?.extendedTextMessage?.contextInfo?.participant || 
                            (args[0] ? args[0].replace(/[^0-9]/g, '') + "@s.whatsapp.net" : null);

            if (!rawTarget) {
                return await socket.sendMessage(sender, { 
                    text: "⚠️ *Please tag, reply, or give the phone number of the user!*\nExample: `.kick @user`" 
                }, { quoted: msg });
            }

            const targetUser = jidNormalizedUser(rawTarget);

            // Kick කිරීම
            await socket.groupParticipantsUpdate(sender, [targetUser], "remove");

            return await socket.sendMessage(sender, { 
                text: `👢 *User removed successfully!* @${targetUser.split("@")[0]}`,
                mentions: [targetUser] 
            }, { quoted: msg });

        } catch (err) {
            console.error("KICK ERROR:", err);
            await socket.sendMessage(sender, { 
                text: "❌ *Failed to remove user! Make sure Bot is an Admin.*" 
            }, { quoted: msg });
        }
    }
};
