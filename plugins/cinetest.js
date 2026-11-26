const axios = require('axios');

const _cfg = {
    base: "https://cinesubz.net",
    ua: "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36"
};

const _dec = s => s.replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d)).replace(/&amp;/g, "&");

async function search(q) {
    const { data: html } = await axios.get(_cfg.base + "/?s=" + encodeURIComponent(q), {
        headers: { "User-Agent": _cfg.ua }
    });
    return [...html.matchAll(/<div id="item-\d+" class="display-item">[\s\S]*?<a href="([^"]+)" data-url="[^"]+" data-ptype="([^"]+)" title="[^"]+">[\s\S]*?<img[^>]*data-original="([^"]+)"[\s\S]*?imdb-score">([^<]+)<[\s\S]*?badge-(?:quality|episode)-corner">([^<]+)<[\s\S]*?<h3>([^<]+)<\/h3>/g)].map(m => ({
        title: _dec(m[6]),
        url: m[1],
        type: m[2],
        poster: m[3],
        imdb: m[4],
        quality: m[5]
    }));
}

async function detail(url) {
    const { data: html } = await axios.get(url, {
        headers: { "User-Agent": _cfg.ua }
    });
    return {
        title: html.match(/<title>([^<]+)<\/title>/)?.[1]?.replace(/ \| සිංහල.*$/, ""),
        downloads: [...html.matchAll(/href='([^']+)'[^>]*class='(?:movie-)?download-button'[^>]*>[\s\S]*?(?:movie-)?download-meta'>([^<]+)</gs)].map(m => ({
            api: m[1],
            meta: m[2]
        })),
        episodes: [...html.matchAll(/class='episode-link' href='([^']+)' data-pid='\d+' data-season='(\d+)' data-episode='(\d+)'>[\s\S]*?ep-title'>([^<]+)<[\s\S]*?ep-date'>([^<]+)</gs)].map(m => ({
            url: m[1],
            season: +m[2],
            episode: +m[3],
            title: _dec(m[4]),
            date: m[5]
        }))
    };
}

