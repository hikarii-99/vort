const axios = require('axios');
const cheerio = require('cheerio');

const BASE_URL = "https://animeheaven.me";

// Scraper එකට ඕන Headers ටික
const client = axios.create({
    timeout: 15000,
    headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Connection": "keep-alive"
    }
});

const delay = (ms) => new Promise(r => setTimeout(r, ms));

// Retry එක්ක Scrape කරන Function එක
async function fetchWithRetry(url, options = {}, retries = 2) {
    try {
        return await client.get(url, options);
    } catch (error) {
        if (retries > 0) {
            await delay(1000);
            return fetchWithRetry(url, options, retries - 1);
        }
        throw new Error("Request failed: " + error.message);
    }
}

module.exports = {
    command: ['ah', 'anime' 'animeheaven'], 
    description: 'Download Anime from AnimeHeaven (Direct Scraper & Direct Upload)',

    handler: async ({ socket, msg, sender, args, prefix }) => {
        try {
            const query = args.join(' ').trim();

            if (!query) {
                return await socket.sendMessage(sender, {
                    text: `🎌 *VORTEX MD | AnimeHeaven DL*\n\n` +
                        `*Usage:* ${prefix}ah <anime name>\n\n` +
                        `*Examples:*\n` +
                        `${prefix}ah naruto\n` +
                        `${prefix}ah one piece\n\n` +
                        `> *Powered by VORTEX*`
                }, { quoted: msg });
            }

            await socket.sendMessage(sender, { react: { text: '🔍', key: msg.key } });
            await socket.sendMessage(sender, { text: `🔍 *Searching AnimeHeaven for: ${query}...*` }, { quoted: msg });

            // 1. Search Data Scrape කිරීම
            const searchUrl = `${BASE_URL}/fastsearch.php?xhr=1&s=${encodeURIComponent(query)}`;
            let searchRes;
            try {
                searchRes = await fetchWithRetry(searchUrl, {
                    headers: { "X-Requested-With": "XMLHttpRequest", "Referer": BASE_URL }
                });
            } catch (err) {
                return await socket.sendMessage(sender, { text: `❌ *Search Failed:* ${err.message}` }, { quoted: msg });
            }

            const $ = cheerio.load(searchRes.data);
            const animeList = [];

            $("a.ac").each((i, el) => {
                animeList.push({
                    title: $(el).find(".fastname").text().trim(),
                    url: BASE_URL + $(el).attr("href"),
                    image: BASE_URL + $(el).find("img.coverimg").attr("src")
                });
            });

            if (animeList.length === 0) {
                return await socket.sendMessage(sender, { text: `❌ *No animes found for:* ${query}` }, { quoted: msg });
            }

            const topAnimes = animeList.slice(0, 5);
            const animeListText = topAnimes.map((a, i) => `*${i + 1}.* 🎬 ${a.title}`).join('\n\n');
            
            const caption = `🎌 *VORTEX MD | Anime Search*\n\n` +
                            `${animeListText}\n\n` +
                            `───────────────━┈\n` +
                            `↩️ *Reply with number to select Anime*\n\n` +
                            `> *Powered by VORTEX*`;

            let sentMsg;
            if (topAnimes[0]?.image) {
                sentMsg = await socket.sendMessage(sender, { image: { url: topAnimes[0].image }, caption: caption }, { quoted: msg });
            } else {
                sentMsg = await socket.sendMessage(sender, { text: caption }, { quoted: msg });
            }

            const searchMsgId = sentMsg.key.id;

            const searchHandler = async ({ messages }) => {
                const reply = messages[0];
                if (!reply?.message) return;
                const isReply = reply.message?.extendedTextMessage?.contextInfo?.stanzaId === searchMsgId;
                if (!isReply) return;

                const replyText = (reply.message.conversation || reply.message.extendedTextMessage?.text || '').trim();
                const selNum = parseInt(replyText);

                if (isNaN(selNum) || selNum < 1 || selNum > topAnimes.length) {
                    return await socket.sendMessage(reply.key.remoteJid, {
                        text: `❌ *Invalid number!* Enter 1 to ${topAnimes.length}`
                    }, { quoted: reply });
                }

                socket.ev.off('messages.upsert', searchHandler); 
                const selectedAnime = topAnimes[selNum - 1];

                await socket.sendMessage(reply.key.remoteJid, { react: { text: '⏳', key: reply.key } });
                await socket.sendMessage(reply.key.remoteJid, { text: `🔄 *Extracting Episodes...*` }, { quoted: reply });

                // 2. Episodes Scrape කිරීම
                let animeRes;
                try {
                    animeRes = await fetchWithRetry(selectedAnime.url, { headers: { Referer: BASE_URL } });
                } catch (err) {
                    return await socket.sendMessage(reply.key.remoteJid, { text: `❌ *Failed to load episodes:* ${err.message}` }, { quoted: reply });
                }

                const $$ = cheerio.load(animeRes.data);
                const episodes = [];
                const seen = new Set();

                $$(".trackep, .trackep0").each((i, el) => {
                    const ep = $$(el).find(".watch2").text().trim();
                    if (!ep || seen.has(ep)) return;
                    seen.add(ep);

                    const a = $$(el).closest("a");
                    let token = a.attr("id");
                    if (!token) {
                        const onclick = a.attr("onclick");
                        const m = onclick?.match(/gatea\("([^"]+)"\)/);
                        if (m) token = m[1];
                    }
                    if (token) episodes.push({ episode: ep, token });
                });

                if (episodes.length === 0) {
                    return await socket.sendMessage(reply.key.remoteJid, { text: `❌ *No episodes found for this anime!*` }, { quoted: reply });
                }

                const epLimit = episodes.slice(0, 40);
                const epListText = epLimit.map((e, i) => `*${i + 1}.* Episode ${e.episode}`).join('\n');

                const epCaption = `🎌 *${selectedAnime.title}*\n\n` +
                    `╭──────────────━┈\n` +
                    `│ 📥 *Available Episodes*\n` +
                    `╰──────────────━┈\n\n` +
                    `${epListText}\n\n` +
                    `───────────────━┈\n` +
                    `↩️ *Reply with number to download episode*\n\n` +
                    `> *VORTEX MD*`;

                const epMsg = await socket.sendMessage(reply.key.remoteJid, {
                    image: { url: selectedAnime.image },
                    caption: epCaption
                }, { quoted: reply });

                const epMsgId = epMsg.key.id;

                const epHandler = async ({ messages: epMessages }) => {
                    const epReply = epMessages[0];
                    if (!epReply?.message) return;
                    const isEpReply = epReply.message?.extendedTextMessage?.contextInfo?.stanzaId === epMsgId;
                    if (!isEpReply) return;

                    const epReplyText = (epReply.message.conversation || epReply.message.extendedTextMessage?.text || '').trim();
                    const epNum = parseInt(epReplyText);

                    if (isNaN(epNum) || epNum < 1 || epNum > epLimit.length) {
                        return await socket.sendMessage(epReply.key.remoteJid, {
                            text: `❌ *Invalid number!* Enter 1 to ${epLimit.length}`
                        }, { quoted: epReply });
                    }

                    socket.ev.off('messages.upsert', epHandler); 
                    const selectedEp = epLimit[epNum - 1];

                    await socket.sendMessage(epReply.key.remoteJid, { react: { text: '⏳', key: epReply.key } });
                    await socket.sendMessage(epReply.key.remoteJid, { text: `🔄 *Bypassing Video Link...*` }, { quoted: epReply });

                    // 3. Video Link එක Scrape කිරීම (Bypass Token)
                    let videoUrl = null;
                    try {
                        const gateRes = await fetchWithRetry(`${BASE_URL}/gate.php`, {
                            headers: {
                                "User-Agent": "Mozilla/5.0",
                                "Referer": `${BASE_URL}/anime.php`,
                                "Cookie": `key=${selectedEp.token}`
                            }
                        });
                        const $$$ = cheerio.load(gateRes.data);
                        videoUrl = $$$("video source").first().attr("src");
                    } catch (err) {
                        return await socket.sendMessage(epReply.key.remoteJid, { text: `❌ *Failed to bypass video:* ${err.message}` }, { quoted: epReply });
                    }

                    if (!videoUrl) {
                        return await socket.sendMessage(epReply.key.remoteJid, { text: `❌ *Error:* Could not extract video URL.` }, { quoted: epReply });
                    }

                    const fileName = `${selectedAnime.title.replace(/[^a-zA-Z0-9]/g, '_')}_Ep_${selectedEp.episode}.mp4`;

                    try {
                        await socket.sendMessage(epReply.key.remoteJid, {
                            text: `📤 *Direct Uploading Episode ${selectedEp.episode} to WhatsApp... Please wait!*`
                        }, { quoted: epReply });

                        // 4. Direct Upload (No Temp files)
                        await socket.sendMessage(epReply.key.remoteJid, {
                            document: { url: videoUrl },
                            mimetype: 'video/mp4',
                            fileName: fileName,
                            caption: `🎌 *${selectedAnime.title}*\n🎬 Episode: ${selectedEp.episode}\n\n> *Powered by VORTEX*`
                        }, { quoted: epReply });

                        await socket.sendMessage(epReply.key.remoteJid, { react: { text: '✅', key: epReply.key } });

                    } catch (e) {
                        await socket.sendMessage(epReply.key.remoteJid, {
                            text: `❌ *Failed to upload video:*\n${e.message}\n\n📥 *Direct Link:*\n${videoUrl}`
                        }, { quoted: epReply });
                    }
                };

                socket.ev.on('messages.upsert', epHandler);
                setTimeout(() => socket.ev.off('messages.upsert', epHandler), 10 * 60 * 1000); 
            };

            socket.ev.on('messages.upsert', searchHandler);
            setTimeout(() => socket.ev.off('messages.upsert', searchHandler), 5 * 60 * 1000); 

        } catch (err) {
            console.error('Anime plugin error:', err.message);
            await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
            await socket.sendMessage(sender, { text: `❌ *System Error:* ${err.message}` }, { quoted: msg });
        }
    }
};
