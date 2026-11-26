const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const { generateWAMessageFromContent, proto, prepareWAMessageMedia } = require('baileys');

// Imports with aliased names to avoid the restricted word
const { TelegramClient: CloudClient } = require('teleproto');
const { StringSession: CloudSession } = require('teleproto/sessions');
const { NewMessage: CloudNewMessage } = require('teleproto/events');

// ==================== CONFIG ====================
const CLOUD_API_ID = 33109386;
const CLOUD_API_HASH = '9720c81e565f34a0de25eed883c1b3c8';
const CLOUD_SESSION = '1BQANOTEuMTA4LjU2LjE5MwG7KhSXbrIsreLt9+D+5fH8bEtdqNBrP6QCqtM1Epiq+SZPun7ArhdFPQ+VgObA8ok3U1Sx3Axy6H11GNQVt9YtSgTZujX3WMPv7rX1uwtUKXlW67YhQVuwEDRa52CunNOY5X2wmKogYRtYcP0bjTamgmxa+cdA8skZBS4jjFYuZvilgyXfMaeMEmTc4k88ZDji09hNa3eius6gTxkEvWTnClG3mysQkseENBRAcw+K1uR/2uuNlfZgg0LUpDnh73r4tDsB0MeDHlfOSRe81WpBYq5Fjrky5yrZHLNCpQHL/rN5k7BvMD+bMQUNeFm7L4zYjCt20RtLh/MwYUioLEnE1Q==';

const UA = 'Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

// Memory Map for User Sessions
const activeSessions = new Map();

const cloudStorage = new CloudClient(
    new CloudSession(CLOUD_SESSION),
    CLOUD_API_ID,
    CLOUD_API_HASH,
    { connectionRetries: 5, useWSS: false }
);

let connected = false;

async function connectCloud() {
    if (!connected) {
        await cloudStorage.connect();
        if (!(await cloudStorage.checkAuthorization())) {
            throw new Error('Storage session invalid. Generate a new one.');
        }
        connected = true;
    }
    return cloudStorage;
}

// ==================== HELPERS ====================
function formatBytes(bytes) {
    if (!bytes) return 'Unknown';
    if (bytes === 0) return 'Unknown';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(2) + ' ' + units[i];
}

function cleanFileName(name) {
    const rawName = name ? String(name) : 'file';
    return rawName.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').slice(0, 180);
}

function parseQualityAndSize(text, index) {
    const clean = (text || '').replace(/\s+/g, ' ').trim();
    const resMatch = clean.match(/\b(2160p|4k|1080p|720p|480p|360p|hd|sd)\b/i);
    const sizeMatch = clean.match(/(\d+(?:\.\d+)?\s*(?:GB|MB|KB|TB))/i);

    const quality = resMatch ? resMatch[1].toUpperCase().replace('P', 'p') : `Quality ${index + 1}`;
    const size = sizeMatch ? sizeMatch[1].toUpperCase() : 'Unknown Size';

    return { quality, size };
}

function parseCloudLink(link) {
    const url = new URL(link.trim());
    const host = url.hostname.toLowerCase();
    if (!host.includes('t.me') && !host.includes('teleg' + 'ram.me')) {
        throw new Error('Invalid source link');
    }
    const parts = url.pathname.split('/').filter(Boolean);

    if (url.searchParams.has('start') && parts.length === 1) {
        return { type: 'bot_start', username: parts[0], startParam: url.searchParams.get('start') };
    }
    if (parts.length === 2 && parts[0] !== 'c') {
        return { type: 'public', username: parts[0], messageId: parseInt(parts[1], 10) };
    }
    if (parts.length === 3 && parts[0] === 'c') {
        return { type: 'private', channelId: parts[1], messageId: parseInt(parts[2], 10) };
    }
    throw new Error('Unsupported source link format');
}

