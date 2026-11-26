const axios = require('axios');

const SEARCH_API = 'https://api-dark-shan-yt.koyeb.app/education/wiki-search?q=';
const INFO_API = 'https://api-dark-shan-yt.koyeb.app/education/wiki-info?url=';

module.exports = {
    command: ['ppr', 'pastpaper', 'paper'],
    description: 'Search and Download Past Papers from PastPapers.wiki',

    handler: async ({ socket, msg, sender, args, prefix }) => {
        try {
            const query = args.join(' ').trim();

            if (!query) {
                return await socket.sendMessage(sender, {
                    text: `📚 *VORTEX MD | Past Paper Downloader*\n\n` +
                        `*Usage:* ${prefix}ppr <search query>\n\n` +
                        `*Examples:*\n` +
                        `${prefix}ppr 2023 combined maths\n` +
                        `${prefix}ppr 2022 physics sinhala\n` +
                        `${prefix}ppr AL chemistry marking scheme\n\n` +
                        `> *Powered by VORTEX MD*`
                }, { quoted: msg });
            }

            // ── STEP 1: Search ──
            await socket.sendMessage(sender, { react: { text: '🔍', key: msg.key } });
            await socket.sendMessage(sender, {
                text: `🔍 *Searching for: ${query}...*`
            }, { quoted: msg });

            const searchRes = await axios.get(`${SEARCH_API}${encodeURIComponent(query)}`, { timeout: 15000 });
            const searchData = searchRes.data;

            if (!searchData.status || !searchData.data || searchData.data.length === 0) {
                return await socket.sendMessage(sender, {
                    text: `❌ *No results found for:* ${query}\n\nTry different keywords.`
                }, { quoted: msg });
            }

            const results = searchData.data.slice(0, 8);

            const resultText = results.map((r, i) =>
                `*${i + 1}.* ${r.title}\n   📅 ${r.date || 'N/A'}`
            ).join('\n\n');

            const caption = `📚 *VORTEX MD | Past Papers*\n🔍 Results for: *${query}*\n\n${resultText}\n\n↩️ *Reply with number to download*\n\n> *Powered by VORTEX MD*`;

            let sentMsg;
            if (results[0]?.image) {
                sentMsg = await socket.sendMessage(sender, {
                    image: { url: results[0].image },
                    caption: caption
                }, { quoted: msg });
            } else {
                sentMsg = await socket.sendMessage(sender, {
                    text: caption
                }, { quoted: msg });
            }

            const searchMsgId = sentMsg.key.id;

            // ── STEP 2 Listener: Paper selection ──
            const searchHandler = async ({ messages }) => {
                const reply = messages[0];
                if (!reply?.message) return;
                const isReply = reply.message?.extendedTextMessage?.contextInfo?.stanzaId === searchMsgId;
                if (!isReply) return;

                const replyText = (reply.message.conversation || reply.message.extendedTextMessage?.text || '').trim();
                const selNum = parseInt(replyText);

                if (isNaN(selNum) || selNum < 1 || selNum > results.length) {
                    return await socket.sendMessage(reply.key.remoteJid, {
                        text: `❌ *Invalid number!* Enter 1 to ${results.length}`
                    }, { quoted: reply });
                }

                socket.ev.off('messages.upsert', searchHandler);

                const selected = results[selNum - 1];

                await socket.sendMessage(reply.key.remoteJid, { react: { text: '⏳', key: reply.key } });
                await socket.sendMessage(reply.key.remoteJid, {
                    text: `🔄 *Loading: ${selected.title}...*`
                }, { quoted: reply });

                // Fetch paper details
                let info;
                try {
                    const infoRes = await axios.get(`${INFO_API}${encodeURIComponent(selected.url)}`, { timeout: 15000 });
                    info = infoRes.data?.data;
                } catch (e) {
                    return await socket.sendMessage(reply.key.remoteJid, {
                        text: `❌ *Failed to load paper details.*`
                    }, { quoted: reply });
                }

                if (!info) {
                    return await socket.sendMessage(reply.key.remoteJid, {
                        text: `❌ *No details found.*`
                    }, { quoted: reply });
                }

                // Build info caption
                const infoLines = info.info ? Object.entries(info.info).map(([k, v]) =>
                    `📌 *${k.replace(/_–/g, '').replace(/_/g, ' ').trim()}* ${v}`
                ).join('\n') : '';

                const cats = info.categories?.join(', ') || 'N/A';
                const dlLinks = info.download || [];

                const infoCaption = `📚 *${info.title}*\n\n` +
                    `${infoLines}\n\n` +
                    `🗂️ *Categories:* ${cats}\n` +
                    `📅 *Date:* ${info.date || 'N/A'}\n\n` +
                    `> *VORTEX MD | Past Papers*`;

                // Send info with image
                if (info.image) {
                    await socket.sendMessage(reply.key.remoteJid, {
                        image: { url: info.image },
                        caption: infoCaption
                    }, { quoted: reply });
                } else {
                    await socket.sendMessage(reply.key.remoteJid, {
                        text: infoCaption
                    }, { quoted: reply });
                }

                // Find PDF link
                const pdfLink = dlLinks.find(d => d.name === 'Download' || d.url?.endsWith('.pdf'));

                if (pdfLink) {
                    try {
                        const fileName = info.title.replace(/[^a-zA-Z0-9\s]/g, '').trim().replace(/\s+/g, '_') + '.pdf';
                        await socket.sendMessage(reply.key.remoteJid, {
                            document: { url: pdfLink.url },
                            mimetype: 'application/pdf',
                            fileName: fileName,
                            caption: `📄 *${info.title}*\n\n> *VORTEX MD*`
                        }, { quoted: reply });

                        await socket.sendMessage(reply.key.remoteJid, { react: { text: '✅', key: reply.key } });

                    } catch (e) {
                        await socket.sendMessage(reply.key.remoteJid, {
                            text: `📥 *Download Link:*\n${pdfLink.url}\n\n> *VORTEX MD*`
                        }, { quoted: reply });
                    }

                } else if (dlLinks.length > 0) {
                    const linkText = dlLinks.map(d => `• *${d.name}:* ${d.url}`).join('\n');
                    await socket.sendMessage(reply.key.remoteJid, {
                        text: `📥 *Download Links:*\n\n${linkText}\n\n> *VORTEX MD*`
                    }, { quoted: reply });
                } else {
                    await socket.sendMessage(reply.key.remoteJid, {
                        text: `❌ *No download links found.*`
                    }, { quoted: reply });
                }
            };

            socket.ev.on('messages.upsert', searchHandler);
            setTimeout(() => socket.ev.off('messages.upsert', searchHandler), 5 * 60 * 1000);

        } catch (err) {
            console.error('Past paper plugin error:', err.message);
            await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
            await socket.sendMessage(sender, {
                text: `❌ *Error:* ${err.message}`
            }, { quoted: msg });
        }
    }
};
