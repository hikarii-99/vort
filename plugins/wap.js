const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const BASE = 'https://ratedwap.com';
const DEFAULT_IMG = 'https://u.pone.rs/gvtwfxjd.jpg';

const TEMP_DIR = path.join(__dirname, 'temp_wap');
if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR);
}

const UA =
    'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

function abs(href) {
    if (!href) return null;
    if (/^https?:\/\//i.test(href)) return href;
    if (href.startsWith('/')) return BASE + href;
    return BASE + '/' + href;
}

async function fetchHtml(url) {
    const { data } = await axios.get(url, {
        timeout: 30000,
        headers: {
            'User-Agent': UA,
            Accept: 'text/html,application/xhtml+xml',
            'Accept-Language': 'en-US,en;q=0.9',
            Referer: BASE + '/'
        }
    });
    return cheerio.load(data);
}

async function doSearch(q) {
    const $ = await fetchHtml(
        BASE + '/cms/searchTV.php?q=' + encodeURIComponent(q)
    );
    const results = [];
    const seen = {};

    $('ul[data-role="listview"] li a[href]').each((_, el) => {
        let href = abs(($(el).attr('href') || '').trim());
        if (!href || href === BASE + '/' || seen[href]) return;

        const title =
            $(el).find('h3').text().replace(/\s+/g, ' ').trim() ||
            $(el).text().replace(/\s+/g, ' ').trim();
        if (!title) return;

        seen[href] = true;
        results.push({ title: title, link: href });
    });

    return results;
}

async function doDetail(pageUrl) {
    const $ = await fetchHtml(pageUrl);

    let title =
        $('div[data-role="content"] p[align="center"] b').first().text().trim() ||
        $('title')
            .text()
            .replace(/Downloads.*/i, '')
            .replace(/::.*/g, '')
            .trim();

    let image = $(
        'div[data-role="content"] img[src*="sub_thumb"], div[data-role="content"] img[alt="Screen"], div[data-role="content"] img'
    )
        .first()
        .attr('src');
    image = abs(image);

    const contentText = $('div[data-role="content"]').text();
    const info = {};
    const g = contentText.match(/Genre:\s*([^\n]+)/i);
    const e = contentText.match(/Episodes:\s*(\d+)/i);
    const y = contentText.match(/Release date:\s*(\d{4})/i);
    const len = contentText.match(/Length:\s*([^\n]+)/i);
    if (g) info.genre = g[1].trim();
    if (e) info.episodes = e[1].trim();
    if (y) info.year = y[1].trim();
    if (len) info.length = len[1].trim();

    const seasons = [];
    const folders = [];
    const files = [];
    const seen = {};

    $('ul[data-role="listview"] li a[href]').each((_, el) => {
        let href = ($(el).attr('href') || '').trim();
        const name = $(el).text().replace(/\s+/g, ' ').trim();
        if (!href || !name) return;
        href = abs(href);
        if (seen[href]) return;

        // Skip sort links
        if (/New to Old|Old to New/i.test(name)) return;

        // Series seasons
        const isSeason =
            /season/i.test(name) ||
            /\/Season[-_]?\d+/i.test(href) ||
            /\/\d+\/Season/i.test(href);

        if (isSeason) {
            seen[href] = true;
            const numMatch =
                name.match(/(\d+)/) || href.match(/Season[-_]?(\d+)/i);
            seasons.push({
                name: name,
                number: numMatch ? parseInt(numMatch[1], 10) : null,
                link: href
            });
            return;
        }

        // Movie quality folders: /new/1/27403/Full-HD-Movie/
        const isFolder =
            /\/new\/\d+\/\d+\/[^/]+\/?$/i.test(href.replace(BASE, '')) ||
            /Full[- ]?HD/i.test(name) ||
            /\b(720p|1080p|480p|360p|HD|CAM|TS|Bluray|WEB)\b/i.test(name);

        if (isFolder) {
            seen[href] = true;
            folders.push({ name: name, link: href });
            return;
        }

        // Direct file pages
        const isFile =
            /\.mp4\.html/i.test(href) ||
            (/\/\d+\/Downloads\//i.test(href) &&
                !/\/Downloads\/(movie|Movie|Anime|TV)/i.test(href));

        if (isFile) {
            seen[href] = true;
            const ps = $(el).find('p');
            let size = null;
            let fileName = name;
            if (ps.length >= 2) {
                fileName = $(ps[0]).text().replace(/\s+/g, ' ').trim() || name;
                size = $(ps[1]).text().replace(/\s+/g, ' ').trim();
            }
            files.push({ name: fileName, size: size, link: href });
        }
    });

    seasons.sort(function (a, b) {
        if (a.number == null && b.number == null) return 0;
        if (a.number == null) return 1;
        if (b.number == null) return -1;
        return a.number - b.number;
    });

    return {
        title: title,
        image: image,
        info: info,
        seasons: seasons,
        folders: folders,
        files: files
    };
}

function parseEpisodes($) {
    const episodes = [];
    const seen = {};

    $('ul[data-role="listview"] li a[href]').each((_, el) => {
        const href = abs(($(el).attr('href') || '').trim());
        if (!href || seen[href]) return;
        if (!/Downloads/i.test(href) && !/\.mp4\.html/i.test(href)) return;

        const ps = $(el).find('p');
        let name = '';
        let size = '';
        if (ps.length >= 2) {
            name = $(ps[0]).text().replace(/\s+/g, ' ').trim();
            size = $(ps[1]).text().replace(/\s+/g, ' ').trim();
        } else {
            name = $(el).text().replace(/\s+/g, ' ').trim();
        }
        if (!name) return;
        seen[href] = true;

        const epMatch =
            name.match(/S\d+E(\d+)/i) ||
            name.match(/E(\d+)/i) ||
            name.match(/Episode\s*(\d+)/i);

        episodes.push({
            name: name,
            size: size || null,
            episode: epMatch ? parseInt(epMatch[1], 10) : null,
            link: href
        });
    });

    return episodes;
}

function getNextPageUrl($, currentUrl) {
    let next = $('.pagination-container a.pagination-link')
        .filter((_, el) => /next/i.test($(el).text()))
        .first()
        .attr('href');
    if (next) return abs(next);

    const m = currentUrl.match(/\/new\/(\d+)\//);
    const cur = m ? parseInt(m[1], 10) : 1;
    let best = null;
    let bestNum = cur;

    $('.pagination-container a.pagination-link').each((_, el) => {
        const n = parseInt($(el).text().trim(), 10);
        if (!isNaN(n) && n > bestNum) {
            bestNum = n;
            best = $(el).attr('href');
        }
    });
    return best ? abs(best) : null;
}

async function doEpisodes(listUrl) {
    let url = listUrl;
    let page = 0;
    const all = [];
    const seen = {};
    const pagesVisited = {};

    while (url && page < 15) {
        if (pagesVisited[url]) break;
        pagesVisited[url] = true;
        page++;

        const $ = await fetchHtml(url);
        const eps = parseEpisodes($);
        for (let i = 0; i < eps.length; i++) {
            if (seen[eps[i].link]) continue;
            seen[eps[i].link] = true;
            all.push(eps[i]);
        }

        const next = getNextPageUrl($, url);
        if (!next || next === url) break;
        url = next;
    }

    all.sort(function (a, b) {
        if (a.episode != null && b.episode != null) return a.episode - b.episode;
        return 0;
    });

    return all;
}

async function doDirect(episodeUrl) {
    const $ = await fetchHtml(episodeUrl);

    let title =
        $('div[data-role="content"] p[align="center"] b')
            .first()
            .text()
            .replace(/\s*Download\s*$/i, '')
            .replace(/\s+/g, ' ')
            .trim() || null;

    let fileName = null;
    let fileSize = null;
    $('ul[data-role="listview"] li').each((_, el) => {
        const t = $(el).text().replace(/\s+/g, ' ').trim();
        const fn = t.match(/File Name:\s*(.+)/i);
        const fs = t.match(/File Size:\s*(.+)/i);
        if (fn) fileName = fn[1].trim();
        if (fs) fileSize = fs[1].trim();
    });

    let direct =
        $('video source[src]').attr('src') ||
        $('video').attr('src') ||
        null;

    if (!direct) {
        $('a[href*=".mp4"]').each((_, el) => {
            const h = $(el).attr('href') || '';
            if (/^https?:\/\//i.test(h) && /\.mp4/i.test(h)) direct = h;
        });
    }

    return {
        title: title || fileName,
        fileName: fileName,
        fileSize: fileSize,
        direct: direct
    };
}

async function downloadToFile(url, destPath) {
    const response = await axios({
        url: url,
        method: 'GET',
        responseType: 'stream',
        timeout: 600000,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        headers: {
            'User-Agent': UA,
            Referer: BASE + '/',
            Accept: '*/*'
        }
    });

    const writer = fs.createWriteStream(destPath);
    response.data.pipe(writer);

    await new Promise(function (resolve, reject) {
        writer.on('finish', resolve);
        writer.on('error', reject);
    });

    const stats = fs.statSync(destPath);
    if (stats.size < 50 * 1024) {
        try {
            fs.unlinkSync(destPath);
        } catch (e) {}
        throw new Error('File too small / incomplete');
    }
    return stats.size;
}

function formatBytes(n) {
    if (!n) return '';
    if (n >= 1073741824) return (n / 1073741824).toFixed(2) + ' GB';
    if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
    return '';
}

async function sendWithImage(socket, jid, quoted, imageUrl, caption) {
    const img = imageUrl || DEFAULT_IMG;
    try {
        return await socket.sendMessage(
            jid,
            { image: { url: img }, caption: caption },
            { quoted: quoted }
        );
    } catch (e) {
        return await socket.sendMessage(jid, { text: caption }, { quoted: quoted });
    }
}

module.exports = {
    command: ['wap', 'rated', 'rwap'],
    description: 'Search & Download RatedWAP (Movies + Series)',

    handler: async ({ socket, msg, sender, args, prefix }) => {
        try {
            const query = args.join(' ').trim();

            if (!query) {
                return await socket.sendMessage(
                    sender,
                    {
                        text:
                            '📺 *VORTEX | RatedWAP*\n\n' +
                            '*Usage:*\n' +
                            prefix +
                            'wap <name>\n\n' +
                            '*Examples:*\n' +
                            prefix +
                            'wap moana\n' +
                            prefix +
                            'wap jujutsu kaisen\n\n' +
                            '> *Powered by VORTEX*'
                    },
                    { quoted: msg }
                );
            }

            if (
                /ratedwap\.com|newtoxic\.com/i.test(query) &&
                /\.mp4\.html/i.test(query)
            ) {
                await socket.sendMessage(sender, {
                    react: { text: '⏳', key: msg.key }
                });
                return await sendEpisodeFile(socket, sender, msg, query, null);
            }

            await socket.sendMessage(sender, {
                react: { text: '🔍', key: msg.key }
            });

            let results;
            try {
                results = await doSearch(query);
            } catch (e) {
                return await socket.sendMessage(
                    sender,
                    {
                        text:
                            '❌ *Search failed:* ' +
                            e.message +
                            '\n\nIf 403, set BASE = https://newtoxic.com'
                    },
                    { quoted: msg }
                );
            }

            if (!results.length) {
                return await socket.sendMessage(
                    sender,
                    { text: '❌ *No results for:* ' + query },
                    { quoted: msg }
                );
            }

            results = results.slice(0, 12);
            let listText = '';
            for (let i = 0; i < results.length; i++) {
                listText += '*' + (i + 1) + '.* ' + results[i].title + '\n';
            }

            const searchMsg = await sendWithImage(
                socket,
                sender,
                msg,
                DEFAULT_IMG,
                '📺 *RatedWAP Search*\n' +
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
            console.error('WAP plugin error:', err.message);
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

async function handleDetail(socket, jid, quoted, detailUrl, fallbackTitle) {
    let detail;
    try {
        detail = await doDetail(detailUrl);
    } catch (e) {
        return await socket.sendMessage(
            jid,
            { text: '❌ *Detail failed:* ' + e.message },
            { quoted: quoted }
        );
    }

    const title = detail.title || fallbackTitle || 'Title';
    const seasons = detail.seasons || [];
    const folders = detail.folders || [];
    const files = detail.files || [];
    const thumb =
        detail.image && /^https?:\/\//i.test(detail.image)
            ? detail.image
            : DEFAULT_IMG;

    // ── 1) SERIES: seasons ──
    if (seasons.length) {
        let text = '📺 *' + title + '*\n';
        if (detail.info.year) text += '📅 ' + detail.info.year + '\n';
        if (detail.info.episodes) text += '🎞️ Episodes: ' + detail.info.episodes + '\n';
        text += '\n📂 *Select season:*\n\n';
        for (let i = 0; i < seasons.length; i++) {
            text += '*' + (i + 1) + '.* ' + seasons[i].name + '\n';
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
            if (isNaN(num) || num < 1 || num > seasons.length) {
                return await socket.sendMessage(
                    jid,
                    { text: '❌ *Invalid!* Enter 1 – ' + seasons.length },
                    { quoted: reply }
                );
            }

            socket.ev.off('messages.upsert', seasonHandler);
            const selected = seasons[num - 1];

            await socket.sendMessage(jid, {
                react: { text: '⏳', key: reply.key }
            });

            await handleEpisodes(
                socket,
                jid,
                reply,
                selected.link,
                title,
                selected.name
            );
        };

        socket.ev.on('messages.upsert', seasonHandler);
        setTimeout(function () {
            socket.ev.off('messages.upsert', seasonHandler);
        }, 5 * 60 * 1000);
        return;
    }

    // ── 2) MOVIE: quality folders (Full HD Movie, ...) ──
    if (folders.length) {
        let text = '🎬 *' + title + '*\n';
        if (detail.info.year) text += '📅 ' + detail.info.year + '\n';
        if (detail.info.length) text += '⏱ ' + detail.info.length + '\n';
        text += '\n📁 *Select quality:*\n\n';

        for (let i = 0; i < folders.length; i++) {
            text += '*' + (i + 1) + '.* ' + folders[i].name + '\n';
        }
        text += '\n↩️ *Reply with number*\n\n> *VORTEX*';

        const folderMsg = await sendWithImage(socket, jid, quoted, thumb, text);
        const folderMsgId = folderMsg.key.id;

        const folderHandler = async ({ messages }) => {
            const reply = messages[0];
            if (!reply || !reply.message) return;

            const stanza =
                reply.message.extendedTextMessage &&
                reply.message.extendedTextMessage.contextInfo &&
                reply.message.extendedTextMessage.contextInfo.stanzaId;
            if (stanza !== folderMsgId) return;

            const textIn = (
                reply.message.conversation ||
                (reply.message.extendedTextMessage &&
                    reply.message.extendedTextMessage.text) ||
                ''
            ).trim();

            const num = parseInt(textIn);
            if (isNaN(num) || num < 1 || num > folders.length) {
                return await socket.sendMessage(
                    jid,
                    { text: '❌ *Invalid!* Enter 1 – ' + folders.length },
                    { quoted: reply }
                );
            }

            socket.ev.off('messages.upsert', folderHandler);
            const selected = folders[num - 1];

            await socket.sendMessage(jid, {
                react: { text: '⏳', key: reply.key }
            });

            await handleEpisodes(
                socket,
                jid,
                reply,
                selected.link,
                title,
                selected.name
            );
        };

        socket.ev.on('messages.upsert', folderHandler);
        setTimeout(function () {
            socket.ev.off('messages.upsert', folderHandler);
        }, 5 * 60 * 1000);
        return;
    }

    // ── 3) Direct files on detail page ──
    if (files.length) {
        let text = '🎬 *' + title + '*\n';
        if (detail.info.year) text += '📅 ' + detail.info.year + '\n';
        text += '\n⬇️ *Select file:*\n\n';

        for (let i = 0; i < files.length; i++) {
            text += '*' + (i + 1) + '.* ' + files[i].name;
            if (files[i].size) text += '\n   📦 ' + files[i].size;
            text += '\n';
        }
        text += '\n↩️ *Reply with number*\n\n> *VORTEX*';

        const fileMsg = await sendWithImage(socket, jid, quoted, thumb, text);
        const fileMsgId = fileMsg.key.id;

        const fileHandler = async ({ messages }) => {
            const reply = messages[0];
            if (!reply || !reply.message) return;

            const stanza =
                reply.message.extendedTextMessage &&
                reply.message.extendedTextMessage.contextInfo &&
                reply.message.extendedTextMessage.contextInfo.stanzaId;
            if (stanza !== fileMsgId) return;

            const textIn = (
                reply.message.conversation ||
                (reply.message.extendedTextMessage &&
                    reply.message.extendedTextMessage.text) ||
                ''
            ).trim();

            const num = parseInt(textIn);
            if (isNaN(num) || num < 1 || num > files.length) {
                return await socket.sendMessage(
                    jid,
                    { text: '❌ *Invalid!* Enter 1 – ' + files.length },
                    { quoted: reply }
                );
            }

            socket.ev.off('messages.upsert', fileHandler);
            const selected = files[num - 1];

            await socket.sendMessage(jid, {
                react: { text: '⏳', key: reply.key }
            });

            await sendEpisodeFile(
                socket,
                jid,
                reply,
                selected.link,
                selected.name
            );
        };

        socket.ev.on('messages.upsert', fileHandler);
        setTimeout(function () {
            socket.ev.off('messages.upsert', fileHandler);
        }, 10 * 60 * 1000);
        return;
    }

    // ── empty ──
    await sendWithImage(
        socket,
        jid,
        quoted,
        thumb,
        '📺 *' +
            title +
            '*\n\n⚠️ No seasons, folders or files found.\n🔗 ' +
            detailUrl +
            '\n\n> *VORTEX*'
    );
}

async function handleEpisodes(socket, jid, quoted, listUrl, showTitle, listName) {
    let episodes;
    try {
        episodes = await doEpisodes(listUrl);
    } catch (e) {
        return await socket.sendMessage(
            jid,
            { text: '❌ *List failed:* ' + e.message },
            { quoted: quoted }
        );
    }

    if (!episodes.length) {
        return await socket.sendMessage(
            jid,
            { text: '❌ *No files found in:* ' + listName },
            { quoted: quoted }
        );
    }

    const maxShow = 30;
    const list = episodes.slice(0, maxShow);

    let text =
        '📺 *' +
        showTitle +
        '*\n📁 ' +
        listName +
        ' — ' +
        episodes.length +
        ' file(s)\n\n';

    for (let i = 0; i < list.length; i++) {
        const ep = list[i];
        const label =
            ep.episode != null
                ? 'E' + String(ep.episode).padStart(2, '0')
                : String(i + 1);
        text += '*' + (i + 1) + '.* ' + label;
        if (ep.name && ep.episode != null) {
            // keep short
        } else if (ep.name) {
            text += ' ' + ep.name.slice(0, 40);
        }
        if (ep.size) text += ' | ' + ep.size;
        text += '\n';
    }

    if (episodes.length > maxShow) {
        text += '\n_...+' + (episodes.length - maxShow) + ' more_\n';
    }

    text += '\n↩️ *Reply with number*\n\n> *VORTEX*';

    const epMsg = await sendWithImage(socket, jid, quoted, DEFAULT_IMG, text);
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

        await socket.sendMessage(jid, {
            react: { text: '⏳', key: reply.key }
        });

        await sendEpisodeFile(socket, jid, reply, selected.link, selected.name);
    };

    socket.ev.on('messages.upsert', epHandler);
    setTimeout(function () {
        socket.ev.off('messages.upsert', epHandler);
    }, 10 * 60 * 1000);
}

async function sendEpisodeFile(socket, jid, quoted, episodePageUrl, fallbackName) {
    let dl;
    try {
        dl = await doDirect(episodePageUrl);
    } catch (e) {
        return await socket.sendMessage(
            jid,
            { text: '❌ *Extract failed:* ' + e.message },
            { quoted: quoted }
        );
    }

    if (!dl.direct) {
        return await socket.sendMessage(
            jid,
            { text: '❌ *No direct link found*' },
            { quoted: quoted }
        );
    }

    const title = dl.title || fallbackName || 'Video';
    const sizeText = dl.fileSize || '';
    const direct = dl.direct;

    const safeName = String(title)
        .replace(/[^a-zA-Z0-9._\s-]/g, '')
        .replace(/\s+/g, '_')
        .slice(0, 80);
    const fileName = safeName + (/\.mp4$/i.test(safeName) ? '' : '.mp4');
    const tempPath = path.join(TEMP_DIR, fileName);

    try {
        await socket.sendMessage(
            jid,
            {
                text:
                    '⬇️ *Downloading...*\n🎬 ' +
                    title +
                    '\n' +
                    (sizeText ? '📦 ' + sizeText + '\n' : '') +
                    '\nPlease wait...'
            },
            { quoted: quoted }
        );

        await downloadToFile(direct, tempPath);
        const realSize = formatBytes(fs.statSync(tempPath).size);

        await socket.sendMessage(
            jid,
            {
                document: { url: tempPath },
                mimetype: 'video/mp4',
                fileName: fileName,
                caption:
                    '📺 *' +
                    title +
                    '*\n' +
                    (realSize ? '📦 ' + realSize + '\n' : '') +
                    '\n> *VORTEX | RatedWAP*'
            },
            { quoted: quoted }
        );

        await socket.sendMessage(jid, {
            react: { text: '✅', key: quoted.key }
        });
    } catch (err) {
        console.error('WAP send error:', err.message);
        await socket.sendMessage(
            jid,
            {
                text:
                    '❌ *Send failed:* ' +
                    err.message +
                    '\n\n⬇️ *Direct link:*\n' +
                    direct
            },
            { quoted: quoted }
        );
    } finally {
        try {
            if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
        } catch (e) {}
    }
}