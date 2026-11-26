const axios = require('axios');

const TTS_API = 'https://ab-text-voice.abrahamdw882.workers.dev/';

// Popular voices list for menu
const VOICE_MENU = [
    { num: '1',  name: 'henry',    lang: 'en-US', label: 'Henry (US Male)' },
    { num: '2',  name: 'jane',     lang: 'en-US', label: 'Jane (US Female)' },
    { num: '3',  name: 'mrbeast',  lang: 'en-US', label: 'MrBeast (US)' },
    { num: '4',  name: 'snoop',    lang: 'en-US', label: 'Snoop (US)' },
    { num: '5',  name: 'brian',    lang: 'en-GB', label: 'Brian (UK Male)' },
    { num: '6',  name: 'amy',      lang: 'en-GB', label: 'Amy (UK Female)' },
    { num: '7',  name: 'sameera',  lang: 'si-LK', label: 'Sameera (Sinhala Male)' },
    { num: '8',  name: 'thilini',  lang: 'si-LK', label: 'Thilini (Sinhala Female)' },
    { num: '9',  name: 'madhur',   lang: 'hi-IN', label: 'Madhur (Hindi Male)' },
    { num: '10', name: 'swara',    lang: 'hi-IN', label: 'Swara (Hindi Female)' },
    { num: '11', name: 'xiaoxiao', lang: 'zh-CN', label: 'Xiaoxiao (Chinese)' },
    { num: '12', name: 'nanami',   lang: 'ja-JP', label: 'Nanami (Japanese)' },
    { num: '13', name: 'sunhi',    lang: 'ko-KR', label: 'Sunhi (Korean)' },
    { num: '14', name: 'katja',    lang: 'de-DE', label: 'Katja (German)' },
    { num: '15', name: 'denise',   lang: 'fr-FR', label: 'Denise (French)' },
];

module.exports = {
    command: ['tts', 'say', 'speak'],
    description: 'Convert text to speech with 234 voices',

    handler: async ({ socket, msg, sender, args, prefix }) => {
        try {
            const input = args.join(' ').trim();

            // No input — show voice menu
            if (!input) {
                const voiceList = VOICE_MENU.map(v =>
                    ` ${v.num.padStart(2)}. ${v.label}`
                ).join('\n');

                return await socket.sendMessage(sender, {
                    text: `🎙️ *VORTEX MD | Text to Speech*\n\n` +
                        `*Usage:*\n` +
                        `${prefix}tts <text>\n` +
                        `${prefix}tts <voicename> | <text>\n\n` +
                        `*Example:*\n` +
                        `${prefix}tts Hello world\n` +
                        `${prefix}tts sameera | ආයුබෝවන්\n` +
                        `${prefix}tts thilini | හෙලෝ\n\n` +
                        `🎭 *Popular Voices:*\n${voiceList}\n\n` +
                        `📝 Total voices: *234*\n` +
                        `Use any voice name directly!\n\n` +
                        `> *Powered by VORTEX MD*`
                }, { quoted: msg });
            }

            // Parse voice | text format
            let voice = 'henry';
            let text = input;

            if (input.includes('|')) {
                const parts = input.split('|');
                voice = parts[0].trim().toLowerCase();
                text = parts.slice(1).join('|').trim();
            }

            if (!text) {
                return await socket.sendMessage(sender, {
                    text: `❌ *No text provided!*\n\n*Example:* ${prefix}tts sameera | ආයුබෝවන්`
                }, { quoted: msg });
            }

            await socket.sendMessage(sender, { react: { text: '🎙️', key: msg.key } });
            await socket.sendMessage(sender, {
                text: `🎙️ *Generating speech...*\n🎭 Voice: *${voice}*\n📝 Text: ${text.length > 50 ? text.substring(0, 50) + '...' : text}`
            }, { quoted: msg });

            // Call TTS API
            const apiUrl = `${TTS_API}?q=${encodeURIComponent(text)}&voicename=${encodeURIComponent(voice)}`;
            const response = await axios.get(apiUrl, {
                responseType: 'arraybuffer',
                timeout: 30000,
                headers: { 'User-Agent': 'Mozilla/5.0' }
            });

            const audioBuffer = Buffer.from(response.data);

            if (!audioBuffer || audioBuffer.length < 100) {
                return await socket.sendMessage(sender, {
                    text: `❌ *Failed to generate speech!*\nCheck voice name and try again.\n\n*Example voices:* henry, jane, sameera, thilini, brian, amy`
                }, { quoted: msg });
            }

            // Send as audio
            await socket.sendMessage(sender, {
                audio: audioBuffer,
                mimetype: 'audio/mp3',
                ptt: false
            }, { quoted: msg });

            await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

        } catch (err) {
            console.error('TTS plugin error:', err.message);
            await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
            await socket.sendMessage(sender, {
                text: `❌ *TTS Error:* ${err.message}`
            }, { quoted: msg });
        }
    }
};
