const axios = require('axios');
const fs = require('fs');
const path = require('path');

const TEMP_DIR = path.join(__dirname, 'temp_mv');
if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR);
}

// ෆයිල් සයිස් එක RAM එකට නොගෙන කෙලින්ම Disk එකට ලියන Function එක (Stream to Disk)
async function downloadLargeFile(url, destPath) {
    const response = await axios({
        url: url,
        method: 'GET',
        responseType: 'stream',
        maxRedirects: 10,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
        }
    });

    const writer = fs.createWriteStream(destPath);
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
        response.data.on('error', reject);
    });
}

function safeImage(url) {
    if (url && /^https?:\/\//i.test(url)) return url;
    return 'https://u.pone.rs/iyhqahtk.jpg';
}

async function sendWithImage(socket, jid, quoted, imageUrl, caption) {
    try {
        return await socket.sendMessage(
            jid,
            { image: { url: safeImage(imageUrl) }, caption: caption },
            { quoted: quoted }
        );
    } catch (e) {
        return await socket.sendMessage(jid, { text: caption }, { quoted: quoted });
    }
}

module.exports = {
    command: ['movie23', 'mv23', 'sinhalasub2'],
    description: 'Search & Download Movies from SinhalaSub',

    handler: async ({ socket, msg, sender, args, prefix }) => {
        try {
            const query = args.join(' ').trim();

            if (!query) {
                return await socket.sendMessage(
                    sender,
                    {
                        text:
                            '🎬 *VORTEX | Movie Downloader*\n\n' +
                            '*Usage:*\n' +
                            prefix + 'mv <movie name>\n\n' +
                            '*Example:*\n' +
                            prefix + 'mv spider man\n\n' +
                            '> *Powered by VORTEX*'
                    },
                    { quoted: msg }
                );
            }

            await socket.sendMessage(sender, { react: { text: '🔍', key: msg.key } });

            // 1. චිත්‍රපට සෙවීම
            const searchUrl = `https://poddax-api.dev/sinhala-sub-search?text=${encodeURIComponent(query)}`;
            const searchRes = await axios.get(searchUrl);

            if (!searchRes.data.status || !searchRes.data.result || searchRes.data.result.length === 0) {
                return await socket.sendMessage(
                    sender,
                    { text: '❌ *No movies found for:* ' + query },
                    { quoted: msg }
                );
            }

            const movies = searchRes.data.result.slice(0, 10);
            let listText = `🎬 *Movie Search Results*\n🔍 *${query}*\n\n`;
            
            movies.forEach((m, i) => {
                listText += `*${i + 1}.* ${m.title}\n`;
            });
            listText += '\n↩️ *Reply with number*\n\n> *VORTEX*';

            // පළමු රිසල්ට් එකේ පින්තූරය පෙන්වමු
            const searchMsg = await sendWithImage(socket, sender, msg, movies[0].image, listText);
            const searchMsgId = searchMsg.key.id;

            // සෙවුම් ප්‍රතිඵල සඳහා Handler
            const searchHandler = async ({ messages }) => {
                const reply = messages[0];
                if (!reply || !reply.message) return;

                const stanza = reply.message.extendedTextMessage?.contextInfo?.stanzaId;
                if (stanza !== searchMsgId) return;

                const textIn = (reply.message.conversation || reply.message.extendedTextMessage?.text || '').trim();
                const num = parseInt(textIn);
                
                if (isNaN(num) || num < 1 || num > movies.length) {
                    return await socket.sendMessage(sender, { text: `❌ *Invalid!* Enter 1 – ${movies.length}` }, { quoted: reply });
                }

                socket.ev.off('messages.upsert', searchHandler);
                const selectedMovie = movies[num - 1];

                await socket.sendMessage(sender, { react: { text: '⏳', key: reply.key } });
                await fetchDownloadLinks(socket, sender, reply, selectedMovie);
            };

            socket.ev.on('messages.upsert', searchHandler);
            setTimeout(() => socket.ev.off('messages.upsert', searchHandler), 5 * 60 * 1000);

        } catch (err) {
            console.error('Movie plugin error:', err.message);
            await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
            await socket.sendMessage(sender, { text: '❌ *Error:* ' + err.message }, { quoted: msg });
        }
    }
};

// 2. Download Links ලබාගැනීම
async function fetchDownloadLinks(socket, jid, quoted, movie) {
    try {
        const dlApiUrl = `https://poddax-api.dev/sinhala-sub-download?url=${encodeURIComponent(movie.url)}`;
        const dlRes = await axios.get(dlApiUrl);

        if (!dlRes.data.status || !dlRes.data.result || dlRes.data.result.length === 0) {
            return await socket.sendMessage(jid, { text: '❌ *No download links available.*' }, { quoted: quoted });
        }

        // DLSERVER-02 (DL2) ලින්ක්ස් පමණක් තෝරා ගැනීම
        const links = dlRes.data.result.filter(l => l.server && l.server.toUpperCase() === 'DLSERVER-02');

        if (links.length === 0) {
            return await socket.sendMessage(jid, { text: '❌ *Direct download links (DL2) are not available for this movie.*' }, { quoted: quoted });
        }

        let text = `🎬 *${movie.title}*\n\n📂 *Available Qualities:*\n\n`;
        links.forEach((l, i) => {
            // UI එකට Quality සහ Size පමණක් පෙන්වීම
            text += `*${i + 1}.* 🎥 ${l.quality} ┃ 💾 ${l.size}\n`;
        });
        text += '\n↩️ *Reply with number*\n📦 Sent as document\n\n> *VORTEX*';

        const linkMsg = await sendWithImage(socket, jid, quoted, movie.image, text);
        const linkMsgId = linkMsg.key.id;

        const linkHandler = async ({ messages }) => {
            const reply = messages[0];
            if (!reply || !reply.message) return;

            const stanza = reply.message.extendedTextMessage?.contextInfo?.stanzaId;
            if (stanza !== linkMsgId) return;

            const textIn = (reply.message.conversation || reply.message.extendedTextMessage?.text || '').trim();
            const num = parseInt(textIn);

            if (isNaN(num) || num < 1 || num > links.length) {
                return await socket.sendMessage(jid, { text: `❌ *Invalid!* Enter 1 – ${links.length}` }, { quoted: reply });
            }

            socket.ev.off('messages.upsert', linkHandler);
            const selectedLink = links[num - 1];

            await processDownload(socket, jid, reply, movie.title, selectedLink);
        };

        socket.ev.on('messages.upsert', linkHandler);
        setTimeout(() => socket.ev.off('messages.upsert', linkHandler), 5 * 60 * 1000);

    } catch (e) {
        await socket.sendMessage(jid, { text: '❌ *Failed to fetch links:* ' + e.message }, { quoted: quoted });
    }
}

// 3. ෆයිල් එක Download කරලා යැවීම
async function processDownload(socket, jid, quoted, title, linkData) {
    const safeTitle = title.replace(/[^a-zA-Z0-9.\s-]/g, '').replace(/\s+/g, '_').slice(0, 50);
    const fileName = `${safeTitle}_${linkData.quality.replace(/\s+/g, '')}.mp4`;
    const tempPath = path.join(TEMP_DIR, fileName);

    try {
        await socket.sendMessage(jid, { react: { text: '⬇️', key: quoted.key } });
        await socket.sendMessage(
            jid,
            {
                text: `⬇️ *Downloading Movie...*\n\n🎬 *${title}*\n🎥 ${linkData.quality}\n💾 ${linkData.size}\n\n_Please wait, this might take a while..._`
            },
            { quoted: quoted }
        );

        // RAM එකට ලෝඩ් නොකර කෙලින්ම Disk එකට ලියනවා
        await downloadLargeFile(linkData.download_url, tempPath);

        await socket.sendMessage(jid, { react: { text: '📤', key: quoted.key } });

        await socket.sendMessage(
            jid,
            {
                document: { url: tempPath },
                mimetype: 'video/mp4',
                fileName: fileName,
                caption: `🎬 *${title}*\n🎥 ${linkData.quality} ┃ 💾 ${linkData.size}\n\n> *VORTEX | SinhalaSub*`
            },
            { quoted: quoted }
        );

        await socket.sendMessage(jid, { react: { text: '✅', key: quoted.key } });

    } catch (err) {
        console.error('Movie Download Error:', err.message);
        await socket.sendMessage(jid, { react: { text: '❌', key: quoted.key } });
        await socket.sendMessage(
            jid,
            { text: `❌ *Download failed:* ${err.message}` },
            { quoted: quoted }
        );
    } finally {
        // අනිවාර්යයෙන්ම ෆයිල් එක මකා දමන්න (Disk Space පිරෙන එක නවත්තන්න)
        try {
            if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
        } catch (e) {}
    }
}
