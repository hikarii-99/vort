// VORTEX MD 🤍
// GET PP PLUGIN 💥

module.exports = {
    command: ['getpp', 'pp'],
    description: 'Get profile picture of a user by phone number',


    handler: async ({ socket, msg, sender, args, isOwner, quoted, senderNumber }) => {
        try {
            // Input — args, quoted, mention
            let input = args[0] ||
                msg.message?.extendedTextMessage?.contextInfo?.participant?.split('@')[0] ||
                msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0]?.split('@')[0] ||
                null;

            if (!input || !/^\d{5,15}$/.test(input.replace(/[^0-9]/g, ''))) {
                return await socket.sendMessage(sender, {
                    text: `📱 *Please provide a valid phone number!*\n\n*Example:* .getpp 94712345678\n\nOr mention/reply to a user.`
                }, { quoted: msg });
            }

            const targetJid = input.replace(/[^0-9]/g, '') + '@s.whatsapp.net';

            await socket.sendMessage(sender, { react: { text: '🖼️', key: msg.key } });

            // Fetch profile picture
            let ppUrl;
            try {
                ppUrl = await socket.profilePictureUrl(targetJid, 'image');
            } catch {
                return await socket.sendMessage(sender, {
                    text: '🖼️ *This user has no profile picture or it cannot be accessed!*'
                }, { quoted: msg });
            }

            // Get name
            let userName = input.replace(/[^0-9]/g, '');
            try {
                const contact = await socket.getContact(targetJid);
                userName = contact.notify || contact.vname || userName;
            } catch {
                // No name — use number
            }

            // Send profile picture
            await socket.sendMessage(sender, {
                image: { url: ppUrl },
                caption: `🖼️ *VORTEX MD | Profile Picture*\n\n📌 *${userName}*\n📱 ${targetJid.split('@')[0]}\n\n> *Powered by VORTEX MD*`
            }, { quoted: msg });

            await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

        } catch (e) {
            console.error('getpp plugin error:', e.message);
            await socket.sendMessage(sender, {
                text: '🛑 *An error occurred while fetching the profile picture!*'
            }, { quoted: msg });
        }
    }
};
