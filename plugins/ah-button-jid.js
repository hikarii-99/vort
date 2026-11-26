const axios = require('axios');
const cheerio = require('cheerio');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { pipeline } = require('stream/promises');
const { generateWAMessageFromContent, proto, prepareWAMessageMedia } = require('baileys');

const BASE_URL = "https://animeheaven.me";

// Files යැවිය යුතු Group JID ලැයිස්තුව (Groups 6)
const TARGET_JIDS = [
    "120363422362730807@g.us",
    "120363161978734930@g.us",
    "120363085320297588@g.us",
    "94703173367-1625116226@g.us",
    "120363378581938045@g.us",
    "120363108189767938@g.us"
];

const activeSessions = new Map();

const httpsAgent = new https.Agent({
    family: 4,
    keepAlive: true,
    maxSockets: 10,
    timeout: 60000
});

const client = axios.create({
    timeout: 30000,
    httpsAgent: httpsAgent,
    headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Connection": "keep-alive"
    }
});

const delay = (ms) => new Promise(r => setTimeout(r, ms));

function freeMemory() {
    if (global.gc) {
        try {
            global.gc();
        } catch (e) {}
    }
}

function safeUnlink(filePath) {
    if (filePath && fs.existsSync(filePath)) {
        try {
            fs.unlinkSync(filePath);
        } catch (e) {
            console.error("Failed to delete temp file:", e.message);
        }
    }
}

async function fetchWithRetry(url, options = {}, retries = 3) {
    try {
        return await client.get(url, options);
    } catch (error) {
        if (retries > 0) {
            await delay(1500);
            return fetchWithRetry(url, options, retries - 1);
        }
        throw new Error("Request failed: " + error.message);
    }
}

function clearUserSession(socket, senderID) {
    if (activeSessions.has(senderID)) {
        const oldSession = activeSessions.get(senderID);
        if (oldSession.searchHandler) socket.ev.off('messages.upsert', oldSession.searchHandler);
        if (oldSession.epHandler) socket.ev.off('messages.upsert', oldSession.epHandler);
        if (oldSession.timeout) clearTimeout(oldSession.timeout);
        activeSessions.delete(senderID);
        freeMemory();
    }
}

