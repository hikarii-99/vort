const { Sticker, StickerTypes } = require('wa-sticker-formatter');
const { downloadContentFromMessage } = require('baileys');

async function downloadMedia(mediaMsg, type) {
    const stream = await downloadContentFromMessage(mediaMsg, type);
    let buffer = Buffer.from([]);
    for await (const chunk of stream) {
        buffer = Buffer.concat([buffer, chunk]);
    }
    return buffer;
}

async function makeSticker(buffer, packName = 'VORTEX MD', authorName = '𝕍𝕆ℝ𝕋𝔼𝕏 𝕄𝔻', type = StickerTypes.FULL) {
    const sticker = new Sticker(buffer, {
        pack: packName,
        author: authorName,
        type: type,
        categories: ['🤩', '🎉'],
        id: '12345',
        quality: 75,
        background: 'transparent',
    });
    return await sticker.toBuffer();
}

module.exports = {
    command: ['sticker', 's', 'stic'],
    description: 'Convert image/video/sticker to sticker',

    handler: async ({ socket, msg, sender, args, prefix, body }) => {
        try {
            const contextInfo = msg.message?.extendedTextMessage?.contextInfo;
            const quotedMsg = contextInfo?.quotedMessage;
            const isCrop = body.includes('--crop') || body.includes('-c');
            const stickerType = isCrop ? StickerTypes.CROPPED : StickerTypes.FULL;

            const directImage = msg.message?.imageMessage;
            const directVideo = msg.message?.videoMessage;

            let buffer = null;

            if (directImage) {
                buffer = await downloadMedia(directImage, 'image');
            } else if (directVideo) {
                buffer = await downloadMedia(directVideo, 'video');
            } else if (quotedMsg) {
                if (quotedMsg.imageMessage) {
                    buffer = await downloadMedia(quotedMsg.imageMessage, 'image');
                } else if (quotedMsg.videoMessage) {
                    buffer = await downloadMedia(quotedMsg.videoMessage, 'video');
                } else if (quotedMsg.stickerMessage) {
                    buffer = await downloadMedia(quotedMsg.stickerMessage, 'sticker');
                } else if (quotedMsg.viewOnceMessage?.message?.imageMessage) {
                    buffer = await downloadMedia(quotedMsg.viewOnceMessage.message.imageMessage, 'image');
                }
            }

            if (!buffer) {
                return await socket.sendMessage(sender, {
                    text: `💦 *Reply to an image, video, or sticker!*\n\n` +
                        `*Usage:*\n` +
                        `${prefix}s — Normal sticker\n` +
                        `${prefix}s --crop — Cropped sticker`
                }, { quoted: msg });
            }

            await socket.sendMessage(sender, { react: { text: '💦', key: msg.key } });

            const stickerBuffer = await makeSticker(buffer, 'VORTEX MD', '𝕍𝕆ℝ𝕋𝔼𝕏 𝕄𝔻', stickerType);

            await socket.sendMessage(sender, {
                sticker: stickerBuffer
            }, { quoted: msg });

            await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

        } catch (err) {
            console.error('Sticker plugin error:', err.message);
            await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
            await socket.sendMessage(sender, {
                text: `❌ *Error:* ${err.message}`
            }, { quoted: msg });
        }
    }
};
