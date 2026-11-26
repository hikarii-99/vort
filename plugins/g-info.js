module.exports = {
    command: ['groupinfo', 'ginfo', 'gcinfo'],
    description: 'Get information about the current group',
    ownerOnly: false,

    handler: async ({ socket, msg, sender, isGroup }) => {
        try {
            if (!isGroup) {
                return await socket.sendMessage(sender, { 
                    text: "❌ *This command can only be used in groups!*" 
                }, { quoted: msg });
            }

            await socket.sendMessage(sender, { react: { text: '⏳', key: msg.key } });

            // Group Metadata ලබා ගැනීම
            const metadata = await socket.groupMetadata(sender);

            const name = metadata.subject || "N/A";
            const id = metadata.id || "N/A";
            const owner = metadata.owner ? `@${metadata.owner.split('@')[0]}` : "Unknown / Community";
            const desc = metadata.desc || "No description set.";
            const totalMembers = metadata.participants ? metadata.participants.length : 0;
            const adminsCount = metadata.participants ? metadata.participants.filter(p => p.admin).length : 0;

            const captionText = `📊 *GROUP INFORMATION*\n\n` +
                                `📛 *Name:* ${name}\n` +
                                `🆔 *ID:* ${id}\n` +
                                `👑 *Owner:* ${owner}\n` +
                                `👥 *Members:* ${totalMembers}\n` +
                                `🛡️ *Admins:* ${adminsCount}\n\n` +
                                `📝 *Description:*\n${desc}`;

            // Group Profile Picture එක ගැනීමට උත්සාහ කිරීම, නැතහොත් Text පමණක් යැවීම
            try {
                const ppUrl = await socket.profilePictureUrl(sender, 'image');
                await socket.sendMessage(sender, {
                    image: { url: ppUrl },
                    caption: captionText,
                    mentions: metadata.owner ? [metadata.owner] : []
                }, { quoted: msg });
            } catch {
                await socket.sendMessage(sender, {
                    text: captionText,
                    mentions: metadata.owner ? [metadata.owner] : []
                }, { quoted: msg });
            }

            await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

        } catch (err) {
            console.error("GROUPINFO ERROR:", err);
            await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
            await socket.sendMessage(sender, { 
                text: "❌ *Failed to fetch group info!*" 
            }, { quoted: msg });
        }
    }
};