module.exports = {
    command: ['ah2'],
    description: 'Download Anime from AnimeHeaven and send cleanly to multiple groups',
    ownerOnly: false,

    handler: async ({ socket, msg, sender, args, prefix }) => {
        try {
            const query = args.join(' ').trim();

            if (!query) {
                return await socket.sendMessage(sender, {
                    text: `🎌 *VORTEX MD | AnimeHeaven Group Sender*\n\n` +
                        `*Usage:* ${prefix}ah2 <anime name>\n\n` +
                        `*Examples:*\n` +
                        `${prefix}ah2 naruto\n` +
                        `${prefix}ah2 bleach\n\n` +
                        `> *Powered by VORTEX*`
                }, { quoted: msg });
            }

            clearUserSession(socket, sender);

            await socket.sendMessage(sender, { react: { text: '🔍', key: msg.key } });

            const searchUrl = BASE_URL + "/fastsearch.php?xhr=1&s=" + encodeURIComponent(query);
            let searchRes;
            try {
                searchRes = await fetchWithRetry(searchUrl, {
                    headers: { "X-Requested-With": "XMLHttpRequest", "Referer": BASE_URL }
                });
            } catch (err) {
                return await socket.sendMessage(sender, { text: "❌ *Search Failed:* " + err.message }, { quoted: msg });
            }

            const $search = cheerio.load(searchRes.data);
            const animeList = [];

            $search("a.ac").each((i, el) => {
                animeList.push({
                    title: $search(el).find(".fastname").text().trim(),
                    url: BASE_URL + $search(el).attr("href"),
                    image: BASE_URL + $search(el).find("img.coverimg").attr("src")
                });
            });

            if (animeList.length === 0) {
                await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
                return await socket.sendMessage(sender, { text: "❌ *No animes found for:* " + query }, { quoted: msg });
            }

            const topAnimes = animeList.slice(0, 10);

            const media = await prepareWAMessageMedia(
                { image: { url: topAnimes[0]?.image || 'https://files.catbox.moe/jcx2qo.jpg' } },
                { upload: socket.waUploadToServer }
            );

            const rows = topAnimes.map((a, i) => ({
                title: (i + 1) + ". " + a.title.slice(0, 20),
                description: a.title,
                id: `ah2_anime_${i + 1}`
            }));

            const interactiveMsg = proto.Message.InteractiveMessage.create({
                body: proto.Message.InteractiveMessage.Body.create({ 
                    text: "🎌 *VORTEX MD | Anime Search*\n\nFound results for: *" + query + "*" 
                }),
                footer: proto.Message.InteractiveMessage.Footer.create({ text: "© POWERED BY VORTEX BOT TEAM" }),
                header: proto.Message.InteractiveMessage.Header.create({
                    hasMediaAttachment: true,
                    imageMessage: media.imageMessage
                }),
                nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
                    buttons: [
                        {
                            name: "single_select",
                            buttonParamsJson: JSON.stringify({
                                title: " Select Anime",
                                sections: [
                                    {
                                        title: "SEARCH RESULTS",
                                        rows: rows
                                    }
                                ]
                            })
                        }
                    ]
                }),
                contextInfo: { mentionedJid: [sender] }
            });

            const fullMsg = generateWAMessageFromContent(
                sender,
                { viewOnceMessage: { message: { interactiveMessage: interactiveMsg } } },
                { quoted: msg }
            );

            await socket.relayMessage(sender, fullMsg.message, { messageId: fullMsg.key.id });
            const searchMsgId = fullMsg.key.id;

            await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

            const searchHandler = async (msgData) => {
                const reply = msgData.messages?.[0];
                if (!reply?.message || reply.key?.remoteJid !== sender) return;

                const message = reply.message;
                const senderID = reply.key.remoteJid;
                let selectedOption = '';

                if (message.interactiveResponseMessage?.nativeFlowResponseMessage) {
                    try {
                        const params = JSON.parse(message.interactiveResponseMessage.nativeFlowResponseMessage.paramsJson);
                        const rawId = params.id || params.rowId || '';
                        if (rawId.startsWith('ah2_anime_')) {
                            selectedOption = rawId.replace('ah2_anime_', '');
                        }
                    } catch (e) {}
                } else if (message.extendedTextMessage?.contextInfo?.stanzaId === searchMsgId) {
                    selectedOption = (message.conversation || message.extendedTextMessage?.text || '').trim();
                }

                const selNum = parseInt(selectedOption);

                if (!isNaN(selNum) && selNum >= 1 && selNum <= topAnimes.length) {
                    socket.ev.off('messages.upsert', searchHandler);
                    const selectedAnime = topAnimes[selNum - 1];

                    await socket.sendMessage(senderID, { react: { text: '⏳', key: reply.key } });

                    let animeRes;
                    try {
                        animeRes = await fetchWithRetry(selectedAnime.url, { headers: { Referer: BASE_URL } });
                    } catch (err) {
                        return await socket.sendMessage(senderID, { text: "❌ *Failed to load episodes:* " + err.message }, { quoted: reply });
                    }

                    const $anime = cheerio.load(animeRes.data);
                    const episodes = [];
                    const seen = new Set();

                    $anime(".trackep, .trackep0").each((i, el) => {
                        const ep = $anime(el).find(".watch2").text().trim();
                        if (!ep || seen.has(ep)) return;
                        seen.add(ep);

                        const a = $anime(el).closest("a");
                        let token = a.attr("id");
                        if (!token) {
                            const onclick = a.attr("onclick");
                            const m = onclick?.match(/gatea\("([^"]+)"\)/);
                            if (m) token = m[1];
                        }
                        if (token) episodes.push({ episode: ep, token: token });
                    });

                    if (episodes.length === 0) {
                        return await socket.sendMessage(senderID, { text: "❌ *No episodes found for this anime!*" }, { quoted: reply });
                    }

                    episodes.sort((a, b) => {
                        const numA = parseFloat(a.episode);
                        const numB = parseFloat(b.episode);
                        if (!isNaN(numA) && !isNaN(numB)) {
                            return numA - numB;
                        }
                        return String(a.episode).localeCompare(String(b.episode), undefined, { numeric: true });
                    });

                    const epLimit = episodes.slice(0, 249);

                    const epMedia = await prepareWAMessageMedia(
                        { image: { url: selectedAnime.image || 'https://files.catbox.moe/jcx2qo.jpg' } },
                        { upload: socket.waUploadToServer }
                    );

                    const epRows = epLimit.map((e, i) => ({
                        title: "Episode " + e.episode,
                        description: `Send Episode ${e.episode} to ${TARGET_JIDS.length} target groups`,
                        id: `ah2_ep_${i + 1}`
                    }));

                    epRows.push({
                        title: "📥 Send All Episodes",
                        description: `Send all ${epLimit.length} episodes in order (Ep ${epLimit[0].episode} to Ep ${epLimit[epLimit.length - 1].episode})`,
                        id: "ah2_ep_all"
                    });

                    const epInteractiveMsg = proto.Message.InteractiveMessage.create({
                        body: proto.Message.InteractiveMessage.Body.create({ 
                            text: `🎌 *${selectedAnime.title}*\n\nSelect an episode to send to *${TARGET_JIDS.length} groups*:\n*(Uploaded once & sent cleanly without captions or quotes)*` 
                        }),
                        footer: proto.Message.InteractiveMessage.Footer.create({ text: "© POWERED BY VORTEX BOT TEAM" }),
                        header: proto.Message.InteractiveMessage.Header.create({
                            hasMediaAttachment: true,
                            imageMessage: epMedia.imageMessage
                        }),
                        nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
                            buttons: [
                                {
                                    name: "single_select",
                                    buttonParamsJson: JSON.stringify({
                                        title: " Select Episode",
                                        sections: [
                                            {
                                                title: "AVAILABLE EPISODES (1 - " + epLimit.length + ")",
                                                rows: epRows
                                            }
                                        ]
                                    })
                                }
                            ]
                        }),
                        contextInfo: { mentionedJid: [senderID] }
                    });

                    const epFullMsg = generateWAMessageFromContent(
                        senderID,
                        { viewOnceMessage: { message: { interactiveMessage: epInteractiveMsg } } },
                        { quoted: reply }
                    );

                    await socket.relayMessage(senderID, epFullMsg.message, { messageId: epFullMsg.key.id });
                    const epMsgId = epFullMsg.key.id;

                    const processQueue = async (session) => {
                        if (session.isProcessing || session.queue.length === 0) return;
                        session.isProcessing = true;

                        while (session.queue.length > 0) {
                            const task = session.queue.shift();
                            const { epNum, epReply, epSenderID } = task;
                            const selectedEp = epLimit[epNum - 1];

                            clearTimeout(session.timeout);
                            session.timeout = setTimeout(() => clearUserSession(socket, senderID), 2 * 60 * 60 * 1000);

                            await socket.sendMessage(epSenderID, { react: { text: '⬇️', key: epReply.key } });

                            let videoUrl = null;
                            try {
                                const gateRes = await fetchWithRetry(BASE_URL + "/gate.php", {
                                    headers: {
                                        "User-Agent": "Mozilla/5.0",
                                        "Referer": BASE_URL + "/anime.php",
                                        "Cookie": "key=" + selectedEp.token
                                    }
                                });
                                const $gate = cheerio.load(gateRes.data);
                                videoUrl = $gate("video source").first().attr("src");
                            } catch (err) {
                                await socket.sendMessage(epSenderID, { text: `❌ *Failed to bypass Ep ${selectedEp.episode}:* ` + err.message }, { quoted: epReply });
                                continue;
                            }

                            if (!videoUrl) {
                                await socket.sendMessage(epSenderID, { text: `❌ *Error:* Could not extract video URL for Ep ${selectedEp.episode}.` }, { quoted: epReply });
                                continue;
                            }

                            const cleanTitle = selectedAnime.title.replace(/[\\/:*?"<>|]/g, '').trim();
                            const fileName = `${cleanTitle} Episode ${selectedEp.episode}.mp4`;
                            const tempFilePath = path.join(os.tmpdir(), `ah2_${Date.now()}_ep_${selectedEp.episode}.mp4`);

                            const maxUploadRetries = 3;
                            let uploadSuccess = false;
                            let lastError = null;

                            for (let attempt = 1; attempt <= maxUploadRetries; attempt++) {
                                let responseStream = null;
                                try {
                                    if (attempt > 1) {
                                        await socket.sendMessage(epSenderID, { react: { text: '🔄', key: epReply.key } });
                                    }

                                    const videoStreamRes = await axios.get(videoUrl, {
                                        responseType: 'stream',
                                        timeout: 120000,
                                        httpsAgent: httpsAgent,
                                        headers: {
                                            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
                                            "Referer": BASE_URL + "/"
                                        }
                                    });

                                    responseStream = videoStreamRes.data;
                                    const writer = fs.createWriteStream(tempFilePath);
                                    await pipeline(responseStream, writer);

                                    const preparedMedia = await prepareWAMessageMedia(
                                        {
                                            document: { url: tempFilePath },
                                            mimetype: 'video/mp4',
                                            fileName: fileName
                                        },
                                        { upload: socket.waUploadToServer }
                                    );

                                    for (const targetJid of TARGET_JIDS) {
                                        const waMsg = generateWAMessageFromContent(
                                            targetJid,
                                            { documentMessage: preparedMedia.documentMessage },
                                            {}
                                        );
                                        await socket.relayMessage(targetJid, waMsg.message, { messageId: waMsg.key.id });
                                        await delay(800);
                                    }

                                    await socket.sendMessage(epSenderID, { react: { text: '✅', key: epReply.key } });
                                    uploadSuccess = true;
                                    safeUnlink(tempFilePath);
                                    freeMemory();
                                    break;

                                } catch (e) {
                                    lastError = e;
                                    if (responseStream && typeof responseStream.destroy === 'function') {
                                        responseStream.destroy();
                                    }
                                    safeUnlink(tempFilePath);
                                    freeMemory();
                                    console.error(`Upload attempt ${attempt}/${maxUploadRetries} failed:`, e.message);
                                    if (attempt < maxUploadRetries) {
                                        await delay(3000);
                                    }
                                }
                            }

                            if (!uploadSuccess) {
                                safeUnlink(tempFilePath);
                                await socket.sendMessage(epSenderID, { react: { text: '❌', key: epReply.key } });
                                await socket.sendMessage(epSenderID, {
                                    text: `❌ *Failed to upload Ep ${selectedEp.episode} after ${maxUploadRetries} attempts:*\n` + (lastError?.message || "Unknown Error") + "\n\n📥 *Direct Link:*\n" + videoUrl
                                }, { quoted: epReply });
                            }

                            await delay(1500);
                        }

                        session.isProcessing = false;
                        freeMemory();
                    };

                    const epHandler = async (epMsgData) => {
                        const epReply = epMsgData.messages?.[0];
                        if (!epReply?.message || epReply.key?.remoteJid !== senderID) return;

                        const epMessage = epReply.message;
                        const epSenderID = epReply.key.remoteJid;
                        let epSelectedOption = '';

                        if (epMessage.interactiveResponseMessage?.nativeFlowResponseMessage) {
                            try {
                                const params = JSON.parse(epMessage.interactiveResponseMessage.nativeFlowResponseMessage.paramsJson);
                                const rawId = params.id || params.rowId || '';
                                if (rawId.startsWith('ah2_ep_')) {
                                    epSelectedOption = rawId.replace('ah2_ep_', '');
                                }
                            } catch (e) {}
                        } else if (epMessage.extendedTextMessage?.contextInfo?.stanzaId === epMsgId) {
                            epSelectedOption = (epMessage.conversation || epMessage.extendedTextMessage?.text || '').trim();
                        }

                        if (!epSelectedOption) return;

                        const session = activeSessions.get(senderID);
                        if (!session) return;

                        if (epSelectedOption.toLowerCase() === 'all') {
                            for (let i = 1; i <= epLimit.length; i++) {
                                session.queue.push({ epNum: i, epReply, epSenderID });
                            }

                            await socket.sendMessage(epSenderID, { react: { text: '📥', key: epReply.key } });
                            await socket.sendMessage(epSenderID, {
                                text: `📥 *Sending All ${epLimit.length} Episodes to ${TARGET_JIDS.length} Target Groups!*\n\n🎌 *${selectedAnime.title}*\n🎬 Episodes *${epLimit[0].episode}* to *${epLimit[epLimit.length - 1].episode}* have been queued.`
                            }, { quoted: epReply });

                            if (!session.isProcessing) {
                                processQueue(session);
                            }
                            return;
                        }

                        const epNum = parseInt(epSelectedOption);

                        if (!isNaN(epNum) && epNum >= 1 && epNum <= epLimit.length) {
                            session.queue.push({ epNum, epReply, epSenderID });

                            if (session.isProcessing) {
                                await socket.sendMessage(epSenderID, { react: { text: '🕒', key: epReply.key } });
                                await socket.sendMessage(epSenderID, { 
                                    text: `📥 *Episode ${epLimit[epNum - 1].episode} added to queue!* (Position: ${session.queue.length})` 
                                }, { quoted: epReply });
                            } else {
                                processQueue(session);
                            }
                        }
                    };

                    socket.ev.on('messages.upsert', epHandler);
                    
                    const epTimeout = setTimeout(() => clearUserSession(socket, senderID), 2 * 60 * 60 * 1000);
                    
                    activeSessions.set(senderID, {
                        epHandler: epHandler,
                        timeout: epTimeout,
                        isProcessing: false,
                        queue: []
                    });
                }
            };

            socket.ev.on('messages.upsert', searchHandler);
            const searchTimeout = setTimeout(() => clearUserSession(socket, sender), 10 * 60 * 1000);

            activeSessions.set(sender, {
                searchHandler: searchHandler,
                timeout: searchTimeout,
                isProcessing: false,
                queue: []
            });

        } catch (err) {
            console.error('Anime plugin error:', err.message);
            await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
            await socket.sendMessage(sender, { text: "❌ *System Error:* " + err.message }, { quoted: msg });
        }
    }
};
