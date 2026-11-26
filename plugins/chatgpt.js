const crypto = require('crypto');

const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const base = 'https://chatgpt.com/backend-anon';

function baseCfg() {
    const cores = [8, 12, 16, 24];
    const screens = [3000, 4000, 6000];
    const core = cores[Math.floor(Math.random() * cores.length)];
    const screen = screens[Math.floor(Math.random() * screens.length)];
    return [
        core + screen,
        new Date().toString(),
        4294705152,
        0,
        ua,
        'https://cdn.oaistatic.com/assets/main.js',
        'dpl=abc',
        'en-US',
        'en-US,en',
        0,
        'webdriver-false',
        'location',
        crypto.randomUUID()
    ];
}

function solvePow(seed, diff) {
    const cfg = baseCfg();
    for (let i = 0; i < 500000; i++) {
        cfg[3] = i;
        const b64 = Buffer.from(JSON.stringify(cfg)).toString('base64');
        const hash = crypto.createHash('sha3-512').update(seed + b64).digest('hex');
        if (hash.slice(0, diff.length) <= diff) {
            return 'gAAAAAB' + b64;
        }
    }
    return 'wQ8jGT' + Buffer.from(seed).toString('base64');
}

function parseSse(raw) {
    let answer = '';
    let convId = '';
    const lines = raw.split('\n');
    for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();
        if (payload === '[DONE]') break;
        let j;
        try {
            j = JSON.parse(payload);
        } catch {
            continue;
        }
        if (j.conversation_id) convId = j.conversation_id;
        const msg = j.message;
        if (msg && msg.author && msg.author.role === 'assistant') {
            const parts = msg.content && msg.content.parts;
            if (parts && typeof parts[0] === 'string') answer = parts[0];
        }
    }
    return { answer, convId };
}

async function chatgpt(prompt) {
    const deviceId = crypto.randomUUID();
    const initP = 'gAAAAAC' + Buffer.from(JSON.stringify(baseCfg())).toString('base64');

    const reqRes = await fetch(base + '/sentinel/chat-requirements', {
        method: 'POST',
        headers: {
            'user-agent': ua,
            'content-type': 'application/json',
            accept: '*/*',
            'oai-device-id': deviceId,
            'oai-language': 'en-US',
            origin: 'https://chatgpt.com',
            referer: 'https://chatgpt.com/'
        },
        body: JSON.stringify({ p: initP })
    });

    if (!reqRes.ok) return { ok: false, status: reqRes.status, stage: 'requirements' };
    const req = await reqRes.json();

    const powToken = req.proofofwork ? solvePow(req.proofofwork.seed, req.proofofwork.difficulty) : null;
    const body = {
        action: 'next',
        messages: [
            {
                id: crypto.randomUUID(),
                author: { role: 'user' },
                content: { content_type: 'text', parts: [prompt] },
                metadata: {}
            }
        ],
        parent_message_id: crypto.randomUUID(),
        model: 'auto',
        timezone_offset_min: -420,
        history_and_training_disabled: true,
        conversation_mode: { kind: 'primary_assistant' },
        websocket_request_id: crypto.randomUUID()
    };

    const res = await fetch(base + '/conversation', {
        method: 'POST',
        headers: {
            'user-agent': ua,
            'content-type': 'application/json',
            accept: 'text/event-stream',
            'oai-device-id': deviceId,
            'oai-language': 'en-US',
            'openai-sentinel-chat-requirements-token': req.token,
            ...(powToken ? { 'openai-sentinel-proof-token': powToken } : {}),
            origin: 'https://chatgpt.com',
            referer: 'https://chatgpt.com/'
        },
        body: JSON.stringify(body)
    });

    if (!res.ok) return { ok: false, status: res.status, stage: 'conversation' };
    const txt = await res.text();
    const parsed = parseSse(txt);
    return { ok: true, ...parsed };
}

// ==================== PLUGIN ====================

module.exports = {
    command: ['chatgpt', 'gpt', 'cgpt', 'openai'],
    description: 'Chat with ChatGPT (Anonymous)',
    ownerOnly: false,

    handler: async ({ socket, msg, sender, args, prefix }) => {
        try {
            const userPrompt = args.join(' ');

            if (!userPrompt) {
                return await socket.sendMessage(sender, {
                    text: `😒 *මොකද නිකන් හූල්ලන්නේ? මොනවා හරි අහන්නකෝ!*\n\n*Usage:* ${prefix}chatgpt <ඔයාගේ ප්‍රශ්නය>`
                }, { quoted: msg });
            }

            // Thinking reaction
            await socket.sendMessage(sender, {
                react: { text: '💭', key: msg.key }
            });

            const result = await chatgpt(userPrompt);

            if (!result.ok) {
                return await socket.sendMessage(sender, {
                    text: `🙄 *ChatGPT එකෙන් උත්තර එකක් ගන්න බැරි වුණා...*\n\nStatus: ${result.status} | Stage: ${result.stage}`
                }, { quoted: msg });
            }

            const aiResponse = result.answer || '😒 *මට උත්තර එකක් හොයාගන්න බැරි වුණා...*';

            await socket.sendMessage(sender, {
                text: aiResponse
            }, { quoted: msg });

            // Done reaction
            await socket.sendMessage(sender, {
                react: { text: '✨', key: msg.key }
            });

        } catch (err) {
            console.error('ChatGPT plugin error:', err.message);
            await socket.sendMessage(sender, {
                text: `🙄 *එකපාරටම මොකක් හරි අවුලක් ගියා!*\n\n\`${err.message}\``
            }, { quoted: msg });
        }
    }
};