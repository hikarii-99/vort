const https = require('https');
const { downloadContentFromMessage } = require('baileys');

const BANANA_API_HOST = 'ibbo.ai';
const BANANA_API_PATH = '/api/nano-banana-lite-image-to-image';

const HEADERS = {
    'Accept': '*/*',
    'Origin': 'https://banana-nano.ai',
    'Referer': 'https://banana-nano.ai/ai-image-editor',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36',
};

function buildBody(imageBuf, prompt) {
    const boundary = '----Boundary' + Date.now();
    const parts = [];
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="image.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`));
    parts.push(imageBuf);
    parts.push(Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="prompt"\r\n\r\n${prompt}`));
    parts.push(Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="output_format"\r\n\r\njpg`));
    parts.push(Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="generator_slug"\r\n\r\nai-image-editor`));
    parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
    return { boundary, body: Buffer.concat(parts) };
}

function postBanana(body, boundary) {
    return new Promise((resolve, reject) => {
        const opts = {
            hostname: BANANA_API_HOST,
            port: 443,
            path: BANANA_API_PATH,
            method: 'POST',
            headers: {
                ...HEADERS,
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                'Content-Length': body.length,
            },
            timeout: 60000,
        };

        const req = https.request(opts, (res) => {
            let chunks = [];
            res.on('data', d => chunks.push(d));
            res.on('end', () => {
                const raw = Buffer.concat(chunks).toString();
                try { resolve(JSON.parse(raw)); } catch { resolve({ _raw: raw.substring(0, 300), _status: res.statusCode }); }
            });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
        req.write(body);
        req.end();
    });
}

async function downloadImageBuffer(url) {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        https.get({
            hostname: u.hostname,
            path: u.pathname + u.search,
            headers: { 'User-Agent': 'Mozilla/5.0' },
            timeout: 30000
        }, (res) => {
            if (res.statusCode === 301 || res.statusCode === 302) {
                return downloadImageBuffer(res.headers.location).then(resolve).catch(reject);
            }
            const chunks = [];
            res.on('data', d => chunks.push(d));
            res.on('end', () => resolve(Buffer.concat(chunks)));
        }).on('error', reject);
    });
}

module.exports = {
    command: ['editimg', 'aiedit', 'imgai'],
    description: 'Edit image using AI with a text prompt',

    handler: async ({ socket, msg, sender, args, prefix }) => {
        try {
            const contextInfo = msg.message?.extendedTextMessage?.contextInfo;
            const quotedMsg = contextInfo?.quotedMessage;
            const directImage = msg.message?.imageMessage;

            const prompt = args.join(' ').trim();

            if (!prompt) {
                return await socket.sendMessage(sender, {
                    text: `🎨 *VORTEX MD | AI Image Editor*\n\n` +
                        `*Usage:* Reply to an image with:\n` +
                        `${prefix}editimg <prompt>\n\n` +
                        `*Examples:*\n` +
                        `${prefix}editimg add stylish glasses\n` +
                        `${prefix}editimg make it look like anime\n` +
                        `${prefix}editimg add snow background\n` +
                        `${prefix}aiedit remove background\n\n` +
                        `> *Powered by VORTEX MD*`
                }, { quoted: msg });
            }

            // Get image
            let mediaMsg = null;
            if (directImage) {
                mediaMsg = directImage;
            } else if (quotedMsg?.imageMessage) {
                mediaMsg = quotedMsg.imageMessage;
            } else if (quotedMsg?.viewOnceMessage?.message?.imageMessage) {
                mediaMsg = quotedMsg.viewOnceMessage.message.imageMessage;
            }

            if (!mediaMsg) {
                return await socket.sendMessage(sender, {
                    text: `❌ *Reply to an image!*\n\n${prefix}editimg add glasses`
                }, { quoted: msg });
            }

            await socket.sendMessage(sender, { react: { text: '🎨', key: msg.key } });
            await socket.sendMessage(sender, {
                text: `🎨 *Editing image...*\n\n📝 *Prompt:* ${prompt}\n\n_Please wait..._`
            }, { quoted: msg });

            // Download image
            const stream = await downloadContentFromMessage(mediaMsg, 'image');
            let imgBuffer = Buffer.from([]);
            for await (const chunk of stream) {
                imgBuffer = Buffer.concat([imgBuffer, chunk]);
            }

            if (!imgBuffer.length) {
                return await socket.sendMessage(sender, {
                    text: `❌ *Failed to download image.*`
                }, { quoted: msg });
            }

            // Build and send to API
            const { boundary, body } = buildBody(imgBuffer, prompt);
            let result;
            try {
                result = await postBanana(body, boundary);
            } catch (e) {
                return await socket.sendMessage(sender, {
                    text: `❌ *API request failed:* ${e.message}`
                }, { quoted: msg });
            }

            if (!result?.success || !result?.data?.image_url) {
                const errMsg = result?._raw || result?.message || JSON.stringify(result).substring(0, 200);
                return await socket.sendMessage(sender, {
                    text: `❌ *Image editing failed!*\n\n${errMsg}`
                }, { quoted: msg });
            }

            // Download result image
            const resultBuffer = await downloadImageBuffer(result.data.image_url);

            const remaining = result.data.free_usage?.remaining ?? 'N/A';
            const caption = `🎨 *VORTEX MD | AI Image Editor*\n\n` +
                `📝 *Prompt:* ${prompt}\n` +
                `🤖 *Model:* ${result.data.model || 'NanoBanana'}\n` +
                `🆓 *Free remaining:* ${remaining}\n\n` +
                `> *Powered by VORTEX MD*`;

            await socket.sendMessage(sender, {
                image: resultBuffer,
                caption: caption
            }, { quoted: msg });

            await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

        } catch (err) {
            console.error('EditImg plugin error:', err.message);
            await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
            await socket.sendMessage(sender, {
                text: `❌ *Error:* ${err.message}`
            }, { quoted: msg });
        }
    }
};
