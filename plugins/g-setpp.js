const { downloadMediaMessage, jidNormalizedUser } = require('baileys');

module.exports = {
    command: ['setgpp', 'setfullgpp', 'setgrouppp'],
    description: 'Set group profile picture by replying to an image',
    ownerOnly: false,

    handler: async ({ socket, msg, sender, isGroup }) => {
        try {
            if (!isGroup) {
                return await socket.sendMessage(sender, { 
                    text: "❌ *This command only works in groups!*" 
                }, { quoted: msg });
            }

            // User Admin ද කියා Check කිරීම
            const groupMetadata = await socket.groupMetadata(sender);
            const participants = groupMetadata.participants || [];
            
            const groupAdmins = participants
                .filter(p => p.admin !== null)
                .map(p => jidNormalizedUser(p.id));

            const rawUserJid = msg.key.participant || msg.participant;
            const userJid = jidNormalizedUser(rawUserJid);

            if (!groupAdmins.includes(userJid)) {
                return await socket.sendMessage(sender, { 
                    text: "❌ *Only admins can use this command!*" 
                }, { quoted: msg });
            }

            // Image එක Reply කර ඇත්දැයි Check කිරීම
            const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            const imageMessage = quotedMsg?.imageMessage || 
                                 quotedMsg?.viewOnceMessage?.message?.imageMessage ||
                                 quotedMsg?.viewOnceMessageV2?.message?.imageMessage;

            if (!imageMessage) {
                return await socket.sendMessage(sender, { 
                    text: "⚠️ *Please reply to an image with `.setgpp`!*" 
                }, { quoted: msg });
            }

            await socket.sendMessage(sender, { react: { text: '⏳', key: msg.key } });

            const mediaMsg = { message: { imageMessage: imageMessage } };
            const mediaBuffer = await downloadMediaMessage(
                mediaMsg,
                'buffer',
                {},
                { logger: console, reconnectMode: 'on-or-off' }
            );

            if (!mediaBuffer) {
                await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
                return await socket.sendMessage(sender, { 
                    text: "❌ *Failed to download the image!*" 
                }, { quoted: msg });
            }

            // Group DP Update කිරීම
            await socket.updateProfilePicture(sender, mediaBuffer);

            await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });
            await socket.sendMessage(sender, { 
                text: "✅ *Group profile picture updated successfully!*" 
            }, { quoted: msg });

        } catch (err) {
            console.error("SETGPP ERROR:", err);
            await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
            await socket.sendMessage(sender, { 
                text: "❌ *Failed to update group picture! Make sure Bot is an Admin.*" 
            }, { quoted: msg });
        }
    }
};
