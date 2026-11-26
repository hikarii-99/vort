const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const { TelegramClient } = require('teleproto');
const { StringSession } = require('teleproto/sessions');
const { NewMessage } = require('teleproto/events');

// ==================== CONFIG ====================
const TG_API_ID = 38283171;
const TG_API_HASH = '7e20fe6ddcfbc41eeb4fb9950eaa6133';
const TG_SESSION = '1BQANOTEuMTA4LjU2LjEwMQG7dIaFVWiPbqPcY9wd3Qaym/ja104O/Cp2DOd5n7hAhqElKHSwGMlNNiiRqFRnA44Zgzm6EWHddbKyYUPy5rhKV/J7S6Bm4rQP5cpgQXOC6gmApdULugCHaQ6Gio9vPMgcVd6aMRQw+Q79hxvvpjmXb12DYvrFdmasL1UgD2LVbS/7N9JKujzqAb7WnWYOZLvgU2NYEpeT5nt6U8sNXoSfGrKJazMfdQOBcTO+Du8BHqRpqm0uvpXE6EgnNgU1djAYCbyJUL4Wr+El4BavxJHYVPYrvnuCL9qVDAWQ9couKg6iZ3XVQXBBXESewjwJKkVrVBvr6jrujFRN0Ni8EXhFmA==';

const UA = 'Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

const telegram = new TelegramClient(
    new StringSession(TG_SESSION),
    TG_API_ID,
    TG_API_HASH,
    { connectionRetries: 5, useWSS: false }
);

let connected = false;

async function connectTelegram() {
    if (!connected) {
        await telegram.connect();
        if (!(await telegram.checkAuthorization())) {
            throw new Error('Session invalid. Generate a new one.');
        }
        connected = true;
    }
    return telegram;
}

// ==================== HELPERS ====================
function formatBytes(bytes) {
    if (!bytes || bytes === 0) return 'Unknown';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(2) + ' ' + units[i];
}

function cleanFileName(name) {
    return String(name || 'file').replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').slice(0, 180);
}

