const axios = require('axios');

const GENERATE_API = 'https://apis.davidcyriltech.my.id/ai/music/remusic';
const STYLES_API = 'https://apis.davidcyriltech.my.id/ai/music/remusic/styles';

module.exports = {
    command: ['aimusic', 'genmusic', 'makemusic', 'amusic'],
    description: 'Generate AI Music using Remusic AI',

    handler: async ({ socket, msg, sender, args, prefix }) => {
        try {
            const input = args.join(' ').trim();

            // No input — show help + styles
            if (!input) {
                await socket.sendMessage(sender, { react: { text: '🎵', key: msg.key } });

                let stylesText = '';
                try {
                    const { data } = await axios.get(STYLES_API, { timeout: 10000 });
                    if (data.success && data.result) {
                        const r = data.result;
                        stylesText = `\n\n🎸 *Genres:*\n${r.genre?.slice(0, 10).join(', ')}...\n\n` +
                            `😊 *Moods:*\n${r.mood?.slice(0, 10).join(', ')}...\n\n` +
                            `🎤 *Vocals:*\n${r.vocal?.join(', ')}\n\n` +
                            `⏱️ *Tempo:*\n${r.tempo?.join(', ')}`;
                    }
                } catch (e) {}

                return await socket.sendMessage(sender, {
                    text: `🎵 *VORTEX MD | AI Music Generator*\n\n` +
                        `*Usage:*\n` +
                        `${prefix}music <prompt>\n` +
                        `${prefix}music <prompt>, style: <styles>\n` +
                        `${prefix}music <prompt>, lyrics: <lyrics>\n` +
                        `${prefix}music <prompt>, style: <styles>, lyrics: <lyrics>\n\n` +
                        `*Examples:*\n` +
                        `${prefix}music quiet night\n` +
                        `${prefix}music love song, style: Pop Romantic\n` +
                        `${prefix}music sad vibes, style: Lo-fi Sad, lyrics: I miss you every night...\n\n` +
                        `${stylesText}\n\n` +
                        `> *Powered by VORTEX MD*`
                }, { quoted: msg });
            }

            // Parse input: prompt, style: xxx, lyrics: xxx
            let prompt = input;
            let styles = '';
            let lyrics = '';
            let title = '';

            const parts = input.split(',').map(p => p.trim());
            prompt = parts[0].trim();

            for (let i = 1; i < parts.length; i++) {
                const part = parts[i].trim();
                if (part.toLowerCase().startsWith('style:')) {
                    styles = part.substring(6).trim();
                } else if (part.toLowerCase().startsWith('lyrics:')) {
                    lyrics = part.substring(7).trim();
                } else if (part.toLowerCase().startsWith('title:')) {
                    title = part.substring(6).trim();
                }
            }

            await socket.sendMessage(sender, { react: { text: '⏳', key: msg.key } });
            await socket.sendMessage(sender, {
                text: `🎵 *Generating your AI music...*\n\n` +
                    `📝 *Prompt:* ${prompt}\n` +
                    `${styles ? `🎸 *Style:* ${styles}\n` : ''}` +
                    `${lyrics ? `📜 *Custom Lyrics:* Yes\n` : ''}` +
                    `\n_This may take 1-2 minutes..._`
            }, { quoted: msg });

            // Build API URL
            let apiUrl = `${GENERATE_API}?prompt=${encodeURIComponent(prompt)}`;
            if (styles) apiUrl += `&styles=${encodeURIComponent(styles)}`;
            if (title) apiUrl += `&title=${encodeURIComponent(title)}`;
            if (lyrics) apiUrl += `&lyrics=${encodeURIComponent(lyrics)}`;

            const { data } = await axios.get(apiUrl, { timeout: 180000 });

            if (!data.success || !data.result) {
                return await socket.sendMessage(sender, {
                    text: `❌ *Music generation failed!* Try again later.`
                }, { quoted: msg });
            }

            const result = data.result;
            let audioUrl = result.audio_url || result.songs?.[0]?.audio;
            const imageUrl = result.image_url || result.songs?.[0]?.image;
            const songTitle = result.title || result.songs?.[0]?.title || prompt;
            const songLyrics = result.lyrics || result.songs?.[0]?.lyrics || '';
            const tags = result.tags || styles || '';

            // Poll if audio not ready — 1 min × 2 tries = 2 mins max
            if (!audioUrl) {
                const songId = result.songs?.[0]?.id;
                if (!songId) {
                    return await socket.sendMessage(sender, {
                        text: `❌ *Audio generation failed. Try again.*`
                    }, { quoted: msg });
                }

                await socket.sendMessage(sender, {
                    text: `⏳ *Audio is processing, waiting...*`
                }, { quoted: msg });

                for (let i = 0; i < 2; i++) {
                    await new Promise(r => setTimeout(r, 60000)); // 1 minute
                    try {
                        const { data: sd } = await axios.get(
                            `https://apis.davidcyriltech.my.id/ai/music/remusic/status/${songId}`,
                            { timeout: 15000 }
                        );
                        if (sd?.result?.audio_url || sd?.result?.audio) {
                            audioUrl = sd.result.audio_url || sd.result.audio;
                            break;
                        }
                    } catch (e) {}
                }

                if (!audioUrl) {
                    return await socket.sendMessage(sender, {
                        text: `❌ *Audio not ready after 2 minutes. Try again later.*`
                    }, { quoted: msg });
                }
            }

            // Build caption
            const caption = `🎵 *VORTEX MD | AI Music*\n\n` +
                `🎶 *${songTitle}*\n` +
                `${tags ? `🎸 *Style:* ${tags}\n` : ''}` +
                `${songLyrics ? `\n📜 *Lyrics:*\n${songLyrics.substring(0, 300)}${songLyrics.length > 300 ? '...' : ''}\n` : ''}` +
                `\n> *Generated by VORTEX MD AI*`;

            // Send cover image
            if (imageUrl) {
                await socket.sendMessage(sender, {
                    image: { url: imageUrl },
                    caption: caption
                }, { quoted: msg });
            }

            // Send audio
            await socket.sendMessage(sender, {
                audio: { url: audioUrl },
                mimetype: 'audio/mp3',
                ptt: false
            }, { quoted: msg });

            await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

        } catch (err) {
            console.error('AI Music plugin error:', err.message);
            await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
            await socket.sendMessage(sender, {
                text: `❌ *Error:* ${err.message}`
            }, { quoted: msg });
        }
    }
};
