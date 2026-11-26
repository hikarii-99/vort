const axios = require('axios');

const API = 'https://anime-vortex.vercel.app';

async function searchAnime(query) {
    const { data } = await axios.get(`${API}/?search=${encodeURIComponent(query)}`, { timeout: 20000 });
    return data;
}

async function listItems(url) {
    const { data } = await axios.get(`${API}/?list=${encodeURIComponent(url)}`, { timeout: 20000 });
    return data;
}

async function getDownload(url) {
    const { data } = await axios.get(`${API}/?download=${encodeURIComponent(url)}`, { timeout: 30000 });
    return data;
}

module.exports = {
    command: ['anim', 'jap', 'jsub'],
    description: 'Search and Download Japanese Anime (SUB)',

    handler: async ({ socket, msg, sender, args, prefix }) => {
        try {
            const query = args.join(' ').trim();

            if (!query) {
                return await socket.sendMessage(sender, {
                    text:
                        `🎌 *VORTEX MD | Anime SUB Downloader*\n\n` +
                        `*Usage:* ${prefix}anim <anime name>\n\n` +
                        `*Examples:*\n` +
                        `${prefix}anim jujutsu kaisen\n` +
                        `${prefix}anim naruto\n` +
                        `${prefix}jap demon slayer\n\n` +
                        `> *Powered by VORTEX MD*`
                }, { quoted: msg });
            }

            // ── STEP 1: Search ──
            await socket.sendMessage(sender, { react: { text: '🔍', key: msg.key } });

            let searchData;
            try {
                searchData = await searchAnime(query);
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

            let results = searchData.results.filter(r =>
                (r.type === 'japanese' || r.lang === 'SUB') && r.series
            );
            if (!results.length) results = searchData.results.filter(r => r.series);
            results = results.slice(0, 5);

            if (!results.length) {
                return await socket.sendMessage(sender, {
                    text: `❌ *No results found for:* ${query}`
                }, { quoted: msg });
            }

            const resultText = results.map((r, i) =>
                `*${i + 1}.* ${r.title}\n   📺 EP ${r.ep || '-'} | ${r.lang || '-'} | ${r.status || '-'} | ${r.year || '-'}`
            ).join('\n\n');

            const caption =
                `🎌 *VORTEX MD | Anime Search*\n` +
                `🔍 Results for: *${query}*\n\n` +
                `${resultText}\n\n` +
                `↩️ *Reply with number to select*\n\n` +
                `> *Powered by VORTEX MD*`;

            let sentMsg;
            if (results[0]?.image) {
                sentMsg = await socket.sendMessage(sender, {
                    image: { url: results[0].image },
                    caption
                }, { quoted: msg });
            } else {
                sentMsg = await socket.sendMessage(sender, { text: caption }, { quoted: msg });
            }

            const searchMsgId = sentMsg.key.id;

            // ── STEP 2: Anime → Seasons ──
            const searchHandler = async ({ messages }) => {
                const reply = messages[0];
                if (!reply?.message) return;

                const stanzaId = reply.message?.extendedTextMessage?.contextInfo?.stanzaId;
                if (stanzaId !== searchMsgId) return;

                const replyText = (
                    reply.message.conversation ||
                    reply.message.extendedTextMessage?.text ||
                    ''
                ).trim();
                const selNum = parseInt(replyText);

                if (isNaN(selNum) || selNum < 1 || selNum > results.length) {
                    return await socket.sendMessage(reply.key.remoteJid, {
                        text: `❌ *Invalid number!* Enter 1 to ${results.length}`
                    }, { quoted: reply });
                }

                socket.ev.off('messages.upsert', searchHandler);
                const selected = results[selNum - 1];

                await socket.sendMessage(reply.key.remoteJid, { react: { text: '⏳', key: reply.key } });

                let seasonData;
                try {
                    seasonData = await listItems(selected.series);
                } catch (e) {
                    return await socket.sendMessage(reply.key.remoteJid, {
                        text: `❌ *Failed to load seasons:* ${e.message}`
                    }, { quoted: reply });
                }

                if (!seasonData.success || !seasonData.items?.length) {
                    return await socket.sendMessage(reply.key.remoteJid, {
                        text: `❌ *No seasons found.*`
                    }, { quoted: reply });
                }

                const seasons = seasonData.items;
                const seasonText = seasons.map((s, i) => `*${i + 1}.* ${s.name}`).join('\n');
                const seasonCaption =
                    `🎌 *${selected.title}*\n` +
                    `📺 EP ${selected.ep || '-'} | ${selected.lang || '-'}\n\n` +
                    `🗂️ *Seasons:*\n\n${seasonText}\n\n` +
                    `↩️ *Reply with season number*\n\n> *VORTEX MD*`;

                const thumb = seasonData.image || selected.image;
                let seasonMsg;
                if (thumb) {
                    seasonMsg = await socket.sendMessage(reply.key.remoteJid, {
                        image: { url: thumb },
                        caption: seasonCaption
                    }, { quoted: reply });
                } else {
                    seasonMsg = await socket.sendMessage(reply.key.remoteJid, {
                        text: seasonCaption
                    }, { quoted: reply });
                }

                const seasonMsgId = seasonMsg.key.id;

                // ── STEP 3: Season → Episodes ──
                const seasonHandler = async ({ messages }) => {
                    const sReply = messages[0];
                    if (!sReply?.message) return;

                    const sStanza = sReply.message?.extendedTextMessage?.contextInfo?.stanzaId;
                    if (sStanza !== seasonMsgId) return;

                    const sText = (
                        sReply.message.conversation ||
                        sReply.message.extendedTextMessage?.text ||
                        ''
                    ).trim();
                    const sNum = parseInt(sText);

                    if (isNaN(sNum) || sNum < 1 || sNum > seasons.length) {
                        return await socket.sendMessage(sReply.key.remoteJid, {
                            text: `❌ *Invalid number!* Enter 1 to ${seasons.length}`
                        }, { quoted: sReply });
                    }

                    socket.ev.off('messages.upsert', seasonHandler);
                    const selectedSeason = seasons[sNum - 1];

                    await socket.sendMessage(sReply.key.remoteJid, { react: { text: '⏳', key: sReply.key } });

                    let epData;
                    try {
                        epData = await listItems(selectedSeason.link);
                    } catch (e) {
                        return await socket.sendMessage(sReply.key.remoteJid, {
                            text: `❌ *Failed to load episodes:* ${e.message}`
                        }, { quoted: sReply });
                    }

                    if (!epData.success || !epData.items?.length) {
                        return await socket.sendMessage(sReply.key.remoteJid, {
                            text: `❌ *No episodes found.*`
                        }, { quoted: sReply });
                    }

                    const episodes = epData.items;
                    const showEps = episodes.slice(0, 40);
                    const epText = showEps.map((e, i) =>
                        `*${i + 1}.* ${e.name}${e.size ? ` | ${e.size}` : ''}`
                    ).join('\n');
                    const moreText = episodes.length > 40
                        ? `\n\n📌 Showing first 40 of ${episodes.length}`
                        : '';

                    const epCaption =
                        `🎌 *${selected.title} — ${selectedSeason.name}*\n` +
                        `🎞️ Episodes: *${episodes.length}*\n\n` +
                        `${epText}${moreText}\n\n` +
                        `↩️ *Reply with episode number*\n\n> *VORTEX MD*`;

                    let epMsg;
                    if (thumb) {
                        epMsg = await socket.sendMessage(sReply.key.remoteJid, {
                            image: { url: thumb },
                            caption: epCaption
                        }, { quoted: sReply });
                    } else {
                        epMsg = await socket.sendMessage(sReply.key.remoteJid, {
                            text: epCaption
                        }, { quoted: sReply });
                    }

                    const epMsgId = epMsg.key.id;

                    // ── STEP 4: Episode → Direct MP4 ──
                    const epHandler = async ({ messages }) => {
                        const eReply = messages[0];
                        if (!eReply?.message) return;

                        const eStanza = eReply.message?.extendedTextMessage?.contextInfo?.stanzaId;
                        if (eStanza !== epMsgId) return;

                        const eText = (
                            eReply.message.conversation ||
                            eReply.message.extendedTextMessage?.text ||
                            ''
                        ).trim();
                        const eNum = parseInt(eText);

                        if (isNaN(eNum) || eNum < 1 || eNum > showEps.length) {
                            return await socket.sendMessage(eReply.key.remoteJid, {
                                text: `❌ *Invalid number!* Enter 1 to ${showEps.length}`
                            }, { quoted: eReply });
                        }

                        socket.ev.off('messages.upsert', epHandler);
                        const selectedEp = showEps[eNum - 1];

                        await socket.sendMessage(eReply.key.remoteJid, { react: { text: '⏳', key: eReply.key } });

                        let dlData;
                        try {
                            dlData = await getDownload(selectedEp.link);
                        } catch (e) {
                            return await socket.sendMessage(eReply.key.remoteJid, {
                                text: `❌ *Download failed:* ${e.message}`
                            }, { quoted: eReply });
                        }

                        if (!dlData.success || !dlData.download) {
                            return await socket.sendMessage(eReply.key.remoteJid, {
                                text: `❌ *No direct link found for ${selectedEp.name}*`
                            }, { quoted: eReply });
                        }

                        const mp4Url = dlData.download;
                        const fileName = (dlData.file || `${selected.title}_${selectedEp.name}.mp4`)
                            .replace(/[^\w.\- ]+/g, '')
                            .replace(/\s+/g, '_');

                        // Send as document
                        try {
                            await socket.sendMessage(eReply.key.remoteJid, {
                                document: { url: mp4Url },
                                mimetype: 'video/mp4',
                                fileName: fileName,
                                caption:
                                    `🎌 *${selected.title}*\n` +
                                    `🗂️ ${selectedSeason.name} | ${selectedEp.name}\n` +
                                    `📦 ${dlData.size || ''}\n\n> *VORTEX MD*`
                            }, { quoted: eReply });
                        } catch (e) {
                            console.log('Document send skipped or failed:', e.message);
                            return await socket.sendMessage(eReply.key.remoteJid, {
                                text: `❌ *File is too large to send as a document.*`
                            }, { quoted: eReply });
                        }

                        await socket.sendMessage(eReply.key.remoteJid, {
                            react: { text: '✅', key: eReply.key }
                        });
                    };

                    socket.ev.on('messages.upsert', epHandler);
                    setTimeout(() => socket.ev.off('messages.upsert', epHandler), 10 * 60 * 1000);
                };

                socket.ev.on('messages.upsert', seasonHandler);
                setTimeout(() => socket.ev.off('messages.upsert', seasonHandler), 5 * 60 * 1000);
            };

            socket.ev.on('messages.upsert', searchHandler);
            setTimeout(() => socket.ev.off('messages.upsert', searchHandler), 5 * 60 * 1000);

        } catch (err) {
            console.error('Anim plugin error:', err.message);
            await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
            await socket.sendMessage(sender, {
                text: `❌ *Error:* ${err.message}`
            }, { quoted: msg });
        }
    }
};
