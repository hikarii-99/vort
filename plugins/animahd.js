const axios = require('axios');
const fs = require('fs');
const path = require('path');

const API = 'https://animehd-vortex.vercel.app';
const DEFAULT_IMG = 'https://u.pone.rs/iyhqahtk.jpg';

const TEMP_DIR = path.join(__dirname, 'temp_ahd');
if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR);
}

// අනිත් සපෝට් Functions 
async function apiGet(params) {
    const { data } = await axios.get(API + '/', {
        params: params,
        timeout: 45000
    });
    return data;
}

function safeImage(url) {
    if (url && /^https?:\/\//i.test(url)) return url;
    return DEFAULT_IMG;
}

function formatBytes(n) {
    if (!n) return '';
    if (n >= 1073741824) return (n / 1073741824).toFixed(2) + ' GB';
    if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
    return '';
}

async function sendWithImage(socket, jid, quoted, imageUrl, caption) {
    try {
        return await socket.sendMessage(
            jid,
            {
                image: { url: safeImage(imageUrl) },
                caption: caption
            },
            { quoted: quoted }
        );
    } catch (e) {
        return await socket.sendMessage(jid, { text: caption }, { quoted: quoted });
    }
}

async function handleDetail(socket, jid, quoted, detailUrl, fallbackTitle) {
    let detail;
    try {
        detail = await apiGet({ detail: detailUrl });
    } catch (e) {
        return await socket.sendMessage(
            jid,
            { text: '❌ *Detail failed:* ' + e.message },
            { quoted: quoted }
        );
    }

    if (!detail.success) {
        return await socket.sendMessage(
            jid,
            { text: '❌ *Detail error*' },
            { quoted: quoted }
        );
    }

    const title = detail.title || fallbackTitle || 'Anime';
    const thumb = safeImage(detail.image);
    const episodes = detail.episodes || [];
    const seasonKeys = Object.keys(detail.seasons || {});

    if (!episodes.length) {
        return await sendWithImage(
            socket,
            jid,
            quoted,
            thumb,
            '🎌 *' + title + '*\n\n⚠️ No episodes found.\n🔗 ' + detailUrl
        );
    }

    if (seasonKeys.length > 1) {
        let text = '🎌 *' + title + '*\n';
        if (detail.meta) text += 'ℹ️ ' + detail.meta + '\n';
        text += '🎞️ ' + detail.episodeCount + ' episodes\n\n';
        text += '📂 *Select season:*\n\n';

        for (let i = 0; i < seasonKeys.length; i++) {
            const key = seasonKeys[i];
            const count = (detail.seasons[key] || []).length;
            text += '*' + (i + 1) + '.* ' + key + ' (' + count + ' eps)\n';
        }
        text += '\n↩️ *Reply with number*\n\n> *VORTEX*';

        const seasonMsg = await sendWithImage(socket, jid, quoted, thumb, text);
        const seasonMsgId = seasonMsg.key.id;

        const seasonHandler = async ({ messages }) => {
            const reply = messages[0];
            if (!reply || !reply.message) return;

            const stanza =
                reply.message.extendedTextMessage &&
                reply.message.extendedTextMessage.contextInfo &&
                reply.message.extendedTextMessage.contextInfo.stanzaId;
            if (stanza !== seasonMsgId) return;

            const textIn = (
                reply.message.conversation ||
                (reply.message.extendedTextMessage &&
                    reply.message.extendedTextMessage.text) ||
                ''
            ).trim();

            const num = parseInt(textIn);
            if (isNaN(num) || num < 1 || num > seasonKeys.length) {
                return await socket.sendMessage(
                    jid,
                    { text: '❌ *Invalid!* Enter 1 – ' + seasonKeys.length },
                    { quoted: reply }
                );
            }

            socket.ev.off('messages.upsert', seasonHandler);
            const key = seasonKeys[num - 1];
            const list = detail.seasons[key] || [];

            await socket.sendMessage(jid, {
                react: { text: '⏳', key: reply.key }
            });

            await showEpisodes(socket, jid, reply, title, key, list, thumb);
        };

        socket.ev.on('messages.upsert', seasonHandler);
        setTimeout(function () {
            socket.ev.off('messages.upsert', seasonHandler);
        }, 5 * 60 * 1000);
        return;
    }

    const list = seasonKeys.length === 1 ? detail.seasons[seasonKeys[0]] : episodes;
    const label = seasonKeys.length === 1 ? seasonKeys[0] : 'All';
    await showEpisodes(socket, jid, quoted, title, label, list, thumb);
}

async function showEpisodes(socket, jid, quoted, title, seasonLabel, episodes, thumb) {
    const maxShow = 30;
    const list = episodes.slice(0, maxShow);

    let text =
        '🎌 *' +
        title +
        '*\n📂 ' +
        seasonLabel +
        ' — ' +
        episodes.length +
        ' eps\n\n';

    for (let i = 0; i < list.length; i++) {
        const ep = list[i];
        const label =
            ep.season != null && ep.episode != null
                ? 'S' +
                  String(ep.season).padStart(2, '0') +
                  'E' +
                  String(ep.episode).padStart(2, '0')
                : String(i + 1);
        text += '*' + (i + 1) + '.* ' + label;
        if (ep.quality) text += ' | ' + ep.quality;
        if (ep.size) text += ' | ' + ep.size;
        text += '\n';
    }

    if (episodes.length > maxShow) {
        text += '\n_...+' + (episodes.length - maxShow) + ' more_\n';
    }

    text += '\n↩️ *Reply with number*\n📦 Sent as document\n\n> *VORTEX*';

    const epMsg = await sendWithImage(socket, jid, quoted, thumb, text);
    const epMsgId = epMsg.key.id;

    const epHandler = async ({ messages }) => {
        const reply = messages[0];
        if (!reply || !reply.message) return;

        const stanza =
            reply.message.extendedTextMessage &&
            reply.message.extendedTextMessage.contextInfo &&
            reply.message.extendedTextMessage.contextInfo.stanzaId;
        if (stanza !== epMsgId) return;

        const textIn = (
            reply.message.conversation ||
            (reply.message.extendedTextMessage &&
                reply.message.extendedTextMessage.text) ||
            ''
        ).trim();

        const num = parseInt(textIn);
        if (isNaN(num) || num < 1 || num > list.length) {
            return await socket.sendMessage(
                jid,
                { text: '❌ *Invalid!* Enter 1 – ' + list.length },
                { quoted: reply }
            );
        }

        socket.ev.off('messages.upsert', epHandler);
        const selected = list[num - 1];

        await sendEpisodeFile(socket, jid, reply, title, selected);
    };

    socket.ev.on('messages.upsert', epHandler);
    setTimeout(function () {
        socket.ev.off('messages.upsert', epHandler);
    }, 10 * 60 * 1000);
}

async function sendEpisodeFile(socket, jid, quoted, showTitle, ep) {
    const label =
        ep.season != null && ep.episode != null
            ? 'S' +
              String(ep.season).padStart(2, '0') +
              'E' +
              String(ep.episode).padStart(2, '0')
            : ep.name || 'Episode';

    const safeName = String(ep.name || label)
        .replace(/[^a-zA-Z0-9._\s-]/g, '')
        .replace(/\s+/g, '_')
        .slice(0, 80);
    const fileName = safeName + (/\.(mkv|mp4)$/i.test(safeName) ? '' : '.mkv');
    const tempPath = path.join(TEMP_DIR, fileName);

    try {
        await socket.sendMessage(jid, {
            react: { text: '⬇️', key: quoted.key }
        });
        await socket.sendMessage(
            jid,
            {
                text:
                    '⬇️ *Downloading from Drive...*\n' +
                    '🎌 ' +
                    showTitle +
                    '\n' +
                    '🎞️ ' +
                    label +
                    '\n' +
                    (ep.quality ? '📦 ' + ep.quality + '\n' : '') +
                    (ep.size ? '💾 ' + ep.size + '\n' : '') +
                    '\nPlease wait...'
            },
            { quoted: quoted }
        );

        if (!ep.fileId) {
            throw new Error('No Google Drive fileId found!');
        }

        const gdriveUrl = `https://drive.google.com/file/d/${ep.fileId}/view`;

        const { data: gdriveData } = await axios.get(
            `https://poddax-api.dev/gdrive?url=${encodeURIComponent(gdriveUrl)}`,
            { timeout: 60000 }
        );

        if (!gdriveData?.success || !gdriveData?.downloadUrl) {
            throw new Error("Failed to bypass Google Drive link using API!");
        }

        const finalDownloadUrl = gdriveData.downloadUrl;

        const streamRes = await axios.get(finalDownloadUrl, {
            responseType: 'stream',
            headers: { 'User-Agent': 'Mozilla/5.0' },
            maxRedirects: 10,
            validateStatus: () => true
        });

        const streamContentType = streamRes.headers['content-type'] || '';
        if (streamContentType.includes('text/html') || streamContentType.includes('application/json')) {
            throw new Error('Failed to bypass virus scan / Quota exceeded.');
        }

        const writer = fs.createWriteStream(tempPath);
        streamRes.data.pipe(writer);

        await new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
            streamRes.data.on('error', reject);
        });

        // 🔴 2KB අර්බුදය වලක්වන කොටස 
        const stats = fs.statSync(tempPath);
        if (stats.size < 100 * 1024) { 
            throw new Error('File too small / incomplete.');
        }

        const realSize = formatBytes(stats.size);
        const isMp4 = /\.mp4$/i.test(fileName);

        await socket.sendMessage(jid, {
            react: { text: '📤', key: quoted.key }
        });

        await socket.sendMessage(
            jid,
            {
                document: { url: tempPath },
                mimetype: isMp4 ? 'video/mp4' : 'video/x-matroska',
                fileName: fileName,
                caption:
                    '🎌 *' +
                    showTitle +
                    '*\n' +
                    '🎞️ *' +
                    label +
                    '*\n' +
                    (ep.quality ? '📦 ' + ep.quality + '\n' : '') +
                    (realSize ? '💾 ' + realSize + '\n' : '') +
                    '\n> *VORTEX | AnimaHD*'
            },
            { quoted: quoted }
        );

        await socket.sendMessage(jid, {
            react: { text: '✅', key: quoted.key }
        });
    } catch (err) {
        console.error('AHD send error:', err.message);
        await socket.sendMessage(jid, {
            react: { text: '❌', key: quoted.key }
        });
        await socket.sendMessage(
            jid,
            {
                text:
                    '❌ *Download/send failed:* ' +
                    err.message +
                    '\n\n(Large Drive files sometimes need manual download)\n' +
                    '📁 ' +
                    (ep.gdrive || `https://drive.google.com/file/d/${ep.fileId}/view`)
            },
            { quoted: quoted }
        );
    } finally {
        try {
            if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
        } catch (e) {}
    }
}

