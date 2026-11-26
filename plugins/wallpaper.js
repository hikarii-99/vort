const axios = require('axios');

const API = 'https://vortex-api-theta.vercel.app/download/wallpaper';

module.exports = {
    command: ['wallpaper', 'wall', 'wp'],
    description: 'Download HD Wallpapers',

    handler: async ({ socket, msg, sender, args, prefix }) => {
        try {
            const query = args.join(' ').trim();

            if (!query) {
                return await socket.sendMessage(sender, {
                    text: `🖼️ *VORTEX MD | Wallpaper Downloader*\n\n` +
                        `*Usage:* ${prefix}wp <keyword>\n\n` +
                        `*Examples:*\n` +
                        `${prefix}wp car\n` +
                        `${prefix}wp nature\n` +
                        `${prefix}wp anime\n` +
                        `${prefix}wp space\n\n` +
                        `> *Powered by VORTEX MD*`
                }, { quoted: msg });
            }

            await socket.sendMessage(sender, { react: { text: '🔍', key: msg.key } });
            await socket.sendMessage(sender, {
                text: `🔍 *Searching wallpapers for: ${query}...*`
            }, { quoted: msg });

            const { data } = await axios.get(`${API}?text=${encodeURIComponent(query)}&page=1`, { timeout: 15000 });

            if (!data.result || data.result.length === 0) {
                return await socket.sendMessage(sender, {
                    text: `❌ *No wallpapers found for:* ${query}`
                }, { quoted: msg });
            }

            const results = data.result.slice(0, 5);

            // Build result list
            const resultText = results.map((r, i) =>
                `*${i + 1}.* ${r.type || 'Wallpaper'}`
            ).join('\n');

            const caption = `🖼️ *VORTEX MD | Wallpapers*\n🔍 Results for: *${query}*\n\n${resultText}\n\n↩️ *Reply with number to download*\n\n> *Powered by VORTEX MD*`;

            // Send first wallpaper as preview with list
            const previewUrl = results[0]?.image?.[0];
            let sentMsg;

            if (previewUrl) {
                sentMsg = await socket.sendMessage(sender, {
                    image: { url: previewUrl },
                    caption: caption
                }, { quoted: msg });
            } else {
                sentMsg = await socket.sendMessage(sender, {
                    text: caption
                }, { quoted: msg });
            }

            const menuMsgId = sentMsg.key.id;

            // ── Reply Listener ──
            const replyHandler = async ({ messages }) => {
                const reply = messages[0];
                if (!reply?.message) return;
                const isReply = reply.message?.extendedTextMessage?.contextInfo?.stanzaId === menuMsgId;
                if (!isReply) return;

                const replyText = (reply.message.conversation || reply.message.extendedTextMessage?.text || '').trim();
                const selNum = parseInt(replyText);

                if (isNaN(selNum) || selNum < 1 || selNum > results.length) {
                    return await socket.sendMessage(reply.key.remoteJid, {
                        text: `❌ *Invalid number!* Enter 1 to ${results.length}`
                    }, { quoted: reply });
                }

                socket.ev.off('messages.upsert', replyHandler);

                const selected = results[selNum - 1];
                const imgUrl = selected.image?.[0];

                if (!imgUrl) {
                    return await socket.sendMessage(reply.key.remoteJid, {
                        text: `❌ *Image not available.*`
                    }, { quoted: reply });
                }

                await socket.sendMessage(reply.key.remoteJid, { react: { text: '⏳', key: reply.key } });

                await socket.sendMessage(reply.key.remoteJid, {
                    image: { url: imgUrl },
                    caption: `🖼️ *VORTEX MD | Wallpaper*\n🏷️ Type: ${selected.type || 'N/A'}\n\n> *Powered by VORTEX MD*`
                }, { quoted: reply });

                await socket.sendMessage(reply.key.remoteJid, { react: { text: '✅', key: reply.key } });
            };

            socket.ev.on('messages.upsert', replyHandler);
            setTimeout(() => socket.ev.off('messages.upsert', replyHandler), 5 * 60 * 1000);

        } catch (err) {
            console.error('Wallpaper plugin error:', err.message);
            await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
            await socket.sendMessage(sender, {
                text: `❌ *Error:* ${err.message}`
            }, { quoted: msg });
        }
    }
};
