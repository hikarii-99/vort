const axios = require('axios');
const fs = require('fs');
const path = require('path');

const TEMP_DIR = path.join(__dirname, 'temp_cineverse');
if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR);
}

const API = 'https://cineverse-vortex.vercel.app';

async function apiGet(params) {
    const { data } = await axios.get(API + '/', {
        params: params,
        timeout: 25000
    });
    return data;
}

async function downloadWithRetry(url, destPath, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            const response = await axios({
                url: url,
                method: 'GET',
                responseType: 'stream',
                timeout: 1200000,
                maxContentLength: Infinity,
                maxBodyLength: Infinity,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                    'Connection': 'keep-alive'
                }
            });

            const writer = fs.createWriteStream(destPath);
            response.data.pipe(writer);

            await new Promise((resolve, reject) => {
                writer.on('finish', resolve);
                writer.on('error', reject);
            });

            const stats = fs.statSync(destPath);
            if (stats.size < 1024 * 1024) {
                fs.unlinkSync(destPath);
                throw new Error('Incomplete download (file too small).');
            }
            return true;
        } catch (error) {
            console.log(`[DOWNLOAD ${i + 1} FAILED] ${error.message}`);
            if (fs.existsSync(destPath)) try { fs.unlinkSync(destPath); } catch (e) {}
            if (i === retries - 1) throw error;
            await new Promise(res => setTimeout(res, 3000));
        }
    }
}

async function sendFile(socket, jid, quoted, title, label, url) {
    const cleanFileName = `${title}_${label}.mp4`.replace(/[^a-zA-Z0-9._-]/g, '_');
    const tempFilePath = path.join(TEMP_DIR, cleanFileName);

    try {
        await socket.sendMessage(jid, { react: { text: '⬇️', key: quoted.key } });
        await socket.sendMessage(jid, {
            text:
                `╭━━━〔 *DOWNLOADING* 〕━━━┈\n` +
                `┃ 🎬 *${title}*\n` +
                `┃ 📦 ${label}\n` +
                `╰━━━━━━━━━━━━━━━━━━┈\n\n` +
                `*(Saving to disk... please wait)*`
        }, { quoted: quoted });

        await downloadWithRetry(url, tempFilePath, 3);

        await socket.sendMessage(jid, { react: { text: '📤', key: quoted.key } });
        await socket.sendMessage(jid, {
            document: { url: tempFilePath },
            mimetype: 'video/mp4',
            fileName: cleanFileName,
            caption: `🎬 *${title}*\n📦 ${label}\n\n> *Powered by VORTEX*`
        }, { quoted: quoted });

        await socket.sendMessage(jid, { react: { text: '✅', key: quoted.key } });
    } catch (error) {
        await socket.sendMessage(jid, { react: { text: '❌', key: quoted.key } });
        await socket.sendMessage(jid, {
            text: `❌ *Download failed:* ${error.message}\n\n🔗 ${url}`
        }, { quoted: quoted });
    } finally {
        try {
            if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
        } catch (e) {}
    }
}

function attachQualityHandler(socket, jid, msgId, downloads, title) {
    const qualityHandler = async ({ messages }) => {
        const qReply = messages[0];
        if (!qReply?.message) return;

        const stanza = qReply.message?.extendedTextMessage?.contextInfo?.stanzaId;
        if (stanza !== msgId) return;

        const text = (qReply.message.conversation || qReply.message.extendedTextMessage?.text || '').trim();
        const qNum = parseInt(text);

        if (isNaN(qNum) || qNum < 1 || qNum > downloads.length) {
            return await socket.sendMessage(jid, {
                text: `❌ *Invalid!* Enter 1 – ${downloads.length}`
            }, { quoted: qReply });
        }

        socket.ev.off('messages.upsert', qualityHandler);
        const selectedDL = downloads[qNum - 1];
        await sendFile(socket, jid, qReply, title, selectedDL.label, selectedDL.url);
    };

    socket.ev.on('messages.upsert', qualityHandler);
    setTimeout(() => socket.ev.off('messages.upsert', qualityHandler), 15 * 60 * 1000);
}

async function showDownloads(socket, jid, quoted, title, image, downloads) {
    if (!downloads.length) {
        return await socket.sendMessage(jid, {
            text: `❌ *No download links for:* ${title}`
        }, { quoted: quoted });
    }

    let text =
        `🎬 *${title}*\n\n` +
        `⬇️ *Select option:*\n\n`;

    downloads.forEach((d, i) => {
        text += `*${i + 1}.* ${d.label}\n`;
    });
    text += `\n↩️ *Reply with number*\n\n> *VORTEX*`;

    let qualMsg;
    if (image) {
        qualMsg = await socket.sendMessage(jid, {
            image: { url: image },
            caption: text
        }, { quoted: quoted });
    } else {
        qualMsg = await socket.sendMessage(jid, { text: text }, { quoted: quoted });
    }

    attachQualityHandler(socket, jid, qualMsg.key.id, downloads, title);
}

