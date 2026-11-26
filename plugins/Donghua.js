const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const os = require('os');
const cloudscraper = require('cloudscraper');

// Temp ෆෝල්ඩරය සකස් කිරීම
const TEMP_DIR = path.join(__dirname, 'temp_animexin');
if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR);
}
process.env.TMPDIR = TEMP_DIR;
os.tmpdir = () => TEMP_DIR;

const BASE_URL = 'https://animexin.dev';
const DEFAULT_THUMB = 'https://u.pone.rs/lpmsdlmk.jpg'; // ඔයාගෙ අලුත් Image Link එක

// 1. Cloudflare Bypass HTML Scraper Function
async function fetchHtmlWithRetry(url, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            const html = await cloudscraper.get({
                uri: url,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.5',
                    'Connection': 'keep-alive',
                    'Upgrade-Insecure-Requests': '1'
                },
                cloudflareMaxTimeout: 30000,
                followAllRedirects: true
            });

            if (!html || html.includes('Just a moment...')) {
                throw new Error("Cloudflare Challenge Detected");
            }

            return html;
        } catch (error) {
            console.log(`[CLOUDSCRAPE ATTEMPT ${i + 1} FAILED] - ${error.message}`);
            if (i === retries - 1) throw new Error("Cloudflare Firewall Blocked. Please try again.");
            await new Promise(res => setTimeout(res, 3000));
        }
    }
}

// 2. New Built-in Mediafire Scraper 🔥 (Replaces External API)
async function getMediafireLink(url) {
    try {
        const { data } = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8'
            }
        });

        const $ = cheerio.load(data);
        const downloadLink = $('#downloadButton').attr('href');

        if (!downloadLink) throw new Error('Download button not found on Mediafire page.');

        // File name එක url එකෙන් වෙන් කරගැනීම
        const fileNameMatch = downloadLink.match(/\/([^\/?#]+)[^\/]*$/);
        const fileName = fileNameMatch ? decodeURIComponent(fileNameMatch[1]) : `AnimeXin_${Date.now()}.mp4`;

        return { downloadLink, fileName };
    } catch (err) {
        throw new Error(`Mediafire Bypass Failed: ${err.message}`);
    }
}

// 3. Direct File Download Function (Updated for Mediafire & Size Check)
async function downloadWithRetry(url, destPath, referer, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            const response = await axios({
                url: url,
                method: 'GET',
                responseType: 'stream',
                timeout: 60000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                    'Referer': referer, // Mediafire එකෙන් Block වෙන එක නවත්වන්න මේක අත්‍යවශ්‍යයි
                    'Connection': 'keep-alive'
                }
            });

            const writer = fs.createWriteStream(destPath);
            response.data.pipe(writer);

            await new Promise((resolve, reject) => {
                writer.on('finish', resolve);
                writer.on('error', reject);
            });

            // 1MB වලට වඩා අඩු නම් (corrupted/html page) නම් reject කරනවා
            const stats = fs.statSync(destPath);
            if (stats.size < 1024 * 1024) { 
                fs.unlinkSync(destPath);
                throw new Error(`Incomplete download (File size only ${(stats.size / 1024).toFixed(2)} KB). Mediafire blocked the request.`);
            }

            return true;
        } catch (error) {
            console.log(`[DOWNLOAD ATTEMPT ${i + 1} FAILED] - ${error.message}`);
            if (fs.existsSync(destPath)) try { fs.unlinkSync(destPath); } catch(e){}
            if (i === retries - 1) throw error;
            await new Promise(res => setTimeout(res, 3000));
        }
    }
}

// --- SCRAPER HELPER FUNCTIONS ---

async function searchAnimeXin(query) {
    const url = `${BASE_URL}/?s=${encodeURIComponent(query)}`;
    const html = await fetchHtmlWithRetry(url);
    const $ = cheerio.load(html);
    const results = [];

    $('.listupd article.bs').each((_, el) => {
        const article = $(el);
        const link = article.find('.bsx > a').first();
        if (!link.length) return;

        const titleEl = link.find('.tt h2[itemprop="headline"]').first();
        const typeEl = link.find('.typez').first();
        const statusEl = link.find('.epx').first();

        const title = (titleEl.text() && titleEl.text().trim()) || (link.attr('title') && link.attr('title').trim()) || null;
        const href = link.attr('href') || null;

        if (title && href) {
            results.push({
                title,
                url: href,
                type: typeEl.text().trim() || 'Anime',
                status: statusEl.text().trim() || 'N/A'
            });
        }
    });

    return results;
}

