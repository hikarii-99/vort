const axios = require('axios');
const fs = require('fs');
const path = require('path');
const os = require('os');

// 1. Temp ෆෝල්ඩරේ හදනවා
const TEMP_DIR = path.join(__dirname, 'temp_media');
if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR);
}
process.env.TMPDIR = TEMP_DIR;
os.tmpdir = () => TEMP_DIR;

// ඔයාගේ Sinhala API Link එක
const API_BASE_URL = 'https://vortexsinhaladl.vercel.app/api';

// 3 පාරක් Try කරන Download Function එක 🔥
async function downloadWithRetry(url, destPath, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            console.log(`[ATTEMPT ${i + 1}] Downloading from: ${url}`);
            const { data } = await axios({
                url: url,
                method: 'GET',
                responseType: 'stream',
                timeout: 30000 // තත්පර 30ක Timeout එකක් 
            });

            const writer = fs.createWriteStream(destPath);
            data.pipe(writer);

            await new Promise((resolve, reject) => {
                writer.on('finish', resolve);
                writer.on('error', reject);
            });
            
            return true; // ගොඩ!
        } catch (error) {
            console.log(`[ERROR] Attempt ${i + 1} failed: ${error.message}`);
            if (i === retries - 1) throw error; // තුන් පාරම බැරි වුණොත් Error එක දෙනවා
            await new Promise(res => setTimeout(res, 2000)); // තත්පර 2ක් ඉඳලා ආයෙ Try කරනවා
        }
    }
}

