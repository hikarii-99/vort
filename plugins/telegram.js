const fs = require('fs');
const path = require('path');

const { TelegramClient } = require('teleproto');
const { StringSession } = require('teleproto/sessions');
const { NewMessage } = require('teleproto/events');

const TG_API_ID = 38283171;
const TG_API_HASH = '7e20fe6ddcfbc41eeb4fb9950eaa6133';
const TG_SESSION = '1BQANOTEuMTA4LjU2LjEwMQG7dIaFVWiPbqPcY9wd3Qaym/ja104O/Cp2DOd5n7hAhqElKHSwGMlNNiiRqFRnA44Zgzm6EWHddbKyYUPy5rhKV/J7S6Bm4rQP5cpgQXOC6gmApdULugCHaQ6Gio9vPMgcVd6aMRQw+Q79hxvvpjmXb12DYvrFdmasL1UgD2LVbS/7N9JKujzqAb7WnWYOZLvgU2NYEpeT5nt6U8sNXoSfGrKJazMfdQOBcTO+Du8BHqRpqm0uvpXE6EgnNgU1djAYCbyJUL4Wr+El4BavxJHYVPYrvnuCL9qVDAWQ9couKg6iZ3XVQXBBXESewjwJKkVrVBvr6jrujFRN0Ni8EXhFmA==';

const telegram = new TelegramClient(
    new StringSession(TG_SESSION),
    TG_API_ID,
    TG_API_HASH,
    {
        connectionRetries: 5,
        useWSS: false
    }
);

let connected = false;

async function connectTelegram() {
    if (!connected) {
        await telegram.connect();
        if (!(await telegram.checkAuthorization())) {
            throw new Error('Telegram session invalid. Please generate a new session string.');
        }
        connected = true;
    }
    return telegram;
}

function formatBytes(bytes) {
    if (!bytes || bytes === 0) return 'Unknown';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
}

function cleanFileName(name) {
    return String(name || 'telegram_file')
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
        .slice(0, 180);
}

function parseTelegramLink(link) {
    const url = new URL(link.trim());

    if (!['t.me', 'telegram.me'].includes(url.hostname)) {
        throw new Error('Invalid Telegram link.');
    }

    const parts = url.pathname.split('/').filter(Boolean);

    if (url.searchParams.has('start') && parts.length === 1) {
        return {
            type: 'bot_start',
            username: parts[0],
            startParam: url.searchParams.get('start')
        };
    }

    if (parts.length === 2 && parts[0] !== 'c' && parts[0] !== 's') {
        return {
            type: 'public',
            username: parts[0],
            messageId: parseInt(parts[1], 10)
        };
    }

    if (parts.length === 3 && parts[0] === 'c') {
        return {
            type: 'private',
            channelId: parts[1],
            messageId: parseInt(parts[2], 10)
        };
    }

    throw new Error('Unsupported Telegram link format.');
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
                for (const msg of recent) {
                    if (msg.media) {
                        resolve(msg);
                        return;
                    }
                }
            } catch (e) {}

            reject(new Error('Bot did not reply with media in time. Try again.'));
        }, timeout);

        async function handler(event) {
            try {
                if (resolved) return;
                const msg = event.message;
                if (!msg || !msg.media) return;

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

        client.addEventHandler(handler, new NewMessage({}));
    });
}

