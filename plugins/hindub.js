const axios = require('axios');
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

// Helper: API Call with Retry
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

// Helper: Stream File Download
async function downloadWithRetry(url, destPath, retries = 3) {
    for (let i = 0; i < retries; i++) {
        let writer;
        try {
            const { data } = await axios({
                url: url,
                method: 'GET',
                responseType: 'stream',
                timeout: 60000
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
            if (i === retries - 1) throw error;
            await new Promise(res => setTimeout(res, 3000));
        }
    }
}

// Helper: Quality Label Parser from URL
function getQualityLabel(url) {
    if (!url) return 'HD Quality';
    const decoded = decodeURIComponent(url);
    if (/1080p/i.test(decoded)) return /HEVC/i.test(decoded) ? '1080p (HEVC x265)' : '1080p Full HD';
    if (/720p/i.test(decoded)) return /HEVC/i.test(decoded) ? '720p (HEVC x265)' : '720p HD';
    if (/480p/i.test(decoded)) return '480p SD';
    return 'HD Quality';
}

module.exports = {
    command: ['hin', 'hindub', 'cinepix'],
    description: 'Search and Download Hindi Dubbed Movies (VORTEX API Engine)',

    handler: async ({ socket, msg, sender, args, prefix }) => {
        try {
            const query = args.join(' ').trim();

            if (!query) {
                return await socket.sendMessage(sender, {
                    text: `╭━━━〔 *V O R T E X  H I N D I* 〕━━━\n` +
                          `┃\n` +
                          `┃ 🎬 *Command:* ${prefix}hin\n` +
                          `┃ 📌 *Usage:* ${prefix}hin <movie name>\n` +
                          `┃\n` +
                          `┃ *Example:*\n` +
                          `┃ ${prefix}hin Avengers Infinity War\n` +
                          `┃\n` +
                          `╰━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                          `> *© VORTEX MD*`
                }, { quoted: msg });
            }

            await socket.sendMessage(sender, { react: { text: '🔍', key: msg.key } });

            // 1. Search via Vercel API
            const searchApiUrl = `https://vortex-hindubmv.vercel.app/api/search?keyword=${encodeURIComponent(query)}`;
            let searchData;
            try {
                searchData = await apiCallWithRetry(searchApiUrl, 3);
            } catch (err) {
                return await socket.sendMessage(sender, { text: `❌ *Search API Error:*\n${err.message}` }, { quoted: msg });
            }

            // Extract results array dynamically
            const rawResults = Array.isArray(searchData) ? searchData : (searchData?.results || searchData?.data || searchData?.result || []);

            if (!rawResults || rawResults.length === 0) {
                return await socket.sendMessage(sender, { text: `❌ *No results found for:* ${query}` }, { quoted: msg });
            }

            const top = rawResults.slice(0, 5);
            const resultList = top.map((r, i) => `┃ *${i + 1} |* ${r.title || r.name}`).join('\n┃\n');

            const caption = `╭━━━〔 *H I N D I  S E A R C H* 〕━━━\n` +
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

            const firstImage = top[0]?.image || top[0]?.poster || top[0]?.thumbnail;
            let sentMsg;
            if (firstImage) {
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
                const selectedUrl = selected.link || selected.url;

                await socket.sendMessage(reply.key.remoteJid, { react: { text: '⏳', key: reply.key } });

                // 3. Details API Call
                const detailsApiUrl = `https://vortex-hindubmv.vercel.app/api/details?url=${encodeURIComponent(selectedUrl)}`;
                let detailsData;
                try {
                    detailsData = await apiCallWithRetry(detailsApiUrl, 3);
                } catch (err) {
                    return await socket.sendMessage(reply.key.remoteJid, { text: `❌ *Failed to fetch movie details!*` }, { quoted: reply });
                }

                if (!detailsData || !detailsData.downloads) {
                    return await socket.sendMessage(reply.key.remoteJid, { text: `❌ *No download options found for this movie!*` }, { quoted: reply });
                }

                // Filter out links where downloadUrl is null
                const validDownloads = detailsData.downloads.filter(d => d && d.downloadUrl);

                if (validDownloads.length === 0) {
                    return await socket.sendMessage(reply.key.remoteJid, { text: `❌ *All download links are currently unavailable for this movie.*` }, { quoted: reply });
                }

                const dlList = validDownloads.map((d, i) => {
                    const quality = getQualityLabel(d.downloadUrl);
                    return `┃ *${i + 1} |* 📥 *${quality}*`;
                }).join('\n┃\n');

                const dlCaption = `╭━━━〔 *D O W N L O A D S* 〕━━━\n` +
                                  `┃\n` +
                                  `┃ 🎬 *Title:*\n┃ ${detailsData.title || selected.title}\n` +
                                  `┃\n` +
                                  `┣━━━〔 *Available Qualities* 〕━━━\n` +
                                  `┃\n` +
                                  `${dlList}\n` +
                                  `┃\n` +
                                  `╰━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                                  `*💡 Reply with a number (1-${validDownloads.length}) to download*\n` +
                                  `> *© VORTEX MD*`;

                const posterImage = detailsData.image || selected.image;
                let dlMsg;
                if (posterImage) {
                    dlMsg = await socket.sendMessage(reply.key.remoteJid, { image: { url: posterImage }, caption: dlCaption }, { quoted: reply });
                } else {
                    dlMsg = await socket.sendMessage(reply.key.remoteJid, { text: dlCaption }, { quoted: reply });
                }

                const dlMsgId = dlMsg.key.id;

                // 4. Download & Send Handler
                const dlHandler = async ({ messages: dlMsgs }) => {
                    const dlReply = dlMsgs[0];
                    if (!dlReply?.message) return;
                    const isIt = dlReply.message?.extendedTextMessage?.contextInfo?.stanzaId === dlMsgId;
                    if (!isIt) return;

                    const dlText = (dlReply.message.conversation || dlReply.message.extendedTextMessage?.text || '').trim();
                    const dlNum = parseInt(dlText);

                    if (isNaN(dlNum) || dlNum < 1 || dlNum > validDownloads.length) {
                        return await socket.sendMessage(dlReply.key.remoteJid, { text: `❌ *Invalid quality choice!*` }, { quoted: dlReply });
                    }

                    socket.ev.off('messages.upsert', dlHandler);
                    const selectedOption = validDownloads[dlNum - 1];
                    const directLink = selectedOption.downloadUrl;

                    await socket.sendMessage(dlReply.key.remoteJid, { react: { text: '🔄', key: dlReply.key } });

                    let tempFilePath = '';
                    try {
                        // Clean file name creation
                        let cleanTitle = (detailsData.title || selected.title).replace(/[^a-zA-Z0-9]/g, '_').substring(0, 40);
                        let fileName = `VORTEX_${cleanTitle}_${Date.now()}.mkv`;
                        tempFilePath = path.join(TEMP_DIR, fileName);

                        await socket.sendMessage(dlReply.key.remoteJid, { react: { text: '⬇️', key: dlReply.key } });
                        await socket.sendMessage(dlReply.key.remoteJid, {
                            text: `╭━━━〔 *P R O C E S S I N G* 〕━━━\n` +
                                  `┃\n` +
                                  `┃ 🔄 *Status:* Downloading Movie...\n` +
                                  `┃ 🎬 *Title:* ${detailsData.title || selected.title}\n` +
                                  `┃ 🎥 *Quality:* ${getQualityLabel(directLink)}\n` +
                                  `┃\n` +
                                  `╰━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                                  `*(Please wait, upload starting soon...)*`
                        }, { quoted: dlReply });

                        await downloadWithRetry(directLink, tempFilePath, 3);

                        await socket.sendMessage(dlReply.key.remoteJid, { react: { text: '📤', key: dlReply.key } });

                        const finalCaption = `╭━━━〔 *V O R T E X  H I N D I* 〕━━━\n` +
                                             `┃\n` +
                                             `┃ 🎬 *Title:* ${detailsData.title || selected.title}\n` +
                                             `┃ 🎥 *Quality:* ${getQualityLabel(directLink)}\n` +
                                             `┃\n` +
                                             `╰━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                                             `> *© VORTEX MD*`;

                        await socket.sendMessage(dlReply.key.remoteJid, {
                            document: { stream: fs.createReadStream(tempFilePath) },
                            mimetype: 'video/x-matroska',
                            fileName: `${cleanTitle}.mkv`,
                            caption: finalCaption
                        }, { quoted: dlReply });

                        await socket.sendMessage(dlReply.key.remoteJid, { react: { text: '✅', key: dlReply.key } });

                    } catch (e) {
                        console.error('Hindi Download Error:', e);
                        await socket.sendMessage(dlReply.key.remoteJid, { react: { text: '❌', key: dlReply.key } });
                        await socket.sendMessage(dlReply.key.remoteJid, { text: `❌ *Download Failed:*\n${e.message}` }, { quoted: dlReply });
                    } finally {
                        try {
                            if (tempFilePath && fs.existsSync(tempFilePath)) {
                                fs.unlinkSync(tempFilePath);
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
            console.error('Hindi Movie Plugin Error:', err.message);
            await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
            await socket.sendMessage(sender, { text: `❌ *System Error:* ${err.message}` }, { quoted: msg });
        }
    }
};
