const axios = require('axios');
const cheerio = require('cheerio');

const BASE_URL = 'https://storage.kanzaki.ru/ANIME___/';
const MENU_IMAGE = 'https://u.pone.rs/satmulxn.jpg';

function normalizeText(str) {
    return decodeURIComponent(str)
        .toLowerCase()
        .replace(/[_.-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

async function getLinks(url) {
    try {
        const response = await axios.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            timeout: 15000
        });
        const $ = cheerio.load(response.data);
        const links = [];
        $('a').each((_, element) => {
            const href = $(element).attr('href');
            if (href && href !== '../') links.push(href);
        });
        return links;
    } catch (e) {
        return [];
    }
}

async function extractFiles(url) {
    const links = await getLinks(url);
    const files = [];
    for (const link of links) {
        const fullUrl = url + link;
        const name = decodeURIComponent(link);
        if (link.endsWith('/')) {
            const subFiles = await extractFiles(fullUrl);
            files.push(...subFiles);
        } else {
            files.push({ name, url: fullUrl });
        }
    }
    return files;
}

async function searchAnime(query) {
    const allFolders = await getLinks(BASE_URL);
    const cleanQuery = normalizeText(query);
    return allFolders.filter(f => normalizeText(f).includes(cleanQuery));
}

module.exports = {
    command: ['anime2', 'kan', 'kanzaki'],
    description: 'Download Anime from Kanzaki Storage',

    handler: async ({ socket, msg, sender, args, prefix }) => {
        try {
            const query = args.join(' ').trim();

            if (!query) {
                return await socket.sendMessage(sender, {
                    image: { url: MENU_IMAGE },
                    caption: `🎌 *VORTEX MD | Kanzaki Anime*\n\n` +
                        `*Usage:* ${prefix}kan <anime name>\n\n` +
                        `*Examples:*\n` +
                        `${prefix}kan naruto\n` +
                        `${prefix}kan one piece\n` +
                        `${prefix}adl demon slayer\n\n` +
                        `> *Powered by VORTEX MD*`
                }, { quoted: msg });
            }

            // ── STEP 1: Search ──
            await socket.sendMessage(sender, { react: { text: '🔍', key: msg.key } });
            await socket.sendMessage(sender, { text: `🔍 *Searching: ${query}...*` }, { quoted: msg });

            let matchingFolders;
            try {
                matchingFolders = await searchAnime(query);
            } catch (e) {
                return await socket.sendMessage(sender, {
                    text: `❌ *Search failed:* ${e.message}`
                }, { quoted: msg });
            }

            if (!matchingFolders.length) {
                return await socket.sendMessage(sender, {
                    text: `❌ *No results found for:* ${query}\n\nTry a different name.`
                }, { quoted: msg });
            }

            const top = matchingFolders.slice(0, 5);
            const resultText = top.map((f, i) =>
                `*${i + 1}.* ${decodeURIComponent(f).replace(/\/$/, '')}`
            ).join('\n\n');

            const caption = `🎌 *VORTEX MD | Kanzaki Anime*\n🔍 Results for: *${query}*\n\n${resultText}\n\n↩️ *Reply with number to select*\n\n> *Powered by VORTEX MD*`;

            const sentMsg = await socket.sendMessage(sender, {
                image: { url: MENU_IMAGE },
                caption: caption
            }, { quoted: msg });

            const searchMsgId = sentMsg.key.id;

            // ── STEP 2: Folder selection → file list ──
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
                const selectedFolder = top[selNum - 1];
                const folderUrl = BASE_URL + selectedFolder;
                const folderName = decodeURIComponent(selectedFolder).replace(/\/$/, '');

                await socket.sendMessage(reply.key.remoteJid, { react: { text: '⏳', key: reply.key } });
                await socket.sendMessage(reply.key.remoteJid, {
                    text: `🔄 *Loading files for: ${folderName}...*`
                }, { quoted: reply });

                let files;
                try {
                    files = await extractFiles(folderUrl);
                } catch (e) {
                    return await socket.sendMessage(reply.key.remoteJid, {
                        text: `❌ *Failed to load:* ${e.message}`
                    }, { quoted: reply });
                }

                if (!files.length) {
                    return await socket.sendMessage(reply.key.remoteJid, {
                        text: `❌ *No files found in:* ${folderName}`
                    }, { quoted: reply });
                }

                const showFiles = files.slice(0, 30);
                const fileList = showFiles.map((f, i) =>
                    `*${i + 1}.* ${f.name}`
                ).join('\n\n');

                const moreText = files.length > 30 ? `\n\n📌 *Showing first 30 of ${files.length} files*` : '';

                const fileCaption = `🎌 *${folderName}*\n📁 Files: *${files.length}*\n\n━━━━━━━━━━━━━━━━━━\n\n${fileList}${moreText}\n\n━━━━━━━━━━━━━━━━━━\n\n↩️ *Reply with number to download*\n\n> *VORTEX MD*`;

                const fileMsg = await socket.sendMessage(reply.key.remoteJid, {
                    image: { url: MENU_IMAGE },
                    caption: fileCaption
                }, { quoted: reply });

                const fileMsgId = fileMsg.key.id;

                // ── STEP 3: File selection → send ──
                const fileHandler = async ({ messages }) => {
                    const fileReply = messages[0];
                    if (!fileReply?.message) return;
                    const isIt = fileReply.message?.extendedTextMessage?.contextInfo?.stanzaId === fileMsgId;
                    if (!isIt) return;

                    const fileText = (fileReply.message.conversation || fileReply.message.extendedTextMessage?.text || '').trim();
                    const fileNum = parseInt(fileText);

                    if (isNaN(fileNum) || fileNum < 1 || fileNum > showFiles.length) {
                        return await socket.sendMessage(fileReply.key.remoteJid, {
                            text: `❌ *Invalid number!* Enter 1 to ${showFiles.length}`
                        }, { quoted: fileReply });
                    }

                    socket.ev.off('messages.upsert', fileHandler);

                    const selectedFile = showFiles[fileNum - 1];

                    await socket.sendMessage(fileReply.key.remoteJid, { react: { text: '⏳', key: fileReply.key } });
                    await socket.sendMessage(fileReply.key.remoteJid, {
                        text: `⬇️ *Sending: ${selectedFile.name}...*`
                    }, { quoted: fileReply });

                    try {
                        const ext = selectedFile.name.split('.').pop().toLowerCase();
                        const mimetype = ext === 'mkv' ? 'video/x-matroska' : 'video/mp4';

                        await socket.sendMessage(fileReply.key.remoteJid, {
                            document: { url: selectedFile.url },
                            mimetype: mimetype,
                            fileName: selectedFile.name,
                            caption: `🎌 *VORTEX MD | Kanzaki*\n\n📺 *${folderName}*\n📄 ${selectedFile.name}\n\n> *Powered by VORTEX MD*`
                        }, { quoted: fileReply });

                        await socket.sendMessage(fileReply.key.remoteJid, { react: { text: '✅', key: fileReply.key } });

                    } catch (e) {
                        await socket.sendMessage(fileReply.key.remoteJid, {
                            text: `❌ *Send failed:* ${e.message}\n\n📥 *Direct link:*\n${selectedFile.url}`
                        }, { quoted: fileReply });
                    }
                };

                socket.ev.on('messages.upsert', fileHandler);
                setTimeout(() => socket.ev.off('messages.upsert', fileHandler), 10 * 60 * 1000);
            };

            socket.ev.on('messages.upsert', searchHandler);
            setTimeout(() => socket.ev.off('messages.upsert', searchHandler), 5 * 60 * 1000);

        } catch (err) {
            console.error('Kanzaki plugin error:', err.message);
            await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
            await socket.sendMessage(sender, {
                text: `❌ *Error:* ${err.message}`
            }, { quoted: msg });
        }
    }
};