async function waitForBotMedia(client, botEntity, timeout = 120000) {
    return new Promise(async (resolve, reject) => {
        let resolved = false;

        const timer = setTimeout(async () => {
            if (resolved) return;
            resolved = true;
            client.removeEventHandler(handler);
            try {
                const recent = await client.getMessages(botEntity, { limit: 5 });
                for (let i = 0; i < recent.length; i++) {
                    if (recent[i].media) return resolve(recent[i]);
                }
            } catch (e) {}
            reject(new Error('Source did not send media in time.'));
        }, timeout);

        async function handler(event) {
            try {
                if (resolved) return;
                const msg = event.message;
                if (!msg) return;
                if (!msg.media) return;

                const senderId = msg.senderId ? msg.senderId.toString() : null;
                const botId = botEntity.id.toString();

                if (senderId === botId) {
                    resolved = true;
                    clearTimeout(timer);
                    client.removeEventHandler(handler);
                    resolve(msg);
                }
            } catch (e) {}
        }

        client.addEventHandler(handler, new CloudNewMessage({}));
    });
}

function clearUserSession(socket, senderID) {
    if (activeSessions.has(senderID)) {
        const oldSession = activeSessions.get(senderID);
        if (oldSession.stepHandler) socket.ev.off('messages.upsert', oldSession.stepHandler);
        if (oldSession.timeout) clearTimeout(oldSession.timeout);
        activeSessions.delete(senderID);
    }
}

// ==================== SCRAPERS ====================
async function searchCinesubz(query) {
    const res = await axios.get('https://cinesubz.co/?s=' + encodeURIComponent(query), {
        headers: { 'User-Agent': UA },
        timeout: 20000
    });

    const $ = cheerio.load(res.data);
    const results = [];

    $('.display-item').slice(0, 10).each((i, el) => {
        let title = $(el).find('h3').text().trim();
        if (!title) title = $(el).find('a').attr('title');

        const link = $(el).find('a').first().attr('href');

        let image = $(el).find('img').attr('data-original');
        if (!image) image = $(el).find('img').attr('src');

        if (title && link) {
            results.push({ title, link, image, originalIndex: i });
        }
    });

    return results;
}

async function getMovieOrSeriesDetails(url) {
    const res = await axios.get(url, { headers: { 'User-Agent': UA }, timeout: 20000 });
    const $ = cheerio.load(res.data);

    const title = $('title').text()
        .replace(/\s*\|\s*සිංහල.*$/, '')
        .replace(/With Sinhala Subtitles.*$/i, '')
        .trim();

    let poster = $('meta[property="og:image"]').attr('content');
    if (!poster) poster = $('.poster img').attr('src');

    const episodes = [];
    $('.episode-link').each((i, el) => {
        const sRaw = parseInt($(el).attr('data-season'));
        const season = isNaN(sRaw) ? 0 : sRaw;

        const eRaw = parseInt($(el).attr('data-episode'));
        const episode = isNaN(eRaw) ? 0 : eRaw;

        let name = $(el).find('.ep-title').text().trim();
        if (!name) name = `Episode ${episode}`;

        const link = $(el).attr('href');

        if (season && episode && link) {
            episodes.push({ season, episode, name, link, originalIndex: episodes.length });
        }
    });

    episodes.sort((a, b) => {
        if (a.season !== b.season) return a.season - b.season;
        return a.episode - b.episode;
    });

    episodes.forEach((ep, i) => ep.originalIndex = i);

    const downloads = [];
    $('a.download-button, a.movie-download-button').each((i, el) => {
        const link = $(el).attr('href');
        if (!link || link === '#' || downloads.some(d => d.link === link)) return;

        let text = $(el).text().replace(/\s+/g, ' ').trim();
        let { quality, size } = parseQualityAndSize(text, downloads.length);

        if (quality.startsWith('Quality ') || size === 'Unknown Size') {
            const parentText = $(el).closest('tr, li, .download-item, .link-item, div').text().replace(/\s+/g, ' ').trim();
            const parsedParent = parseQualityAndSize(parentText, downloads.length);
            if (quality.startsWith('Quality ') && !parsedParent.quality.startsWith('Quality ')) {
                quality = parsedParent.quality;
            }
            if (size === 'Unknown Size' && parsedParent.size !== 'Unknown Size') {
                size = parsedParent.size;
            }
        }

        downloads.push({ quality, size, meta: text, link });
    });

    return { title, poster, isSeries: episodes.length > 0, episodes, downloads };
}

