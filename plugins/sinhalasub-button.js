const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { generateWAMessageFromContent, proto, prepareWAMessageMedia } = require('baileys');

const TEMP_DIR = path.join(__dirname, 'temp_mv');
if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// Memory Map to store active user sessions
const activeSessions = new Map();

function clearUserSession(socket, senderID) {
    if (activeSessions.has(senderID)) {
        const oldSession = activeSessions.get(senderID);
        if (oldSession.stepHandler) socket.ev.off('messages.upsert', oldSession.stepHandler);
        if (oldSession.timeout) clearTimeout(oldSession.timeout);
        activeSessions.delete(senderID);
    }
}

// Stream large file directly to disk without loading into RAM
async function downloadLargeFile(url, destPath) {
    const response = await axios({
        url: url,
        method: 'GET',
        responseType: 'stream',
        maxRedirects: 10,
        timeout: 60000,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
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

async function getMediaHeader(socket, imgUrl) {
    try {
        return await prepareWAMessageMedia(
            { image: { url: safeImage(imgUrl) } },
            { upload: socket.waUploadToServer }
        );
    } catch (e) {
        return await prepareWAMessageMedia(
            { image: { url: 'https://u.pone.rs/iyhqahtk.jpg' } },
            { upload: socket.waUploadToServer }
        );
    }
}

module.exports = {
    command: ['movie2', 'mv2', 'sinhalasub'],
    description: 'Search & Download Movies from SinhalaSub',
    ownerOnly: false,

    handler: async ({ socket, msg, sender, args, prefix = '.' }) => {
        try {
            const query = args.join(' ').trim();

            if (!query) {
                return await socket.sendMessage(
                    sender,
                    {
                        text:
                            '🎬 *VORTEX MD | Movie Downloader*\n\n' +
                            '*Usage:*\n' +
                            `${prefix}mv2 <movie name>\n\n` +
                            '*Example:*\n' +
                            `${prefix}mv2 spider man\n\n` +
                            '> *Powered by VORTEX*'
                    },
                    { quoted: msg }
                );
            }

            // Clear previous session when starting a new search
            clearUserSession(socket, sender);

            await socket.sendMessage(sender, { react: { text: '🔍', key: msg.key } });

            // 1. Search Movies
            const searchUrl = `https://vortex-api-theta.vercel.app/movie/sinhalasub/search?text=${encodeURIComponent(query)}`;
            const searchRes = await axios.get(searchUrl, { timeout: 25000 });

            let rawMovies = [];
            if (searchRes.data && searchRes.data.result && searchRes.data.result.data) {
                rawMovies = searchRes.data.result.data;
            } else if (searchRes.data && Array.isArray(searchRes.data.result)) {
                rawMovies = searchRes.data.result;
            } else if (searchRes.data && Array.isArray(searchRes.data.data)) {
                rawMovies = searchRes.data.data;
            }

            if (!searchRes.data?.status || !Array.isArray(rawMovies) || rawMovies.length === 0) {
                await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
                return await socket.sendMessage(
                    sender,
                    { text: '❌ *No movies found for:* ' + query },
                    { quoted: msg }
                );
            }

            const movies = rawMovies.slice(0, 10);
            const media = await getMediaHeader(socket, movies[0]?.image);

            const searchRows = movies.map((m, i) => ({
                title: `${i + 1}. ${m.title.slice(0, 24)}`,
                description: m.title,
                id: `ssub_mv_${i}`
            }));

            const interactiveMsg = proto.Message.InteractiveMessage.create({
                body: proto.Message.InteractiveMessage.Body.create({
                    text: `🎬 *VORTEX MD | Movie Search*\n\n🔍 *Query:* ${query}\n📊 *Showing:* Top ${movies.length} Results\n\n*(Select a movie from the button below)*`
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
                                title: ' Select Movie',
                                sections: [
                                    {
                                        title: 'SEARCH RESULTS',
                                        rows: searchRows
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

            // Session Listener
            const stepHandler = async (msgData) => {
                const reply = msgData.messages ? msgData.messages[0] : null;
                if (!reply || !reply.message) return;
                if (!reply.key || reply.key.remoteJid !== sender) return;

                const message = reply.message;
                const senderID = reply.key.remoteJid;
                let selectedId = '';

                if (message.interactiveResponseMessage && message.interactiveResponseMessage.nativeFlowResponseMessage) {
                    try {
                        const params = JSON.parse(message.interactiveResponseMessage.nativeFlowResponseMessage.paramsJson);
                        selectedId = params.id ? params.id : '';
                    } catch (e) {}
                } else if (message.extendedTextMessage?.contextInfo?.stanzaId === searchMsgId) {
                    const num = parseInt((message.conversation || message.extendedTextMessage?.text || '').trim());
                    if (!isNaN(num) && num >= 1 && num <= movies.length) {
                        selectedId = `ssub_mv_${num - 1}`;
                    }
                }

                if (!selectedId) return;

                const session = activeSessions.get(senderID);
                if (!session) return;

                // Extend Session Timeout
                clearTimeout(session.timeout);
                session.timeout = setTimeout(() => clearUserSession(socket, senderID), 30 * 60 * 1000);

                // ==================== 1. MOVIE SELECTED -> FETCH QUALITIES ====================
                if (selectedId.startsWith('ssub_mv_')) {
                    const idx = parseInt(selectedId.replace('ssub_mv_', ''));
                    const selectedMovie = session.movies[idx];
                    if (!selectedMovie) return;

                    await socket.sendMessage(senderID, { react: { text: '⏳', key: reply.key } });

                    try {
                        const movieUrl = selectedMovie.url ? selectedMovie.url : selectedMovie.link;
                        const dlApiUrl = `https://vortex-api-theta.vercel.app/movie/sinhalasub/movie?url=${encodeURIComponent(movieUrl)}`;
                        const dlRes = await axios.get(dlApiUrl, { timeout: 25000 });

                        let movieData = null;
                        if (dlRes.data && dlRes.data.result && dlRes.data.result.data) {
                            movieData = dlRes.data.result.data;
                        } else if (dlRes.data && dlRes.data.result) {
                            movieData = dlRes.data.result;
                        } else if (dlRes.data && dlRes.data.data) {
                            movieData = dlRes.data.data;
                        }

                        let rawLinks = [];
                        if (Array.isArray(movieData)) {
                            rawLinks = movieData;
                        } else if (movieData && Array.isArray(movieData.downloads)) {
                            rawLinks = movieData.downloads;
                        } else if (movieData && Array.isArray(movieData.dl_links)) {
                            rawLinks = movieData.dl_links;
                        }

                        if (!dlRes.data?.status || rawLinks.length === 0) {
                            await socket.sendMessage(senderID, { react: { text: '❌', key: reply.key } });
                            return await socket.sendMessage(senderID, { text: '❌ *No download links available for this movie.*' }, { quoted: reply });
                        }

                        // Filter DLSERVER-02 (DL2) first, fallback to any direct link
                        let links = rawLinks.filter(l => {
                            const hasDirect = Boolean(l.direct || l.download_url || l.link);
                            const isDL2 = l.server && l.server.toUpperCase() === 'DLSERVER-02';
                            return isDL2 && hasDirect;
                        });

                        if (links.length === 0) {
                            links = rawLinks.filter(l => Boolean(l.direct || l.download_url || l.link));
                        }

                        if (links.length === 0) {
                            await socket.sendMessage(senderID, { react: { text: '❌', key: reply.key } });
                            return await socket.sendMessage(senderID, { text: '❌ *Direct download links are not available for this movie.*' }, { quoted: reply });
                        }

                        const displayTitle = (movieData && movieData.title) ? movieData.title : selectedMovie.title;
                        const displayImage = (movieData && movieData.image) ? movieData.image : selectedMovie.image;

                        session.currentTitle = displayTitle;
                        session.links = links;

                        const dlMedia = await getMediaHeader(socket, displayImage);

                        // Put Quality + Size directly on the button title
                        const dlRows = links.map((l, i) => {
                            const q = l.quality ? l.quality : 'HD';
                            const s = l.size ? l.size : 'Unknown';
                            return {
                                title: `🎥 ${q} ┃ 💾 ${s}`,
                                description: `Download ${displayTitle.slice(0, 45)}`,
                                id: `ssub_dl_${i}`
                            };
                        });

                        const firstQ = links[0].quality ? links[0].quality : 'HD';
                        const firstS = links[0].size ? links[0].size : '';

                        const dlInteractiveMsg = proto.Message.InteractiveMessage.create({
                            body: proto.Message.InteractiveMessage.Body.create({
                                text: `🎬 *${displayTitle}*\n\n📂 *Select Quality & Size from the button below to download:*`
                            }),
                            footer: proto.Message.InteractiveMessage.Footer.create({ text: '© POWERED BY VORTEX BOT TEAM' }),
                            header: proto.Message.InteractiveMessage.Header.create({
                                hasMediaAttachment: true,
                                imageMessage: dlMedia.imageMessage
                            }),
                            nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
                                buttons: [
                                    {
                                        name: 'single_select',
                                        buttonParamsJson: JSON.stringify({
                                            title: `📥 ${firstQ} (${firstS})`,
                                            sections: [
                                                {
                                                    title: 'AVAILABLE QUALITIES & SIZES',
                                                    rows: dlRows
                                                }
                                            ]
                                        })
                                    }
                                ]
                            }),
                            contextInfo: { mentionedJid: [senderID] }
                        });

                        const dlFullMsg = generateWAMessageFromContent(
                            senderID,
                            { viewOnceMessage: { message: { interactiveMessage: dlInteractiveMsg } } },
                            { quoted: reply }
                        );

                        await socket.relayMessage(senderID, dlFullMsg.message, { messageId: dlFullMsg.key.id });
                        await socket.sendMessage(senderID, { react: { text: '✅', key: reply.key } });

                    } catch (e) {
                        await socket.sendMessage(senderID, { react: { text: '❌', key: reply.key } });
                        await socket.sendMessage(senderID, { text: '❌ *Failed to fetch links:* ' + e.message }, { quoted: reply });
                    }
                }

                // ==================== 2. QUALITY SELECTED -> DOWNLOAD MOVIE ====================
                else if (selectedId.startsWith('ssub_dl_')) {
                    if (session.isDownloading) {
                        return await socket.sendMessage(
                            senderID,
                            { text: '⏳ *A movie is already downloading. Please wait until it finishes!*' },
                            { quoted: reply }
                        );
                    }

                    const linkIdx = parseInt(selectedId.replace('ssub_dl_', ''));
                    const selectedLink = session.links ? session.links[linkIdx] : null;
                    if (!selectedLink) return;

                    session.isDownloading = true;
                    const title = session.currentTitle ? session.currentTitle : 'Movie';

                    const safeTitle = title.replace(/[^a-zA-Z0-9.\s-]/g, '').replace(/\s+/g, '_').slice(0, 50);
                    const qualityStr = (selectedLink.quality ? selectedLink.quality : 'HD').replace(/\s+/g, '');
                    const fileName = `${safeTitle}_${qualityStr}.mp4`;
                    const tempPath = path.join(TEMP_DIR, `${Date.now()}_${fileName}`);

                    let directDownloadUrl = selectedLink.direct;
                    if (!directDownloadUrl) directDownloadUrl = selectedLink.download_url;
                    if (!directDownloadUrl) directDownloadUrl = selectedLink.link;

                    try {
                        if (!directDownloadUrl) {
                            throw new Error('Direct download URL not found');
                        }

                        await socket.sendMessage(senderID, { react: { text: '⬇️', key: reply.key } });
                        await socket.sendMessage(
                            senderID,
                            {
                                text: `⬇️ *Downloading Movie...*\n\n🎬 *${title}*\n🎥 ${selectedLink.quality}\n💾 ${selectedLink.size}\n\n_Please wait, this might take a while..._`
                            },
                            { quoted: reply }
                        );

                        await downloadLargeFile(directDownloadUrl, tempPath);

                        await socket.sendMessage(senderID, { react: { text: '📤', key: reply.key } });

                        await socket.sendMessage(
                            senderID,
                            {
                                document: { url: tempPath },
                                mimetype: 'video/mp4',
                                fileName: fileName,
                                caption: `🎬 *${title}*\n🎥 ${selectedLink.quality} ┃ 💾 ${selectedLink.size}\n\n> *VORTEX MD | SinhalaSub*`
                            },
                            { quoted: reply }
                        );

                        await socket.sendMessage(senderID, { react: { text: '✅', key: reply.key } });

                    } catch (err) {
                        console.error('Movie Download Error:', err.message);
                        await socket.sendMessage(senderID, { react: { text: '❌', key: reply.key } });
                        await socket.sendMessage(
                            senderID,
                            { text: `❌ *Download failed:* ${err.message}` },
                            { quoted: reply }
                        );
                    } finally {
                        session.isDownloading = false;
                        try {
                            if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
                        } catch (e) {}
                    }
                }
            };

            socket.ev.on('messages.upsert', stepHandler);
            const sessionTimeout = setTimeout(() => clearUserSession(socket, sender), 30 * 60 * 1000);

            activeSessions.set(sender, {
                stepHandler: stepHandler,
                timeout: sessionTimeout,
                movies: movies,
                links: [],
                currentTitle: '',
                isDownloading: false
            });

        } catch (err) {
            console.error('Movie plugin error:', err.message);
            await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
            await socket.sendMessage(sender, { text: '❌ *Error:* ' + err.message }, { quoted: msg });
        }
    }
};