module.exports = {
    command: ['sinhala', 'sdub', 'sl'],
    description: 'Search and Download Sinhala Dubbed Movies (Stable with 3x Retries)',

    handler: async ({ socket, msg, sender, args, prefix }) => {
        try {
            const query = args.join(' ').trim();

            if (!query) {
                return await socket.sendMessage(sender, {
                    text: `🎬 *VORTEX MD | Sinhala Movies*\n\n` +
                        `*Usage:* ${prefix}sinhala <movie name>\n\n` +
                        `*Examples:*\n` +
                        `${prefix}sinhala minions\n` +
                        `${prefix}sdub harry potter\n` +
                        `${prefix}sl avengers\n\n` +
                        `> *Powered by VORTEX*`
                }, { quoted: msg });
            }

            await socket.sendMessage(sender, { react: { text: '🔍', key: msg.key } });
            await socket.sendMessage(sender, { text: `🔍 *Searching for: ${query}...*` }, { quoted: msg });

            // API එකෙන් Search කරනවා
            const searchRes = await axios.get(`${API_BASE_URL}/search?q=${encodeURIComponent(query)}`);
            const searchData = searchRes.data;

            if (!searchData.success || !searchData.results || searchData.results.length === 0) {
                return await socket.sendMessage(sender, {
                    text: `❌ *No results found for:* ${query}`
                }, { quoted: msg });
            }

            const top = searchData.results.slice(0, 5);
            const resultText = top.map((r, i) => `*${i + 1}.* ${r.name}`).join('\n\n');
            const caption = `🎬 *${searchData.owner} MD | Sinhala Movies*\n🔍 Results for: *${query}*\n\n${resultText}\n\n↩️ *Reply with number to select*\n\n> *Powered by ${searchData.owner}*`;

            let sentMsg;
            if (top[0]?.icon) {
                sentMsg = await socket.sendMessage(sender, {
                    image: { url: top[0].icon },
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
                await socket.sendMessage(reply.key.remoteJid, { text: `🔄 *Getting Movie Info...*` }, { quoted: reply });

                // API එකෙන් Movie Details ගන්නවා
                let detail;
                try {
                    const movieRes = await axios.get(`${API_BASE_URL}/movie?url=${encodeURIComponent(selected.link)}`);
                    detail = movieRes.data;
                } catch (e) {
                    return await socket.sendMessage(reply.key.remoteJid, {
                        text: `❌ *Failed to connect API:* ${e.message}`
                    }, { quoted: reply });
                }

                if (!detail.success || !detail.finalLink) {
                    return await socket.sendMessage(reply.key.remoteJid, {
                        text: `❌ *Download link not found for this movie!*`
                    }, { quoted: reply });
                }

                const infoCaption = `🎬 *${detail.owner} MD | Sinhala Movie*\n\n` +
                    `📽️ *${detail.name}*\n\n` +
                    `↩️ *Reply* \`1\` *to download*\n\n> *${detail.owner}*`;

                let infoMsg;
                if (detail.icon) {
                    infoMsg = await socket.sendMessage(reply.key.remoteJid, {
                        image: { url: detail.icon },
                        caption: infoCaption
                    }, { quoted: reply });
                } else {
                    infoMsg = await socket.sendMessage(reply.key.remoteJid, {
                        text: infoCaption
                    }, { quoted: reply });
                }

                const infoMsgId = infoMsg.key.id;

                const dlHandler = async ({ messages }) => {
                    const dlReply = messages[0];
                    if (!dlReply?.message) return;
                    const isIt = dlReply.message?.extendedTextMessage?.contextInfo?.stanzaId === infoMsgId;
                    if (!isIt) return;

                    const dlText = (dlReply.message.conversation || dlReply.message.extendedTextMessage?.text || '').trim();
                    if (dlText !== '1') {
                        return await socket.sendMessage(dlReply.key.remoteJid, {
                            text: `❌ *Reply* \`1\` *to download*`
                        }, { quoted: dlReply });
                    }

                    socket.ev.off('messages.upsert', dlHandler);
                    await socket.sendMessage(dlReply.key.remoteJid, { react: { text: '⏳', key: dlReply.key } });

                    const fileName = `${detail.name.replace(/[^a-zA-Z0-9\s]/g, '').trim()}.mp4`;
                    const tempFilePath = path.join(TEMP_DIR, fileName);
                    
                    try {
                        const safeUrl = encodeURI(decodeURI(detail.finalLink));

                        await socket.sendMessage(dlReply.key.remoteJid, {
                            text: `⬇️ *Downloading to Server... Please wait!*\n(Stable Mode with Retries)`
                        }, { quoted: dlReply });

                        // 3. ෆයිල් එක Server එකට ඩවුන්ලෝඩ් කරනවා (Retry Logic එක පාවිච්චි කරලා) 🔥
                        await downloadWithRetry(safeUrl, tempFilePath, 3);

                        await socket.sendMessage(dlReply.key.remoteJid, {
                            text: `📤 *Download complete! Uploading to WhatsApp...*`
                        }, { quoted: dlReply });

                        // 4. ඩවුන්ලෝඩ් වුණ ෆයිල් එක WhatsApp එකට යවනවා
                        await socket.sendMessage(dlReply.key.remoteJid, {
                            document: { stream: fs.createReadStream(tempFilePath) },
                            mimetype: 'video/mp4',
                            fileName: fileName,
                            caption: `🎬 *${detail.name}*\n\n> *Powered by ${detail.owner}*`
                        }, { quoted: dlReply });

                        await socket.sendMessage(dlReply.key.remoteJid, { react: { text: '✅', key: dlReply.key } });

                    } catch (e) {
                        await socket.sendMessage(dlReply.key.remoteJid, {
                            text: `❌ *Download failed after 3 attempts:*\n${e.message}\n\n📥 *Direct Link:*\n${detail.finalLink}`
                        }, { quoted: dlReply });
                    } finally {
                        // 5. යවලා ඉවර වුණ ගමන් Storage සහ RAM එක Clean කරනවා
                        try {
                            if (fs.existsSync(tempFilePath)) {
                                fs.unlinkSync(tempFilePath);
                                console.log(`[CLEANUP] Deleted ${fileName} to free up space.`);
                            }
                        } catch (cleanupErr) {
                            console.error('Failed to delete temp file:', cleanupErr.message);
                        }
                    }
                };

                socket.ev.on('messages.upsert', dlHandler);
                setTimeout(() => socket.ev.off('messages.upsert', dlHandler), 10 * 60 * 1000);
            };

            socket.ev.on('messages.upsert', searchHandler);
            setTimeout(() => socket.ev.off('messages.upsert', searchHandler), 5 * 60 * 1000);

        } catch (err) {
            console.error('Sinhala plugin error:', err.message);
            await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
            await socket.sendMessage(sender, { text: `❌ *Error:* ${err.message}` }, { quoted: msg });
        }
    }
};