module.exports = {
    command: ['ahd', 'animahd', 'ahh'],
    description: 'Search & Download AnimaHD anime',

    handler: async ({ socket, msg, sender, args, prefix }) => {
        try {
            const query = args.join(' ').trim();

            if (!query) {
                return await socket.sendMessage(
                    sender,
                    {
                        text:
                            '🎌 *VORTEX | AnimaHD*\n\n' +
                            '*Usage:*\n' +
                            prefix +
                            'ahd <anime name>\n\n' +
                            '*Examples:*\n' +
                            prefix +
                            'ahd jujutsu kaisen\n' +
                            prefix +
                            'ahd bye bye earth\n\n' +
                            '> *Powered by VORTEX*'
                    },
                    { quoted: msg }
                );
            }

            if (/animahd\.com\//i.test(query)) {
                await socket.sendMessage(sender, {
                    react: { text: '⏳', key: msg.key }
                });
                return await handleDetail(socket, sender, msg, query, null);
            }

            await socket.sendMessage(sender, {
                react: { text: '🔍', key: msg.key }
            });

            let searchData;
            try {
                searchData = await apiGet({ search: query });
            } catch (e) {
                return await socket.sendMessage(
                    sender,
                    { text: '❌ *Search failed:* ' + e.message },
                    { quoted: msg }
                );
            }

            if (!searchData.success || !searchData.results || !searchData.results.length) {
                return await socket.sendMessage(
                    sender,
                    { text: '❌ *No results for:* ' + query },
                    { quoted: msg }
                );
            }

            const results = searchData.results.slice(0, 12);
            let listText = '';
            for (let i = 0; i < results.length; i++) {
                listText += '*' + (i + 1) + '.* ' + results[i].title + '\n';
            }

            const searchMsg = await sendWithImage(
                socket,
                sender,
                msg,
                DEFAULT_IMG,
                '🎌 *AnimaHD Search*\n' +
                    '🔍 *' +
                    query +
                    '* — ' +
                    results.length +
                    ' results\n\n' +
                    listText +
                    '\n↩️ *Reply with number*\n\n> *VORTEX*'
            );

            const searchMsgId = searchMsg.key.id;

            const searchHandler = async ({ messages }) => {
                const reply = messages[0];
                if (!reply || !reply.message) return;

                const stanza =
                    reply.message.extendedTextMessage &&
                    reply.message.extendedTextMessage.contextInfo &&
                    reply.message.extendedTextMessage.contextInfo.stanzaId;
                if (stanza !== searchMsgId) return;

                const text = (
                    reply.message.conversation ||
                    (reply.message.extendedTextMessage &&
                        reply.message.extendedTextMessage.text) ||
                    ''
                ).trim();

                const num = parseInt(text);
                if (isNaN(num) || num < 1 || num > results.length) {
                    return await socket.sendMessage(
                        reply.key.remoteJid,
                        { text: '❌ *Invalid!* Enter 1 – ' + results.length },
                        { quoted: reply }
                    );
                }

                socket.ev.off('messages.upsert', searchHandler);
                const selected = results[num - 1];

                await socket.sendMessage(reply.key.remoteJid, {
                    react: { text: '⏳', key: reply.key }
                });

                await handleDetail(
                    socket,
                    reply.key.remoteJid,
                    reply,
                    selected.link,
                    selected.title
                );
            };

            socket.ev.on('messages.upsert', searchHandler);
            setTimeout(function () {
                socket.ev.off('messages.upsert', searchHandler);
            }, 5 * 60 * 1000);
        } catch (err) {
            console.error('AHD plugin error:', err.message);
            await socket.sendMessage(sender, {
                react: { text: '❌', key: msg.key }
            });
            await socket.sendMessage(
                sender,
                { text: '❌ *Error:* ' + err.message },
                { quoted: msg }
            );
        }
    }
};
