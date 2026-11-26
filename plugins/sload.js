const axios = require('axios');

const SEARCH_API = 'https://seriezloaded-vortex.vercel.app/search?search=';
const SCRAPE_API = 'https://seriezloaded-vortex.vercel.app/scrape?url=';

module.exports = {
    command: ['series', 'sz', 'sload'],
    description: 'Search and Download Series from SeriezLoaded',

    handler: async ({ socket, msg, sender, args, prefix }) => {
        try {
            const query = args.join(' ').trim();

            if (!query) {
                return await socket.sendMessage(sender, {
                    text: `🎬 *VORTEX MD | Series Downloader*\n\n` +
                        `*Usage:* ${prefix}series <name>\n\n` +
                        `*Examples:*\n` +
                        `${prefix}series the doll\n` +
                        `${prefix}sz breaking bad\n` +
                        `${prefix}sload game of thrones\n\n` +
                        `> *Powered by VORTEX MD*`
                }, { quoted: msg });
            }

            // ── STEP 1: Search ──
            await socket.sendMessage(sender, { react: { text: '🔍', key: msg.key } });
            await socket.sendMessage(sender, { text: `🔍 *Searching: ${query}...*` }, { quoted: msg });

            let searchData;
            try {
                const { data } = await axios.get(`${SEARCH_API}${encodeURIComponent(query)}`, { timeout: 15000 });
                searchData = data;
            } catch (e) {
                return await socket.sendMessage(sender, {
                    text: `❌ *Search failed:* ${e.message}`
                }, { quoted: msg });
            }

            if (!searchData.success || !searchData.results?.length) {
                return await socket.sendMessage(sender, {
                    text: `❌ *No results found for:* ${query}`
                }, { quoted: msg });
            }

            const results = searchData.results.slice(0, 6);
            const resultText = results.map((r, i) =>
                `*${i + 1}.* ${r.title.replace(/&#8211;/g, '–').replace(/&#\d+;/g, '')}`
            ).join('\n\n');

            const caption = `🎬 *VORTEX MD | Series Search*\n🔍 Results for: *${query}*\n\n${resultText}\n\n↩️ *Reply with number to select*\n\n> *Powered by VORTEX MD*`;

            let sentMsg;
            if (results[0]?.image) {
                sentMsg = await socket.sendMessage(sender, {
                    image: { url: results[0].image },
                    caption: caption
                }, { quoted: msg });
            } else {
                sentMsg = await socket.sendMessage(sender, { text: caption }, { quoted: msg });
            }

            const searchMsgId = sentMsg.key.id;

            // ── STEP 2: Series selection → Episode list ──
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
                    text: `🔄 *Loading episodes...*`
                }, { quoted: reply });

                // Scrape episode list
                let scrapeData;
                try {
                    const { data } = await axios.get(`${SCRAPE_API}${encodeURIComponent(selected.link)}`, { timeout: 20000 });
                    scrapeData = data;
                } catch (e) {
                    return await socket.sendMessage(reply.key.remoteJid, {
                        text: `❌ *Failed to load episodes:* ${e.message}`
                    }, { quoted: reply });
                }

                if (!scrapeData.success || !scrapeData.episodes?.length) {
                    return await socket.sendMessage(reply.key.remoteJid, {
                        text: `❌ *No episodes found.*`
                    }, { quoted: reply });
                }

                const episodes = scrapeData.episodes;
                const epText = episodes.map((e, i) =>
                    `*${i + 1}.* ${e.episode}`
                ).join('\n\n');

                const epCaption = `🎬 *${scrapeData.title.replace(/&#8211;/g, '–')}*\n🎞️ Episodes: *${scrapeData.total_episodes}*\n\n${epText}\n\n↩️ *Reply with number to download*\n\n> *VORTEX MD*`;

                let epMsg;
                const thumb = scrapeData.image || selected.image;
                if (thumb) {
                    epMsg = await socket.sendMessage(reply.key.remoteJid, {
                        image: { url: thumb },
                        caption: epCaption
                    }, { quoted: reply });
                } else {
                    epMsg = await socket.sendMessage(reply.key.remoteJid, { text: epCaption }, { quoted: reply });
                }

                const epMsgId = epMsg.key.id;

                // ── STEP 3: Episode selection → Send file ──
                const epHandler = async ({ messages }) => {
                    const epReply = messages[0];
                    if (!epReply?.message) return;
                    const isIt = epReply.message?.extendedTextMessage?.contextInfo?.stanzaId === epMsgId;
                    if (!isIt) return;

                    const epText = (epReply.message.conversation || epReply.message.extendedTextMessage?.text || '').trim();
                    const epNum = parseInt(epText);

                    if (isNaN(epNum) || epNum < 1 || epNum > episodes.length) {
                        return await socket.sendMessage(epReply.key.remoteJid, {
                            text: `❌ *Invalid number!* Enter 1 to ${episodes.length}`
                        }, { quoted: epReply });
                    }

                    socket.ev.off('messages.upsert', epHandler);
                    const selectedEp = episodes[epNum - 1];

                    await socket.sendMessage(epReply.key.remoteJid, { react: { text: '⏳', key: epReply.key } });
                    await socket.sendMessage(epReply.key.remoteJid, {
                        text: `⬇️ *Sending: ${selectedEp.episode}...*`
                    }, { quoted: epReply });

                    try {
                        const dlUrl = selectedEp.direct_link;
                        const ext = dlUrl.includes('.mkv') ? 'mkv' : dlUrl.includes('.mp4') ? 'mp4' : 'mkv';
                        const mimetype = ext === 'mkv' ? 'video/x-matroska' : 'video/mp4';
                        const fileName = `${scrapeData.title.replace(/[^a-zA-Z0-9\s]/g, '').trim()}_${selectedEp.episode.replace(/[^a-zA-Z0-9\s]/g, '').trim()}.${ext}`;

                        // ZIP file check
                        if (dlUrl.includes('send.now') || dlUrl.includes('.zip')) {
                            return await socket.sendMessage(epReply.key.remoteJid, {
                                text: `📦 *Download ZIP:*\n${dlUrl}\n\n> *VORTEX MD*`
                            }, { quoted: epReply });
                        }

                        await socket.sendMessage(epReply.key.remoteJid, {
                            document: { url: dlUrl },
                            mimetype: mimetype,
                            fileName: fileName,
                            caption: `🎬 *VORTEX MD | Series*\n\n📺 *${scrapeData.title.replace(/&#8211;/g, '–')}*\n🎞️ ${selectedEp.episode}\n\n> *Powered by VORTEX MD*`
                        }, { quoted: epReply });

                        await socket.sendMessage(epReply.key.remoteJid, { react: { text: '✅', key: epReply.key } });

                    } catch (e) {
                        await socket.sendMessage(epReply.key.remoteJid, {
                            text: `❌ *Send failed:* ${e.message}\n\n📥 *Direct link:*\n${selectedEp.direct_link}`
                        }, { quoted: epReply });
                    }
                };

                socket.ev.on('messages.upsert', epHandler);
                setTimeout(() => socket.ev.off('messages.upsert', epHandler), 10 * 60 * 1000);
            };

            socket.ev.on('messages.upsert', searchHandler);
            setTimeout(() => socket.ev.off('messages.upsert', searchHandler), 5 * 60 * 1000);

        } catch (err) {
            console.error('Series plugin error:', err.message);
            await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
            await socket.sendMessage(sender, {
                text: `❌ *Error:* ${err.message}`
            }, { quoted: msg });
        }
    }
};
