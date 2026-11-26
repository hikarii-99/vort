const axios = require('axios');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Temp ෆෝල්ඩරයක් හදමු
const TEMP_DIR = path.join(__dirname, 'temp_anime');
if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR);
}
process.env.TMPDIR = TEMP_DIR;
os.tmpdir = () => TEMP_DIR;

// ඔයාගේ API Link එක
const API_BASE_URL = 'https://vortex-animostlk.vercel.app/api';

// 1. API Call එකට 3 පාරක් Try කරන Function එක (අලුතෙන් දැම්මේ) 🔥
async function apiCallWithRetry(url, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            const response = await axios.get(url, { timeout: 20000 }); // තත්පර 20ක් බලන් ඉන්නවා
            if (!response.data || !response.data.success) {
                throw new Error(response.data?.error || 'API returned success: false');
            }
            return response.data;
        } catch (error) {
            console.log(`[API ATTEMPT ${i + 1} FAILED] ${url}`);
            if (i === retries - 1) {
                // අන්තිම පාරත් බැරි වුණොත් හරියටම Error එක එළියට දෙනවා
                let errMsg = error.response?.data?.error || error.message;
                if (typeof errMsg === 'object') {
                    errMsg = errMsg.message || JSON.stringify(errMsg);
                }
                throw new Error(errMsg);
            }
            await new Promise(res => setTimeout(res, 2000)); // තත්පර 2ක් ඉඳලා ආයෙ Try කරනවා
        }
    }
}

// 2. Video File එක ඩවුන්ලෝඩ් කරන්න 3 පාරක් Try කරන Function එක
async function downloadWithRetry(url, destPath, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            console.log(`[DOWNLOAD ATTEMPT ${i + 1}]`);
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
            console.log(`[DOWNLOAD ERROR] Attempt ${i + 1} failed: ${error.message}`);
            if (i === retries - 1) throw error; 
            await new Promise(res => setTimeout(res, 2000)); 
        }
    }
}

