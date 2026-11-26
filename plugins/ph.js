const axios = require('axios');

const API = 'https://ph-vortex.vercel.app';
const DEFAULT_THUMB = 'https://u.pone.rs/iyhqahtk.jpg';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function apiGet(params) {
    const { data } = await axios.get(API + '/', {
        params: params,
        timeout: 30000
    });
    return data;
}

function makeToken() {
    return Buffer.from(JSON.stringify(['', '', '', ''])).toString('base64');
}

function formatSize(bytes) {
    if (!bytes) return '';
    const n = Number(bytes);
    if (n >= 1073741824) return (n / 1073741824).toFixed(2) + ' GB';
    if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
    return '';
}

function formatDuration(sec) {
    if (!sec || isNaN(sec)) return '';
    const s = Math.floor(Number(sec));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const r = s % 60;
    if (h > 0) {
        return h + ':' + String(m).padStart(2, '0') + ':' + String(r).padStart(2, '0');
    }
    return m + ':' + String(r).padStart(2, '0');
}

function isSafeImage(url) {
    if (!url) return false;
    if (/downixcdn\.com/i.test(url)) return false;
    return /^https?:\/\//i.test(url);
}

async function sendSafeImage(socket, jid, quoted, imageUrl, caption) {
    if (isSafeImage(imageUrl)) {
        try {
            return await socket.sendMessage(jid, {
                image: { url: imageUrl },
                caption: caption
            }, { quoted: quoted });
        } catch (e) {
            console.log('Image fail:', e.message);
        }
    }
    return await socket.sendMessage(jid, {
        text: caption
    }, { quoted: quoted });
}

async function extractDirect(videoUrl) {
    const { data, status } = await axios.post(
        'https://ph-api.com/extract',
        {
            url: videoUrl,
            turnstileToken: makeToken()
        },
        {
            timeout: 30000,
            headers: {
                'Content-Type': 'application/json',
                Origin: 'https://downix.org',
                Referer: 'https://downix.org/',
                'User-Agent': UA
            },
            validateStatus: function () {
                return true;
            }
        }
    );

    if (data && data.error_code) {
        throw new Error('API ' + data.error_code);
    }
    if (status >= 400) {
        throw new Error('HTTP ' + status);
    }
    if (!data || !data.videos) {
        throw new Error('No videos in response');
    }
    return data;
}

async function sendDownload(socket, jid, quoted, videoUrl, searchThumb) {
    let raw;
    try {
        raw = await extractDirect(videoUrl);
    } catch (e) {
        return await socket.sendMessage(jid, {
            text: '❌ *Extract failed:* ' + e.message
        }, { quoted: quoted });
    }

    const title = raw.title || 'Video';
    const duration = formatDuration(raw.duration);

    // Download / Quality select menu එකට Thumbnail එක (Direct link එකක් දුන්නොත් DEFAULT_THUMB එක ගනී)
    const thumb = isSafeImage(searchThumb) ? searchThumb : DEFAULT_THUMB;

    const downloads = [];
    const list = Array.isArray(raw.videos) ? raw.videos : [];
    for (let i = 0; i < list.length; i++) {
        const v = list[i];
        if (!v || !v.download_link) continue;
        downloads.push({
            quality: v.quality ? String(v.quality) + 'p' : 'default',
            size: v.file_size || null,
            sizeText: formatSize(v.file_size),
            url: v.download_link
        });
    }

    if (!downloads.length) {
        return await socket.sendMessage(jid, {
            text: '❌ *No download links*\n\n🎬 ' + title
        }, { quoted: quoted });
    }

    let text = '🔥 *' + title + '*\n';
    if (duration) text += '⏱ ' + duration + '\n';
    text += '\n⬇️ *Select quality:*\n\n';

    for (let i = 0; i < downloads.length; i++) {
        const d = downloads[i];
        const size = d.sizeText || '';
        text += '*' + (i + 1) + '.* ' + d.quality;
        if (size) text += ' | ' + size;
        text += '\n';
    }

    text += '\n↩️ *Reply with number*\n';
    text += '📦 Sent as document (up to \~2GB)\n\n> *VORTEX*';

    const qualMsg = await sendSafeImage(socket, jid, quoted, thumb, text);
    const qualMsgId = qualMsg.key.id;

    const qualityHandler = async ({ messages }) => {
        const qReply = messages[0];
        if (!qReply || !qReply.message) return;

        const stanza =
            qReply.message.extendedTextMessage &&
            qReply.message.extendedTextMessage.contextInfo &&
            qReply.message.extendedTextMessage.contextInfo.stanzaId;

        if (stanza !== qualMsgId) return;

        const qText = (
            qReply.message.conversation ||
            (qReply.message.extendedTextMessage &&
                qReply.message.extendedTextMessage.text) ||
            ''
        ).trim();

        const qNum = parseInt(qText);
        if (isNaN(qNum) || qNum < 1 || qNum > downloads.length) {
            return await socket.sendMessage(jid, {
                text: '❌ *Invalid!* Enter 1 – ' + downloads.length
            }, { quoted: qReply });
        }

        socket.ev.off('messages.upsert', qualityHandler);

        const selected = downloads[qNum - 1];
        const size = selected.sizeText || formatSize(selected.size) || '';
        const quality = selected.quality || 'video';

        const MAX_BYTES = 1900 * 1024 * 1024;
        if (selected.size && selected.size > MAX_BYTES) {
            return await socket.sendMessage(jid, {
                text:
                    '⚠️ *File too large for server*\n' +
                    '📦 ' + quality + (size ? ' | ' + size : '') + '\n' +
                    'Pick a lower quality.'
            }, { quoted: qReply });
        }

        const safeName = String(title)
            .replace(/[^a-zA-Z0-9._\s-]/g, '')
            .replace(/\s+/g, '_')
            .slice(0, 60);
        const fileName = safeName + '_' + quality + '.mp4';

        try {
            await socket.sendMessage(jid, {
                react: { text: '⬇️', key: qReply.key }
            });

            // Direct URL Stream (Storage එකට Download නොකර කෙලින්ම යවයි)
            await socket.sendMessage(jid, {
                document: { url: selected.url },
                mimetype: 'video/mp4',
                fileName: fileName,
                caption:
                    '🔥 *' + title + '*\n' +
                    '📦 ' + quality + (size ? ' | ' + size : '') + '\n\n> *VORTEX*'
            }, { quoted: qReply });

            await socket.sendMessage(jid, {
                react: { text: '✅', key: qReply.key }
            });
        } catch (err) {
            console.error('PH send error:', err.message);
            await socket.sendMessage(jid, {
                react: { text: '❌', key: qReply.key }
            });
            await socket.sendMessage(jid, {
                text: '❌ *Send failed:* ' + err.message
            }, { quoted: qReply });
        }
    };

    socket.ev.on('messages.upsert', qualityHandler);
    setTimeout(function () {
        socket.ev.off('messages.upsert', qualityHandler);
    }, 20 * 60 * 1000);
}

