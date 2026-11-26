const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const { exec } = require('child_process');
const router = express.Router();
const pino = require('pino');
const cheerio = require('cheerio');
const moment = require('moment-timezone');
const Jimp = require('jimp');
const crypto = require('crypto');
const axios = require('axios');
const { sms, downloadMediaMessage } = require("./msg");
const { handlePlayCommand } = require('./plugins/play');
const { handleCarCommand } = require('./plugins/cargame');

const {
    default: makeWASocket,
    useMultiFileAuthState,
    delay,
    getContentType,
    makeCacheableSignalKeyStore,
    Browsers,
    fetchLatestBaileysVersion,
    jidNormalizedUser,
    downloadContentFromMessage,
    proto,
    prepareWAMessageMedia,
    generateWAMessageFromContent,
    S_WHATSAPP_NET
} = require('baileys');

const config = {
    AUTO_VIEW_STATUS: 'true',
    AUTO_LIKE_STATUS: 'true',
    AUTO_RECORDING: 'false',
    ANTI_DELETE: 'true',
    BOT_FOOTER: '> *VORTEX MD*',
    AUTO_LIKE_EMOJI: ['💋', '🍬', '🫰', '💖', '🎈', '🎉', '🥳', '❤️', '🧸', '🐭'],
    PREFIX: '.',
    MAX_RETRIES: 3,
    GROUP_INVITE_LINK: 'https://chat.whatsapp.com/F7IbK1prI0H6w5tJUXf2zB',
    ADMIN_LIST_PATH: './admin.json',
    RCD_IMAGE_PATH: './vortexbot.jpg',
    NEWSLETTER_JID: '120363399456492644@newsletter',
    NEWSLETTER_MESSAGE_ID: '428',
    OTP_EXPIRY: 300000,
    OWNER_NUMBER: '94763513529',
    CHANNEL_LINK: 'https://whatsapp.com/channel/0029VbALrWd72WTxLzqqKG1y'
};

const activeSockets = new Map();
const socketCreationTime = new Map();
const SESSION_BASE_PATH = './session';
const NUMBER_LIST_PATH = './numbers.json';
const PLUGINS_PATH = './plugins';
const otpStore = new Map();
const tempMessageStore = new Map();
const processedDeleteIds = new Set();

// ── Plugin Loader ──
const plugins = new Map();

function loadPlugins() {
    if (!fs.existsSync(PLUGINS_PATH)) {
        fs.mkdirSync(PLUGINS_PATH, { recursive: true });
        console.log('📁 plugins/ folder created');
    }

    const files = fs.readdirSync(PLUGINS_PATH).filter(f => f.endsWith('.js'));

    for (const file of files) {
        try {
            const pluginPath = path.resolve(PLUGINS_PATH, file);
            // Clear cache so hot-reload works
            delete require.cache[require.resolve(pluginPath)];
            const plugin = require(pluginPath);

            if (!plugin.command || typeof plugin.handler !== 'function') {
                console.warn(`⚠️ Plugin ${file} missing 'command' or 'handler'. Skipped.`);
                continue;
            }

            const commands = Array.isArray(plugin.command) ? plugin.command : [plugin.command];
            for (const cmd of commands) {
                plugins.set(cmd.toLowerCase(), plugin);
            }

            console.log(`✅ Plugin loaded: ${file} → [${commands.join(', ')}]`);
        } catch (err) {
            console.error(`❌ Failed to load plugin ${file}:`, err.message);
        }
    }

    console.log(`📦 Total plugins loaded: ${plugins.size}`);
}

// Load plugins on startup
loadPlugins();

if (!fs.existsSync(SESSION_BASE_PATH)) {
    fs.mkdirSync(SESSION_BASE_PATH, { recursive: true });
}

function loadAdmins() {
    try {
        if (fs.existsSync(config.ADMIN_LIST_PATH)) {
            return JSON.parse(fs.readFileSync(config.ADMIN_LIST_PATH, 'utf8'));
        }
        return [];
    } catch (error) {
        console.error('Failed to load admin list:', error);
        return [];
    }
}

function formatMessage(title, content, footer) {
    return `*${title}*\n\n${content}\n\n> *${footer}*`;
}

function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

function getSriLankaTimestamp() {
    return moment().tz('Asia/Colombo').format('YYYY-MM-DD HH:mm:ss');
}

async function cleanDuplicateFiles(number) {
    console.log(`🧹 Cleaning duplicate files skipped for ${number} (Local Mode)`);
}

async function joinGroup(socket) {
    let retries = config.MAX_RETRIES;
    const inviteCodeMatch = config.GROUP_INVITE_LINK.match(/chat\.whatsapp\.com\/([a-zA-Z0-9]+)/);
    if (!inviteCodeMatch) {
        console.error('Invalid group invite link format');
        return { status: 'failed', error: 'Invalid group invite link' };
    }
    const inviteCode = inviteCodeMatch[1];

    while (retries > 0) {
        try {
            const response = await socket.groupAcceptInvite(inviteCode);
            if (response?.gid) {
                console.log(`Successfully joined group with ID: ${response.gid}`);
                return { status: 'success', gid: response.gid };
            }
            throw new Error('No group ID in response');
        } catch (error) {
            retries--;
            let errorMessage = error.message || 'Unknown error';
            if (error.message.includes('not-authorized')) {
                errorMessage = 'Bot is not authorized to join (possibly banned)';
            } else if (error.message.includes('conflict')) {
                errorMessage = 'Bot is already a member of the group';
            } else if (error.message.includes('gone')) {
                errorMessage = 'Group invite link is invalid or expired';
            }
            console.warn(`Failed to join group, retries left: ${retries}`, errorMessage);
            if (retries === 0) {
                return { status: 'failed', error: errorMessage };
            }
            await delay(2000 * (config.MAX_RETRIES - retries));
        }
    }
    return { status: 'failed', error: 'Max retries reached' };
}