module.exports = {
    command: ['cv', 'cine', 'cineverse'],
    description: 'Search & Download Movies/Series from CineVerse LK',

    handler: async ({ socket, msg, sender, args, prefix }) => {
        try {
            const query = args.join(' ').trim();

            if (!query) {
                return await socket.sendMessage(sender, {
                    text:
                        `🎬 *CineVerse LK Downloader*\n\n` +
                        `*Usage:* ${prefix}cv <name>\n\n` +
                        `*Examples:*\n` +
                        `${prefix}cv harry potter\n` +
                        `${prefix}cv vikings\n` +
                        `${prefix}cine avatar\n\n` +
                        `> *Powered by VORTEX*`
                }, { quoted: msg });
            }

            // ── STEP 1: Search ──
            await socket.sendMessage(sender, { react: { text: '🔍', key: msg.key } });

            let searchData;
            try {
                searchData = await apiGet({ search: query });
            } catch (e) {
                return await socket.sendMessage(sender, {
                    text: `❌ *Search failed:* ${e.message}`
                }, { quoted: msg });
            }

            if (!searchData.success || !searchData.results?.length) {
                return await socket.sendMessage(sender, {
                    text: `❌ *No results for:* ${query}`
                }, { quoted: msg });
            }

            const results = searchData.results.slice(0, 8);
            const listText = results.map((r, i) =>
                `*${i + 1}.* ${r.title}\n   📂 ${r.type || '-'} | ${r.year || '-'}${r.isSeries ? ' | 📺 Series' : ''}`
            ).join('\n\n');

            const caption =
                `🎬 *CineVerse Search*\n` +
                `🔍 *${query}* — ${results.length} results\n\n` +
                `${listText}\n\n` +
                `↩️ *Reply with number*\n\n> *VORTEX*`;

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

            // ── STEP 2: Select title ──
            const searchHandler = async ({ messages }) => {
                const reply = messages[0];
                if (!reply?.message) return;

                const stanza = reply.message?.extendedTextMessage?.contextInfo?.stanzaId;
                if (stanza !== searchMsgId) return;

                const replyText = (reply.message.conversation || reply.message.extendedTextMessage?.text || '').trim();
                const num = parseInt(replyText);

                if (isNaN(num) || num < 1 || num > results.length) {
                    return await socket.sendMessage(reply.key.remoteJid, {
                        text: `❌ *Invalid!* Enter 1 – ${results.length}`
                    }, { quoted: reply });
                }

                socket.ev.off('messages.upsert', searchHandler);
                const selected = results[num - 1];
                const key = selected.title;
                const jid = reply.key.remoteJid;

                await socket.sendMessage(jid, { react: { text: '⏳', key: reply.key } });

                let detailData = null;
                let dlData = null;
                try {
                    detailData = await apiGet({ details: key }).catch(() => null);
                    dlData = await apiGet({ download: key }).catch(() => null);
                } catch (e) {}

                const title = detailData?.title || selected.title;
                const year = detailData?.year || selected.year || '-';
                const type = detailData?.type || selected.type || '-';
                const image = detailData?.image || selected.image;
                const desc = detailData?.description || '';
                const rating = detailData?.imdbRating || '';
                const isSeries = selected.isSeries || detailData?.isSeries || dlData?.need === 'season' || type === 'series';

                let descShort = desc;
                if (descShort && descShort.length > 250) descShort = descShort.slice(0, 250) + '...';

                // ═══ SERIES FLOW ═══
                if (isSeries && dlData?.need === 'season' && dlData.seasons?.length) {
                    const seasons = dlData.seasons;
                    let seasonText =
                        `🎬 *${title}*\n` +
                        `📂 Series | ${year}` + (rating ? ` | ⭐ ${rating}` : '') + `\n`;

                    if (descShort) seasonText += `\n📝 ${descShort}\n`;

                    seasonText += `\n📺 *Select Season:*\n\n`;
                    seasons.forEach((s, i) => {
                        seasonText += `*${i + 1}.* Season ${s.season} (${s.episodes} eps)\n`;
                    });
                    seasonText += `\n↩️ *Reply with number*\n\n> *VORTEX*`;

                    let seasonMsg;
                    if (image) {
                        seasonMsg = await socket.sendMessage(jid, {
                            image: { url: image },
                            caption: seasonText
                        }, { quoted: reply });
                    } else {
                        seasonMsg = await socket.sendMessage(jid, { text: seasonText }, { quoted: reply });
                    }

                    const seasonMsgId = seasonMsg.key.id;

                    // ── STEP 3: Select season ──
                    const seasonHandler = async ({ messages }) => {
                        const sReply = messages[0];
                        if (!sReply?.message) return;

                        const sStanza = sReply.message?.extendedTextMessage?.contextInfo?.stanzaId;
                        if (sStanza !== seasonMsgId) return;

                        const sText = (sReply.message.conversation || sReply.message.extendedTextMessage?.text || '').trim();
                        const sNum = parseInt(sText);

                        if (isNaN(sNum) || sNum < 1 || sNum > seasons.length) {
                            return await socket.sendMessage(jid, {
                                text: `❌ *Invalid!* Enter 1 – ${seasons.length}`
                            }, { quoted: sReply });
                        }

                        socket.ev.off('messages.upsert', seasonHandler);
                        const selectedSeason = seasons[sNum - 1].season;

                        await socket.sendMessage(jid, { react: { text: '⏳', key: sReply.key } });

                        let epData;
                        try {
                            epData = await apiGet({
                                download: key,
                                season: selectedSeason
                            });
                        } catch (e) {
                            return await socket.sendMessage(jid, {
                                text: `❌ *Failed to load episodes:* ${e.message}`
                            }, { quoted: sReply });
                        }

                        if (!epData.episodes?.length) {
                            return await socket.sendMessage(jid, {
                                text: `❌ *No episodes in Season ${selectedSeason}*`
                            }, { quoted: sReply });
                        }

                        const episodes = epData.episodes;
                        const showEps = episodes.slice(0, 50);
                        let epText =
                            `🎬 *${title}*\n` +
                            `📺 Season ${selectedSeason} — ${episodes.length} episodes\n\n`;

                        showEps.forEach((ep, i) => {
                            epText += `*${i + 1}.* Episode ${ep.episode}\n`;
                        });
                        if (episodes.length > 50) {
                            epText += `\n📌 Showing first 50 of ${episodes.length}\n`;
                        }
                        epText += `\n↩️ *Reply with number*\n\n> *VORTEX*`;

                        const epMsg = await socket.sendMessage(jid, {
                            text: epText
                        }, { quoted: sReply });

                        const epMsgId = epMsg.key.id;

                        // ── STEP 4: Select episode ──
                        const epHandler = async ({ messages }) => {
                            const eReply = messages[0];
                            if (!eReply?.message) return;

                            const eStanza = eReply.message?.extendedTextMessage?.contextInfo?.stanzaId;
                            if (eStanza !== epMsgId) return;

                            const eText = (eReply.message.conversation || eReply.message.extendedTextMessage?.text || '').trim();
                            const eNum = parseInt(eText);

                            if (isNaN(eNum) || eNum < 1 || eNum > showEps.length) {
                                return await socket.sendMessage(jid, {
                                    text: `❌ *Invalid!* Enter 1 – ${showEps.length}`
                                }, { quoted: eReply });
                            }

                            socket.ev.off('messages.upsert', epHandler);
                            const selectedEp = showEps[eNum - 1].episode;

                            await socket.sendMessage(jid, { react: { text: '⏳', key: eReply.key } });

                            let finalData;
                            try {
                                finalData = await apiGet({
                                    download: key,
                                    season: selectedSeason,
                                    episode: selectedEp
                                });
                            } catch (e) {
                                return await socket.sendMessage(jid, {
                                    text: `❌ *Failed:* ${e.message}`
                                }, { quoted: eReply });
                            }

                            const epTitle = finalData.title || `${title} S${selectedSeason}E${selectedEp}`;
                            const downloads = finalData.downloads || [];

                            await showDownloads(socket, jid, eReply, epTitle, image, downloads);
                        };

                        socket.ev.on('messages.upsert', epHandler);
                        setTimeout(() => socket.ev.off('messages.upsert', epHandler), 10 * 60 * 1000);
                    };

                    socket.ev.on('messages.upsert', seasonHandler);
                    setTimeout(() => socket.ev.off('messages.upsert', seasonHandler), 10 * 60 * 1000);
                    return;
                }

                // ═══ MOVIE FLOW ═══
                const downloads = dlData?.downloads || [];

                let infoText =
                    `🎬 *${title}*\n` +
                    `📂 ${type} | ${year}` + (rating ? ` | ⭐ ${rating}` : '') + `\n`;

                if (descShort) infoText += `\n📝 ${descShort}\n`;

                if (!downloads.length) {
                    return await socket.sendMessage(jid, {
                        text: infoText + `\n❌ *No download links found*`
                    }, { quoted: reply });
                }

                infoText += `\n⬇️ *Select option:*\n\n`;
                downloads.forEach((d, i) => {
                    infoText += `*${i + 1}.* ${d.label}\n`;
                });
                infoText += `\n↩️ *Reply with number*\n\n> *VORTEX*`;

                let qualMsg;
                if (image) {
                    qualMsg = await socket.sendMessage(jid, {
                        image: { url: image },
                        caption: infoText
                    }, { quoted: reply });
                } else {
                    qualMsg = await socket.sendMessage(jid, { text: infoText }, { quoted: reply });
                }

                attachQualityHandler(socket, jid, qualMsg.key.id, downloads, title);
            };

            socket.ev.on('messages.upsert', searchHandler);
            setTimeout(() => socket.ev.off('messages.upsert', searchHandler), 5 * 60 * 1000);

        } catch (err) {
            console.error('CV plugin error:', err.message);
            await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
            await socket.sendMessage(sender, {
                text: `❌ *Error:* ${err.message}`
            }, { quoted: msg });
        }
    }
};
