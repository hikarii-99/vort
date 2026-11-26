const { downloadMediaMessage } = require('baileys');

module.exports = {
    command: ['take', 'toimg', 'sticker2img'],
    description: 'Convert a sticker to an image or video',
    ownerOnly: false,

    handler: async ({ socket, msg, sender }) => {
        try {
            // Quoted message එකෙහි Sticker එකක් තිබේදැයි පරීක්ෂා කිරීම
            const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            const stickerMessage = quotedMsg?.stickerMessage || 
                                   quotedMsg?.viewOnceMessage?.message?.stickerMessage ||
                                   quotedMsg?.viewOnceMessageV2?.message?.stickerMessage;

            if (!stickerMessage) {
                return await socket.sendMessage(sender, {
                    text: "⚠️ *Please reply to a sticker with `.take` or `.toimg`!*"
                }, { quoted: msg });
            }

            await socket.sendMessage(sender, { react: { text: '⏳', key: msg.key } });

            // Quoted Message object එක Download කිරීමට සුදුසු පරිදි සකස් කිරීම
            const mediaMsg = {
                message: {
                    stickerMessage: stickerMessage
                }
            };

            // Baileys හරහා Sticker Buffer එක ඩවුන්ලෝඩ් කර ගැනීම
            const buffer = await downloadMediaMessage(
                mediaMsg,
                'buffer',
                {},
                { 
                    logger: console,
                    reconnectMode: 'on-or-off'
                }
            );

            if (!buffer) {
                await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
                return await socket.sendMessage(sender, {
                    text: "❌ *Failed to download sticker media!*"
                }, { quoted: msg });
            }

            // Animated Sticker එකක්ද (GIF/Video) නැත්නම් Normal Sticker එකක්ද යන්න හඳුනාගෙන යැවීම
            if (stickerMessage.isAnimated) {
                await socket.sendMessage(sender, {
                    video: buffer,
                    gifPlayback: true,
                    caption: "🎥 *Sticker converted to GIF/Video*"
                }, { quoted: msg });
            } else {
                await socket.sendMessage(sender, {
                    image: buffer,
                    caption: "🖼️ *Sticker converted to Image*"
                }, { quoted: msg });
            }

            await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

        } catch (err) {
            console.error("TAKE ERROR:", err);
            await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
            await socket.sendMessage(sender, {
                text: "❌ *Failed to convert sticker to image!*"
            }, { quoted: msg });
        }
    }
};