async function getAnimeDetails(seriesUrl) {
    const html = await fetchHtmlWithRetry(seriesUrl);
    const $ = cheerio.load(html);

    const title = $('h1').first().text().trim() || $('meta[property="og:title"]').attr('content') || 'Anime';
    
    const episodes = [];
    const seen = new Set();

    $('a[href*="episode"]').each((i, el) => {
        const href = $(el).attr('href');
        let epTitle = $(el).text().trim();

        if (!href || seen.has(href)) return;
        if (!href.includes('animexin.dev') || !href.includes('episode')) return;

        if (!epTitle || epTitle.length < 3) {
            const match = href.match(/episode-(\d+)/i);
            epTitle = match ? `Episode ${match[1]}` : `Episode ${i + 1}`;
        }

        seen.add(href);
        episodes.push({
            title: epTitle,
            link: href.startsWith('http') ? href : BASE_URL + href
        });
    });

    episodes.sort((a, b) => {
        const numA = parseInt(a.title.match(/\d+/)?.[0] || 0);
        const numB = parseInt(b.title.match(/\d+/)?.[0] || 0);
        return numA - numB;
    });

    return { title, episodes };
}

async function getEpisodeDownloads(episodeUrl) {
    const html = await fetchHtmlWithRetry(episodeUrl);
    const $ = cheerio.load(html);

    const title = $('h1').first().text().trim() || $('meta[property="og:title"]').attr('content') || 'Episode';
    const links = [];
    const seen = new Set();

    const mfRegex = /https:\/\/www\.mediafire\.com\/file\/[^\s"'<>]+/gi;
    let match;

    while ((match = mfRegex.exec(html)) !== null) {
        let url = match[0].replace(/&amp;/g, '&').replace(/"$/, '');
        if (!seen.has(url)) {
            seen.add(url);
            links.push(url);
        }
    }

    let englishLinks = links.filter(u => /eng|english/i.test(u));
    if (englishLinks.length === 0) englishLinks = links;

    return { title, links: englishLinks };
}

module.exports = {
    command: ['animexin2', 'donghua2'],
    description: 'Search & Download Donghua/Anime from AnimeXin',

    handler: async ({ socket, msg, sender, args, prefix }) => {
        try {
            const query = args.join(' ').trim();

            if (!query) {
                return await socket.sendMessage(sender, {
                    image: { url: DEFAULT_THUMB },
                    caption: `╭━━━〔 *A N I M E X I N  D L* 〕━━━┈\n` +
                             `┃\n` +
                             `┃ 🎬 *Command:* ${prefix}animexin or ${prefix}xin\n` +
                             `┃ 📌 *Usage:* ${prefix}xin <anime name>\n` +
                             `┃\n` +
                             `┃ *Example:*\n` +
                             `┃ ${prefix}xin Soul Land\n` +
                             `┃\n` +
                             `╰━━━━━━━━━━━━━━━━━━━━━━━━━━┈\n\n` +
                             `> *© VORTEX MD*`
                }, { quoted: msg });
            }

            await socket.sendMessage(sender, { react: { text: '🔍', key: msg.key } });

            // 1. Search Results
            let results;
            try {
                results = await searchAnimeXin(query);
            } catch (err) {
                return await socket.sendMessage(sender, { text: `❌ *Search Error:*\n${err.message}` }, { quoted: msg });
            }

            if (!results || results.length === 0) {
                return await socket.sendMessage(sender, { text: `❌ *No results found for:* ${query}` }, { quoted: msg });
            }

            const top = results.slice(0, 5);
            const resultList = top.map((r, i) => `┃ *${i + 1} |* ${r.title}\n┃ 🏷️ ${r.type} | ${r.status}`).join('\n┃\n');

            const caption = `╭━━━〔 *A N I M E X I N  S E A R C H* 〕━━━┈\n` +
                            `┃\n` +
                            `┃ 🔍 *Query:* ${query}\n` +
                            `┃ 📊 *Found:* ${top.length} Anime\n` +
                            `┃\n` +
                            `┣━━━〔 *Results List* 〕━━━┈\n` +
                            `┃\n` +
                            `${resultList}\n` +
                            `┃\n` +
                            `╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈\n\n` +
                            `*💡 Reply with a number (1-${top.length}) to select*\n` +
                            `> *© VORTEX MD*`;

            const sentMsg = await socket.sendMessage(sender, { image: { url: DEFAULT_THUMB }, caption: caption }, { quoted: msg });
            const searchMsgId = sentMsg.key.id;

            // --- 2. Anime Selection Handler ---
            const searchHandler = async ({ messages }) => {
                const reply = messages[0];
                if (!reply?.message) return;
                const isReply = reply.message?.extendedTextMessage?.contextInfo?.stanzaId === searchMsgId;
                if (!isReply) return;

                const replyText = (reply.message.conversation || reply.message.extendedTextMessage?.text || '').trim();
                const selNum = parseInt(replyText);

                if (isNaN(selNum) || selNum < 1 || selNum > top.length) {
                    return await socket.sendMessage(reply.key.remoteJid, { text: `❌ *Invalid number!* Enter 1 to ${top.length}` }, { quoted: reply });
                }

                socket.ev.off('messages.upsert', searchHandler);
                const selectedAnime = top[selNum - 1];

                await socket.sendMessage(reply.key.remoteJid, { react: { text: '⏳', key: reply.key } });

                // Fetch Series Details & Episodes
                let seriesData;
                try {
                    seriesData = await getAnimeDetails(selectedAnime.url);
                } catch (err) {
                    return await socket.sendMessage(reply.key.remoteJid, { text: `❌ *Failed to fetch episodes!*` }, { quoted: reply });
                }

                if (!seriesData.episodes || seriesData.episodes.length === 0) {
                    return await socket.sendMessage(reply.key.remoteJid, { text: `❌ *No episodes found for this series!*` }, { quoted: reply });
                }

                const episodesList = seriesData.episodes.slice(0, 30);
                const epListText = episodesList.map((ep, i) => `┃ *${i + 1} |* ${ep.title}`).join('\n');

                const epCaption = `╭━━━〔 *E P I S O D E S  L I S T* 〕━━━┈\n` +
                                  `┃\n` +
                                  `┃ 🎬 *Anime:* ${seriesData.title}\n` +
                                  `┃ 📌 *Total Episodes:* ${seriesData.episodes.length}\n` +
                                  `┃\n` +
                                  `┣━━━〔 *Episodes (1-${episodesList.length})* 〕━━━┈\n` +
                                  `┃\n` +
                                  `${epListText}\n` +
                                  `┃\n` +
                                  `╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈\n\n` +
                                  `*💡 Reply with Episode Number to download*\n` +
                                  `> *© VORTEX MD*`;

                const epMsg = await socket.sendMessage(reply.key.remoteJid, { image: { url: DEFAULT_THUMB }, caption: epCaption }, { quoted: reply });
                const epMsgId = epMsg.key.id;

                // --- 3. Episode Selection & Download Handler ---
                const epHandler = async ({ messages: epMsgs }) => {
                    const epReply = epMsgs[0];
                    if (!epReply?.message) return;
                    const isIt = epReply.message?.extendedTextMessage?.contextInfo?.stanzaId === epMsgId;
                    if (!isIt) return;

                    const epText = (epReply.message.conversation || epReply.message.extendedTextMessage?.text || '').trim();
                    const epNum = parseInt(epText);

                    if (isNaN(epNum) || epNum < 1 || epNum > episodesList.length) {
                        return await socket.sendMessage(epReply.key.remoteJid, { text: `❌ *Invalid Episode!* Enter 1 to ${episodesList.length}` }, { quoted: epReply });
                    }

                    socket.ev.off('messages.upsert', epHandler);
                    const selectedEp = episodesList[epNum - 1];

                    await socket.sendMessage(epReply.key.remoteJid, { react: { text: '🔄', key: epReply.key } });

                    try {
                        const epDownloads = await getEpisodeDownloads(selectedEp.link);

                        if (!epDownloads.links || epDownloads.links.length === 0) {
                            return await socket.sendMessage(epReply.key.remoteJid, { text: `❌ *No download links found for this episode!*` }, { quoted: epReply });
                        }

                        const targetMediafireUrl = epDownloads.links[0];

                        await socket.sendMessage(epReply.key.remoteJid, { react: { text: '⚙️', key: epReply.key } });

                        // අපේ අලුත් Mediafire function එක පාවිච්චි කිරීම
                        const mfData = await getMediafireLink(targetMediafireUrl);
                        
                        if (!mfData.downloadLink) {
                            throw new Error("Could not extract Mediafire direct link.");
                        }

                        const directLink = mfData.downloadLink;
                        const fileName = mfData.fileName;
                        
                        const tempFilePath = path.join(TEMP_DIR, fileName.replace(/[^a-zA-Z0-9._-]/g, '_'));

                        await socket.sendMessage(epReply.key.remoteJid, { react: { text: '⬇️', key: epReply.key } });
                        await socket.sendMessage(epReply.key.remoteJid, {
                            text: `╭━━━〔 *D O W N L O A D I N G* 〕━━━┈\n` +
                                  `┃\n` +
                                  `┃ 🎬 *Title:* ${epDownloads.title}\n` +
                                  `┃ 📄 *File:* ${fileName}\n` +
                                  `┃\n` +
                                  `╰━━━━━━━━━━━━━━━━━━━━━━━━━━┈\n\n` +
                                  `*(Please wait, sending video file shortly...)*`
                        }, { quoted: epReply });

                        // Download කරන ගමන් Referer එක විදිහට original url එක යවනවා
                        await downloadWithRetry(directLink, tempFilePath, targetMediafireUrl, 3);

                        await socket.sendMessage(epReply.key.remoteJid, { react: { text: '📤', key: epReply.key } });

                        const mimetype = fileName.endsWith('.mkv') ? 'video/x-matroska' : 'video/mp4';

                        const finalCaption = `╭━━━〔 *A N I M E X I N  D L* 〕━━━┈\n` +
                                             `┃\n` +
                                             `┃ 🎬 *Episode:* ${epDownloads.title}\n` +
                                             `┃\n` +
                                             `╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈\n\n` +
                                             `> *© VORTEX MD*`;

                        // fs.createReadStream වෙනුවට URL Path එක කෙලින්ම දෙනවා
                        await socket.sendMessage(epReply.key.remoteJid, {
                            document: { url: tempFilePath },
                            mimetype: mimetype,
                            fileName: fileName,
                            caption: finalCaption
                        }, { quoted: epReply });

                        await socket.sendMessage(epReply.key.remoteJid, { react: { text: '✅', key: epReply.key } });

                    } catch (e) {
                        console.error('Download/API Error:', e);
                        await socket.sendMessage(epReply.key.remoteJid, { react: { text: '❌', key: epReply.key } });
                        await socket.sendMessage(epReply.key.remoteJid, { text: `❌ *Process Failed:*\n${e.message}` }, { quoted: epReply });
                    } finally {
                        // Temp files මකා දැමීම
                        try {
                            if (fs.existsSync(TEMP_DIR)) {
                                fs.readdirSync(TEMP_DIR).forEach(file => {
                                    fs.unlinkSync(path.join(TEMP_DIR, file));
                                });
                            }
                        } catch (err) {}
                    }
                };

                socket.ev.on('messages.upsert', epHandler);
                setTimeout(() => socket.ev.off('messages.upsert', epHandler), 10 * 60 * 1000);
            };

            socket.ev.on('messages.upsert', searchHandler);
            setTimeout(() => socket.ev.off('messages.upsert', searchHandler), 5 * 60 * 1000);

        } catch (err) {
            console.error('AnimeXin plugin error:', err.message);
            await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
            await socket.sendMessage(sender, { text: `❌ *System Error:* ${err.message}` }, { quoted: msg });
        }
    }
};