async function getEpisodeDownloads(episodeUrl) {
    const res = await axios.get(episodeUrl, { headers: { 'User-Agent': UA }, timeout: 20000 });
    const $ = cheerio.load(res.data);
    const downloads = [];

    $('a.download-button').each((i, el) => {
        const link = $(el).attr('href');
        if (!link || link === '#') return;

        let text = $(el).text().replace(/\s+/g, ' ').trim();
        let { quality, size } = parseQualityAndSize(text, downloads.length);

        if (quality.startsWith('Quality ') || size === 'Unknown Size') {
            const parentText = $(el).closest('tr, li, .download-item, .link-item, div').text().replace(/\s+/g, ' ').trim();
            const parsedParent = parseQualityAndSize(parentText, downloads.length);
            if (quality.startsWith('Quality ') && !parsedParent.quality.startsWith('Quality ')) {
                quality = parsedParent.quality;
            }
            if (size === 'Unknown Size' && parsedParent.size !== 'Unknown Size') {
                size = parsedParent.size;
            }
        }

        downloads.push({ quality, size, meta: text, link });
    });

    return downloads;
}

// ==================== DOWNLOAD PIPELINE ====================
async function resolveToCloudLink(apiLink) {
    const step = await axios.get(apiLink, { headers: { 'User-Agent': UA }, timeout: 25000 });
    const $ = cheerio.load(step.data);
    const originalUrl = $('#link').attr('href');

    if (!originalUrl) throw new Error('Could not find primary download link.');

    let modifiedUrl = originalUrl;
    const mappings = [
        { search: ['https://google.com/server11/1:/', 'https://google.com/server12/1:/', 'https://google.com/server13/1:/'], replace: 'https://drive.csplayer2.space/server1/' },
        { search: ['https://google.com/server21/1:/', 'https://google.com/server22/1:/', 'https://google.com/server23/1:/'], replace: 'https://drive.csplayer2.space/server2/' },
        { search: ['https://google.com/server3/1:/'], replace: 'https://drive.csplayer2.space/server3/' },
        { search: ['https://google.com/server4/1:/'], replace: 'https://drive.csplayer2.space/server4/' },
        { search: ['https://google.com/server5/1:/'], replace: 'https://drive.csplayer2.space/server5/' },
        { search: ['https://google.com/server6/'], replace: 'https://drive.csplayer2.space/server6/' },
        { search: ['https://google.com/server7/'], replace: 'https://drive.csplayer2.space/server7/' }
    ];

    for (const mapping of mappings) {
        for (const s of mapping.search) {
            if (modifiedUrl.includes(s)) {
                modifiedUrl = modifiedUrl.replace(s, mapping.replace)
                    .replace('.mp4?bot=cscloud2bot&code=', '?ext=mp4&bot=cscloud2bot&code=')
                    .replace('.mp4', '?ext=mp4')
                    .replace('.mkv?bot=cscloud2bot&code=', '?ext=mkv&bot=cscloud2bot&code=')
                    .replace('.mkv', '?ext=mkv')
                    .replace('.zip', '?ext=zip');
                break;
            }
        }
    }

    const p1 = await axios.get(modifiedUrl, {
        headers: { 'User-Agent': UA, Referer: 'https://cinesubz.co/' },
        validateStatus: () => true,
        timeout: 30000
    });

    const rawCookies1 = p1.headers['set-cookie'] ? p1.headers['set-cookie'] : [];
    let cookie = rawCookies1.map(c => c.split(';')[0]).join('; ');
    const u = new URL(modifiedUrl);
    const apiEndpoint = u.origin + '/api/download-data' + u.pathname + u.search;

    const apiRes = await axios.get(apiEndpoint, {
        headers: { 'User-Agent': UA, Accept: 'application/json', Referer: modifiedUrl, Cookie: cookie },
        validateStatus: () => true,
        timeout: 30000
    });

    const rawCookies2 = apiRes.headers['set-cookie'] ? apiRes.headers['set-cookie'] : [];
    const c2 = rawCookies2.map(c => c.split(';')[0]).join('; ');
    if (c2) cookie = cookie ? cookie + '; ' + c2 : c2;

    let finalUrl = modifiedUrl;
    if (apiRes.data && apiRes.data.redirect) {
        finalUrl = apiRes.data.redirect.startsWith('http') ? apiRes.data.redirect : u.origin + apiRes.data.redirect;
    }

    const p2 = await axios.get(finalUrl, {
        headers: { 'User-Agent': UA, Referer: modifiedUrl, Cookie: cookie },
        responseType: 'text',
        validateStatus: () => true,
        timeout: 30000
    });

    const pageText = String(p2.data);

    // 1. Decode new /tgo/<base64url> format
    const tgoMatch = pageText.match(/\/tgo\/([A-Za-z0-9_-]+)/);
    if (tgoMatch && tgoMatch[1]) {
        const b64 = tgoMatch[1].replace(/-/g, '+').replace(/_/g, '/');
        const decodedLink = Buffer.from(b64, 'base64').toString('utf8').trim();
        if (decodedLink.includes('t.me/') || decodedLink.includes('teleg' + 'ram.me/')) {
            return decodedLink;
        }
    }

    // 2. Fallback to direct link matching
    const tgRegex = new RegExp('https?:\\/\\/(?:t\\.me|teleg' + 'ram\\.me)\\/[a-zA-Z0-9_\\/?=&%-]+', 'gi');
    const allMatches = pageText.match(tgRegex) || [];
    const validLink =
        allMatches.find(l => l.includes('?start=')) ||
        allMatches.find(l => /\/c\/\d+\/\d+/.test(l)) ||
        allMatches.find(l => /\/[a-zA-Z0-9_]+\/\d+/.test(l));

    if (!validLink) throw new Error('Could not extract download source link.');
    return validLink;
}