module.exports = {
    command: ['animostlk', 'an'],
    description: 'Search and Download Anime (Super Stable with API & DL Retries)',

    handler: async ({ socket, msg, sender, args, prefix }) => {
        try {
            const query = args.join(' ').trim();

            if (!query) {
                return await socket.sendMessage(sender, {
                    text: `🎌 *VORTEX MD | Anime Downloader*\n\n` +
                        `*Usage:* ${prefix}anime <title>\n\n` +
                        `*Examples:*\n` +
                        `${prefix}anime Your Name\n` +
                        `${prefix}an A Whisker Away\n\n` +
                        `> *Powered by VORTEX*`
                }, { quoted: msg });
            }

            await socket.sendMessage(sender, { react: { text: '🔍', key: msg.key } });
            await socket.sendMessage(sender, { text: `🔍 *Searching for: ${query}...*` }, { quoted: msg });

            // 1. API එකෙන් Search කරනවා (Retry එක්ක)
            let searchData;
            try {
                searchData = await apiCallWithRetry(`${API_BASE_URL}/search?q=${encodeURIComponent(query)}`, 3);
            } catch (apiErr) {
                return await socket.sendMessage(sender, {
                    text: `❌ *Search API Error:*\n${apiErr.message}\n\n(API එක පැත්තේ අවුලක් තියෙනවා, පස්සේ try කරන්න)`
                }, { quoted: msg });
            }

            if (!searchData.results || searchData.results.length === 0) {
                return await socket.sendMessage(sender, {
                    text: `❌ *No results found for:* ${query}`
                }, { quoted: msg });
            }

            const top = searchData.results.slice(0, 5);
            const resultText = top.map((r, i) => `*${i + 1}.* ${r.title}`).join('\n\n');
            const caption = `🎌 *${searchData.owner || 'VORTEX'} MD | Anime Search*\n🔍 Results for: *${query}*\n\n${resultText}\n\n↩️ *Reply with number to select*\n\n> *Powered by ${searchData.owner || 'VORTEX'}*`;

            let sentMsg;
            if (top[0]?.image) {
                sentMsg = await socket.sendMessage(sender, {
                    image: { url: top[0].image },
                    caption: caption
                }, { quoted: msg });
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

                if (isNaN(selNum) || selNum < 1 || selNum > top.length) {
                    return await socket.sendMessage(reply.key.remoteJid, {
                        text: `❌ *Invalid number!* Enter 1 to ${top.length}`
                    }, { quoted: reply });
                }

                socket.ev.off('messages.upsert', searchHandler);
                const selected = top[selNum - 1];

                await socket.sendMessage(reply.key.remoteJid, { react: { text: '⏳', key: reply.key } });
                await socket.sendMessage(reply.key.remoteJid, { text: `🔄 *Loading Options...*` }, { quoted: reply });

                // 2. API එකෙන් Downloads Details ගන්නවා (Retry එක්ක)
                let detailData;
                try {
                    detailData = await apiCallWithRetry(`${API_BASE_URL}/movie?url=${encodeURIComponent(selected.url)}`, 3);
                } catch (apiErr) {
                    return await socket.sendMessage(reply.key.remoteJid, {
                        text: `❌ *API Details Error:*\n${apiErr.message}\n\n🔗 *URL:* ${selected.url}`
                    }, { quoted: reply });
                }

                if (!detailData.details || !detailData.details.downloads || !detailData.details.downloads.length) {
                    return await socket.sendMessage(reply.key.remoteJid, {
                        text: `❌ *No download links found!*`
                    }, { quoted: reply });
                }

                const details = detailData.details;
                
                // Telegram ලින්ක්ස් අයින් කරලා Filter කරමු
                const filteredDownloads = details.downloads.filter(
                    (d) => !/telegram/i.test(d.source) && !/t\.me\//i.test(d.url)
                );

                if (filteredDownloads.length === 0) {
                    return await socket.sendMessage(reply.key.remoteJid, {
                        text: `❌ *No direct download links found for this movie!*`
                    }, { quoted: reply });
                }

                // අලුත් UI එක
                const dlList = filteredDownloads.map((d, i) => {
                    const icon = d.quality.includes('1080') ? '🎬' : d.quality.includes('720') ? '📽️' : d.quality.includes('480') ? '📺' : '📱';
                    return `*${i + 1}.* ${icon} *${d.quality}*  ┃  📦 ${d.size}  ┃  🗂️ ${d.type.toUpperCase()}`;
                }).join('\n\n'); 

                const dlCaption = `🎌 *${details.title}*\n\n` +
                    `╭──────────────━┈\n` +
                    `│ 📥 *Available Downloads*\n` +
                    `╰──────────────━┈\n\n` +
                    `${dlList}\n\n` +
                    `───────────────━┈\n` +
                    `↩️ *Reply with number to download*\n\n` +
                    `> *${detailData.owner || 'VORTEX'} MD*`;

                let dlMsg;
                if (details.poster) {
                    dlMsg = await socket.sendMessage(reply.key.remoteJid, {
                        image: { url: details.poster },
                        caption: dlCaption
                    }, { quoted: reply });
                } else {
                    dlMsg = await socket.sendMessage(reply.key.remoteJid, { text: dlCaption }, { quoted: reply });
                }

                const dlMsgId = dlMsg.key.id;

                const dlHandler = async ({ messages }) => {
                    const dlReply = messages[0];
                    if (!dlReply?.message) return;
                    const isIt = dlReply.message?.extendedTextMessage?.contextInfo?.stanzaId === dlMsgId;
                    if (!isIt) return;

                    const dlText = (dlReply.message.conversation || dlReply.message.extendedTextMessage?.text || '').trim();
                    const dlNum = parseInt(dlText);

                    if (isNaN(dlNum) || dlNum < 1 || dlNum > filteredDownloads.length) {
                        return await socket.sendMessage(dlReply.key.remoteJid, {
                            text: `❌ *Invalid number!* Enter 1 to ${filteredDownloads.length}`
                        }, { quoted: dlReply });
                    }

                    socket.ev.off('messages.upsert', dlHandler);
                    const selectedDl = filteredDownloads[dlNum - 1]; 

                    await socket.sendMessage(dlReply.key.remoteJid, { react: { text: '⏳', key: dlReply.key } });

                    const fileUrl = selectedDl.downloadUrl || selectedDl.videoUrl || selectedDl.url;
                    
                    const fileName = `${details.title}_${selectedDl.quality}.${selectedDl.type}`.replace(/[^a-zA-Z0-9._-]/g, '_');
                    const tempFilePath = path.join(TEMP_DIR, fileName);

                    try {
                        await socket.sendMessage(dlReply.key.remoteJid, {
                            text: `⬇️ *Downloading ${selectedDl.quality}... Please wait!*\n(This might take a while)`
                        }, { quoted: dlReply });

                        // Video File එක Download කරන තැන
                        await downloadWithRetry(fileUrl, tempFilePath, 3);

                        await socket.sendMessage(dlReply.key.remoteJid, {
                            text: `📤 *Download complete! Uploading to WhatsApp...*`
                        }, { quoted: dlReply });

                        const mimetype = selectedDl.type === 'mkv' ? 'video/x-matroska' : 'video/mp4';
                        await socket.sendMessage(dlReply.key.remoteJid, {
                            document: { stream: fs.createReadStream(tempFilePath) },
                            mimetype: mimetype,
                            fileName: fileName,
                            caption: `🎌 *${details.title}*\n🎬 ${selectedDl.quality} | ${selectedDl.size}\n\n> *Powered by ${detailData.owner || 'VORTEX'}*`
                        }, { quoted: dlReply });

                        await socket.sendMessage(dlReply.key.remoteJid, { react: { text: '✅', key: dlReply.key } });

                    } catch (e) {
                        await socket.sendMessage(dlReply.key.remoteJid, {
                            text: `❌ *Failed to download after 3 attempts:*\n${e.message}\n\n📥 *Direct Link:*\n${fileUrl}`
                        }, { quoted: dlReply });
                    } finally {
                        try {
                            if (fs.existsSync(tempFilePath)) {
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
            console.error('Anime plugin error:', err.message);
            await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
            await socket.sendMessage(sender, { text: `❌ *System Error:* ${err.message}` }, { quoted: msg });
        }
    }
};