module.exports = {
    command: ['ph', 'porn', 'phub'],
    description: 'Search & Download from Pornhub',

    handler: async ({ socket, msg, sender, args, prefix }) => {
        try {
            const query = args.join(' ').trim();

            if (!query) {
                return await socket.sendMessage(sender, {
                    text:
                        '🔥 *VORTEX | PH Downloader*\n\n' +
                        '*Usage:*\n' +
                        prefix + 'ph <search>\n' +
                        prefix + 'ph <pornhub url>\n\n' +
                        '*Examples:*\n' +
                        prefix + 'ph step sis\n' +
                        prefix + 'ph https://www.pornhub.com/view_video.php?viewkey=XXXX\n\n' +
                        '> *Powered by VORTEX*'
                }, { quoted: msg });
            }

            // Direct link දුන්නොත් searchThumb එක null වෙනුවට DEFAULT_THUMB එක පාස් වේ
            if (/pornhub\.(com|org)/i.test(query)) {
                await socket.sendMessage(sender, {
                    react: { text: '⏳', key: msg.key }
                });
                return await sendDownload(socket, sender, msg, query, DEFAULT_THUMB);
            }

            await socket.sendMessage(sender, {
                react: { text: '🔍', key: msg.key }
            });

            let searchData;
            try {
                searchData = await apiGet({ search: query });
            } catch (e) {
                return await socket.sendMessage(sender, {
                    text: '❌ *Search failed:* ' + e.message
                }, { quoted: msg });
            }

            if (!searchData.success || !searchData.results || !searchData.results.length) {
                return await socket.sendMessage(sender, {
                    text: '❌ *No results for:* ' + query
                }, { quoted: msg });
            }

            const results = searchData.results.slice(0, 10);
            let listText = '';
            for (let i = 0; i < results.length; i++) {
                const r = results[i];
                listText += '*' + (i + 1) + '.* ' + r.title + '\n';
                listText += '   ⏱ ' + (r.duration || '-') + '\n\n';
            }

            const caption =
                '🔥 *PH Search*\n' +
                '🔍 *' + query + '* — ' + results.length + ' results\n\n' +
                listText +
                '↩️ *Reply with number*\n\n> *VORTEX*';

            const searchThumb =
                results[0] && results[0].image ? results[0].image : null;

            const sentMsg = await sendSafeImage(
                socket,
                sender,
                msg,
                searchThumb,
                caption
            );
            const searchMsgId = sentMsg.key.id;

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
                    return await socket.sendMessage(reply.key.remoteJid, {
                        text: '❌ *Invalid!* Enter 1 – ' + results.length
                    }, { quoted: reply });
                }

                socket.ev.off('messages.upsert', searchHandler);
                const selected = results[num - 1];

                await socket.sendMessage(reply.key.remoteJid, {
                    react: { text: '⏳', key: reply.key }
                });

                await sendDownload(
                    socket,
                    reply.key.remoteJid,
                    reply,
                    selected.link,
                    selected.image || null
                );
            };

            socket.ev.on('messages.upsert', searchHandler);
            setTimeout(function () {
                socket.ev.off('messages.upsert', searchHandler);
            }, 5 * 60 * 1000);
        } catch (err) {
            console.error('PH plugin error:', err.message);
            await socket.sendMessage(sender, {
                react: { text: '❌', key: msg.key }
            });
            await socket.sendMessage(sender, {
                text: '❌ *Error:* ' + err.message
            }, { quoted: msg });
        }
    }
};
