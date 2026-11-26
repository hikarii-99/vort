const axios = require('axios');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { pipeline } = require('stream/promises');
const { generateWAMessageFromContent, proto, prepareWAMessageMedia } = require('baileys');

const API_BASE = 'https://jilhub.udmodz-2ab.workers.dev';

// Memory Map to store active user sessions
const activeSessions = new Map();

// Force IPv4 to prevent ENETUNREACH & ETIMEDOUT errors
const httpsAgent = new https.Agent({
    family: 4,
    keepAlive: true,
    timeout: 60000
});

const client = axios.create({
    baseURL: API_BASE,
    timeout: 30000,
    httpsAgent: httpsAgent,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/json, */*'
    }
});

const delay = (ms) => new Promise(r => setTimeout(r, ms));

function safeUnlink(filePath) {
    if (filePath && fs.existsSync(filePath)) {
        try {
            fs.unlinkSync(filePath);
        } catch (e) {}
    }
}

function clearUserSession(socket, senderID) {
    if (activeSessions.has(senderID)) {
        const oldSession = activeSessions.get(senderID);
        if (oldSession.stepHandler) socket.ev.off('messages.upsert', oldSession.stepHandler);
        if (oldSession.timeout) clearTimeout(oldSession.timeout);
        activeSessions.delete(senderID);
    }
}

// Extract id & slug safely from API item object or URL
function extractIdAndSlug(item) {
    let id = item.id || item.video_id || item.videoId || '';
    let slug = item.slug || '';

    const rawUrl = item.url || item.link || item.href || item.path || '';
    if ((!id || !slug) && rawUrl) {
        // Match /video/11461/new-srilanka-036 or /11461/new-srilanka-036
        const pathMatch = rawUrl.match(/(?:\/video)?\/(\d+)\/([^/?#]+)/i);
        if (pathMatch) {
            if (!id) id = pathMatch[1];
            if (!slug) slug = pathMatch[2];
        } else {
            try {
                const u = new URL(rawUrl, API_BASE);
                if (!id) id = u.searchParams.get('id') || '';
                if (!slug) slug = u.searchParams.get('slug') || '';
            } catch (e) {}
        }
    }

    return { id: String(id).trim(), slug: String(slug).trim() };
}

// Parse list array flexibly regardless of JSON wrapper key
function extractItemsList(data) {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    if (Array.isArray(data.results)) return data.results;
    if (Array.isArray(data.result)) return data.result;
    if (Array.isArray(data.data)) return data.data;
    if (Array.isArray(data.videos)) return data.videos;
    if (Array.isArray(data.items)) return data.items;
    if (data.data && Array.isArray(data.data.videos)) return data.data.videos;
    if (data.data && Array.isArray(data.data.results)) return data.data.results;
    if (data.result && Array.isArray(data.result.videos)) return data.result.videos;
    return [];
}

module.exports = {
    command: ['jilhub', 'jh', 'jil'],
    description: 'Search and download videos from Jilhub API',
    ownerOnly: false,

    handler: async ({ socket, msg, sender, args, prefix = '.' }) => {
        try {
            const query = args.join(' ').trim();

            if (!query) {
                return await socket.sendMessage(sender, {
                    text: `🔞 *VORTEX MD | Jilhub Downloader*\n\n` +
                          `*Usage:*\n` +
                          `• \`${prefix}jh <search query>\` - Search videos\n` +
                          `• \`${prefix}jh latest\` - Latest uploads\n` +
                          `• \`${prefix}jh popular\` - Most viewed videos\n` +
                          `• \`${prefix}jh toprated\` - Top rated videos\n\n` +
                          `*Example:*\n` +
                          `\`${prefix}jh sri lanka\`\n\n` +
                          `> *Powered by VORTEX*`
                }, { quoted: msg });
            }

            clearUserSession(socket, sender);

            await socket.sendMessage(sender, { react: { text: '🔍', key: msg.key } });

            let endpoint = '/search';
            let params = { q: query, page: 1 };
            let modeTitle = `Search: ${query}`;

            const lowerQuery = query.toLowerCase();
            if (lowerQuery === 'latest' || lowerQuery === 'new') {
                endpoint = '/latest';
                params = { page: 1 };
                modeTitle = 'Latest Updates';
            } else if (lowerQuery === 'popular' || lowerQuery === 'most-viewed' || lowerQuery === 'mostviewed') {
                endpoint = '/most-viewed';
                params = { page: 1 };
                modeTitle = 'Most Viewed Videos';
            } else if (lowerQuery === 'top' || lowerQuery === 'top-rated' || lowerQuery === 'toprated') {
                endpoint = '/top-rated';
                params = { page: 1 };
                modeTitle = 'Top Rated Videos';
            }

            const { data: searchData } = await client.get(endpoint, { params });
            const rawList = extractItemsList(searchData);

            if (!rawList || rawList.length === 0) {
                await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
                return await socket.sendMessage(sender, {
                    text: `❌ *No videos found for:* ${query}`
                }, { quoted: msg });
            }

            // Limit to top 12 results
            const topResults = rawList.slice(0, 12);

            const fallbackImage = 'https://files.catbox.moe/jcx2qo.jpg';
            const firstThumb = topResults[0]?.thumbnail || topResults[0]?.thumb || topResults[0]?.image || topResults[0]?.poster || fallbackImage;

            let media;
            try {
                media = await prepareWAMessageMedia(
                    { image: { url: firstThumb } },
                    { upload: socket.waUploadToServer }
                );
            } catch (e) {
                media = await prepareWAMessageMedia(
                    { image: { url: fallbackImage } },
                    { upload: socket.waUploadToServer }
                );
            }

            const sessionTag = Date.now().toString(36);

            const rows = topResults.map((item, idx) => {
                const title = item.title || item.name || `Video ${idx + 1}`;
                const duration = item.duration || item.time || '';
                const views = item.views || item.view || '';
                const metaDesc = [duration ? `⏱️ ${duration}` : '', views ? `👁️ ${views}` : ''].filter(Boolean).join(' | ');

                return {
                    title: `${idx + 1}. ${title.slice(0, 24)}`,
                    description: metaDesc ? `${metaDesc} - ${title.slice(0, 40)}` : title.slice(0, 60),
                    id: `jh_sel_${sessionTag}_${idx}`
                };
            });

            const interactiveMsg = proto.Message.InteractiveMessage.create({
                body: proto.Message.InteractiveMessage.Body.create({
                    text: `🔞 *VORTEX MD | Jilhub DL*\n\n` +
                          `📌 *Mode:* ${modeTitle}\n` +
                          `📊 *Showing:* Top ${topResults.length} Results\n\n` +
                          `*(Select a video from the button below to download. You can select multiple videos from this list)*`
                }),
                footer: proto.Message.InteractiveMessage.Footer.create({ text: '© POWERED BY VORTEX BOT TEAM' }),
                header: proto.Message.InteractiveMessage.Header.create({
                    hasMediaAttachment: true,
                    imageMessage: media.imageMessage
                }),
                nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
                    buttons: [
                        {
                            name: 'single_select',
                            buttonParamsJson: JSON.stringify({
                                title: '📥 Select Video',
                                sections: [
                                    {
                                        title: modeTitle.toUpperCase().slice(0, 24),
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

            // Listener for button selection or number reply
            const stepHandler = async (msgData) => {
                const receivedMsg = msgData.messages ? msgData.messages[0] : null;
                if (!receivedMsg || !receivedMsg.message) return;

                const message = receivedMsg.message.ephemeralMessage?.message ||
                                receivedMsg.message.viewOnceMessage?.message ||
                                receivedMsg.message.viewOnceMessageV2?.message ||
                                receivedMsg.message;

                let selectedIdx = -1;

                // 1. Check Interactive Button Response
                if (message.interactiveResponseMessage?.nativeFlowResponseMessage) {
                    try {
                        const params = JSON.parse(message.interactiveResponseMessage.nativeFlowResponseMessage.paramsJson || '{}');
                        const rawId = params.id || params.rowId || '';
                        const prefixStr = `jh_sel_${sessionTag}_`;
                        if (rawId.startsWith(prefixStr)) {
                            selectedIdx = parseInt(rawId.replace(prefixStr, ''), 10);
                        }
                    } catch (e) {}
                }
                // 2. Fallback to quoted number reply
                else if (message.extendedTextMessage?.contextInfo?.stanzaId === searchMsgId) {
                    const text = (message.conversation || message.extendedTextMessage?.text || '').trim();
                    const num = parseInt(text, 10);
                    if (!isNaN(num) && num >= 1 && num <= topResults.length) {
                        selectedIdx = num - 1;
                    }
                }

                if (selectedIdx < 0 || selectedIdx >= topResults.length) return;

                const session = activeSessions.get(sender);
                if (!session) return;

                if (session.isDownloading) {
                    return await socket.sendMessage(sender, {
                        text: '⏳ *A video is already downloading. Please wait until it finishes before selecting the next one!*'
                    }, { quoted: receivedMsg });
                }

                session.isDownloading = true;
                clearTimeout(session.timeout);
                session.timeout = setTimeout(() => clearUserSession(socket, sender), 30 * 60 * 1000);

                const selectedItem = topResults[selectedIdx];
                const { id, slug } = extractIdAndSlug(selectedItem);
                const itemTitle = selectedItem.title || selectedItem.name || slug || `Jilhub_${id}`;

                await socket.sendMessage(sender, { react: { text: '⬇️', key: receivedMsg.key } });

                let tempFilePath = null;

                try {
                    // Build candidate download URLs using the API endpoints
                    const candidateUrls = [];

                    if (id && slug) {
                        // 1. Check /video metadata endpoint for direct links
                        try {
                            const { data: metaRes } = await client.get('/video', { params: { id, slug } });
                            const metaObj = metaRes?.result || metaRes?.data || metaRes?.video || metaRes;

                            if (metaObj) {
                                const directDl = metaObj.download || metaObj.downloadUrl || metaObj.download_url || metaObj.file || metaObj.mp4;
                                const directStream = metaObj.stream || metaObj.streamUrl || metaObj.stream_url || metaObj.src;

                                if (typeof directDl === 'string' && directDl.startsWith('http')) candidateUrls.push(directDl);
                                if (typeof directStream === 'string' && directStream.startsWith('http')) candidateUrls.push(directStream);
                            }
                        } catch (e) {}

                        // 2. Add Worker's /download and /stream proxy endpoints
                        candidateUrls.push(`${API_BASE}/download?id=${encodeURIComponent(id)}&slug=${encodeURIComponent(slug)}`);
                        candidateUrls.push(`${API_BASE}/stream?id=${encodeURIComponent(id)}&slug=${encodeURIComponent(slug)}`);
                    } else if (selectedItem.download || selectedItem.stream || selectedItem.url) {
                        candidateUrls.push(selectedItem.download || selectedItem.stream || selectedItem.url);
                    }

                    if (candidateUrls.length === 0) {
                        throw new Error('Could not resolve video ID or Slug from search item.');
                    }

                    const safeFileName = itemTitle.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60) + '.mp4';
                    tempFilePath = path.join(os.tmpdir(), `jh_${Date.now()}_${safeFileName}`);

                    let downloadSuccess = false;
                    let lastError = null;
                    let usedUrl = candidateUrls[0];

                    // Try candidate URLs with retry support
                    for (const targetUrl of candidateUrls) {
                        if (downloadSuccess) break;
                        usedUrl = targetUrl;

                        for (let attempt = 1; attempt <= 2; attempt++) {
                            let responseStream = null;
                            try {
                                if (attempt > 1) {
                                    await socket.sendMessage(sender, { react: { text: '🔄', key: receivedMsg.key } });
                                }

                                const videoRes = await axios.get(targetUrl, {
                                    responseType: 'stream',
                                    timeout: 120000,
                                    maxRedirects: 5,
                                    httpsAgent: httpsAgent,
                                    headers: {
                                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
                                        'Referer': 'https://jilhub.org/'
                                    }
                                });

                                responseStream = videoRes.data;
                                const writer = fs.createWriteStream(tempFilePath);
                                await pipeline(responseStream, writer);

                                const stats = fs.statSync(tempFilePath);
                                if (stats.size < 20 * 1024) {
                                    throw new Error('Downloaded file is too small or invalid.');
                                }

                                downloadSuccess = true;
                                break;
                            } catch (err) {
                                lastError = err;
                                if (responseStream && typeof responseStream.destroy === 'function') {
                                    responseStream.destroy();
                                }
                                safeUnlink(tempFilePath);
                                await delay(2000);
                            }
                        }
                    }

                    if (!downloadSuccess) {
                        throw new Error(lastError?.message || 'Failed to download video stream.');
                    }

                    const fileSizeMB = (fs.statSync(tempFilePath).size / (1024 * 1024)).toFixed(2);

                    await socket.sendMessage(sender, { react: { text: '📤', key: receivedMsg.key } });

                    await socket.sendMessage(sender, {
                        document: { url: tempFilePath },
                        mimetype: 'video/mp4',
                        fileName: safeFileName,
                        caption: `🔞 *${itemTitle}*\n📦 *Size:* ${fileSizeMB} MB\n\n💡 _Select another video from the list above to download the next one._\n\n> *Powered by VORTEX*`
                    }, { quoted: receivedMsg });

                    await socket.sendMessage(sender, { react: { text: '✅', key: receivedMsg.key } });

                } catch (err) {
                    console.error('Jilhub Download Error:', err.message);
                    await socket.sendMessage(sender, { react: { text: '❌', key: receivedMsg.key } });

                    const fallbackLink = (id && slug)
                        ? `${API_BASE}/download?id=${encodeURIComponent(id)}&slug=${encodeURIComponent(slug)}`
                        : 'N/A';

                    await socket.sendMessage(sender, {
                        text: `❌ *Failed to download video:*\n${err.message}\n\n📥 *Direct Download Link:*\n${fallbackLink}`
                    }, { quoted: receivedMsg });
                } finally {
                    safeUnlink(tempFilePath);
                    session.isDownloading = false;
                }
            };

            socket.ev.on('messages.upsert', stepHandler);
            const sessionTimeout = setTimeout(() => clearUserSession(socket, sender), 30 * 60 * 1000);

            activeSessions.set(sender, {
                stepHandler: stepHandler,
                timeout: sessionTimeout,
                isDownloading: false
            });

        } catch (err) {
            console.error('Jilhub Plugin Error:', err.message);
            await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
            await socket.sendMessage(sender, {
                text: `❌ *Error:* ${err.message}`
            }, { quoted: msg });
        }
    }
};
