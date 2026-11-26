const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const os = require('os');
const cloudscraper = require('cloudscraper');
const { generateWAMessageFromContent, proto, prepareWAMessageMedia } = require('baileys');

// Temp ෆෝල්ඩරය සකස් කිරීම
const TEMP_DIR = path.join(__dirname, 'temp_animexin');
if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR);
}
process.env.TMPDIR = TEMP_DIR;
os.tmpdir = () => TEMP_DIR;

const BASE_URL = 'https://animexin.dev';
const DEFAULT_THUMB = 'https://u.pone.rs/lpmsdlmk.jpg'; // ඔයාගෙ Image Link එක

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

    const title = $('h1').first().text().trim() \vert{}\vert{}$('meta[property="og:title"]').attr('content') || 'Anime';
    
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

    const title = $('h1').first().text().trim() \vert{}\vert{}$('meta[property="og:title"]').attr('content') || 'Episode';
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
    command: ['animexin', 'donghua', 'xin'],
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
                return await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
                return await socket.sendMessage(sender, { text: `❌ *No results found for:* ${query}` }, { quoted: msg });
            }

            const top = results.slice(0, 10);

            // Safe Media Preparation for Interactive List
            let headerObj = undefined;
            try {
                const media = await prepareWAMessageMedia(
                    { image: { url: DEFAULT_THUMB } },
                    { upload: socket.waUploadToServer }
                );
                headerObj = proto.Message.InteractiveMessage.Header.create({
                    hasMediaAttachment: true,
                    imageMessage: media.imageMessage
                });
            } catch (e) {}

            const searchRows = top.map((r, i) => ({
                title: `${i + 1}. ${r.title.slice(0, 20)}`,
                description: `${r.type} | ${r.status}`,
                id: String(i + 1)
            }));

            const searchCaption = `╭━━━〔 *A N I M E X I N  S E A R C H* 〕━━━┈\n` +
                                 `┃\n` +
                                 `┃ 🔍 *Query:* ${query}\n` +
                                 `┃ 📊 *Found:* ${top.length} Anime\n` +
                                 `┃\n` +
                                 `╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈\n\n` +
                                 `*💡 Select an anime from the list below*`;

            const interactiveSearchMsg = proto.Message.InteractiveMessage.create({
                body: proto.Message.InteractiveMessage.Body.create({ text: searchCaption }),
                footer: proto.Message.InteractiveMessage.Footer.create({ text: "© VORTEX MD" }),
                ...(headerObj ? { header: headerObj } : {}),
                nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
                    buttons: [
                        {
                            name: "single_select",
                            buttonParamsJson: JSON.stringify({
                                title: " Select Anime",
                                sections: [
                                    {
                                        title: "SEARCH RESULTS",
                                        rows: searchRows
                                    }
                                ]
                            })
                        }
                    ]
                }),
                contextInfo: { mentionedJid: [sender] }
            });

            const fullSearchMsg = generateWAMessageFromContent(
                sender,
                { viewOnceMessage: { message: { interactiveMessage: interactiveSearchMsg } } },
                { quoted: msg }
            );

            await socket.relayMessage(sender, fullSearchMsg.message, { messageId: fullSearchMsg.key.id });
            const searchMsgId = fullSearchMsg.key.id;

            await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

            // --- 2. Anime Selection Handler ---
            const searchHandler = async (msgData) => {
                const reply = msgData.messages?.[0];
                if (!reply?.message || !reply.key?.remoteJid) return;
                if (reply.key.fromMe) return;

                const message = reply.message;
                const senderID = reply.key.remoteJid;
                let selectedOption = '';

                if (message.interactiveResponseMessage?.nativeFlowResponseMessage) {
                    try {
                        const params = JSON.parse(message.interactiveResponseMessage.nativeFlowResponseMessage.paramsJson);
                        selectedOption = params.id || params.rowId || '';
                    } catch (e) {}
                } else if (message.extendedTextMessage?.contextInfo?.stanzaId === searchMsgId) {
                    selectedOption = (message.conversation || message.extendedTextMessage?.text || '').trim();
                }

                const selNum = parseInt(selectedOption);

                if (!isNaN(selNum) && selNum >= 1 && selNum <= top.length) {
                    socket.ev.off('messages.upsert', searchHandler);
                    const selectedAnime = top[selNum - 1];

                    await socket.sendMessage(senderID, { react: { text: '⏳', key: reply.key } });

                    // Fetch Series Details & Episodes
                    let seriesData;
                    try {
                        seriesData = await getAnimeDetails(selectedAnime.url);
                    } catch (err) {
                        return await socket.sendMessage(senderID, { text: `❌ *Failed to fetch episodes!*` }, { quoted: reply });
                    }

                    if (!seriesData.episodes || seriesData.episodes.length === 0) {
                        return await socket.sendMessage(senderID, { text: `❌ *No episodes found for this series!*` }, { quoted: reply });
                    }

                    const episodesList = seriesData.episodes.slice(0, 50);

                    let epHeaderObj = undefined;
                    try {
                        const epMedia = await prepareWAMessageMedia(
                            { image: { url: DEFAULT_THUMB } },
                            { upload: socket.waUploadToServer }
                        );
                        epHeaderObj = proto.Message.InteractiveMessage.Header.create({
                            hasMediaAttachment: true,
                            imageMessage: epMedia.imageMessage
                        });
                    } catch (e) {}

                    const epRows = episodesList.map((ep, i) => ({
                        title: ep.title.length > 24 ? ep.title.slice(0, 21) + "..." : ep.title,
                        description: `Download ${ep.title}`,
                        id: String(i + 1)
                    }));

                    const epCaption = `╭━━━〔 *E P I S O D E S  L I S T* 〕━━━┈\n` +
                                      `┃\n` +
                                      `┃ 🎬 *Anime:* ${seriesData.title}\n` +
                                      `┃ 📌 *Total Episodes:* ${seriesData.episodes.length}\n` +
                                      `┃\n` +
                                      `╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈\n\n` +
                                      `*💡 Select an episode to download*`;

                    const epInteractiveMsg = proto.Message.InteractiveMessage.create({
                        body: proto.Message.InteractiveMessage.Body.create({ text: epCaption }),
                        footer: proto.Message.InteractiveMessage.Footer.create({ text: "© VORTEX MD" }),
                        ...(epHeaderObj ? { header: epHeaderObj } : {}),
                        nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
                            buttons: [
                                {
                                    name: "single_select",
                                    buttonParamsJson: JSON.stringify({
                                        title: " Select Episode",
                                        sections: [
                                            {
                                                title: "AVAILABLE EPISODES",
                                                rows: epRows
                                            }
                                        ]
                                    })
                                }
                            ]
                        }),
                        contextInfo: { mentionedJid: [senderID] }
                    });

                    const fullEpMsg = generateWAMessageFromContent(
                        senderID,
                        { viewOnceMessage: { message: { interactiveMessage: epInteractiveMsg } } },
                        { quoted: reply }
                    );

                    await socket.relayMessage(senderID, fullEpMsg.message, { messageId: fullEpMsg.key.id });
                    const epMsgId = fullEpMsg.key.id;

                    // --- 3. Episode Selection & Download Handler ---
                    const epHandler = async (epMsgData) => {
                        const epReply = epMsgData.messages?.[0];
                        if (!epReply?.message || !epReply.key?.remoteJid) return;
                        if (epReply.key.fromMe) return;

                        const epMessage = epReply.message;
                        const epSenderID = epReply.key.remoteJid;
                        let epSelectedOption = '';

                        if (epMessage.interactiveResponseMessage?.nativeFlowResponseMessage) {
                            try {
                                const params = JSON.parse(epMessage.interactiveResponseMessage.nativeFlowResponseMessage.paramsJson);
                                epSelectedOption = params.id || params.rowId || '';
                            } catch (e) {}
                        } else if (epMessage.extendedTextMessage?.contextInfo?.stanzaId === epMsgId) {
                            epSelectedOption = (epMessage.conversation || epMessage.extendedTextMessage?.text || '').trim();
                        }

                        const epNum = parseInt(epSelectedOption);

                        if (!isNaN(epNum) && epNum >= 1 && epNum <= episodesList.length) {
                            socket.ev.off('messages.upsert', epHandler);
                            const selectedEp = episodesList[epNum - 1];

                            await socket.sendMessage(epSenderID, { react: { text: '🔄', key: epReply.key } });

                            try {
                                const epDownloads = await getEpisodeDownloads(selectedEp.link);

                                if (!epDownloads.links || epDownloads.links.length === 0) {
                                    return await socket.sendMessage(epSenderID, { text: `❌ *No download links found for this episode!*` }, { quoted: epReply });
                                }

                                const targetMediafireUrl = epDownloads.links[0];

                                await socket.sendMessage(epSenderID, { react: { text: '⚙️', key: epReply.key } });

                                // අපේ Mediafire function එක පාවිච්චි කිරීම
                                const mfData = await getMediafireLink(targetMediafireUrl);
                                
                                if (!mfData.downloadLink) {
                                    throw new Error("Could not extract Mediafire direct link.");
                                }

                                const directLink = mfData.downloadLink;
                                const fileName = mfData.fileName;
                                
                                const tempFilePath = path.join(TEMP_DIR, fileName.replace(/[^a-zA-Z0-9._-]/g, '_'));

                                await socket.sendMessage(epSenderID, { react: { text: '⬇️', key: epReply.key } });
                                await socket.sendMessage(epSenderID, {
                                    text: `╭━━━〔 *D O W N L O A D I N G* 〕━━━┈\n` +
                                          `┃\n` +
                                          `┃ 🎬 *Title:* ${epDownloads.title}\n` +
                                          `┃ 📄 *File:* ${fileName}\n` +
                                          `┃\n` +
                                          `╰━━━━━━━━━━━━━━━━━━━━━━━━━━┈\n\n` +
                                          `*(Please wait, sending video file shortly...)*`
                                }, { quoted: epReply });

                                // Download කරන ගමන් Referer එක යවනවා
                                await downloadWithRetry(directLink, tempFilePath, targetMediafireUrl, 3);

                                await socket.sendMessage(epSenderID, { react: { text: '📤', key: epReply.key } });

                                const mimetype = fileName.endsWith('.mkv') ? 'video/x-matroska' : 'video/mp4';

                                const finalCaption = `╭━━━〔 *A N I M E X I N  D L* 〕━━━┈\n` +
                                                     `┃\n` +
                                                     `┃ 🎬 *Episode:* ${epDownloads.title}\n` +
                                                     `┃\n` +
                                                     `╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈\n\n` +
                                                     `> *© VORTEX MD*`;

                                // Temp File එක WhatsApp එකට Upload කිරීම
                                await socket.sendMessage(epSenderID, {
                                    document: { url: tempFilePath },
                                    mimetype: mimetype,
                                    fileName: fileName,
                                    caption: finalCaption
                                }, { quoted: epReply });

                                await socket.sendMessage(epSenderID, { react: { text: '✅', key: epReply.key } });

                            } catch (e) {
                                console.error('Download/API Error:', e);
                                await socket.sendMessage(epSenderID, { react: { text: '❌', key: epReply.key } });
                                await socket.sendMessage(epSenderID, { text: `❌ *Process Failed:*\n${e.message}` }, { quoted: epReply });
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
                        }
                    };

                    socket.ev.on('messages.upsert', epHandler);
                    setTimeout(() => socket.ev.off('messages.upsert', epHandler), 10 * 60 * 1000);
                }
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