// csplayer domain එක පමණක් වෙනම target කරන dl function එක
async function dl(url) {
    const { data: html } = await axios.get(url, {
        headers: { 
            "User-Agent": _cfg.ua,
            "Referer": _cfg.base
        }
    });

    // 1. csplayer2.space හෝ ඕනෑම csplayer domain එකක් සහිත link එකක් තිබේදැයි බලයි
    const csplayerMatch = html.match(/https?:\/\/[a-zA-Z0-9.-]*csplayer[a-zA-Z0-9.-]*\/server\d+\/[^"'<>\s]+/i);
    
    if (csplayerMatch) {
        return csplayerMatch[0].replace(/&amp;/g, "&");
    }

    // 2. google.com නොවන වෙනත් server link එකක් තිබේ නම් එය ගනී
    const fallbackMatch = html.match(/https?:\/\/(?!.*google\.com)[a-zA-Z0-9.-]+\/server\d+\/[^"'<>\s]+/i);
    
    if (fallbackMatch) {
        return fallbackMatch[0].replace(/&amp;/g, "&");
    }

    throw new Error("csplayer direct link එක සොයා ගැනීමට නොහැකි විය.");
}

module.exports = {
    command: ['cinelink', 'csz', 'sinhala2'],
    description: 'Fetch CSPlayer Direct Link from Cinesubz',
    ownerOnly: false,

    handler: async ({ socket, msg, sender, args, prefix }) => {
        try {
            const query = args.join(' ').trim();

            if (!query) {
                return await socket.sendMessage(sender, {
                    text: `❌ *Usage:* ${prefix}cinesubz <name>`
                }, { quoted: msg });
            }

            // ── STEP 1: Search ──
            await socket.sendMessage(sender, { react: { text: '🔍', key: msg.key } });

            let results;
            try {
                results = await search(query);
            } catch (e) {
                return await socket.sendMessage(sender, { text: `❌ *Search failed:* ${e}` }, { quoted: msg });
            }

            if (!results || results.length === 0) {
                return await socket.sendMessage(sender, { text: `❌ *No results found for:* ${query}` }, { quoted: msg });
            }

            const top = results.slice(0, 5);
            const resultText = top.map((r, i) => `*${i + 1}.* ${r.title}\n   📺 ${r.type} | ⭐ ${r.imdb} | 🎬 ${r.quality}`).join('\n\n');
            const caption = `🎬 *VORTEX MD | Cinesubz*\n🔍 Results for: *${query}*\n\n${resultText}\n\n↩️ *Reply with number to select*`;

            let sentMsg = await socket.sendMessage(sender, {
                image: top[0]?.poster ? { url: top[0].poster } : undefined,
                text: !top[0]?.poster ? caption : undefined,
                caption: top[0]?.poster ? caption : undefined
            }, { quoted: msg });

            const searchMsgId = sentMsg.key.id;

            // ── STEP 2 Listener: Movie/Series Selection ──
            const searchHandler = async ({ messages }) => {
                const reply = messages[0];
                if (!reply?.message) return;
                if (reply.message?.extendedTextMessage?.contextInfo?.stanzaId !== searchMsgId) return;

                const replyText = (reply.message.conversation || reply.message.extendedTextMessage?.text || '').trim();
                const selNum = parseInt(replyText);

                if (isNaN(selNum) || selNum < 1 || selNum > top.length) return;
                socket.ev.off('messages.upsert', searchHandler);

                const selected = top[selNum - 1];
                await socket.sendMessage(reply.key.remoteJid, { react: { text: '⏳', key: reply.key } });

                let info;
                try { 
                    info = await detail(selected.url); 
                } catch (e) { 
                    return await socket.sendMessage(reply.key.remoteJid, { text: `❌ *Failed to load details:* ${e}` }, { quoted: reply }); 
                }

                // ── Movie ──
                if (info.downloads && info.downloads.length > 0) {
                    const dlList = info.downloads.map((d, i) => `*${i + 1}.* ${d.meta}`).join('\n');
                    const movieCaption = `🎬 *${info.title || selected.title}*\n\n📥 *Download Options:*\n${dlList}\n\n↩️ *Reply with number to get the link*`;

                    let movieMsg = await socket.sendMessage(reply.key.remoteJid, {
                        image: selected.poster ? { url: selected.poster } : undefined,
                        text: !selected.poster ? movieCaption : undefined,
                        caption: selected.poster ? movieCaption : undefined
                    }, { quoted: reply });

                    const movieMsgId = movieMsg.key.id;

                    const movieDlHandler = async ({ messages }) => {
                        const dlReply = messages[0];
                        if (!dlReply?.message) return;
                        if (dlReply.message?.extendedTextMessage?.contextInfo?.stanzaId !== movieMsgId) return;

                        const dlText = (dlReply.message.conversation || dlReply.message.extendedTextMessage?.text || '').trim();
                        const dlNum = parseInt(dlText);

                        if (isNaN(dlNum) || dlNum < 1 || dlNum > info.downloads.length) return;
                        socket.ev.off('messages.upsert', movieDlHandler);

                        await socket.sendMessage(dlReply.key.remoteJid, { react: { text: '⏳', key: dlReply.key } });

                        try {
                            const directUrl = await dl(info.downloads[dlNum - 1].api);
                            
                            // Link එක පමණක් WhatsApp වෙත යැවීම
                            await socket.sendMessage(dlReply.key.remoteJid, { text: directUrl }, { quoted: dlReply });
                            await socket.sendMessage(dlReply.key.remoteJid, { react: { text: '✅', key: dlReply.key } });
                        } catch (e) {
                            await socket.sendMessage(dlReply.key.remoteJid, { text: `❌ *Link fetch failed:* ${e.message}` }, { quoted: dlReply });
                        }
                    };

                    socket.ev.on('messages.upsert', movieDlHandler);
                    setTimeout(() => socket.ev.off('messages.upsert', movieDlHandler), 10 * 60 * 1000);

                // ── TV Series ──
                } else if (info.episodes && info.episodes.length > 0) {
                    const seasons = {};
                    info.episodes.forEach(ep => {
                        if (!seasons[ep.season]) seasons[ep.season] = [];
                        seasons[ep.season].push(ep);
                    });

                    let epListText = Object.keys(seasons).length === 1 
                        ? info.episodes.map((ep, i) => `*${i + 1}.* S${ep.season}E${String(ep.episode).padStart(2, '0')} - ${ep.title}`).join('\n')
                        : Object.keys(seasons).map(s => `*Season ${s}* (${seasons[s].length} eps)`).join('\n') + '\n\nEnter: *S1E3* format';

                    const seriesCaption = `📺 *${info.title || selected.title}*\n\n${epListText}\n\n↩️ *Reply with number or S1E3*`;

                    let seriesMsg = await socket.sendMessage(reply.key.remoteJid, {
                        image: selected.poster ? { url: selected.poster } : undefined,
                        text: !selected.poster ? seriesCaption : undefined,
                        caption: selected.poster ? seriesCaption : undefined
                    }, { quoted: reply });

                    const seriesMsgId = seriesMsg.key.id;

                    const epHandler = async ({ messages }) => {
                        const epReply = messages[0];
                        if (!epReply?.message) return;
                        if (epReply.message?.extendedTextMessage?.contextInfo?.stanzaId !== seriesMsgId) return;

                        const epText = (epReply.message.conversation || epReply.message.extendedTextMessage?.text || '').trim().toUpperCase();
                        let targetEp = epText.match(/^S(\d+)E(\d+)$/) 
                            ? info.episodes.find(e => e.season === +epText.match(/^S(\d+)E(\d+)$/)[1] && e.episode === +epText.match(/^S(\d+)E(\d+)$/)[2])
                            : (!isNaN(parseInt(epText)) ? info.episodes[parseInt(epText) - 1] : null);

                        if (!targetEp) return;
                        socket.ev.off('messages.upsert', epHandler);

                        await socket.sendMessage(epReply.key.remoteJid, { react: { text: '⏳', key: epReply.key } });

                        try {
                            const epDetail = await detail(targetEp.url);
                            if (!epDetail.downloads || epDetail.downloads.length === 0) throw new Error("No download links");

                            const directUrl = await dl(epDetail.downloads[0].api);
                            
                            // Link එක පමණක් WhatsApp වෙත යැවීම
                            await socket.sendMessage(epReply.key.remoteJid, { text: directUrl }, { quoted: epReply });
                            await socket.sendMessage(epReply.key.remoteJid, { react: { text: '✅', key: epReply.key } });
                        } catch (e) {
                            await socket.sendMessage(epReply.key.remoteJid, { text: `❌ *Failed:* ${e.message}` }, { quoted: epReply });
                        }
                    };

                    socket.ev.on('messages.upsert', epHandler);
                    setTimeout(() => socket.ev.off('messages.upsert', epHandler), 15 * 60 * 1000);
                } else {
                    await socket.sendMessage(reply.key.remoteJid, { text: '❌ *No download links found.*' }, { quoted: reply });
                }
            };

            socket.ev.on('messages.upsert', searchHandler);
            setTimeout(() => socket.ev.off('messages.upsert', searchHandler), 5 * 60 * 1000);

        } catch (err) {
            console.error('Error:', err.message);
        }
    }
};