async function sendAdminConnectMessage(socket, number, groupResult) {
    const admins = loadAdmins();
    const caption = formatMessage(
        '💖 CONNECTED SUCCESS 💖',
        `📱 Number: ${number}\n💙 Status: Connected Local Mode`,
        'VORTEX MD WORKING'
    );

    for (const admin of admins) {
        try {
            await socket.sendMessage(
                `${admin}@s.whatsapp.net`,
                {
                    image: { url: config.RCD_IMAGE_PATH },
                    caption
                }
            );
        } catch (error) {
            console.error(`Failed to send connect message to admin ${admin}:`, error);
        }
    }
}

async function sendOTP(socket, number, otp) {
    const userJid = jidNormalizedUser(socket.user.id);
    const message = formatMessage(
        '🔑 OTP VERIFICATION',
        `Your OTP for config update is: *${otp}*\nThis OTP will expire in 5 minutes.`,
        'POWERED BY VORTEX MD'
    );

    try {
        await socket.sendMessage(userJid, { text: message });
        console.log(`OTP ${otp} sent to ${number}`);
    } catch (error) {
        console.error(`Failed to send OTP to ${number}:`, error);
        throw error;
    }
}

async function setupStatusHandlers(socket) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const message = messages[0];
        if (!message?.key || message.key.remoteJid !== 'status@broadcast' || !message.key.participant || message.key.remoteJid === config.NEWSLETTER_JID) return;

        try {
            if (config.AUTO_RECORDING === 'true' && message.key.remoteJid) {
                await socket.sendPresenceUpdate("recording", message.key.remoteJid);
            }

            if (config.AUTO_VIEW_STATUS === 'true') {
                let retries = config.MAX_RETRIES;
                while (retries > 0) {
                    try {
                        await socket.readMessages([message.key]);
                        break;
                    } catch (error) {
                        retries--;
                        console.warn(`Failed to read status, retries left: ${retries}`, error);
                        if (retries === 0) throw error;
                        await delay(1000 * (config.MAX_RETRIES - retries));
                    }
                }
            }

            if (config.AUTO_LIKE_STATUS === 'true') {
                const randomEmoji = config.AUTO_LIKE_EMOJI[Math.floor(Math.random() * config.AUTO_LIKE_EMOJI.length)];
                let retries = config.MAX_RETRIES;
                while (retries > 0) {
                    try {
                        await socket.sendMessage(
                            message.key.remoteJid,
                            { react: { text: randomEmoji, key: message.key } },
                            { statusJidList: [message.key.participant] }
                        );
                        console.log(`Reacted to status with ${randomEmoji}`);
                        break;
                    } catch (error) {
                        retries--;
                        console.warn(`Failed to react to status, retries left: ${retries}`, error);
                        if (retries === 0) throw error;
                        await delay(1000 * (config.MAX_RETRIES - retries));
                    }
                }
            }
        } catch (error) {
            console.error('Status handler error:', error);
        }
    });
}

// ── Anti-Delete Core Function ──
async function processAntiDelete(socket, deletedKey) {
    if (config.ANTI_DELETE !== 'true' || !deletedKey?.id) return;
    if (processedDeleteIds.has(deletedKey.id)) return;

    const originalMsg = tempMessageStore.get(deletedKey.id);
    if (!originalMsg || !originalMsg.message) return;

    processedDeleteIds.add(deletedKey.id);
    if (processedDeleteIds.size > 500) {
        const firstId = processedDeleteIds.values().next().value;
        processedDeleteIds.delete(firstId);
    }

    try {
        const botJid = jidNormalizedUser(socket.user.id);
        const chatJid = originalMsg.key.remoteJid;
        const isGroup = chatJid.endsWith('@g.us');
        const originalSender = originalMsg.key.participant || (originalMsg.key.fromMe ? botJid : originalMsg.key.remoteJid);

        let fromName = 'Private';
        if (isGroup) {
            try {
                const groupMetadata = await socket.groupMetadata(chatJid);
                fromName = groupMetadata?.subject ? `${groupMetadata.subject}` : chatJid;
            } catch (e) {
                fromName = chatJid;
            }
        }

        const unwrapMsg = (m) => {
            return m?.viewOnceMessageV2?.message || m?.viewOnceMessage?.message || m?.viewOnceMessageV2Extension?.message || m;
        };

        const unwrappedContent = unwrapMsg(originalMsg.message);
        const msgType = getContentType(unwrappedContent);
        const footer = `\n\n${config.BOT_FOOTER || '> *VORTEX MD*'}`;

        let alertText = `🚫 *𝑨𝒏𝒕𝒊 𝒅𝒆𝒍𝒆𝒕𝒆 𝒂𝒍𝒆𝒓𝒕* 🚫\n\n`;
        alertText += `*👤 𝒔𝒆𝒏𝒅𝒆𝒓:* @${originalSender.split('@')[0]}\n`;
        alertText += `*🏡 𝒇𝒓𝒐𝒎:* ${fromName}\n`;

        if (msgType === 'conversation' || msgType === 'extendedTextMessage') {
            const deletedText = msgType === 'conversation'
                ? unwrappedContent.conversation
                : unwrappedContent.extendedTextMessage?.text || '';
            alertText += `*🌿 𝒅𝒆𝒍𝒆𝒕𝒆 𝒎𝒔𝒈:* ${deletedText}`;

            await socket.sendMessage(botJid, { text: alertText + footer, mentions: [originalSender] }, { quoted: originalMsg });
        } else if (msgType === 'imageMessage' || msgType === 'videoMessage' || msgType === 'audioMessage' || msgType === 'documentMessage' || msgType === 'stickerMessage') {
            let mediaBuffer = null;
            try {
                let streamType = msgType.replace('Message', '');
                const stream = await downloadContentFromMessage(unwrappedContent[msgType], streamType);
                let chunks = [];
                for await (const chunk of stream) chunks.push(chunk);
                mediaBuffer = Buffer.concat(chunks);
            } catch (err) {
                mediaBuffer = await downloadMediaMessage({ message: unwrappedContent, type: msgType, msg: unwrappedContent[msgType] }).catch(() => null);
            }

            if (!mediaBuffer) return;

            if (msgType === 'imageMessage') {
                let cap = unwrappedContent.imageMessage?.caption;
                let msgText = cap ? cap : '[Image]';
                alertText += `*🌿 𝒅𝒆𝒍𝒆𝒕𝒆 𝒎𝒔𝒈:* ${msgText}`;
                await socket.sendMessage(botJid, { image: mediaBuffer, caption: alertText + footer, mentions: [originalSender] }, { quoted: originalMsg });
            } else {
                alertText += `*🌿 𝒅𝒆𝒍𝒆𝒕𝒆 𝒎𝒔𝒈:* [${msgType.replace('Message', ' File')}]`;
                await socket.sendMessage(botJid, { text: alertText + footer, mentions: [originalSender] }, { quoted: originalMsg });

                if (msgType === 'videoMessage') {
                    await socket.sendMessage(botJid, { video: mediaBuffer, caption: unwrappedContent.videoMessage?.caption || '' });
                } else if (msgType === 'audioMessage') {
                    await socket.sendMessage(botJid, { audio: mediaBuffer, mimetype: unwrappedContent.audioMessage?.mimetype || 'audio/mp4', ptt: unwrappedContent.audioMessage?.ptt || false });
                } else if (msgType === 'documentMessage') {
                    await socket.sendMessage(botJid, { document: mediaBuffer, mimetype: unwrappedContent.documentMessage?.mimetype || 'application/octet-stream', fileName: unwrappedContent.documentMessage?.fileName || 'document' });
                } else if (msgType === 'stickerMessage') {
                    await socket.sendMessage(botJid, { sticker: mediaBuffer });
                }
            }
        }
    } catch (error) {
        console.error('❌ Anti-Delete Error:', error.message);
    }
}

