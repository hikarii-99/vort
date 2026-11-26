module.exports = {
    command: ['rename', 'rn'],
    description: 'Rename a file/document/audio/video',

    handler: async ({ socket, msg, sender, args, prefix, quoted }) => {
        try {
            const { downloadContentFromMessage } = require('baileys');

            const newName = args.join(' ').trim();

            if (!newName) {
                return await socket.sendMessage(sender, {
                    text: `📝 *Usage:* Reply to a file with\n${prefix}rename <new filename>\n\n*Example:*\n${prefix}rename MyDocument`
                }, { quoted: msg });
            }

            // Get quoted message
            const contextInfo = msg.message?.extendedTextMessage?.contextInfo;
            const quotedMsg = contextInfo?.quotedMessage;

            if (!quotedMsg) {
                return await socket.sendMessage(sender, {
                    text: `❌ *Reply to a file/document/audio/video!*`
                }, { quoted: msg });
            }

            await socket.sendMessage(sender, { react: { text: '⏳', key: msg.key } });

            // Detect message type
            let messageType = null;
            let mediaMsg = null;
            let mimetype = null;
            let extension = '';

            if (quotedMsg.documentMessage) {
                messageType = 'document';
                mediaMsg = quotedMsg.documentMessage;
                mimetype = mediaMsg.mimetype || 'application/octet-stream';
                const oldName = mediaMsg.fileName || '';
                extension = oldName.includes('.') ? '.' + oldName.split('.').pop() : '';
            } else if (quotedMsg.audioMessage) {
                messageType = 'audio';
                mediaMsg = quotedMsg.audioMessage;
                mimetype = mediaMsg.mimetype || 'audio/mp3';
                extension = mimetype.includes('ogg') ? '.ogg' : '.mp3';
            } else if (quotedMsg.videoMessage) {
                messageType = 'video';
                mediaMsg = quotedMsg.videoMessage;
                mimetype = mediaMsg.mimetype || 'video/mp4';
                extension = '.mp4';
            } else if (quotedMsg.imageMessage) {
                messageType = 'image';
                mediaMsg = quotedMsg.imageMessage;
                mimetype = mediaMsg.mimetype || 'image/jpeg';
                extension = mimetype.includes('png') ? '.png' : mimetype.includes('webp') ? '.webp' : '.jpg';
            } else {
                return await socket.sendMessage(sender, {
                    text: `❌ *Unsupported file type!*\nSupported: Document, Audio, Video, Image`
                }, { quoted: msg });
            }

            // Add extension if not provided
            const finalName = newName.includes('.') ? newName : newName + extension;

            // Download media
            const stream = await downloadContentFromMessage(mediaMsg, messageType);
            let buffer = Buffer.from([]);
            for await (const chunk of stream) {
                buffer = Buffer.concat([buffer, chunk]);
            }

            // Send as document with new name
            await socket.sendMessage(sender, {
                document: buffer,
                mimetype: mimetype,
                fileName: finalName,
                caption: `✅ *Renamed to:* ${finalName}\n\n> *VORTEX MD*`
            }, { quoted: msg });

            await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

        } catch (err) {
            console.error('Rename plugin error:', err.message);
            await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
            await socket.sendMessage(sender, {
                text: `❌ *Error:* ${err.message}`
            }, { quoted: msg });
        }
    }
};