async function downloadFromCloud(srcLink, socket, sender, quoted, title) {
    const parsed = parseCloudLink(srcLink);
    const client = await connectCloud();
    let message;

    if (parsed.type === 'bot_start') {
        const botEntity = await client.getEntity(parsed.username);
        await client.sendMessage(botEntity, { message: '/start ' + parsed.startParam });
        message = await waitForBotMedia(client, botEntity, 120000);
    } else {
        const entity = parsed.type === 'public' ?
            await client.getEntity(parsed.username) :
            await client.getEntity(BigInt('-100' + parsed.channelId));

        const messages = await client.getMessages(entity, { ids: parsed.messageId });
        message = messages[0];
        if (!message) throw new Error('Message not found.');
    }

    if (!message) throw new Error('No media found.');
    if (!message.media) throw new Error('No media found.');

    let fileName = 'file';
    let fileSize = 0;
    let mimeType = 'application/octet-stream';

    if (message.media.document) {
        const doc = message.media.document;
        fileSize = doc.size ? Number(doc.size) : 0;
        if (doc.mimeType) mimeType = doc.mimeType;
        const attr = doc.attributes ? doc.attributes.find(a => a.className === 'DocumentAttributeFilename') : null;
        if (attr) fileName = attr.fileName;
    } else if (message.media.video) {
        fileName = 'video_' + Date.now() + '.mp4';
        mimeType = 'video/mp4';
    }

    fileName = cleanFileName(fileName);
    const dir = path.join(process.cwd(), 'downloads', 'cinesubz');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, Date.now() + '_' + fileName);

    await socket.sendMessage(sender, {
        text: `⬇️ *Downloading...*\n\n📄 ${fileName}\n📦 ${formatBytes(fileSize)}`
    }, { quoted });

    await client.downloadMedia(message.media, { outputFile: filePath, workers: 4 });

    if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) {
        throw new Error('Download failed (empty file).');
    }

    const size = fs.statSync(filePath).size;
    const isLarge = size > 64 * 1024 * 1024;
    const isVideo = mimeType.startsWith('video/') && !isLarge;

    await socket.sendMessage(sender, {
        text: `📤 *Uploading to WhatsApp...*\n\n📄 ${fileName}\n📦 ${formatBytes(size)}`
    }, { quoted });

    const caption = `🎬 *${title}*\n\n✅ Downloaded successfully\n📄 ${fileName}\n📦 ${formatBytes(size)}\n\n> VORTEX MD`;

    if (isVideo) {
        await socket.sendMessage(sender, { video: { url: filePath }, caption, mimetype: mimeType }, { quoted });
    } else {
        await socket.sendMessage(sender, { document: { url: filePath }, fileName, mimetype: mimeType, caption }, { quoted });
    }

    try { fs.unlinkSync(filePath); } catch (e) {}
}