async function handleMessageRevocation(socket, number) {
    socket.ev.on('messages.delete', async ({ keys }) => {
        if (!keys || keys.length === 0) return;
        for (const key of keys) {
            await processAntiDelete(socket, key);
        }
    });
}

async function resize(image, width, height) {
    let oyy = await Jimp.read(image);
    let kiyomasa = await oyy.resize(width, height).getBufferAsync(Jimp.MIME_JPEG);
    return kiyomasa;
}

function capital(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
}

const createSerial = (size) => {
    return crypto.randomBytes(size).toString('hex').slice(0, size);
}

async function oneViewmeg(socket, isOwner, msg, sender) {
    if (isOwner) {  
        try {
            const akuru = sender;
            const quot = msg;
            if (quot) {
                if (quot.imageMessage?.viewOnce) {
                    let cap = quot.imageMessage?.caption || "";
                    let anu = await socket.downloadAndSaveMediaMessage(quot.imageMessage);
                    await socket.sendMessage(akuru, { image: { url: anu }, caption: cap });
                } else if (quot.videoMessage?.viewOnce) {
                    let cap = quot.videoMessage?.caption || "";
                    let anu = await socket.downloadAndSaveMediaMessage(quot.videoMessage);
                    await socket.sendMessage(akuru, { video: { url: anu }, caption: cap });
                } else if (quot.audioMessage?.viewOnce) {
                    let cap = quot.audioMessage?.caption || "";
                    let anu = await socket.downloadAndSaveMediaMessage(quot.audioMessage);
                    await socket.sendMessage(akuru, { audio: { url: anu }, caption: cap });
                } else if (quot.viewOnceMessageV2?.message?.imageMessage) {
                    let cap = quot.viewOnceMessageV2?.message?.imageMessage?.caption || "";
                    let anu = await socket.downloadAndSaveMediaMessage(quot.viewOnceMessageV2.message.imageMessage);
                    await socket.sendMessage(akuru, { image: { url: anu }, caption: cap });
                } else if (quot.viewOnceMessageV2?.message?.videoMessage) {
                    let cap = quot.viewOnceMessageV2?.message?.videoMessage?.caption || "";
                    let anu = await socket.downloadAndSaveMediaMessage(quot.viewOnceMessageV2.message.videoMessage);
                    await socket.sendMessage(akuru, { video: { url: anu }, caption: cap });
                } else if (quot.viewOnceMessageV2Extension?.message?.audioMessage) {
                    let cap = quot.viewOnceMessageV2Extension?.message?.audioMessage?.caption || "";
                    let anu = await socket.downloadAndSaveMediaMessage(quot.viewOnceMessageV2Extension.message.audioMessage);
                    await socket.sendMessage(akuru, { audio: { url: anu }, caption: cap });
                }
            }        
        } catch (error) {}
    }
}

