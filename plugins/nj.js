const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Temp Directory Setup
const TEMP_DIR = path.join(__dirname, 'temp_movie');
if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR);
}
process.env.TMPDIR = TEMP_DIR;
os.tmpdir = () => TEMP_DIR;

// Modern Chrome 122 Browser Headers (Bypasses WAF & Anti-Bot Checks)
const BROWSER_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Sec-Ch-Ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'cross-site',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1'
};

// Helper: Axios Fetch with Retry & Full Spoofed Headers
async function fetchHtmlWithRetry(url, referer = null, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            const headers = { ...BROWSER_HEADERS };
            if (referer) {
                headers['Referer'] = referer;
                headers['Sec-Fetch-Site'] = 'same-origin';
            }

            const response = await axios.get(url, {
                headers: headers,
                timeout: 20000,
                maxRedirects: 5
            });

            return response.data;
        } catch (error) {
            const status = error.response ? error.response.status : error.message;
            console.log(`[SCRAPE ATTEMPT ${i + 1} FAILED] ${url} - ${status}`);
            if (i === retries - 1) throw new Error(`HTTP ${status} from ${new URL(url).hostname}`);
            await new Promise(res => setTimeout(res, 2000));
        }
    }
}

// Helper: Stream File Download
async function downloadWithRetry(url, destPath, referer = null, retries = 3) {
    for (let i = 0; i < retries; i++) {
        let writer;
        try {
            const headers = { ...BROWSER_HEADERS };
            if (referer) headers['Referer'] = referer;

            const { data } = await axios({
                url: url,
                method: 'GET',
                responseType: 'stream',
                headers: headers,
                timeout: 120000
            });

            writer = fs.createWriteStream(destPath);
            data.pipe(writer);

            await new Promise((resolve, reject) => {
                writer.on('finish', resolve);
                writer.on('error', reject);
            });

            return true;
        } catch (error) {
            if (writer) writer.destroy();
            const status = error.response ? error.response.status : error.message;
            console.log(`[DOWNLOAD ATTEMPT ${i + 1} FAILED] ${url} - ${status}`);
            if (i === retries - 1) throw error;
            await new Promise(res => setTimeout(res, 3000));
        }
    }
}