module.exports = {
    command: ['tg', 'telegram', 'tgdl'],

    description: 'Download Telegram files (supports channels + bot start links)',

    ownerOnly: false,

    handler: async ({ socket, msg, sender, args }) => {
        let filePath = null;

        try {
            const link = args.join(' ').trim();

            if (!link) {
                return await socket.sendMessage(
                    sender,
                    {
                        text:
                            '📌 *Please provide a Telegram link!*\n\n' +
                            'Supported:\n' +
                            '• `.tg https://t.me/channel/123`\n' +
                            '• `.tg https://t.me/c/1234567890/123`\n' +
                            '• `.tg https://t.me/botname?start=XXXX`'
                    },
                    { quoted: msg }
                );
            }

            const parsed = parseTelegramLink(link);

            await socket.sendMessage(sender, {
                react: { text: '⏳', key: msg.key }
            });

            await socket.sendMessage(
                sender,
                {
                    text: '📥 *Telegram Downloader*\n\n⏳ Connecting to Telegram...'
                },
                { quoted: msg }
            );

            const client = await connectTelegram();

            let message;

            if (parsed.type === 'bot_start') {
                await socket.sendMessage(
                    sender,
                    {
                        text: `🤖 *Bot detected*\n\nBot: @${parsed.username}\n⏳ Starting bot & waiting for file...`
                    },
                    { quoted: msg }
                );

                const botEntity = await client.getEntity(parsed.username);
                await client.sendMessage(botEntity, {
                    message: `/start ${parsed.startParam}`
                });

                message = await waitForBotMedia(client, botEntity, 120000);

            } else {
                await socket.sendMessage(
                    sender,
                    {
                        text: '✅ Connected!\n\n🔎 Fetching message...'
                    },
                    { quoted: msg }
                );

                let entity;
                if (parsed.type === 'public') {
                    entity = await client.getEntity(parsed.username);
                } else {
                    const fullChannelId = BigInt(`-100${parsed.channelId}`);
                    entity = await client.getEntity(fullChannelId);
                }

                const messages = await client.getMessages(entity, {
                    ids: parsed.messageId
                });

                message = messages[0];

                if (!message) {
                    throw new Error('Message not found.');
                }
            }

            if (!message || !message.media) {
                throw new Error('No downloadable media found.');
            }

            let fileName = 'telegram_file';
            let fileSize = 0;
            let mimeType = 'application/octet-stream';

            if (message.media.document) {
                const doc = message.media.document;
                fileSize = Number(doc.size) || 0;
                mimeType = doc.mimeType || mimeType;

                const attr = doc.attributes?.find(a => a.className === 'DocumentAttributeFilename');
                if (attr) fileName = attr.fileName;
            } else if (message.media.photo) {
                fileName = `photo_${Date.now()}.jpg`;
                mimeType = 'image/jpeg';
            } else if (message.media.video) {
                fileName = `video_${Date.now()}.mp4`;
                mimeType = 'video/mp4';
            }

            fileName = cleanFileName(fileName);

            const downloadDir = path.join(process.cwd(), 'downloads', 'telegram');
            if (!fs.existsSync(downloadDir)) {
                fs.mkdirSync(downloadDir, { recursive: true });
            }

            filePath = path.join(downloadDir, `${Date.now()}_${fileName}`);

            await socket.sendMessage(
                sender,
                {
                    text:
                        `⬇️ *Downloading to Disk...*\n\n` +
                        `📄 *File:* ${fileName}\n` +
                        `📦 *Size:* ${formatBytes(fileSize)}`
                },
                { quoted: msg }
            );

            await client.downloadMedia(message.media, {
                outputFile: filePath,
                workers: 4
            });

            if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) {
                throw new Error('Download failed — file is empty or missing.');
            }

            const downloadedSize = fs.statSync(filePath).size;
            
            // 64 MB Limit Check
            const MAX_DIRECT_MEDIA_SIZE = 64 * 1024 * 1024; // 64 MB
            const isLargeFile = downloadedSize > MAX_DIRECT_MEDIA_SIZE;

            const isVideo = mimeType.startsWith('video/') && !isLargeFile;
            const isImage = mimeType.startsWith('image/') && !isLargeFile;

            await socket.sendMessage(
                sender,
                {
                    text: `📤 *Uploading to WhatsApp...*\n\n📄 ${fileName}\n📦 ${formatBytes(downloadedSize)}`
                },
                { quoted: msg }
            );

            if (isVideo) {
                await socket.sendMessage(
                    sender,
                    {
                        video: { url: filePath },
                        caption: `✅ *Downloaded from Telegram*\n📄 ${fileName}\n📦 ${formatBytes(downloadedSize)}`,
                        mimetype: mimeType
                    },
                    { quoted: msg }
                );
            } else if (isImage) {
                await socket.sendMessage(
                    sender,
                    {
                        image: { url: filePath },
                        caption: `✅ *Downloaded from Telegram*\n📄 ${fileName}\n📦 ${formatBytes(downloadedSize)}`
                    },
                    { quoted: msg }
                );
            } else {
                await socket.sendMessage(
                    sender,
                    {
                        document: { url: filePath },
                        fileName: fileName,
                        mimetype: mimeType,
                        caption: `✅ *Downloaded from Telegram*\n📄 ${fileName}\n📦 ${formatBytes(downloadedSize)}`
                    },
                    { quoted: msg }
                );
            }

            await socket.sendMessage(sender, {
                react: { text: '✅', key: msg.key }
            });

        } catch (error) {
            console.error('Telegram Downloader Error:', error);

            await socket.sendMessage(sender, {
                react: { text: '❌', key: msg.key }
            });

            await socket.sendMessage(
                sender,
                {
                    text: `❌ *Telegram Error!*\n\n${error.message || error}`
                },
                { quoted: msg }
            );
        } finally {
            // Upload එක ඉවර වුණාට පස්සෙ file එක අයින් කරන කොටස 
            if (filePath && fs.existsSync(filePath)) {
                setTimeout(() => {
                    try {
                        fs.unlinkSync(filePath);
                        console.log(`[+] Successfully deleted file from disk: ${filePath}`);
                    } catch (e) {
                        console.error('[-] Failed to delete file:', e);
                    }
                }, 2000); // 2 seconds delay to ensure WhatsApp fully releases the file
            }
        }
    }
};
