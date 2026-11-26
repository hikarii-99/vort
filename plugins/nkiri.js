const axios = require('axios');

module.exports = {
    command: ['tvseries', 'series', 'tv'],
    description: 'Search and Download TV Series',
    ownerOnly: false,

    handler: async ({ socket, msg, sender, args, prefix }) => {
        try {
            const query = args.join(' ').trim();

            if (!query) {
                return await socket.sendMessage(sender, {
                    text: `❌ *Usage:* ${prefix}tvseries <name>\n\n*Example:*\n${prefix}tvseries batman`
                }, { quoted: msg });
            }

            // ── STEP 1: Search ──
            await socket.sendMessage(sender, { react: { text: '🔍', key: msg.key } });
            await socket.sendMessage(sender, {
                text: `🔍 *Searching for: ${query}...*`
            }, { quoted: msg });

            const searchApi = `https://apis.davidcyriltech.my.id/movies/search?q=${encodeURIComponent(query)}&limit=5`;
            const searchRes = await axios.get(searchApi, { timeout: 15000 });
            const searchData = searchRes.data;

            if (!searchData.success || !searchData.results || searchData.results.length === 0) {
                return await socket.sendMessage(sender, {
                    text: `❌ *No results found for:* ${query}`
                }, { quoted: msg });
            }

            const results = searchData.results;

            const resultText = results.map((r, i) => {
                const eps = r.downloadLinks?.length || 0;
                return `*${i + 1}.* ${r.title}\n   🎞️ ${eps} episodes | 📅 ${r.date || 'N/A'}`;
            }).join('\n\n');

            const caption = `🎬 *VORTEX MD | TV Series Search*\n🔍 Results for: *${query}*\n\n${resultText}\n\n↩️ *Reply with number to select*\n\n> *Powered by VORTEX MD*`;

            // Send search results
            let sentMsg;
            if (results[0]?.thumbnail) {
                sentMsg = await socket.sendMessage(sender, {
                    image: { url: results[0].thumbnail },
                    caption: caption
                }, { quoted: msg });
            } else {
                sentMsg = await socket.sendMessage(sender, {
                    text: caption
                }, { quoted: msg });
            }

            const searchMsgId = sentMsg.key.id;

            // ── STEP 2 Listener: Wait for series selection reply ──
            const searchHandler = async ({ messages }) => {
                const reply = messages[0];
                if (!reply?.message || !reply.key?.remoteJid) return;

                const isReply = reply.message?.extendedTextMessage?.contextInfo?.stanzaId === searchMsgId;
                if (!isReply) return;

                const replyText = (reply.message.conversation || reply.message.extendedTextMessage?.text || '').trim();
                const selNum = parseInt(replyText);

                if (isNaN(selNum) || selNum < 1 || selNum > results.length) {
                    return await socket.sendMessage(reply.key.remoteJid, {
                        text: `❌ *Invalid number!* Enter 1 to ${results.length}`
                    }, { quoted: reply });
                }

                // Remove step 2 listener
                socket.ev.off('messages.upsert', searchHandler);

                const selected = results[selNum - 1];

                await socket.sendMessage(reply.key.remoteJid, { react: { text: '🔍', key: reply.key } });
                await socket.sendMessage(reply.key.remoteJid, {
                    text: `🔄 *Loading: ${selected.title}...*`
                }, { quoted: reply });

                // Call info API
                const infoApi = `https://apis.davidcyriltech.my.id/movies/info?url=${encodeURIComponent(selected.url)}`;
                const infoRes = await axios.get(infoApi, { timeout: 15000 });
                const info = infoRes.data;

                if (!info.success || !info.result) {
                    return await socket.sendMessage(reply.key.remoteJid, {
                        text: '❌ *Failed to load details.*'
                    }, { quoted: reply });
                }

                const result = info.result;
                const links = result.downloadLinks || selected.downloadLinks || [];

                if (links.length === 0) {
                    return await socket.sendMessage(reply.key.remoteJid, {
                        text: '❌ *No episodes found.*'
                    }, { quoted: reply });
                }

                // Build episode list
                const epList = links.map((link, i) => {
                    const raw = link.split('/').pop().replace('.html', '');
                    const clean = raw.replace(/\.(THENKIRI|NKIRI)\.COM\./gi, '.').replace(/\(.*?\)/g, '').trim();
                    return `*${i + 1}.* ${clean}`;
                }).join('\n');

                const detailCaption = `🎬 *${result.title || selected.title}*\n📅 ${result.date || selected.date || 'N/A'}\n🎞️ Episodes: ${links.length}\n\n📋 *Episode List:*\n${epList}\n\n↩️ *Reply with episode number to download*\n\n> *VORTEX MD*`;

                const thumb = result.thumbnail || selected.thumbnail;
                let detailMsg;

                if (thumb) {
                    detailMsg = await socket.sendMessage(reply.key.remoteJid, {
                        image: { url: thumb },
                        caption: detailCaption
                    }, { quoted: reply });
                } else {
                    detailMsg = await socket.sendMessage(reply.key.remoteJid, {
                        text: detailCaption
                    }, { quoted: reply });
                }

                const detailMsgId = detailMsg.key.id;
                const seriesTitle = result.title || selected.title;

                // ── STEP 3 Listener: Wait for episode selection reply ──
                const epHandler = async ({ messages }) => {
                    const epReply = messages[0];
                    if (!epReply?.message || !epReply.key?.remoteJid) return;

                    const isEpReply = epReply.message?.extendedTextMessage?.contextInfo?.stanzaId === detailMsgId;
                    if (!isEpReply) return;

                    const epText = (epReply.message.conversation || epReply.message.extendedTextMessage?.text || '').trim();
                    const epNum = parseInt(epText);

                    if (isNaN(epNum) || epNum < 1 || epNum > links.length) {
                        return await socket.sendMessage(epReply.key.remoteJid, {
                            text: `❌ *Invalid episode!* Enter 1 to ${links.length}`
                        }, { quoted: epReply });
                    }

                    // Remove step 3 listener
                    socket.ev.off('messages.upsert', epHandler);

                    const epUrl = links[epNum - 1];

                    await socket.sendMessage(epReply.key.remoteJid, { react: { text: '⏳', key: epReply.key } });
                    await socket.sendMessage(epReply.key.remoteJid, {
                        text: `⬇️ *Getting Episode ${epNum} download link...*`
                    }, { quoted: epReply });

                    try {
                        const dlApi = `https://apis.davidcyriltech.my.id/nkiri/download?url=${encodeURIComponent(epUrl)}`;
                        const dlRes = await axios.get(dlApi, { timeout: 30000 });
                        const dl = dlRes.data;

                        if (!dl.success || !dl.download_url) {
                            return await socket.sendMessage(epReply.key.remoteJid, {
                                text: '❌ *Failed to get download link. Try again.*'
                            }, { quoted: epReply });
                        }

                        const dlCaption = `🎬 *VORTEX MD | TV Series*\n\n📺 *${seriesTitle}*\n🎞️ Episode: ${epNum}\n📄 ${dl.filename}\n💾 Size: ${dl.size}\n\n> *Powered by VORTEX MD*`;

                        await socket.sendMessage(epReply.key.remoteJid, {
                            document: { url: dl.download_url },
                            mimetype: 'video/x-matroska',
                            fileName: dl.filename,
                            caption: dlCaption
                        }, { quoted: epReply });

                        await socket.sendMessage(epReply.key.remoteJid, { react: { text: '✅', key: epReply.key } });

                    } catch (err) {
                        await socket.sendMessage(epReply.key.remoteJid, {
                            text: `❌ *Download Error:* ${err.message}`
                        }, { quoted: epReply });
                    }
                };

                socket.ev.on('messages.upsert', epHandler);
                // Remove ep listener after 10 mins
                setTimeout(() => socket.ev.off('messages.upsert', epHandler), 10 * 60 * 1000);
            };

            socket.ev.on('messages.upsert', searchHandler);
            // Remove search listener after 5 mins
            setTimeout(() => socket.ev.off('messages.upsert', searchHandler), 5 * 60 * 1000);

        } catch (err) {
            console.error('TV Series plugin error:', err.message);
            await socket.sendMessage(sender, {
                text: `❌ *Error:* ${err.message}`
            }, { quoted: msg });
        }
    }
};