module.exports = {
    command: ['nj', 'naija'],
    description: 'Search and Download Movies from Naijaprey (VORTEX Engine)',

    handler: async ({ socket, msg, sender, args, prefix }) => {
        try {
            const query = args.join(' ').trim();

            if (!query) {
                return await socket.sendMessage(sender, {
                    text: `╭━━━〔 *V O R T E X  N A I J A* 〕━━━\n` +
                          `┃\n` +
                          `┃ 🎬 *Command:* ${prefix}nj\n` +
                          `┃ 📌 *Usage:* ${prefix}nj <movie name>\n` +
                          `┃\n` +
                          `┃ *Example:*\n` +
                          `┃ ${prefix}nj Avatar\n` +
                          `┃\n` +
                          `╰━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                          `> *© VORTEX MD*`
                }, { quoted: msg });
            }

            await socket.sendMessage(sender, { react: { text: '🔍', key: msg.key } });

            // 1. Search Movie
            const pageUrl = `https://www.naijaprey.tv/search/${encodeURIComponent(query)}/`;
            let html;
            try {
                html = await fetchHtmlWithRetry(pageUrl, 'https://www.naijaprey.tv/', 3);
            } catch (err) {
                return await socket.sendMessage(sender, { text: `❌ *Search Error:*\nFailed to fetch Naijaprey (${err.message})` }, { quoted: msg });
            }

            const $ = cheerio.load(html);
            const results = [];
            const seen = new Set();

            $('.mh-loop-item').each((i, el) => {
                const $el = $(el);
                const a = $el.find('.mh-loop-title a').first();
                
                let title = a.text().trim() || a.attr('title') || '';
                let link = a.attr('href') || '';
                let image = $el.find('.mh-loop-thumb img').attr('src') ||
                            $el.find('.mh-loop-thumb img').attr('data-src') ||
                            $el.find('img').attr('src') || '';

                title = title.replace(/\s+/g, ' ').trim();

                if (title && link && !seen.has(link)) {
                    seen.add(link);
                    results.push({ title, link, image });
                }
            });

            if (results.length === 0) {
                return await socket.sendMessage(sender, { text: `❌ *No results found for:* ${query}` }, { quoted: msg });
            }

            const top = results.slice(0, 5);
            const resultList = top.map((r, i) => `┃ *${i + 1} |* ${r.title}`).join('\n┃\n');

            const caption = `╭━━━〔 *N A I J A P R E Y* 〕━━━\n` +
                            `┃\n` +
                            `┃ 🔍 *Query:* ${query}\n` +
                            `┃ 📊 *Found:* ${top.length} Movies\n` +
                            `┃\n` +
                            `┣━━━〔 *Movies List* 〕━━━\n` +
                            `┃\n` +
                            `${resultList}\n` +
                            `┃\n` +
                            `╰━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                            `*💡 Reply with a number (1-${top.length}) to select*\n` +
                            `> *© VORTEX MD*`;

            const firstImage = top[0]?.image;
            let sentMsg;
            if (firstImage && firstImage !== 'No image') {
                sentMsg = await socket.sendMessage(sender, { image: { url: firstImage }, caption }, { quoted: msg });
            } else {
                sentMsg = await socket.sendMessage(sender, { text: caption }, { quoted: msg });
            }

            const searchMsgId = sentMsg.key.id;

            // 2. Selection Handler
            const searchHandler = async ({ messages }) => {
                const reply = messages[0];
                if (!reply?.message) return;
                const isReply = reply.message?.extendedTextMessage?.contextInfo?.stanzaId === searchMsgId;
                if (!isReply) return;

                const replyText = (reply.message.conversation || reply.message.extendedTextMessage?.text || '').trim();
                const selNum = parseInt(replyText);

                if (isNaN(selNum) || selNum < 1 || selNum > top.length) {
                    return await socket.sendMessage(reply.key.remoteJid, { text: `❌ *Invalid choice!* Reply between 1 and ${top.length}` }, { quoted: reply });
                }

                socket.ev.off('messages.upsert', searchHandler);
                const selected = top[selNum - 1];

                await socket.sendMessage(reply.key.remoteJid, { react: { text: '⏳', key: reply.key } });

                try {
                    // Movie Page
                    const movieHtml = await fetchHtmlWithRetry(selected.link, pageUrl);
                    const $1 = cheerio.load(movieHtml);

                    let npLink = null;
                    $1('a.button, a[href*="np-downloader"], a[href*="sdm_downloads"]').each((_, el) => {
                        const href = $1(el).attr('href') || '';
                        if (href.includes('np-downloader') || href.includes('sdm_downloads')) npLink = href;
                    });
                    
                    if (!npLink) {
                        const m = movieHtml.match(/https:\/\/vdl\.np-downloader\.com\/[^\s"'<>]+/i);
                        if (m) npLink = m[0];
                    }
                    
                    if (!npLink) throw new Error('NP Downloader link not found on movie page');

                    // NP Downloader Page
                    const npHtml = await fetchHtmlWithRetry(npLink, selected.link);
                    let wildshare = null;
                    const $2 = cheerio.load(npHtml);
                    
                    $2('a.sdm_download, a[href*="wildshare"]').each((_, el) => {
                        const href = $2(el).attr('href') || '';
                        if (href.includes('wildshare')) wildshare = href.split(/["'\s]/)[0];
                    });
                    
                    if (!wildshare) {
                        const m = npHtml.match(/https:\/\/wildshare\.net\/[a-zA-Z0-9]+/i);
                        if (m) wildshare = m[0];
                    }
                    
                    if (!wildshare) throw new Error('Wildshare link not found on NP page');

                    const id = wildshare.match(/wildshare\.net\/([a-zA-Z0-9]+)/i)?.[1];
                    
                    // Wildshare Redirect / Landing Page
                    let landingPageLink = null;
                    const wsHtml = await fetchHtmlWithRetry(wildshare, npLink);

                    const fileLink = wsHtml.match(/https:\/\/wildshare\.net\/[a-zA-Z0-9]+\/[^"'<>\s]+\.(mkv|mp4|avi|zip|rar)/i);
                    if (fileLink) {
                        landingPageLink = fileLink[0].replace(/<\/?[^>]+>/g, '').trim();
                    }

                    if (!landingPageLink) {
                        const pt = wsHtml.match(/https:\/\/wildshare\.net\/[a-zA-Z0-9]+\?pt=[A-Za-z0-9%+=]+/i);
                        if (pt) landingPageLink = pt[0];
                    }

                    if (!landingPageLink && id) landingPageLink = `https://wildshare.net/${id}`;
                    if (!landingPageLink) throw new Error('Failed to extract Wildshare landing page');

                    // Final Wildshare Download Page
                    const finalPageHtml = await fetchHtmlWithRetry(landingPageLink, wildshare);
                    const $final = cheerio.load(finalPageHtml);
                    
                    let trueDownloadLink = null;

                    $final('a').each((i, el) => {
                        const href = $final(el).attr('href');
                        const text = $final(el).text().toLowerCase();
                        if (href && (text.includes('download') || href.includes('/download/'))) {
                            trueDownloadLink = href;
                        }
                    });

                    if (!trueDownloadLink) {
                        trueDownloadLink = $final('video source').attr('src') || $final('video').attr('src');
                    }

                    if (trueDownloadLink && trueDownloadLink.startsWith('/')) {
                        trueDownloadLink = 'https://wildshare.net' + trueDownloadLink;
                    }

                    if (!trueDownloadLink) {
                        throw new Error('Could not find the final direct download link inside Wildshare page');
                    }

                    // Download Process
                    let cleanTitle = selected.title.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 40);
                    
                    let fileExt = '.mp4';
                    if (trueDownloadLink.includes('.mkv')) fileExt = '.mkv';
                    if (trueDownloadLink.includes('.zip')) fileExt = '.zip';

                    let fileName = `VORTEX_${cleanTitle}_${Date.now()}${fileExt}`;
                    let tempFilePath = path.join(TEMP_DIR, fileName);

                    await socket.sendMessage(reply.key.remoteJid, { react: { text: '⬇️', key: reply.key } });
                    await socket.sendMessage(reply.key.remoteJid, {
                        text: `╭━━━〔 *P R O C E S S I N G* 〕━━━\n` +
                              `┃\n` +
                              `┃ 🔄 *Status:* Downloading Movie...\n` +
                              `┃ 🎬 *Title:* ${selected.title}\n` +
                              `┃ 🌐 *Source:* Naijaprey -> Wildshare\n` +
                              `┃\n` +
                              `╰━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                              `*(Please wait, upload starting soon...)*`
                    }, { quoted: reply });

                    await downloadWithRetry(trueDownloadLink, tempFilePath, landingPageLink, 3);

                    await socket.sendMessage(reply.key.remoteJid, { react: { text: '📤', key: reply.key } });

                    let mimetype = fileExt === '.mkv' ? 'video/x-matroska' : 
                                   fileExt === '.zip' ? 'application/zip' : 'video/mp4';

                    const finalCaption = `╭━━━〔 *V O R T E X  N A I J A* 〕━━━\n` +
                                         `┃\n` +
                                         `┃ 🎬 *Title:* ${selected.title}\n` +
                                         `┃ 📥 *Successfully Downloaded*\n` +
                                         `┃\n` +
                                         `╰━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                                         `> *© VORTEX MD*`;

                    await socket.sendMessage(reply.key.remoteJid, {
                        document: { stream: fs.createReadStream(tempFilePath) },
                        mimetype: mimetype,
                        fileName: fileName,
                        caption: finalCaption
                    }, { quoted: reply });

                    await socket.sendMessage(reply.key.remoteJid, { react: { text: '✅', key: reply.key } });

                    // Clean Temp File
                    try {
                        if (tempFilePath && fs.existsSync(tempFilePath)) {
                            fs.unlinkSync(tempFilePath);
                        }
                    } catch (err) {}

                } catch (e) {
                    console.error('Naijaprey Extraction/Download Error:', e);
                    await socket.sendMessage(reply.key.remoteJid, { react: { text: '❌', key: reply.key } });
                    await socket.sendMessage(reply.key.remoteJid, { text: `❌ *Download Failed:*\n${e.message}` }, { quoted: reply });
                }
            };

            socket.ev.on('messages.upsert', searchHandler);
            setTimeout(() => socket.ev.off('messages.upsert', searchHandler), 5 * 60 * 1000);

        } catch (err) {
            console.error('Naijaprey Plugin Error:', err.message);
            await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
            await socket.sendMessage(sender, { text: `❌ *System Error:* ${err.message}` }, { quoted: msg });
        }
    }
};