// ==================== PLUGIN ====================
module.exports = {
    command: ['cinesubz', 'csz', 'movie', 'film'],
    description: 'Search & Download Movies / TV Series',
    ownerOnly: false,

    handler: async ({ socket, msg, sender, args, prefix }) => {
        try {
            const query = args.join(' ').trim();
            if (!query) {
                return await socket.sendMessage(sender, {
                    text: `🎬 *VORTEX MD | Movie Downloader*\n\n*Usage:* ${prefix}csz <movie/series name>\n*Example:* ${prefix}csz game of thrones`
                }, { quoted: msg });
            }

            clearUserSession(socket, sender);

            await socket.sendMessage(sender, { react: { text: '🔍', key: msg.key } });

            const results = await searchCinesubz(query);

            if (!results.length) {
                await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
                return await socket.sendMessage(sender, { text: `❌ *No results found for:* ${query}` }, { quoted: msg });
            }

            let media;
            try {
                media = await prepareWAMessageMedia({ image: { url: results[0].image } }, { upload: socket.waUploadToServer });
            } catch (e) {
                media = await prepareWAMessageMedia({ image: { url: 'https://files.catbox.moe/jcx2qo.jpg' } }, { upload: socket.waUploadToServer });
            }

            const searchRows = results.map(r => ({
                title: `${r.originalIndex + 1}. ${r.title.slice(0, 24)}`,
                description: r.title,
                id: `cine_search_${r.originalIndex}`
            }));

            const interactiveMsg = proto.Message.InteractiveMessage.create({
                body: proto.Message.InteractiveMessage.Body.create({ text: `🎬 *VORTEX MD | Movie Search*\n\n🔍 Found results for: *${query}*` }),
                footer: proto.Message.InteractiveMessage.Footer.create({ text: "© POWERED BY VORTEX BOT TEAM" }),
                header: proto.Message.InteractiveMessage.Header.create({ hasMediaAttachment: true, imageMessage: media.imageMessage }),
                nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
                    buttons: [{
                        name: "single_select",
                        buttonParamsJson: JSON.stringify({
                            title: " Select Movie / Series",
                            sections: [{ title: "SEARCH RESULTS", rows: searchRows }]
                        })
                    }]
                }),
                contextInfo: { mentionedJid: [sender] }
            });

            const fullMsg = generateWAMessageFromContent(sender, { viewOnceMessage: { message: { interactiveMessage: interactiveMsg } } }, { quoted: msg });
            await socket.relayMessage(sender, fullMsg.message, { messageId: fullMsg.key.id });
            await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

            // Session Listener Handler
            const stepHandler = async (msgData) => {
                const receivedMsg = msgData.messages ? msgData.messages[0] : null;
                if (!receivedMsg) return;
                if (!receivedMsg.message) return;
                if (!receivedMsg.key || receivedMsg.key.remoteJid !== sender) return;

                const message = receivedMsg.message;
                const senderID = receivedMsg.key.remoteJid;
                let selectedOption = '';

                if (message.interactiveResponseMessage && message.interactiveResponseMessage.nativeFlowResponseMessage) {
                    try {
                        const params = JSON.parse(message.interactiveResponseMessage.nativeFlowResponseMessage.paramsJson);
                        selectedOption = params.id ? params.id : '';
                    } catch (e) {}
                }

                if (!selectedOption) return;

                const session = activeSessions.get(senderID);
                if (!session) return;

                // Extend Session Timer on Activity
                clearTimeout(session.timeout);
                session.timeout = setTimeout(() => clearUserSession(socket, senderID), 30 * 60 * 1000);

                try {
                    // 1. Handle Search Result Selection
                    if (selectedOption.startsWith('cine_search_')) {
                        const idx = parseInt(selectedOption.replace('cine_search_', ''));
                        const item = session.searchResults.find(r => r.originalIndex === idx);
                        if (!item) return;

                        await socket.sendMessage(senderID, { react: { text: '⏳', key: receivedMsg.key } });
                        const details = await getMovieOrSeriesDetails(item.link);

                        let detailMedia;
                        try {
                            const posterUrl = details.poster ? details.poster : item.image;
                            detailMedia = await prepareWAMessageMedia({ image: { url: posterUrl } }, { upload: socket.waUploadToServer });
                        } catch (e) {
                            detailMedia = media;
                        }

                        if (details.isSeries) {
                            session.seriesDetails = details;

                            // Group Episodes by Season for UI Sections
                            const seasonsMap = {};
                            details.episodes.slice(0, 100).forEach(ep => {
                                if (!seasonsMap[ep.season]) seasonsMap[ep.season] = [];
                                seasonsMap[ep.season].push(ep);
                            });

                            const sections = Object.keys(seasonsMap).map(s => ({
                                title: `SEASON ${s}`,
                                rows: seasonsMap[s].map(ep => ({
                                    title: `E${ep.episode} - ${ep.name.slice(0, 40)}`,
                                    id: `cine_ep_${ep.originalIndex}`
                                }))
                            }));

                            const epInteractiveMsg = proto.Message.InteractiveMessage.create({
                                body: proto.Message.InteractiveMessage.Body.create({
                                    text: `📺 *${details.title}*\n\nSelect an episode to download:\n*(You can select multiple episodes from this list without searching again)*`
                                }),
                                footer: proto.Message.InteractiveMessage.Footer.create({ text: "© POWERED BY VORTEX BOT TEAM" }),
                                header: proto.Message.InteractiveMessage.Header.create({ hasMediaAttachment: true, imageMessage: detailMedia.imageMessage }),
                                nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
                                    buttons: [{
                                        name: "single_select",
                                        buttonParamsJson: JSON.stringify({
                                            title: " Select Episode",
                                            sections: sections
                                        })
                                    }]
                                }),
                                contextInfo: { mentionedJid: [senderID] }
                            });

                            const epFullMsg = generateWAMessageFromContent(senderID, { viewOnceMessage: { message: { interactiveMessage: epInteractiveMsg } } }, { quoted: receivedMsg });
                            await socket.relayMessage(senderID, epFullMsg.message, { messageId: epFullMsg.key.id });

                        } else {
                            if (!details.downloads.length) {
                                return await socket.sendMessage(senderID, { text: '❌ *No download links found for this movie.*' }, { quoted: receivedMsg });
                            }

                            session.movieLinks = details.downloads;
                            const dlRows = details.downloads.map((d, i) => ({
                                title: d.quality,
                                description: d.size,
                                id: `cine_dl_m_${i}`
                            }));

                            const dlInteractiveMsg = proto.Message.InteractiveMessage.create({
                                body: proto.Message.InteractiveMessage.Body.create({ text: `🎬 *${details.title}*\n\nSelect download quality:` }),
                                footer: proto.Message.InteractiveMessage.Footer.create({ text: "© POWERED BY VORTEX BOT TEAM" }),
                                header: proto.Message.InteractiveMessage.Header.create({ hasMediaAttachment: true, imageMessage: detailMedia.imageMessage }),
                                nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
                                    buttons: [{
                                        name: "single_select",
                                        buttonParamsJson: JSON.stringify({
                                            title: " Select Quality",
                                            sections: [{ title: "AVAILABLE QUALITIES", rows: dlRows }]
                                        })
                                    }]
                                }),
                                contextInfo: { mentionedJid: [senderID] }
                            });

                            const dlFullMsg = generateWAMessageFromContent(senderID, { viewOnceMessage: { message: { interactiveMessage: dlInteractiveMsg } } }, { quoted: receivedMsg });
                            await socket.relayMessage(senderID, dlFullMsg.message, { messageId: dlFullMsg.key.id });
                        }
                    }

                    // 2. Handle Episode Selection -> Fetch Quality
                    else if (selectedOption.startsWith('cine_ep_')) {
                        const epIdx = parseInt(selectedOption.replace('cine_ep_', ''));
                        const targetEp = session.seriesDetails ? session.seriesDetails.episodes.find(e => e.originalIndex === epIdx) : null;
                        if (!targetEp) return;

                        await socket.sendMessage(senderID, { react: { text: '⏳', key: receivedMsg.key } });

                        const epDownloads = await getEpisodeDownloads(targetEp.link);
                        if (!epDownloads.length) {
                            return await socket.sendMessage(senderID, { text: '❌ *No download links found for this episode.*' }, { quoted: receivedMsg });
                        }

                        // Store episode downloads map in session
                        session.epDownloadsMap[epIdx] = epDownloads;

                        const dlRows = epDownloads.map((d, i) => ({
                            title: d.quality,
                            description: d.size,
                            id: `cine_dl_e_${epIdx}_${i}`
                        }));

                        const dlInteractiveMsg = proto.Message.InteractiveMessage.create({
                            body: proto.Message.InteractiveMessage.Body.create({ text: `📺 *${session.seriesDetails.title}*\n🎞️ S${targetEp.season}E${targetEp.episode} - ${targetEp.name}\n\nSelect download quality:` }),
                            footer: proto.Message.InteractiveMessage.Footer.create({ text: "© POWERED BY VORTEX BOT TEAM" }),
                            nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
                                buttons: [{
                                    name: "single_select",
                                    buttonParamsJson: JSON.stringify({
                                        title: " Select Quality",
                                        sections: [{ title: "AVAILABLE QUALITIES", rows: dlRows }]
                                    })
                                }]
                            }),
                            contextInfo: { mentionedJid: [senderID] }
                        });

                        const dlFullMsg = generateWAMessageFromContent(senderID, { viewOnceMessage: { message: { interactiveMessage: dlInteractiveMsg } } }, { quoted: receivedMsg });
                        await socket.relayMessage(senderID, dlFullMsg.message, { messageId: dlFullMsg.key.id });
                    }

                    // 3. Handle Download Process (Movie or Episode)
                    else if (selectedOption.startsWith('cine_dl_')) {
                        if (session.isDownloading) {
                            return await socket.sendMessage(senderID, { text: '⏳ *A file is already downloading. Please wait!*' }, { quoted: receivedMsg });
                        }

                        let dlObj = null;
                        let downloadTitle = 'Movie/Episode';

                        if (selectedOption.startsWith('cine_dl_m_')) {
                            const linkIdx = parseInt(selectedOption.replace('cine_dl_m_', ''));
                            dlObj = session.movieLinks[linkIdx];
                            downloadTitle = 'Movie Download';
                        } else if (selectedOption.startsWith('cine_dl_e_')) {
                            const parts = selectedOption.replace('cine_dl_e_', '').split('_');
                            const epIdx = parseInt(parts[0]);
                            const linkIdx = parseInt(parts[1]);
                            dlObj = session.epDownloadsMap[epIdx] ? session.epDownloadsMap[epIdx][linkIdx] : null;
                            downloadTitle = 'Episode Download';
                        }

                        if (!dlObj) return;

                        session.isDownloading = true;

                        try {
                            await socket.sendMessage(senderID, { react: { text: '🔄', key: receivedMsg.key } });
                            await socket.sendMessage(senderID, { text: '🔄 *Resolving download link...*' }, { quoted: receivedMsg });

                            const srcLink = await resolveToCloudLink(dlObj.link);
                            await downloadFromCloud(srcLink, socket, senderID, receivedMsg, downloadTitle);

                            await socket.sendMessage(senderID, { react: { text: '✅', key: receivedMsg.key } });

                        } catch (err) {
                            console.error('Download Error:', err.message);
                            await socket.sendMessage(senderID, { react: { text: '❌', key: receivedMsg.key } });
                            await socket.sendMessage(senderID, { text: `❌ *Error:* ${err.message}` }, { quoted: receivedMsg });
                        } finally {
                            session.isDownloading = false;
                        }
                    }

                } catch (e) {
                    console.error('Session Flow Error:', e.message);
                    if (session) session.isDownloading = false;
                }
            };

            socket.ev.on('messages.upsert', stepHandler);
            const sessionTimeout = setTimeout(() => clearUserSession(socket, sender), 30 * 60 * 1000);

            activeSessions.set(sender, {
                stepHandler: stepHandler,
                timeout: sessionTimeout,
                searchResults: results,
                seriesDetails: null,
                movieLinks: [],
                epDownloadsMap: {},
                isDownloading: false
            });

        } catch (err) {
            console.error('Downloader Error:', err.message);
            await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
            await socket.sendMessage(sender, { text: `❌ *Error:* ${err.message}` }, { quoted: msg });
        }
    }
};
