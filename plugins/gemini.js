const https = require('https');
const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const { Blob } = require('buffer'); // Node 18+ නම් native, නැත්නම් form-data package එක ඕන

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

const MIME_MAP = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  tiff: 'image/tiff',
  mp3: 'audio/mp3',
  wav: 'audio/wav',
  m4a: 'audio/m4a',
  aac: 'audio/aac',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
  opus: 'audio/opus',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  pdf: 'application/pdf',
  txt: 'text/plain',
  csv: 'text/csv',
  json: 'application/json',
  md: 'text/markdown',
  html: 'text/html',
  xml: 'application/xml',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  py: 'text/x-python',
  js: 'application/javascript',
  mjs: 'application/javascript',
  ts: 'text/plain',
  java: 'text/plain',
  c: 'text/plain',
  cpp: 'text/plain',
  sh: 'text/plain'
};

function parseCookies(input) {
  if (!input) return '';
  if (!input.includes('\t') && !input.includes('\n') && input.includes('=')) {
    return input.trim();
  }
  const cookies = [];
  for (const rawLine of input.split('\n')) {
    const line = rawLine.trim();
    if (!line || (line.startsWith('#') && !line.startsWith('#HttpOnly_'))) continue;
    const cleanLine = line.startsWith('#HttpOnly_') ? line.slice(10) : line;
    const parts = cleanLine.split(/\s+/);
    if (parts.length >= 7) {
      cookies.push(`\( {parts[5]}= \){parts.slice(6).join(' ')}`);
    }
  }
  return cookies.join('; ');
}

async function loadCookiesFromFile(filePath = './Geminicook.txt') {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return parseCookies(raw);
  } catch {
    return '';
  }
}