function parseTelegramLink(link) {
    const url = new URL(link.trim());
    if (!['t.me', 'telegram.me'].includes(url.hostname)) {
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

async function waitForBotMedia(client, botEntity, timeout) {
    timeout = timeout || 120000;
    return new Promise(async function(resolve, reject) {
        var resolved = false;

        var timer = setTimeout(async function() {
            if (resolved) return;
            resolved = true;
            client.removeEventHandler(handler);
            try {
                var recent = await client.getMessages(botEntity, { limit: 5 });
                for (var i = 0; i < recent.length; i++) {
                    if (recent[i].media) {
                        resolve(recent[i]);
                        return;
                    }
                }
            } catch (e) {}
            reject(new Error('Source did not send media in time.'));
        }, timeout);

        async function handler(event) {
            try {
                if (resolved) return;
                var msg = event.message;
                if (!msg || !msg.media) return;

                var senderId = msg.senderId ? msg.senderId.toString() : null;
                var botId = botEntity.id.toString();

                if (senderId === botId) {
                    resolved = true;
                    clearTimeout(timer);
                    client.removeEventHandler(handler);
                    resolve(msg);
                }
            } catch (e) {}
        }

        client.addEventHandler(handler, new NewMessage({}));
    });
}

// ==================== CINESUBZ SCRAPERS ====================
async function searchCinesubz(query) {
    var res = await axios.get('https://cinesubz.co/?s=' + encodeURIComponent(query), {
        headers: { 'User-Agent': UA },
        timeout: 20000
    });

    var $ = cheerio.load(res.data);
    var results = [];

    $('.display-item').slice(0, 8).each(function(i, el) {
        var title = $(el).find('h3').text().trim() || $(el).find('a').attr('title');
        var link = $(el).find('a').first().attr('href');
        var image = $(el).find('img').attr('data-original') || $(el).find('img').attr('src');

        if (title && link) {
            results.push({ title: title, link: link, image: image });
        }
    });

    return results;
}

async function getMovieOrSeriesDetails(url) {
    var res = await axios.get(url, {
        headers: { 'User-Agent': UA },
        timeout: 20000
    });

    var $ = cheerio.load(res.data);

    var title = $('title').text()
        .replace(/ \| සිංහල.*$/, '')
        .replace(/With Sinhala Subtitles.*$/i, '')
        .trim();

    var poster = $('meta[property="og:image"]').attr('content') || $('.poster img').attr('src');

    var episodes = [];
    $('.episode-link').each(function(i, el) {
        var season = parseInt($(el).attr('data-season')) || 0;
        var episode = parseInt($(el).attr('data-episode')) || 0;
        var name = $(el).find('.ep-title').text().trim() || ('Episode ' + episode);
        var link = $(el).attr('href');

        if (season && episode && link) {
            episodes.push({ season: season, episode: episode, name: name, link: link });
        }
    });

    episodes.sort(function(a, b) {
        return a.season - b.season || a.episode - b.episode;
    });

    var downloads = [];
    $('a.download-button, a.movie-download-button').each(function(i, el) {
        var link = $(el).attr('href');
        var meta = $(el).find('.download-meta').text().trim() ||
                   $(el).text().replace(/\s+/g, ' ').trim();

        if (link && link !== '#' && !downloads.some(function(d) { return d.link === link; })) {
            downloads.push({ meta: meta, link: link });
        }
    });

    return {
        title: title,
        poster: poster,
        isSeries: episodes.length > 0,
        episodes: episodes,
        downloads: downloads
    };
}

async function getEpisodeDownloads(episodeUrl) {
    var res = await axios.get(episodeUrl, {
        headers: { 'User-Agent': UA },
        timeout: 20000
    });

    var $ = cheerio.load(res.data);
    var downloads = [];

    $('a.download-button').each(function(i, el) {
        var link = $(el).attr('href');
        var meta = $(el).find('.download-meta').text().trim() ||
                   $(el).text().replace(/\s+/g, ' ').trim();

        if (link && link !== '#') {
            downloads.push({ meta: meta, link: link });
        }
    });

    return downloads;
}

// ==================== DOWNLOAD PIPELINE ====================
async function resolveToTelegramLink(apiLink) {
    var step = await axios.get(apiLink, {
        headers: { 'User-Agent': UA },
        timeout: 25000
    });

    var $ = cheerio.load(step.data);
    var originalUrl = $('#link').attr('href');
    if (!originalUrl) throw new Error('Could not find primary download link.');

    var modifiedUrl = originalUrl;
    var mappings = [
        { search: ['https://google.com/server11/1:/', 'https://google.com/server12/1:/', 'https://google.com/server13/1:/'], replace: 'https://drive.csplayer2.space/server1/' },
        { search: ['https://google.com/server21/1:/', 'https://google.com/server22/1:/', 'https://google.com/server23/1:/'], replace: 'https://drive.csplayer2.space/server2/' },
        { search: ['https://google.com/server3/1:/'], replace: 'https://drive.csplayer2.space/server3/' },
        { search: ['https://google.com/server4/1:/'], replace: 'https://drive.csplayer2.space/server4/' },
        { search: ['https://google.com/server5/1:/'], replace: 'https://drive.csplayer2.space/server5/' },
        { search: ['https://google.com/server6/'], replace: 'https://drive.csplayer2.space/server6/' },
        { search: ['https://google.com/server7/'], replace: 'https://drive.csplayer2.space/server7/' }
    ];

    for (var m = 0; m < mappings.length; m++) {
        for (var s = 0; s < mappings[m].search.length; s++) {
            if (modifiedUrl.indexOf(mappings[m].search[s]) !== -1) {
                modifiedUrl = modifiedUrl.replace(mappings[m].search[s], mappings[m].replace);
                modifiedUrl = modifiedUrl
                    .replace('.mp4?bot=cscloud2bot&code=', '?ext=mp4&bot=cscloud2bot&code=')
                    .replace('.mp4', '?ext=mp4')
                    .replace('.mkv?bot=cscloud2bot&code=', '?ext=mkv&bot=cscloud2bot&code=')
                    .replace('.mkv', '?ext=mkv')
                    .replace('.zip', '?ext=zip');
                break;
            }
        }
    }

    var p1 = await axios.get(modifiedUrl, {
        headers: { 'User-Agent': UA, Referer: 'https://cinesubz.co/' },
        validateStatus: function() { return true; },
        timeout: 30000
    });

    var cookie = (p1.headers['set-cookie'] || []).map(function(c) { return c.split(';')[0]; }).join('; ');

    var u = new URL(modifiedUrl);
    var apiEndpoint = u.origin + '/api/download-data' + u.pathname + u.search;

    var apiRes = await axios.get(apiEndpoint, {
        headers: { 'User-Agent': UA, Accept: 'application/json', Referer: modifiedUrl, Cookie: cookie },
        validateStatus: function() { return true; },
        timeout: 30000
    });

    var c2 = (apiRes.headers['set-cookie'] || []).map(function(c) { return c.split(';')[0]; }).join('; ');
    if (c2) cookie = cookie ? cookie + '; ' + c2 : c2;

    var finalUrl = modifiedUrl;
    if (apiRes.data && apiRes.data.redirect) {
        finalUrl = apiRes.data.redirect.indexOf('http') === 0 ? apiRes.data.redirect : u.origin + apiRes.data.redirect;
    }

    var p2 = await axios.get(finalUrl, {
        headers: { 'User-Agent': UA, Referer: modifiedUrl, Cookie: cookie },
        responseType: 'text',
        validateStatus: function() { return true; },
        timeout: 30000
    });

    var match = String(p2.data).match(/https:\/\/telegram\.me\/[a-zA-Z0-9_?=&]+/);
    if (!match) throw new Error('Could not extract download source link.');

    return match[0];
}

async function downloadFromTelegram(tgLink, socket, sender, quoted, title) {
    var parsed = parseTelegramLink(tgLink);
    var client = await connectTelegram();
    var message;

    if (parsed.type === 'bot_start') {
        var botEntity = await client.getEntity(parsed.username);
        await client.sendMessage(botEntity, { message: '/start ' + parsed.startParam });
        message = await waitForBotMedia(client, botEntity, 120000);
    } else {
        var entity;
        if (parsed.type === 'public') {
            entity = await client.getEntity(parsed.username);
        } else {
            entity = await client.getEntity(BigInt('-100' + parsed.channelId));
        }
        var messages = await client.getMessages(entity, { ids: parsed.messageId });
        message = messages[0];
        if (!message) throw new Error('Message not found.');
    }

    if (!message || !message.media) throw new Error('No media found.');

    var fileName = 'file';
    var fileSize = 0;
    var mimeType = 'application/octet-stream';

    if (message.media.document) {
        var doc = message.media.document;
        fileSize = Number(doc.size) || 0;
        mimeType = doc.mimeType || mimeType;
        var attr = doc.attributes && doc.attributes.find(function(a) { return a.className === 'DocumentAttributeFilename'; });
        if (attr) fileName = attr.fileName;
    } else if (message.media.video) {
        fileName = 'video_' + Date.now() + '.mp4';
        mimeType = 'video/mp4';
    }

    fileName = cleanFileName(fileName);

    var dir = path.join(process.cwd(), 'downloads', 'cinesubz');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    var filePath = path.join(dir, Date.now() + '_' + fileName);

    await socket.sendMessage(sender, {
        text: '⬇️ *Downloading...*\n\n📄 ' + fileName + '\n📦 ' + formatBytes(fileSize)
    }, { quoted: quoted });

    await client.downloadMedia(message.media, { outputFile: filePath, workers: 4 });

    if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) {
        throw new Error('Download failed (empty file).');
    }

    var size = fs.statSync(filePath).size;
    var isLarge = size > 64 * 1024 * 1024;
    var isVideo = mimeType.indexOf('video/') === 0 && !isLarge;

    await socket.sendMessage(sender, {
        text: '📤 *Uploading to WhatsApp...*\n\n📄 ' + fileName + '\n📦 ' + formatBytes(size)
    }, { quoted: quoted });

    var caption = '🎬 *' + title + '*\n\n✅ Downloaded successfully\n📄 ' + fileName + '\n📦 ' + formatBytes(size) + '\n\n> VORTEX MD';

    if (isVideo) {
        await socket.sendMessage(sender, {
            video: { url: filePath },
            caption: caption,
            mimetype: mimeType
        }, { quoted: quoted });
    } else {
        await socket.sendMessage(sender, {
            document: { url: filePath },
            fileName: fileName,
            mimetype: mimeType,
            caption: caption
        }, { quoted: quoted });
    }

    try { fs.unlinkSync(filePath); } catch (e) {}
}

// ==================== SESSION ====================
var sessions = new Map();

// ==================== PLUGIN ====================
module.exports = {
    command: ['cinesubz2', 'csz2', 'movie2', 'film2'],
    description: 'Search & Download Movies / TV Series from CineSubz',
    ownerOnly: false,

    handler: async function({ socket, msg, sender, args }) {
        try {
            var query = args.join(' ').trim();
            if (!query) {
                return socket.sendMessage(sender, {
                    text: '🎬 *CineSubz Downloader*\n\nUsage:\n`.cinesubz <movie/series name>`\n\nExample:\n`.cinesubz game of thrones`'
                }, { quoted: msg });
            }

            await socket.sendMessage(sender, { react: { text: '🔍', key: msg.key } });
            await socket.sendMessage(sender, { text: '🔍 Searching for *' + query + '*...' }, { quoted: msg });

            var results = await searchCinesubz(query);

            if (!results.length) {
                return socket.sendMessage(sender, {
                    text: '❌ No results found for *' + query + '*'
                }, { quoted: msg });
            }

            var text = '🎬 *Search Results*\n\n';
            results.forEach(function(r, i) {
                text += '*' + (i + 1) + '.* ' + r.title + '\n';
            });
            text += '\n↩️ Reply with a number (1-' + results.length + ')';

            var sent = await socket.sendMessage(sender, {
                image: { url: results[0].image },
                caption: text
            }, { quoted: msg });

            sessions.set(sent.key.id, {
                type: 'search',
                results: results,
                expires: Date.now() + 10 * 60 * 1000
            });

            var onReply = async function({ messages }) {
                var m = messages[0];
                if (!m || !m.message) return;

                var replyText = (m.message.conversation || (m.message.extendedTextMessage && m.message.extendedTextMessage.text) || '').trim();
                var quotedId = m.message.extendedTextMessage && m.message.extendedTextMessage.contextInfo && m.message.extendedTextMessage.contextInfo.stanzaId;

                if (!quotedId || !sessions.has(quotedId)) return;

                var session = sessions.get(quotedId);
                if (Date.now() > session.expires) {
                    sessions.delete(quotedId);
                    return;
                }

                var idx = parseInt(replyText) - 1;

                // SEARCH → DETAILS
                if (session.type === 'search') {
                    if (isNaN(idx) || !session.results[idx]) return;

                    await socket.sendMessage(sender, { react: { text: '⏳', key: m.key } });
                    var item = session.results[idx];
                    var details = await getMovieOrSeriesDetails(item.link);

                    if (details.isSeries) {
                        var seasons = {};
                        details.episodes.forEach(function(ep) {
                            if (!seasons[ep.season]) seasons[ep.season] = [];
                            seasons[ep.season].push(ep);
                        });

                        var epText = '📺 *' + details.title + '*\n\n';
                        Object.keys(seasons).forEach(function(s) {
                            epText += '*Season ' + s + '* (' + seasons[s].length + ' eps)\n';
                        });
                        epText += '\n↩️ Reply with *S1E3* or just episode number';

                        var epMsg = await socket.sendMessage(sender, {
                            image: { url: details.poster || item.image },
                            caption: epText
                        }, { quoted: m });

                        sessions.set(epMsg.key.id, {
                            type: 'series',
                            episodes: details.episodes,
                            title: details.title,
                            expires: Date.now() + 12 * 60 * 1000
                        });

                    } else {
                        if (!details.downloads.length) {
                            return socket.sendMessage(sender, {
                                text: '❌ No download links found.'
                            }, { quoted: m });
                        }

                        var dlText = '🎬 *' + details.title + '*\n\n📥 *Select Quality:*\n\n';
                        details.downloads.forEach(function(d, i) {
                            dlText += '*' + (i + 1) + '.* ' + d.meta + '\n';
                        });
                        dlText += '\n↩️ Reply with number';

                        var dlMsg = await socket.sendMessage(sender, {
                            image: { url: details.poster || item.image },
                            caption: dlText
                        }, { quoted: m });

                        sessions.set(dlMsg.key.id, {
                            type: 'downloads',
                            links: details.downloads,
                            title: details.title,
                            expires: Date.now() + 10 * 60 * 1000
                        });
                    }
                }

                // SERIES → EPISODE
                else if (session.type === 'series') {
                    var target = null;
                    var seMatch = replyText.toUpperCase().match(/^S(\d+)E(\d+)$/);

                    if (seMatch) {
                        target = session.episodes.find(function(e) {
                            return e.season === parseInt(seMatch[1]) && e.episode === parseInt(seMatch[2]);
                        });
                    } else {
                        var num = parseInt(replyText);
                        if (!isNaN(num) && session.episodes[num - 1]) {
                            target = session.episodes[num - 1];
                        }
                    }

                    if (!target) {
                        return socket.sendMessage(sender, {
                            text: '❌ Invalid episode. Use S1E3 or number.'
                        }, { quoted: m });
                    }

                    await socket.sendMessage(sender, { react: { text: '⏳', key: m.key } });

                    var epDownloads = await getEpisodeDownloads(target.link);

                    if (!epDownloads.length) {
                        return socket.sendMessage(sender, {
                            text: '❌ No download links for this episode.'
                        }, { quoted: m });
                    }

                    var text2 = '📺 *' + session.title + '*\n🎞️ S' + target.season + 'E' + target.episode + ' - ' + target.name + '\n\n📥 *Select Quality:*\n\n';
                    epDownloads.forEach(function(d, i) {
                        text2 += '*' + (i + 1) + '.* ' + d.meta + '\n';
                    });
                    text2 += '\n↩️ Reply with number';

                    var dlMsg2 = await socket.sendMessage(sender, {
                        text: text2
                    }, { quoted: m });

                    sessions.set(dlMsg2.key.id, {
                        type: 'downloads',
                        links: epDownloads,
                        title: session.title + ' S' + target.season + 'E' + target.episode,
                        expires: Date.now() + 10 * 60 * 1000
                    });
                }

                // DOWNLOAD
                else if (session.type === 'downloads') {
                    if (isNaN(idx) || !session.links[idx]) return;

                    socket.ev.off('messages.upsert', onReply);
                    sessions.delete(quotedId);

                    try {
                        await socket.sendMessage(sender, { react: { text: '🔄', key: m.key } });
                        await socket.sendMessage(sender, {
                            text: '🔄 *Resolving download link...*'
                        }, { quoted: m });

                        var tgLink = await resolveToTelegramLink(session.links[idx].link);

                        await socket.sendMessage(sender, {
                            text: '📥 *Starting download...*'
                        }, { quoted: m });

                        await downloadFromTelegram(tgLink, socket, sender, m, session.title);

                        await socket.sendMessage(sender, {
                            react: { text: '✅', key: m.key }
                        });

                    } catch (err) {
                        console.error(err);
                        await socket.sendMessage(sender, {
                            react: { text: '❌', key: m.key }
                        });
                        await socket.sendMessage(sender, {
                            text: '❌ *Error:* ' + err.message
                        }, { quoted: m });
                    }
                }
            };

            socket.ev.on('messages.upsert', onReply);
            setTimeout(function() {
                socket.ev.off('messages.upsert', onReply);
            }, 15 * 60 * 1000);

        } catch (err) {
            console.error(err);
            await socket.sendMessage(sender, {
                react: { text: '❌', key: msg.key }
            });
            await socket.sendMessage(sender, {
                text: '❌ *Error:* ' + err.message
            }, { quoted: msg });
        }
    }
};