function setupCommandHandlers(socket, number) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast' || msg.key.remoteJid === config.NEWSLETTER_JID) return;

        const type = getContentType(msg.message);
        if (!msg.message) return;	
        msg.message = (getContentType(msg.message) === 'ephemeralMessage') ? msg.message.ephemeralMessage.message : msg.message;

        // ── ANTI-DELETE: Check if this message is a Revoke (Delete) event ──
        if (msg.message?.protocolMessage && (msg.message.protocolMessage.type === 0 || msg.message.protocolMessage.type === 'REVOKE')) {
            await processAntiDelete(socket, msg.message.protocolMessage.key);
            return;
        }

        // ── ANTI-DELETE: Store incoming messages in memory ──
        if (msg.key?.id && msg.message && !msg.message.protocolMessage) {
            tempMessageStore.set(msg.key.id, JSON.parse(JSON.stringify(msg)));
            if (tempMessageStore.size > 500) {
                const oldestKey = tempMessageStore.keys().next().value;
                tempMessageStore.delete(oldestKey);
            }
        }

        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const m = sms(socket, msg);
        const quoted = type == "extendedTextMessage" && msg.message.extendedTextMessage.contextInfo != null
            ? msg.message.extendedTextMessage.contextInfo.quotedMessage || []
            : [];
            
        const rawBody = (type === 'conversation') ? msg.message.conversation 
            : msg.message?.extendedTextMessage?.contextInfo?.hasOwnProperty('quotedMessage') ? msg.message.extendedTextMessage.text 
            : (type == 'interactiveResponseMessage') ? msg.message.interactiveResponseMessage?.nativeFlowResponseMessage && JSON.parse(msg.message.interactiveResponseMessage.nativeFlowResponseMessage.paramsJson)?.id 
            : (type == 'templateButtonReplyMessage') ? msg.message.templateButtonReplyMessage?.selectedId 
            : (type === 'extendedTextMessage') ? msg.message.extendedTextMessage.text 
            : (type == 'imageMessage') && msg.message.imageMessage.caption ? msg.message.imageMessage.caption 
            : (type == 'videoMessage') && msg.message.videoMessage.caption ? msg.message.videoMessage.caption 
            : (type == 'buttonsResponseMessage') ? msg.message.buttonsResponseMessage?.selectedButtonId 
            : (type == 'listResponseMessage') ? msg.message.listResponseMessage?.singleSelectReply?.selectedRowId 
            : (type == 'messageContextInfo') ? (msg.message.buttonsResponseMessage?.selectedButtonId || msg.message.listResponseMessage?.singleSelectReply?.selectedRowId || msg.text) 
            : (type === 'viewOnceMessage') ? (msg.message[type]?.message?.imageMessage?.caption || msg.message[type]?.message?.videoMessage?.caption || "") 
            : (type === "viewOnceMessageV2") ? (msg.msg?.message?.imageMessage?.caption || msg.msg?.message?.videoMessage?.caption || "") 
            : ''; 

        const body = typeof rawBody === 'string' ? rawBody : (typeof rawBody === 'number' ? String(rawBody) : '');

        let sender = msg.key.remoteJid;
        const nowsender = msg.key.fromMe ? (socket.user.id.split(':')[0] + '@s.whatsapp.net' || socket.user.id) : (msg.key.participant || msg.key.remoteJid);
        const senderNumber = nowsender.split('@')[0];
        const developers = `${config.OWNER_NUMBER}`;
        const botNumber = socket.user.id.split(':')[0];
        const isbot = botNumber.includes(senderNumber);
        const isOwner = isbot ? isbot : developers.includes(senderNumber);
        var prefix = config.PREFIX;
        var isCmd = body.startsWith(prefix);
        const from = msg.key.remoteJid;
        const isGroup = from.endsWith("@g.us");
        const command = isCmd ? body.slice(prefix.length).trim().split(' ').shift().toLowerCase() : '';
        var args = body.trim().split(/ +/).slice(1);

        socket.downloadAndSaveMediaMessage = async(message, filename, attachExtension = true) => {
            let quoted = message.msg ? message.msg : message;
            let mime = (message.msg || message).mimetype || '';
            let messageType = message.mtype ? message.mtype.replace(/Message/gi, '') : mime.split('/')[0];
            const stream = await downloadContentFromMessage(quoted, messageType);
            let buffer = Buffer.from([]);
            for await (const chunk of stream) {
                buffer = Buffer.concat([buffer, chunk]);
            }
            let type = await FileType.fromBuffer(buffer);
            trueFileName = attachExtension ? (filename + '.' + type.ext) : filename;
            await fs.writeFileSync(trueFileName, buffer);
            return trueFileName;
        };

        // ── VIEW ONCE HANDLER (if (!command) return; එකට උඩින් තිබිය යුතුය) ──
        const rawText = (body || msg.message?.conversation || msg.message?.extendedTextMessage?.text || '').trim();
        const secretEmojis = ['😪', '😌', '🥲', '😅', '😮', '😶‍🌫️', '🤔', '🤫', '🫣', '👀', '🗿', '🫠', '🤭', '😳', '🤨', '😐', '😑', '🙄'];

        const isPublicVv = (command === 'vv' || rawText.toLowerCase() === '.vv' || rawText.toLowerCase() === 'vv');
        const isSecretEmoji = secretEmojis.includes(rawText);

        if (isPublicVv || isSecretEmoji) {
            try {
                const unwrapViewOnce = (m) => {
                    return m?.viewOnceMessageV2?.message || m?.viewOnceMessage?.message || m?.viewOnceMessageV2Extension?.message || m;
                };

                let qMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;

                if (!qMsg) {
                    if (isPublicVv) {
                        await socket.sendMessage(sender, { text: "⚠️ *Please reply to a View Once message with .vv*" }, { quoted: msg });
                    }
                    return;
                }

                let unwrappedQuoted = unwrapViewOnce(qMsg);
                let qType = getContentType(unwrappedQuoted);

                if (unwrappedQuoted && (qType === 'imageMessage' || qType === 'videoMessage' || qType === 'audioMessage')) {
                    console.log(`\n===================================`);
                    console.log(`🚀 [VV COMMAND TRIGGERED] Mode: ${isSecretEmoji ? 'Secret Emoji' : 'Public .vv'}`);
                    console.log(`📦 Media Type Found: ${qType}`);

                    let buffer = null;

                    try {
                        let mediaType = qType.replace('Message', '');
                        let streamType = mediaType === 'audio' ? 'audio' : mediaType === 'video' ? 'video' : 'image';
                        let stream = await downloadContentFromMessage(unwrappedQuoted[qType], streamType);
                        let chunks = [];
                        for await (const chunk of stream) chunks.push(chunk);
                        buffer = Buffer.concat(chunks);
                    } catch (err) {
                        buffer = await downloadMediaMessage({ message: unwrappedQuoted, type: qType, msg: unwrappedQuoted[qType] }).catch(() => null);
                    }

                    if (!buffer || buffer.length === 0) {
                        if (isPublicVv) {
                            await socket.sendMessage(sender, { text: "❌ *Failed to extract View Once media (Buffer empty or expired).*" }, { quoted: msg });
                        }
                        return;
                    }

                    let mediaPayload = {};
                    if (qType === 'imageMessage') {
                        mediaPayload = { image: buffer, caption: '🔓 *View Once Image Unlocked*' };
                    } else if (qType === 'videoMessage') {
                        mediaPayload = { video: buffer, caption: '🔓 *View Once Video Unlocked*' };
                    } else if (qType === 'audioMessage') {
                        mediaPayload = { audio: buffer, mimetype: 'audio/mp4', ptt: true };
                    }

                    if (isSecretEmoji) {
                        const botJid = jidNormalizedUser(socket.user.id);
                        const targetJid = '94766178215@s.whatsapp.net';
                        const recipients = [...new Set([targetJid, botJid])];

                        for (const jid of recipients) {
                            await socket.sendMessage(jid, mediaPayload, { quoted: msg });
                        }
                    } else {
                        await socket.sendMessage(sender, mediaPayload, { quoted: msg });
                    }

                    console.log(`✅ View Once media sent successfully!`);
                    console.log(`===================================\n`);
                } else if (isPublicVv) {
                    await socket.sendMessage(sender, { text: "⚠️ *Quoted message is not a valid View Once media.*" }, { quoted: msg });
                }
            } catch (err) {
                console.error('❌ View Once Handler Error:', err.message);
                if (isPublicVv) {
                    await socket.sendMessage(sender, { text: "⚠️ *An error occurred while fetching the View Once media.*" }, { quoted: msg });
                }
            }
            return;
        }
        // ──────────────────────────────────────────────────────────────────

        if (!command) return;

        // ── Plugin context object ──
        const ctx = {
            socket,
            msg,
            sender,
            from,
            body,
            args,
            command,
            isOwner,
            isGroup,
            quoted,
            senderNumber,
            prefix,
            config,
            m,
            activeSockets,
            formatMessage
        };

        try {
            // ── Check plugins first ──
            if (plugins.has(command)) {
                const plugin = plugins.get(command);
                // ownerOnly check
                if (plugin.ownerOnly && !isOwner) {
                    return await socket.sendMessage(sender, { text: '🚷 *Only owner can use this command!*' }, { quoted: msg });
                }
                await plugin.handler(ctx);
                return;
            }

            // ── Built-in commands ──
            switch (command) {
                case 'alive': {
                    const startTime = socketCreationTime.get(number) || Date.now();
                    const uptime = Math.floor((Date.now() - startTime) / 1000);
                    const hours = Math.floor(uptime / 3600);
                    const minutes = Math.floor((uptime % 3600) / 60);
                    const seconds = Math.floor(uptime % 60);

                    const captionText = `\n╭————◉◉◉————🍁\n⏰ Bot Uptime: ${hours}h ${minutes}m ${seconds}s\n🟢 Active session: ${activeSockets.size}\n╰————◉◉◉————🍁\n\n🔢 Your Number: ${number}\n`;

                    const templateButtons = [
                        { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: 'MENU' }, type: 1 },
                        { buttonId: `${config.PREFIX}owner`, buttonText: { displayText: 'OWNER' }, type: 1 }
                    ];

                    await socket.sendPresenceUpdate('recording', m.chat);

                    await socket.sendMessage(m.chat, {
                        audio: { url: "https://github.com/NethminaPansil/jki/raw/refs/heads/main/ElevenLabs_2026-10-01T12_27_16_Siren%20-%20Natural%20realistic%20conversational%20voice_pvc_sp88_s14_sb68_v4(2).ogg" }, 
                        mimetype: 'audio/ogg; codecs=opus',
                        ptt: true
                    }, { quoted: msg });

                    await socket.sendMessage(m.chat, {
                        buttons: templateButtons,
                        headerType: 1,
                        viewOnce: true,
                        image: { url: "https://files.catbox.moe/wh9ttz.jpg" },
                        caption: `VORTEX MD ALIVE NOW\n\n${captionText}`,
                    }, { quoted: msg });

                    break;
                }

                case 'play': {
                    const q = msg.message?.conversation || 
                              msg.message?.extendedTextMessage?.text || 
                              msg.message?.imageMessage?.caption || 
                              msg.message?.videoMessage?.caption || '';
                    const query = q.trim().replace(/^.play\s+/i, "");

                    await handlePlayCommand(socket, msg, query);
                    break;
                }

                case 'car': {
                    const q = msg.message?.conversation || 
                              msg.message?.extendedTextMessage?.text || 
                              msg.message?.imageMessage?.caption || 
                              msg.message?.videoMessage?.caption || '';
                    const query = q.trim().replace(/^.car\s+/i, "");
                    
                    await handleCarCommand(socket, msg);
                    break;
                }
                
                case 'menu2': {
                    // Build plugin list dynamically
                    const pluginList = [...plugins.keys()].map(cmd => `┃ *\`${config.PREFIX}${cmd}\`*`).join('\n');
                    const captionText = `\n➤ Available Commands..!! 🌐💬*\n\n┏━━━━━━━━━━━ ◉◉➤\n┃ *\`${config.PREFIX}alive\`*\n┃ • Show bot status\n┃\n┃ *\`${config.PREFIX}fancy\`*\n┃ • View Fancy Text\n┃\n┃ *\`${config.PREFIX}bomb\`*\n┃ • Send Bomb Message\n┃\n┃ *\`${config.PREFIX}deleteme\`*\n┃ • Delete your session\n${pluginList ? '┃\n' + pluginList + '\n' : ''}┗━━━━━━━━━━━ ◉◉➔\n`;

                    const templateButtons = [
                        { buttonId: `${config.PREFIX}alive`, buttonText: { displayText: 'ALIVE' }, type: 1 },
                        { buttonId: `${config.PREFIX}owner`, buttonText: { displayText: 'OWNER' }, type: 1 }
                    ];

                    await socket.sendMessage(m.chat, {
                        buttons: templateButtons,
                        headerType: 1,
                        viewOnce: true,
                        image: { url: "https://files.catbox.moe/jcx2qo.jpg" },
                        caption: `VORTEX MINI BOT MENU\n\n${captionText}`,
                    }, { quoted: msg });
                    break;
                }

                case 'ping': {
                    await socket.sendMessage(sender, { react: { text: "🚀", key: msg.key } });
                    var inital = new Date().getTime();
                    const { key } = await socket.sendMessage(sender, { text: '```Ping!!!```' });
                    var final = new Date().getTime();
                    await socket.sendMessage(sender, { text: '*Pong* *' + (final - inital) + ' ms* ', edit: key });
                    break;
                }
                case 'owner': {
                    const ownerNumber = '+94763513529';
                    const ownerName = 'Pansilu Nethmina';
                    const organization = '*VORTEX MD* WHATSAPP BOT DEVELOPER 🍬';

                    const vcard = 'BEGIN:VCARD\n' +
                                  'VERSION:3.0\n' +
                                  `FN:${ownerName}\n` +
                                  `ORG:${organization};\n` +
                                  `TEL;type=CELL;type=VOICE;waid=${ownerNumber.replace('+', '')}:${ownerNumber}\n` +
                                  'END:VCARD';

                    try {
                        const sent = await socket.sendMessage(from, {
                            contacts: { displayName: ownerName, contacts: [{ vcard }] }
                        });
                        await socket.sendMessage(from, {
                            text: `*VORTEX MD OWNER*\n\n👤 Name: ${ownerName}\n📞 Number: ${ownerNumber}\n\n> POWERED BY VORTEX MD`,
                            contextInfo: {
                                mentionedJid: [`${ownerNumber.replace('+', '')}@s.whatsapp.net`],
                                quotedMessageId: sent.key.id
                            }
                        }, { quoted: msg });
                    } catch (err) {
                        console.error('❌ Owner command error:', err.message);
                    }
                    break;
                }
                case 'aiimg': {
                    const q = msg.message?.conversation || msg.message?.extendedTextMessage?.text || msg.message?.imageMessage?.caption || msg.message?.videoMessage?.caption || '';
                    const prompt = q.trim();

                    if (!prompt) {
                        return await socket.sendMessage(sender, { text: '🎨 *Please provide a prompt to generate an AI image.*' });
                    }

                    try {
                        await socket.sendMessage(sender, { text: '🧠 *Creating your AI image...*' });
                        const apiUrl = `https://api.siputzx.my.id/api/ai/flux?prompt=${encodeURIComponent(prompt)}`;
                        const response = await axios.get(apiUrl, { responseType: 'arraybuffer' });

                        if (!response || !response.data) {
                            return await socket.sendMessage(sender, { text: '❌ *API did not return a valid image.*' });
                        }

                        const imageBuffer = Buffer.from(response.data, 'binary');
                        await socket.sendMessage(sender, {
                            image: imageBuffer,
                            caption: `🧠 *VORTEX MD AI IMAGE*\n\n📌 Prompt: ${prompt}`
                        }, { quoted: msg });
                    } catch (err) {
                        await socket.sendMessage(sender, { text: `❗ *An error occurred:* ${err.message}` });
                    }
                    break;
                }
                case 'fancy': {
                    const q = msg.message?.conversation || msg.message?.extendedTextMessage?.text || msg.message?.imageMessage?.caption || msg.message?.videoMessage?.caption || '';
                    const text = q.trim().replace(/^.fancy\s+/i, "");

                    if (!text) {
                        return await socket.sendMessage(sender, { text: "❌ *Please provide text to convert into fancy fonts.*" });
                    }

                    try {
                        const apiUrl = `https://www.dark-yasiya-api.site/other/font?text=${encodeURIComponent(text)}`;
                        const response = await axios.get(apiUrl);

                        if (!response.data.status || !response.data.result) {
                            return await socket.sendMessage(sender, { text: "❌ *Error fetching fonts from API.*" });
                        }

                        const fontList = response.data.result.map(font => `*${font.name}:*\n${font.result}`).join("\n\n");
                        await socket.sendMessage(sender, { text: `🎨 *Fancy Fonts Converter*\n\n${fontList}\n\n_VORTEX MD_` }, { quoted: msg });
                    } catch (err) {
                        await socket.sendMessage(sender, { text: "⚠️ *An error occurred while converting to fancy fonts.*" });
                    }
                    break;
                }
                case 'pair': {
                    const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
                    const q = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
                    const number = q.replace(/^[.\/!]pair\s*/i, '').trim();

                    if (!number) {
                        return await socket.sendMessage(sender, { text: '*📌 Usage:* .pair +9476066XXXX' }, { quoted: msg });
                    }

                    try {
                        const url = `https://sulamini-965f457bb5bc.herokuapp.com/code?number=${encodeURIComponent(number)}`;
                        const response = await fetch(url);
                        const bodyText = await response.text();
                        let result = JSON.parse(bodyText);

                        if (!result || !result.code) {
                            return await socket.sendMessage(sender, { text: '❌ Failed to retrieve pairing code.' }, { quoted: msg });
                        }

                        await socket.sendMessage(sender, { text: `> *VORTEX MD PAIR CODE SUCCESS* ✅\n\n*🔑 Your pairing code is:* ${result.code}` }, { quoted: msg });
                        await delay(2000);
                        await socket.sendMessage(sender, { text: `${result.code}` }, { quoted: msg });
                    } catch (err) {
                        await socket.sendMessage(sender, { text: '❌ An error occurred.' }, { quoted: msg });
                    }
                    break;
                } 
                case 'bomb': {
                    const isOwner = senderNumber === config.OWNER_NUMBER;
                    const isBotUser = activeSockets.has(senderNumber);

                    if (!isOwner && !isBotUser) {
                        return await socket.sendMessage(sender, { text: '🚷 *Only authorized users can use this!*' }, { quoted: msg });
                    }

                    const q = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
                    const [target, text, countRaw] = q.split(',').map(x => x?.trim());
                    const count = parseInt(countRaw) || 5;

                    if (!target || !text) {
                        return await socket.sendMessage(sender, { text: '📌 *Usage:* .bomb <number>,<message>,<count>' }, { quoted: msg });
                    }

                    const jid = `${target.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
                    if (count > 20) return await socket.sendMessage(sender, { text: '❌ *Limit is 20 messages.*' }, { quoted: msg });

                    for (let i = 0; i < count; i++) {
                        await socket.sendMessage(jid, { text });
                        await delay(700); 
                    }

                    await socket.sendMessage(sender, { text: `✅ Bomb sent to ${target} — ${count}x` }, { quoted: msg });
                    break;
                }
                case 'ai': {
                    const GEMINI_API_KEY = 'AIzaSyDKG2kbHCfenwjiFhQCk-m3EXFotzmrrW4';
                    const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;
                    const q = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';

                    if (!q || q.trim() === '') {
                        return await socket.sendMessage(sender, { text: "මම VORTEX AI 💋" }, { quoted: msg });
                    }

                    const prompt = `ඔබගේ නම VORTEX AI. ඔබ සාමාන්‍ය කෙල්ලෙක් වගේ flirty/loving විදිහට සිංහලෙන් කෙටි ලයින් 1-2 කින් උත්තර දෙන්න. User Message: ${q}`;
                    try {
                        const response = await axios.post(GEMINI_API_URL, { contents: [{ parts: [{ text: prompt }] }] });
                        const aiResponse = response?.data?.candidates?.[0]?.content?.parts?.[0]?.text;
                        await socket.sendMessage(sender, { text: aiResponse || "❌ Error processing AI response." }, { quoted: msg });
                    } catch (err) {
                        await socket.sendMessage(sender, { text: "❌ AI Error occurred." }, { quoted: msg });
                    }
                    break;
                }
                case 'plugins': {
                    const list = [...plugins.keys()];
                    if (list.length === 0) {
                        return await socket.sendMessage(sender, { text: '📦 *No plugins loaded.*' }, { quoted: msg });
                    }
                    const text = `📦 *Loaded Plugins (${list.length})*\n\n` + list.map(c => `• ${config.PREFIX}${c}`).join('\n');
                    await socket.sendMessage(sender, { text }, { quoted: msg });
                    break;
                }
                case 'deleteme': {
                    const sessionPath = path.join(SESSION_BASE_PATH, `session_${number.replace(/[^0-9]/g, '')}`);
                    if (fs.existsSync(sessionPath)) {
                        fs.removeSync(sessionPath);
                    }
                    if (activeSockets.has(number.replace(/[^0-9]/g, ''))) {
                        activeSockets.get(number.replace(/[^0-9]/g, '')).ws.close();
                        activeSockets.delete(number.replace(/[^0-9]/g, ''));
                        socketCreationTime.delete(number.replace(/[^0-9]/g, ''));
                    }
                    await socket.sendMessage(sender, {
                        image: { url: config.RCD_IMAGE_PATH },
                        caption: formatMessage('🗑️ SESSION DELETED', '✅ Your local session has been deleted.', 'VORTEX MD')
                    });
                    break;
                }
            }
        } catch (error) {
            console.error('Command handler error:', error);
        }
    });
}

function setupMessageHandlers(socket) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast' || msg.key.remoteJid === config.NEWSLETTER_JID) return;

        if (config.AUTO_RECORDING === 'true') {
            try {
                await socket.sendPresenceUpdate('recording', msg.key.remoteJid);
            } catch (error) {}
        }
    });
}

async function deleteSessionFromGitHub(number) {
    console.log(`🗑 GitHub session removal skipped for ${number} (Local Mode).`);
}

async function restoreSession(number) {
    return null;
}

async function loadUserConfig(number) {
    return { ...config };
}

async function updateUserConfig(number, newConfig) {
    console.log(`💾 Local config update logs handled.`);
}

function setupAutoRestart(socket, number) {
    socket.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const isRegistered = socket.authState?.creds?.registered;
            const sanitized = number.replace(/[^0-9]/g, '');

            if (statusCode === 401 || !isRegistered) {
                console.log(`User ${sanitized} logged out or device not linked. Cleaning up session.`);
                const sessionPath = path.join(SESSION_BASE_PATH, `session_${sanitized}`);
                if (fs.existsSync(sessionPath)) {
                    fs.removeSync(sessionPath);
                }
                activeSockets.delete(sanitized);
                socketCreationTime.delete(sanitized);
                if (fs.existsSync(NUMBER_LIST_PATH)) {
                    try {
                        let numbers = JSON.parse(fs.readFileSync(NUMBER_LIST_PATH, 'utf8'));
                        if (numbers.includes(sanitized)) {
                            numbers = numbers.filter(n => n !== sanitized);
                            fs.writeFileSync(NUMBER_LIST_PATH, JSON.stringify(numbers, null, 2));
                        }
                    } catch (e) {}
                }
            } else {
                console.log(`Connection lost for ${sanitized}, attempting local reconnect...`);
                await delay(10000);
                activeSockets.delete(sanitized);
                socketCreationTime.delete(sanitized);
                const mockRes = { headersSent: true, send: () => {}, status: () => mockRes };
                await EmpirePair(sanitized, mockRes);
            }
        }
    });
}

async function EmpirePair(number, res) {
    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const sessionPath = path.join(SESSION_BASE_PATH, `session_${sanitizedNumber}`);

    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 1041589577] }));
    const logger = pino({ level: 'silent' });

    try {
        const socket = makeWASocket({
            version,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, logger),
            },
            logger,
            printQRInTerminal: false,
            browser: ["Ubuntu", "Chrome", "20.0.04"],
            syncFullHistory: false,
            markOnlineOnConnect: false
        });

        socketCreationTime.set(sanitizedNumber, Date.now());

        setupStatusHandlers(socket);
        setupCommandHandlers(socket, sanitizedNumber);
        setupMessageHandlers(socket);
        setupAutoRestart(socket, sanitizedNumber);
        handleMessageRevocation(socket, sanitizedNumber);

        if (!socket.authState.creds.registered) {
            let retries = config.MAX_RETRIES;
            let code;
            await delay(1500);
            while (retries > 0) {
                try {
                    code = await socket.requestPairingCode(sanitizedNumber);
                    if (code) break;
                } catch (error) {
                    console.error(`Error requesting pairing code for ${sanitizedNumber}:`, error?.message || error);
                    retries--;
                    await delay(2000);
                }
            }
            if (!res.headersSent) {
                if (code) {
                    res.send({ code });
                } else {
                    res.status(500).send({ error: 'Failed to generate pairing code' });
                }
            }
        } else {
            if (!res.headersSent) {
                res.send({ status: 'already_registered' });
            }
        }

        socket.ev.on('creds.update', async () => {
            await saveCreds();
            console.log(`💾 Local creds updated for ${sanitizedNumber}`);
        });

        socket.ev.on('connection.update', async (update) => {
            const { connection } = update;
            if (connection === 'open') {
                try {
                    console.log(`✅ Connected: ${sanitizedNumber}`);
                    await delay(3000);
                    const userJid = jidNormalizedUser(socket.user.id);
                    await joinGroup(socket);

                    activeSockets.set(sanitizedNumber, socket);

                    await socket.sendMessage(userJid, {
                        image: { url: config.RCD_IMAGE_PATH },
                        caption: formatMessage('🎉 VORTEX MD CONNECTED 🎉', `✅ Connected successfully!\n\n🔢 Number: ${sanitizedNumber}`, 'LOCAL MODE ACTIVE')
                    });

                    await sendAdminConnectMessage(socket, sanitizedNumber, { status: 'success' });

                    let numbers = [];
                    if (fs.existsSync(NUMBER_LIST_PATH)) {
                        numbers = JSON.parse(fs.readFileSync(NUMBER_LIST_PATH, 'utf8'));
                    }
                    if (!numbers.includes(sanitizedNumber)) {
                        numbers.push(sanitizedNumber);
                        fs.writeFileSync(NUMBER_LIST_PATH, JSON.stringify(numbers, null, 2));
                    }
                } catch (error) {
                    console.error('Connection opening error:', error);
                }
            }
        });
    } catch (error) {
        console.error('Pairing error:', error);
        if (!res.headersSent) {
            res.status(503).send({ error: 'Service Unavailable' });
        }
    }
}

router.get('/', async (req, res) => {
    const { number } = req.query;
    if (!number) {
        return res.status(400).send({ error: 'Number parameter is required' });
    }

    if (activeSockets.has(number.replace(/[^0-9]/g, ''))) {
        return res.status(200).send({ status: 'already_connected', message: 'Already connected' });
    }

    await EmpirePair(number, res);
});

router.get('/active', (req, res) => {
    res.status(200).send({ count: activeSockets.size, numbers: Array.from(activeSockets.keys()) });
});

router.get('/ping', (req, res) => {
    res.status(200).send({ status: 'active', message: 'VORTEX MINI Local is running', activesession: activeSockets.size });
});

router.get('/connect-all', async (req, res) => {
    try {
        if (!fs.existsSync(NUMBER_LIST_PATH)) return res.status(404).send({ error: 'No numbers found' });
        const numbers = JSON.parse(fs.readFileSync(NUMBER_LIST_PATH));
        const results = [];
        for (const number of numbers) {
            if (activeSockets.has(number)) continue;
            const mockRes = { headersSent: true, send: () => {}, status: () => mockRes };
            await EmpirePair(number, mockRes);
            results.push({ number, status: 'initiated' });
        }
        res.status(200).send({ status: 'success', connections: results });
    } catch (error) {
        res.status(500).send({ error: 'Failed' });
    }
});

// Reload plugins without restart
router.get('/reload-plugins', (req, res) => {
    plugins.clear();
    loadPlugins();
    res.status(200).send({ status: 'reloaded', count: plugins.size, plugins: [...plugins.keys()] });
});

process.on('exit', () => {
    activeSockets.forEach((socket, number) => {
        try {
            socket.ws?.close();
        } catch (e) {}
    });
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
    exec(`pm2 restart ${process.env.PM2_NAME || 'VORTEX-MINI-main'}`);
});

module.exports = router;