function fetchAppHtml(cookie) {
  return new Promise((resolve, reject) => {
    const req = https.request('https://gemini.google.com/app', {
      headers: {
        'User-Agent': USER_AGENT,
        'Cookie': cookie
      },
      maxHeaderSize: 65536
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.end();
  });
}

async function getSessionTokens(customCookies = null) {
  const cookieHeader = customCookies ? parseCookies(customCookies) : await loadCookiesFromFile();
  if (!cookieHeader) {
    throw new Error('Cookies not found. Please provide cookies or ensure Geminicook.txt exists.');
  }

  const html = await fetchAppHtml(cookieHeader);
  const matchWiz = html.match(/window\.WIZ_global_data\s*=\s*(\{[\s\S]*?\});/);
  if (!matchWiz) {
    throw new Error('Failed to extract WIZ_global_data. Cookies might be invalid or expired.');
  }
  const wiz = JSON.parse(matchWiz[1]);
  if (!wiz.SNlM0e) {
    throw new Error('Failed to retrieve SNlM0e access token. Session may not be authenticated.');
  }
  return {
    at: wiz.SNlM0e,
    bl: wiz.cfb2h,
    fsid: wiz.FdrFJe,
    cookies: cookieHeader
  };
}

function parseFrames(text) {
  const results = [];
  for (const line of text.split('\n')) {
    if (line.startsWith('[["wrb.fr"')) {
      try {
        const parsed = JSON.parse(line);
        for (const item of parsed) {
          if (item[0] === 'wrb.fr' && item[2]) {
            results.push({ rpcid: item[1], data: JSON.parse(item[2]) });
          }
        }
      } catch {}
    }
  }
  return results;
}

async function uploadMedia(input, options = {}) {
  let buffer;
  let filename = options.filename || 'upload.bin';
  let mimeType = options.mimeType;

  if (Buffer.isBuffer(input) || input instanceof Uint8Array) {
    buffer = input;
  } else if (typeof input === 'string') {
    if (input.startsWith('http://') || input.startsWith('https://')) {
      const res = await fetch(input, { headers: { 'User-Agent': USER_AGENT } });
      if (!res.ok) throw new Error(`Failed to fetch media from URL (${res.status})`);
      buffer = Buffer.from(await res.arrayBuffer());
      if (!options.filename) {
        filename = new URL(input).pathname.split('/').pop() || 'upload.bin';
      }
      if (!mimeType && res.headers.get('content-type')) {
        mimeType = res.headers.get('content-type').split(';')[0];
      }
    } else {
      buffer = await fs.readFile(input);
      if (!options.filename) {
        filename = path.basename(input);
      }
    }
  } else {
    throw new Error('Unsupported media input format');
  }

  if (!mimeType) {
    const ext = path.extname(filename).toLowerCase().replace('.', '');
    mimeType = MIME_MAP[ext] || 'application/octet-stream';
  }

  const form = new FormData();
  const blob = new Blob([buffer], { type: mimeType });
  form.append('file', blob, filename);

  const res = await fetch('https://content-push.googleapis.com/upload', {
    method: 'POST',
    headers: {
      'X-Tenant-Id': 'bard-storage',
      'Push-ID': 'feeds/mcudyrk2a4khkz',
      'Origin': 'https://gemini.google.com',
      'Referer': 'https://gemini.google.com/'
    },
    body: form
  });

  if (!res.ok) {
    throw new Error(`Media upload failed (${res.status})`);
  }

  const uploadId = (await res.text()).trim();
  return {
    uploadId,
    filename,
    mimeType
  };
}

async function askGemini(prompt, options = {}) {
  if (!prompt || typeof prompt !== 'string') {
    throw new Error('Prompt string is required');
  }

  const session = await getSessionTokens(options.cookies);
  const reqId = String(Math.floor(Math.random() * 900000) + 100000);
  const uuidVal = crypto.randomUUID().toUpperCase();
  const lang = options.language || 'si';

  let fileData = null;
  const rawFiles = options.files || (options.file ? [options.file] : null);

  if (Array.isArray(rawFiles) && rawFiles.length > 0) {
    const uploadedList = [];
    for (const f of rawFiles) {
      if (typeof f === 'object' && f.uploadId) {
        uploadedList.push(f);
      } else {
        const up = await uploadMedia(f);
        uploadedList.push(up);
      }
    }
    fileData = uploadedList.map((item) => [[item.uploadId], item.filename]);
  }

  const innerReq = new Array(69).fill(null);
  innerReq[0] = [prompt, 0, null, fileData, null, null, 0];
  innerReq[1] = [lang];
  innerReq[2] = options.conversationId
    ? [options.conversationId, options.responseId || '', options.candidateId || '']
    : ['', '', ''];
  innerReq[4] = crypto.randomBytes(16).toString('hex');
  innerReq[6] = [1];
  innerReq[7] = 1;
  innerReq[10] = 1;
  innerReq[11] = 0;
  innerReq[17] = [[options.turnIndex || 0]];
  innerReq[18] = 0;
  innerReq[27] = 1;
  innerReq[30] = [4];
  innerReq[41] = [1];
  innerReq[53] = 0;
  innerReq[55] = [[1]];
  innerReq[59] = uuidVal;
  innerReq[61] = [];
  innerReq[68] = 2;

  const fReq = JSON.stringify([null, JSON.stringify(innerReq)]);

  const params = new URLSearchParams({
    bl: session.bl,
    'f.sid': session.fsid,
    hl: lang,
    _reqid: reqId,
    rt: 'c'
  });

  const res = await fetch(`https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate?${params.toString()}`, {
    method: 'POST',
    headers: {
      'User-Agent': USER_AGENT,
      'Cookie': session.cookies,
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      'Origin': 'https://gemini.google.com',
      'Referer': 'https://gemini.google.com/app',
      'x-goog-ext-525005358-jspb': `["${uuidVal}",1]`
    },
    body: new URLSearchParams({
      at: session.at,
      'f.req': fReq
    })
  });

  if (!res.ok) {
    throw new Error(`Failed to generate response (${res.status})`);
  }

  const text = await res.text();
  const frames = parseFrames(text);

  let finalReply = '';
  let conversationId = null;
  let responseId = null;
  let candidateId = null;

  for (const f of frames) {
    const data = f.data;
    if (Array.isArray(data)) {
      if (data[1] && Array.isArray(data[1])) {
        conversationId = data[1][0] || conversationId;
        responseId = data[1][1] || responseId;
      }
      if (data[4] && Array.isArray(data[4]) && data[4][0]) {
        candidateId = data[4][0][0] || candidateId;
        const candidateText = data[4][0][1]?.[0];
        if (candidateText) {
          finalReply = candidateText;
        }
      }
    }
  }

  return {
    text: finalReply,
    conversationId,
    responseId,
    candidateId
  };
}

// ==================== PLUGIN ====================

module.exports = {
    command: ['gemini', 'gem', 'g'],
    description: 'Chat with Google Gemini AI',
    ownerOnly: false,

    handler: async ({ socket, msg, sender, args, prefix }) => {
        try {
            const userPrompt = args.join(' ');

            if (!userPrompt) {
                return await socket.sendMessage(sender, {
                    text: `😒 *මොකද නිකන් හූල්ලන්නේ? මොනවා හරි අහන්නකෝ!*\n\n*Usage:* ${prefix}gemini <ඔයාගේ ප්‍රශ්නය>`
                }, { quoted: msg });
            }

            // Thinking reaction
            await socket.sendMessage(sender, {
                react: { text: '💭', key: msg.key }
            });

            const result = await askGemini(userPrompt, {
                language: 'si'
            });

            const aiResponse = result.text || '😒 *මට උත්තර එකක් හොයාගන්න බැරි වුණා...*';

            await socket.sendMessage(sender, {
                text: aiResponse
            }, { quoted: msg });

            // Done reaction
            await socket.sendMessage(sender, {
                react: { text: '✨', key: msg.key }
            });

        } catch (err) {
            console.error('Gemini plugin error:', err.message);
            await socket.sendMessage(sender, {
                text: `🙄 *එකපාරටම මොකක් හරි අවුලක් ගියා!*\n\n\`${err.message}\``
            }, { quoted: msg });
        }
    }
};