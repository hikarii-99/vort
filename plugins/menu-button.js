const os = require('os');
const { generateWAMessageFromContent, proto, prepareWAMessageMedia } = require('baileys');

const plugin = {
    command: ['menu', 'help', 'list', 'panel'],
    description: 'Show interactive menu system',
    ownerOnly: false,

    handler: async ({ socket, msg, sender, prefix }) => {
        try {
            // Show loading reaction
            await socket.sendMessage(sender, {
                react: { text: '⏳', key: msg.key }
            });

            // RAM Usage ගණනය කිරීම
            const usedRAM = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);
            const totalRAM = Math.round(os.totalmem() / 1024 / 1024);
            const mode = 'Public';

            const menuCaption = `╭━━━〔 *VORTEX MD* 〕━━━┈⊷
┃★╭──────────────
┃★│ 👑 Owner : *Pansilu Nethmina*
┃★│ 💻 Type : *NodeJs*
┃★│ 🎲 Ram usage: *${usedRAM}MB / ${totalRAM}MB*
┃★│ ⚙️ Mode : *[${mode}]* 
┃★│ 🔣 Prefix : *${prefix}* 
┃★│ 🏷️ Version : *1.0 Beta* 
┃★╰──────────────
╰━━━━━━━━━━━━━━━┈⊷
 𝐕𝐎𝐑𝐓𝐄𝐗 𝐌𝐃 𝐌𝐄𝐍𝐔`;

            // Image Media Prepare කිරීම
            const media = await prepareWAMessageMedia(
                { image: { url: 'https://u.pone.rs/empoefka.jpg' } },
                { upload: socket.waUploadToServer }
            );

            // Title එක ඉවත් කළ Interactive Message Structure එක
            const interactiveMsg = proto.Message.InteractiveMessage.create({
                body: proto.Message.InteractiveMessage.Body.create({ text: menuCaption }),
                footer: proto.Message.InteractiveMessage.Footer.create({ text: "© POWERED BY VORTEX BOT TEAM" }),
                header: proto.Message.InteractiveMessage.Header.create({
                    hasMediaAttachment: true,
                    imageMessage: media.imageMessage
                }),
                nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
                    buttons: [
                        {
                            name: "single_select",
                            buttonParamsJson: JSON.stringify({
                                title: " Choose a Bot Command",
                                sections: [
                                    {
                                        title: "SELECT A MENU CATEGORY",
                                        rows: [
                                            { title: "01. Download Menu", description: "FB, TT, YT, Mediafire & Spotify", id: "1" },
                                            { title: "02. Group Menu", description: "Admin tools, Tagall & Group settings", id: "2" },
                                            { title: "03. Fun Menu", description: "Games, Chess & Fun commands", id: "3" },
                                            { title: "04. Owner Menu", description: "Bot management & System settings", id: "4" },
                                            { title: "05. AI Menu", description: "ChatGPT, Deepseek & Image Gen", id: "5" },
                                            { title: "06. Anime Menu", description: "Anime streaming & Info tools", id: "6" },
                                            { title: "07. Convert Menu", description: "Sticker, ToImage & Media convert", id: "7" },
                                            { title: "08. Other Menu", description: "Remove BG, SSWeb & Utilities", id: "8" },
                                            { title: "09. Movie Menu", description: "Cinesubz, Sinhalasub & Movies", id: "9" },
                                            { title: "10. Main Menu", description: "Ping, System & Alive info", id: "10" }
                                        ]
                                    }
                                ]
                            })
                        }
                    ]
                }),
                contextInfo: {
                    mentionedJid: [sender]
                }
            });

            // Message එක Generate කර යැවීම
            const fullMsg = generateWAMessageFromContent(
                sender,
                {
                    viewOnceMessage: {
                        message: {
                            interactiveMessage: interactiveMsg
                        }
                    }
                },
                { quoted: msg }
            );

            await socket.relayMessage(sender, fullMsg.message, { messageId: fullMsg.key.id });

            const messageID = fullMsg.key.id;

            // Sub Menu Data
            const menuData = {
                '1': {
                    content: `╭━━━〔 *Download Menu* 〕━━━┈⊷
┃★╭──────────────
┃★│ • fb 
┃★│ • mediafire 
┃★│ • tt 
┃★│ • twitter 
┃★│ • Ig 
┃★│ • apk 
┃★│ • img 
┃★│ • upload 
┃★│ • pin 
┃★│ • gdrive 
┃★╰──────────────
┃★╭──────────────
┃★│ • spotify 
┃★│ • song 
┃★│ • video
┃★│ • telegram 
┃★╰──────────────
╰━━━━━━━━━━━━━━━┈⊷
╔══════════⚔️═══════════╗  
           ᐯㄖ尺ㄒ乇乂 几ᗪ 爪乇几卄
╚══════════⚔️═══════════╝`,
                    image: 'https://u.pone.rs/mqnsbcrz.jpg'
                },
                '2': {
                    content: `╭━━━〔 *Group Menu* 〕━━━┈⊷
┃★╭──────────────
┃★│ • ginfo
┃★│ • add @user
┃★│ • kick @user
┃★╰──────────────
┃★╭──────────────
┃★│ • promote @user
┃★│ • demote @user
┃★│ • setgpp 
┃★╰──────────────
┃★╭──────────────
┃★│ • tag @user
┃★│ • hidetag [msg]
┃★│ • tagall
┃★╰──────────────
╰━━━━━━━━━━━━━━━┈⊷
╔══════════⚔️═══════════╗  
            ᐯㄖ尺ㄒ乇乂 几ᗪ 爪乇几卄
╚══════════⚔️═══════════╝`,
                    image: 'https://u.pone.rs/hknaxcgm.jpg'
                },
                '3': {
                    content: `╭━━━〔 *Fun Menu* 〕━━━┈⊷
┃★╭──────────────
┃★│ • loli
┃★│ • car
┃★│ • chess
┃★│ • play
┃★╰──────────────
╰━━━━━━━━━━━━━━━┈⊷
╔══════════⚔️═══════════╗  
           ᐯㄖ尺ㄒ乇乂 几ᗪ 爪乇几卄
╚══════════⚔️═══════════╝`,
                    image: 'https://u.pone.rs/pdaqggru.jpg'
                },
                '4': {
                    content: `╭━━━〔 Owner Menu 〕━━━┈⊷
┃★╭──────────────
┃★│ • setpp 
┃★│ • restart
┃★│ • system
┃★│ • vv
┃★│ • getpp [Number]
┃★╰──────────────
┃★╭──────────────
┃★│ • gjid
┃★│ • jid @user
┃★╰──────────────
╰━━━━━━━━━━━━━━━┈⊷
╔══════════⚔️═══════════╗  
           ᐯㄖ尺ㄒ乇乂 几ᗪ 爪乇几卄
╚══════════⚔️═══════════╝`,
                    image: 'https://u.pone.rs/djaoxykc.jpg'
                },
                '5': {
                    content: `╭━━━〔 AI Menu 〕━━━┈⊷
┃★╭─────────────
┃★│ • ai
┃★│ • aimusic
┃★│ • deepseek 
┃★╰──────────────
┃★╭──────────────
┃★│ • gen
┃★│ • editimg
┃★│ • aivideo
┃★╰──────────────
╰━━━━━━━━━━━━━━━┈⊷
╔══════════⚔️═══════════╗  
           ᐯㄖ尺ㄒ乇乂 几ᗪ 爪乇几卄
╚══════════⚔️═══════════╝`,
                    image: 'https://u.pone.rs/vashwykt.jpg'
                },
                '6': {
                    content: `╭━━━〔 Anime Menu 〕━━━┈⊷
┃★╭──────────────
┃★│ • animostlk
┃★│ • animeheaven
┃★│ • animahd
┃★│ • kazaki
┃★│ • animexin
┃★│ • hanime
┃★│ • hanime2
┃★╰──────────────
╰━━━━━━━━━━━━━━━┈⊷
╔══════════⚔️═══════════╗  
           ᐯㄖ尺ㄒ乇乂 几ᗪ 爪乇几卄
╚══════════⚔️═══════════╝`,
                    image: 'https://u.pone.rs/gccdpruz.jpg'
                },
                '7': {
                    content: `╭━━━〔 Convert Menu 〕━━━┈⊷
┃★╭──────────────
┃★│ • sticker 
┃★│ • toimg
┃★│ • tourl [media]
┃★╰──────────────
┃★╭──────────────
┃★│ • tts [text]
┃★│ • rename
┃★╰──────────────
╰━━━━━━━━━━━━━━━┈⊷
╔══════════⚔️═══════════╗  
           ᐯㄖ尺ㄒ乇乂 几ᗪ 爪乇几卄
╚══════════⚔️═══════════╝`,
                    image: 'https://u.pone.rs/cgffyvys.jpg'
                },
                '8': {
                    content: `╭━━━〔 Other Menu 〕━━━┈⊷
┃★╭──────────────
┃★│ • Save
┃★│ • fwd [gjid]
┃★│ • removebg 
┃★│ • wallpaper
┃★╰──────────────
┃★╭──────────────
┃★│ • ppr
┃★│ • ssweb
┃★╰──────────────
╰━━━━━━━━━━━━━━━┈⊷
╔══════════⚔️═══════════╗  
           ᐯㄖ尺ㄒ乇乂 几ᗪ 爪乇几卄
╚══════════⚔️═══════════╝`,
                    image: 'https://u.pone.rs/exofsnru.jpg'
                },
                '9': {
                    content: `╭━━〔 *Movie List* 〕━━┈⊷
┃◈╭─────────────·๏
┃◈┃• cinesubz 
┃◈┃• sinhalasub
┃◈┃• wap
┃◈┃• mvlk
┃◈┃• cineverse
┃◈┃• cinepix
┃◈┃• sdub
┃◈┃• tv
┃◈└───────────┈⊷
╰──────────────┈⊷
╔══════════⚔️═══════════╗  
           ᐯㄖ尺ㄒ乇乂 几ᗪ 爪乇几ㄩ
╚══════════⚔️═══════════╝`,
                    image: 'https://u.pone.rs/mdpjxmfa.jpg'
                },
                '10': {
                    content: `╭━━━〔 Main Menu 〕━━━┈⊷
┃★╭──────────────
┃★│ • ping
┃★│ • alive
┃★│ • system
┃★│ • owner
┃★│ • menu
┃★╰──────────────
╰━━━━━━━━━━━━━━━┈⊷
╔══════════⚔️═══════════╗  
           ᐯㄖ尺ㄒ乇乂 几ᗪ 爪乇几卄
╚══════════⚔️═══════════╝`,
                    image: 'https://u.pone.rs/vjenlxgc.jpg'
                }
            };

            await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

            // Event handler එකක් සාදා duplicate යෑම වැළැක්වීමට එකවරක් ක්‍රියාත්මක වූ පසු ඉවත් කිරීම
            const handler = async (msgData) => {
                const receivedMsg = msgData.messages?.[0];
                if (!receivedMsg?.message || !receivedMsg.key?.remoteJid) return;

                const message = receivedMsg.message;
                const senderID = receivedMsg.key.remoteJid;
                let selectedOption = '';

                // List Button Response
                if (message.interactiveResponseMessage?.nativeFlowResponseMessage) {
                    try {
                        const params = JSON.parse(message.interactiveResponseMessage.nativeFlowResponseMessage.paramsJson);
                        selectedOption = params.id || params.rowId || '';
                    } catch (e) {}
                } 
                // Context reply (manual number text)
                else if (message.extendedTextMessage?.contextInfo?.stanzaId === messageID) {
                    selectedOption = message.conversation || message.extendedTextMessage?.text || '';
                }

                const cleanText = selectedOption ? selectedOption.trim().replace(/^0+/, '') : '';

                if (cleanText && menuData[cleanText]) {
                    // Duplicate messages වැළැක්වීම සඳහා අදාළ Listener එක වහාම අක්‍රිය කිරීම
                    socket.ev.off("messages.upsert", handler);

                    await socket.sendMessage(senderID, { react: { text: '⏳', key: receivedMsg.key } });

                    const selectedMenu = menuData[cleanText];
                    
                    await socket.sendMessage(
                        senderID,
                        {
                            image: { url: selectedMenu.image },
                            caption: selectedMenu.content,
                            contextInfo: { mentionedJid: [senderID] }
                        },
                        { quoted: receivedMsg }
                    );

                    await socket.sendMessage(senderID, { react: { text: '✅', key: receivedMsg.key } });
                }
            }; 

            socket.ev.on("messages.upsert", handler);

            // විනාඩි 5කට පසු auto cleanup කිරීම
            setTimeout(() => {
                socket.ev.off("messages.upsert", handler);
            }, 300000);

        } catch (error) {
            console.error('Menu Error:', error);
            await socket.sendMessage(sender, { 
                text: `❌ Error in Menu System: ${error.message}` 
            }, { quoted: msg });
        }
    }
};

module.exports = plugin;
