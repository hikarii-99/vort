const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const os = require('os');
const cloudscraper = require('cloudscraper');

// Temp ෆෝල්ඩරය සකස් කිරීම
const TEMP_DIR = path.join(__dirname, 'temp_movie');
if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR);
}
process.env.TMPDIR = TEMP_DIR;
os.tmpdir = () => TEMP_DIR;

// 1. Cloudscraper යොදාගෙන හදපු HTML Scraper Function එක
async function fetchHtmlWithRetry(url, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            const html = await cloudscraper({
                method: 'GET',
                url: url,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.5'
                }
            });
            return html;
        } catch (error) {
            console.log(`[SCRAPE ATTEMPT ${i + 1} FAILED] - Cloudscraper Error: ${error.message}`);
            if (i === retries - 1) throw new Error("Cloudflare blocking issue. Please try again later.");
            await new Promise(res => setTimeout(res, 3000));
        }
    }
}

// 2. API Call Function එක
async function apiCallWithRetry(url, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            const response = await axios.get(url, { timeout: 20000 });
            if (!response.data) throw new Error('API returned empty response');
            return response.data;
        } catch (error) {
            console.log(`[API ATTEMPT ${i + 1} FAILED] ${url} - ${error.message}`);
            if (i === retries - 1) throw error;
            await new Promise(res => setTimeout(res, 2000));
        }
    }
}

// 3. File Download කරන Stream Function එක
async function downloadWithRetry(url, destPath, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            const { data } = await axios({
                url: url,
                method: 'GET',
                responseType: 'stream',
                timeout: 30000
            });

            const writer = fs.createWriteStream(destPath);
            data.pipe(writer);

            await new Promise((resolve, reject) => {
                writer.on('finish', resolve);
                writer.on('error', reject);
            });

            return true;
        } catch (error) {
            if (i === retries - 1) throw error;
            await new Promise(res => setTimeout(res, 2000));
        }
    }
}

module.exports = {
    command: ['mvlk', 'movie'],
    description: 'Search and Download Movies (VORTEX Clean Engine)',

    handler: async ({ socket, msg, sender, args, prefix }) => {
        try {
            const query = args.join(' ').trim();

            if (!query) {
                return await socket.sendMessage(sender, {
                    text: `╭━━━〔 *V O R T E X  M O V I E S* 〕━━━┈\n` +
                          `┃\n` +
                          `┃ 🎬 *Command:* ${prefix}mvlk\n` +
                          `┃ 📌 *Usage:* ${prefix}mvlk <movie name>\n` +
                          `┃\n` +
                          `┃ *Example:*\n` +
                          `┃ ${prefix}mvlk Ghost Mansion\n` +
                          `┃\n` +
                          `╰━━━━━━━━━━━━━━━━━━━━━━━━━━┈\n\n` +
                          `> *© VORTEX MD*`
                }, { quoted: msg });
            }

            await socket.sendMessage(sender, { react: { text: '🔍', key: msg.key } });

            // Search Execution
            const searchUrl = `https://www.moviesublk.com/search?q=${encodeURIComponent(query)}`;
            let html;
            try {
                html = await fetchHtmlWithRetry(searchUrl, 3);
            } catch (err) {
                return await socket.sendMessage(sender, { text: `❌ *Search Error:*\n${err.message}` }, { quoted: msg });
            }

            const $ = cheerio.load(html);
            const results = [];
            const seen = new Set();
            const thumbMap = {};

            const thumbRegex = /postthumbnail\("([^"]+)",\s*'([^']+)'\)/g;
            let match;
            while ((match = thumbRegex.exec(html)) !== null) {
                if (match[2]) thumbMap[match[2].replace(/&amp;/g, '&').replace(/&#\d+;/g, '').trim()] = match[1];
            }

            $('a').each((i, el) => {
                let title = $(el).text().trim();

                // 1. Title clean up (Script and inline tags)
                if (title.includes('document.write')) {
                    const titleMatch = title.match(/postthumbnail\([^,]+,\s*['"]([^'"]+)['"]\)/);
                    if (titleMatch && titleMatch[1]) {
                        title = titleMatch[1];
                    } else {
                        title = title.replace(/document\.write\(.*?\);?/g, '').trim();
                    }
                }

                // 2. Decode HTML Entities (Unicode sinhala characters)
                title = title.replace(/&#(\d+);/g, (m, dec) => String.fromCharCode(dec));
                title = title.replace(/&quot;/g, '"').replace(/&amp;/g, '&');
                title = title.replace(/\s+/g, ' ').trim();

                let link = $(el).attr('href');
                if (link && link.startsWith('/')) link = 'https://www.moviesublk.com' + link;

                if (link && link.includes('moviesublk.com') && link.includes('/20') && title.length > 5 && !seen.has(link)) {
                    seen.add(link);
                    let image = null;
                    for (const [t, img] of Object.entries(thumbMap)) {
                        if (title.includes(t.substring(0, 20))) { image = img; break; }
                    }
                    if (!image) {
                        const imgTag = $(el).closest('div, li, article').find('img').first();
                        image = imgTag.attr('src') || imgTag.attr('data-src') || null;
                    }
                    results.push({ title, link, image });
                }
            });

            if (results.length === 0) {
                return await socket.sendMessage(sender, { text: `❌ *No results found for:* ${query}` }, { quoted: msg });
            }

            const top = results.slice(0, 5);
            const resultList = top.map((r, i) => `┃ *${i + 1} |* ${r.title}`).join('\n┃\n');

            const caption = `╭━━━〔 *S E A R C H  R E S U L T S* 〕━━━┈\n` +
                            `┃\n` +
                            `┃ 🔍 *Query:* ${query}\n` +
                            `┃ 📊 *Found:* ${top.length} Movies\n` +
                            `┃\n` +
                            `┣━━━〔 *Movies List* 〕━━━┈\n` +
                            `┃\n` +
                            `${resultList}\n` +
                            `┃\n` +
                            `╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈\n\n` +
                            `*💡 Reply with a number (1-${top.length}) to select*\n` +
                            `> *© VORTEX MD*`;

            let sentMsg;
            if (top[0]?.image) {
                sentMsg = await socket.sendMessage(sender, { image: { url: top[0].image }, caption: caption }, { quoted: msg });
            } else {
                sentMsg = await socket.sendMessage(sender, { text: caption }, { quoted: msg });
            }

            const searchMsgId = sentMsg.key.id;

            // Movie Selection Handler
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
                const selected = top[selNum - 1];

                await socket.sendMessage(reply.key.remoteJid, { react: { text: '⏳', key: reply.key } });

                let dlHtml;
                try {
                    dlHtml = await fetchHtmlWithRetry(selected.link, 3);
                } catch (err) {
                    return await socket.sendMessage(reply.key.remoteJid, { text: `❌ *Failed to fetch movie page!*` }, { quoted: reply });
                }

                const supportedLinks = [];
                const linkSeen = new Set();
                
                // Google Drive patterns පමණක් Filter කරනු ලැබේ
                const patterns = [
                    /https:\/\/drive\.google\.com\/file\/d\/[a-zA-Z0-9_-]+[^\s"'<>]*/gi
                ];

                patterns.forEach(regex => {
                    let m;
                    while ((m = regex.exec(dlHtml)) !== null) {
                        let url = m[0].replace(/&amp;/g, '&').replace(/&#34;/g, '').replace(/"$/, '').replace(/\\"/g, '');
                        if (!linkSeen.has(url) && url.length > 15) {
                            linkSeen.add(url);
                            supportedLinks.push({ url, type: 'Google Drive' });
                        }
                    }
                });

                if (supportedLinks.length === 0) {
                    return await socket.sendMessage(reply.key.remoteJid, { text: `❌ *No Google Drive links found on this page!*` }, { quoted: reply });
                }

                const dlList = supportedLinks.map((d, i) => {
                    const icon = '📁';
                    let epMatch = d.url.match(/S(\d+)E(\d+)/i);
                    let epText = epMatch ? `[S${epMatch[1].padStart(2,'0')}E${epMatch[2].padStart(2,'0')}] ` : '';
                    return `┃ *${i + 1} |* ${icon} *${d.type}*\n┃ 🏷️ ${epText}Direct Link`;
                }).join('\n┃\n');

                const dlCaption = `╭━━━〔 *D O W N L O A D S* 〕━━━┈\n` +
                                  `┃\n` +
                                  `┃ 🎬 *Movie:*\n┃ ${selected.title}\n` +
                                  `┃\n` +
                                  `┣━━━〔 *Available Links* 〕━━━┈\n` +
                                  `┃\n` +
                                  `${dlList}\n` +
                                  `┃\n` +
                                  `╰━━━━━━━━━━━━━━━━━━━━━━━━━━┈\n\n` +
                                  `*💡 Reply with a number to download directly*\n` +
                                  `> *© VORTEX MD*`;

                let dlMsg;
                if (selected.image) {
                    dlMsg = await socket.sendMessage(reply.key.remoteJid, { image: { url: selected.image }, caption: dlCaption }, { quoted: reply });
                } else {
                    dlMsg = await socket.sendMessage(reply.key.remoteJid, { text: dlCaption }, { quoted: reply });
                }

                const dlMsgId = dlMsg.key.id;

                // Direct Download & Upload Handler
                const dlHandler = async ({ messages: dlMsgs }) => {
                    const dlReply = dlMsgs[0];
                    if (!dlReply?.message) return;
                    const isIt = dlReply.message?.extendedTextMessage?.contextInfo?.stanzaId === dlMsgId;
                    if (!isIt) return;

                    const dlText = (dlReply.message.conversation || dlReply.message.extendedTextMessage?.text || '').trim();
                    const dlNum = parseInt(dlText);

                    if (isNaN(dlNum) || dlNum < 1 || dlNum > supportedLinks.length) {
                        return await socket.sendMessage(dlReply.key.remoteJid, { text: `❌ *Invalid number!* Enter 1 to ${supportedLinks.length}` }, { quoted: dlReply });
                    }

                    socket.ev.off('messages.upsert', dlHandler);
                    const selectedDl = supportedLinks[dlNum - 1];

                    await socket.sendMessage(dlReply.key.remoteJid, { react: { text: '🔄', key: dlReply.key } });

                    try {
                        let directLink = "";
                        let fileName = `VORTEX_${selected.title.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}.mp4`;
                        let fileSize = "Unknown Size";

                        // Google Drive API Call
                        const gdApi = await apiCallWithRetry(`https://apis.davidcyriltech.my.id/gdrive?url=${encodeURIComponent(selectedDl.url)}`, 3);
                        if (!gdApi.download_link && !gdApi.api_download) throw new Error("Google Drive API error");
                        directLink = gdApi.download_link || gdApi.api_download;
                        fileName = gdApi.name || fileName;
                        fileSize = gdApi.size || fileSize;

                        const tempFilePath = path.join(TEMP_DIR, fileName);

                        await socket.sendMessage(dlReply.key.remoteJid, { react: { text: '⬇️', key: dlReply.key } });
                        await socket.sendMessage(dlReply.key.remoteJid, {
                            text: `╭━━━〔 *P R O C E S S I N G* 〕━━━┈\n` +
                                  `┃\n` +
                                  `┃ 🔄 *Status:* Downloading File...\n` +
                                  `┃ 📄 *Name:* ${fileName}\n` +
                                  `┃ 📦 *Size:* ${fileSize}\n` +
                                  `┃\n` +
                                  `╰━━━━━━━━━━━━━━━━━━━━━━━━━━┈\n\n` +
                                  `*(Please wait, sending file shortly...)*`
                        }, { quoted: dlReply });

                        await downloadWithRetry(directLink, tempFilePath, 3);

                        await socket.sendMessage(dlReply.key.remoteJid, { react: { text: '📤', key: dlReply.key } });

                        let mimetype = fileName.endsWith('.mkv') ? 'video/x-matroska' :
                                       fileName.endsWith('.zip') ? 'application/zip' : 'video/mp4';

                        const finalCaption = `╭━━━〔 *V O R T E X  M O V I E S* 〕━━━┈\n` +
                                             `┃\n` +
                                             `┃ 🎬 *Title:* ${selected.title}\n` +
                                             `┃ 📦 *Size:* ${fileSize}\n` +
                                             `┃\n` +
                                             `╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈\n\n` +
                                             `> *© VORTEX MD*`;

                        await socket.sendMessage(dlReply.key.remoteJid, {
                            document: { stream: fs.createReadStream(tempFilePath) },
                            mimetype: mimetype,
                            fileName: fileName,
                            caption: finalCaption
                        }, { quoted: dlReply });

                        await socket.sendMessage(dlReply.key.remoteJid, { react: { text: '✅', key: dlReply.key } });

                    } catch (e) {
                        console.error('Download/API Error:', e);
                        await socket.sendMessage(dlReply.key.remoteJid, { react: { text: '❌', key: dlReply.key } });
                        await socket.sendMessage(dlReply.key.remoteJid, { text: `❌ *Process Failed:*\n${e.message}` }, { quoted: dlReply });
                    } finally {
                        try {
                            if (fs.existsSync(TEMP_DIR)) {
                                fs.readdirSync(TEMP_DIR).forEach(file => {
                                    fs.unlinkSync(path.join(TEMP_DIR, file));
                                });
                            }
                        } catch (err) {}
                    }
                };

                socket.ev.on('messages.upsert', dlHandler);
                setTimeout(() => socket.ev.off('messages.upsert', dlHandler), 10 * 60 * 1000);
            };

            socket.ev.on('messages.upsert', searchHandler);
            setTimeout(() => socket.ev.off('messages.upsert', searchHandler), 5 * 60 * 1000);

        } catch (err) {
            console.error('Movie plugin error:', err.message);
            await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
            await socket.sendMessage(sender, { text: `❌ *System Error:* ${err.message}` }, { quoted: msg });
        }
    }
};
