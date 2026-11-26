const os = require('os');

module.exports = {
    command: ['menu3', 'help', 'list', 'panel'],
    description: 'Show interactive menu system',
    ownerOnly: false,

    handler: async ({ socket, msg, sender, prefix }) => {
        try {
            // Show loading reaction
            await socket.sendMessage(sender, {
                react: { text: '⏳', key: msg.key }
            });

            // RAM Usage එක හරියටම ගණනය කිරීම
            const usedRAM = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);
            const totalRAM = Math.round(os.totalmem() / 1024 / 1024);
            
            // Config එක අයින් කරපු නිසා Mode එක කෙලින්ම මෙතනින් දෙනවා
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
╭━━〔 *Menu List* 〕━━┈⊷
┃◈╭─────────────·๏ 
┃◈│01.  *Download Menu* 
┃◈│02.  *Group Menu* 
┃◈│03.  *Fun Menu* 
┃◈│04.  *Owner Menu* 
┃◈│05.  *AI Menu* 
┃◈│06.  *Anime Menu* 
┃◈│07.  *Convert Menu* 
┃◈│08.  *Other Menu* 
┃◈│09.  *Movie Menu* 
┃◈│10.  *Main Menu* 
┃◈╰───────────┈⊷ 
╰──────────────┈⊷ 
╔══════════⚔️═══════════╗  
           ᐯㄖ尺ㄒ乇乂 几ᗪ 爪乇几卄 
╚══════════⚔️═══════════╝`;

            // Channel forwarding කොටස අයින් කර සකස් කළ contextInfo
            const contextInfo = {
                mentionedJid: [sender]
            };

            // Main Menu Message එක යැවීම
            const sentMsg = await socket.sendMessage(
                sender,
                {
                    image: { url: 'https://u.pone.rs/empoefka.jpg' },
                    caption: menuCaption,
                    contextInfo: contextInfo
                },
                { quoted: msg }
            );

            const messageID = sentMsg.key.id;

            // Complete menu data
            const menuData = {
                '1': {
                    title: "📥 *Download Menu* 📥",
                    content: `
╭━━━〔 *Download Menu* 〕━━━┈⊷
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
┃★│ 
┃★╰──────────────
╰━━━━━━━━━━━━━━━┈⊷
╔══════════⚔️═══════════╗  
           ᐯㄖ尺ㄒ乇乂 几ᗪ 爪乇几卄
╚══════════⚔️═══════════╝ `,
                    image: 'https://files.catbox.moe/r2jp1i.jpg'
                },
                '2': {
                    title: "👥 *Group Menu* 👥",
                    content: `
╭━━━〔 *Group Menu* 〕━━━┈⊷
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
╚══════════⚔️═══════════╝` ,
                    image: 'https://files.catbox.moe/8460ga.jpg'
                },
                '3': {
                    title: "😄 *Fun Menu* 😄",
                    content: `
╭━━━〔 *Fun Menu* 〕━━━┈⊷
┃★╭──────────────
┃★│ • loli
┃★│ • car
┃★│ • chess
┃★│ • play
┃★╰──────────────
╰━━━━━━━━━━━━━━━┈⊷
╔══════════⚔️═══════════╗  
           ᐯㄖ尺ㄒ乇乂 几ᗪ 爪乇几卄
╚══════════⚔️═══════════╝` ,
                    image: 'https://files.catbox.moe/jwpwj4.jpg'
                },
                '4': {
                    title: "👑 Owner Menu 👑",
                    content: `
╭━━━〔 Owner Menu 〕━━━┈⊷
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
╚══════════⚔️═══════════╝` ,
                    image: 'https://files.catbox.moe/d90r6e.jpg'
                },
                '5': {
                    title: "🤖 AI Menu 🤖",
                    content: `
╭━━━〔 AI Menu 〕━━━┈⊷
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
╚══════════⚔️═══════════╝` ,
                    image: 'https://files.catbox.moe/zkvui4.jpg'
                },
                '6': {
                    title: "🎎 Anime Menu 🎎",
                    content: `
╭━━━〔 Anime Menu 〕━━━┈⊷
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
╚══════════⚔️═══════════╝` ,
                    image: 'https://files.catbox.moe/hy0bmr.jpg'
                },
                '7': {
                    title: "🔄 Convert Menu 🔄",
                    content: `
╭━━━〔 Convert Menu 〕━━━┈⊷
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
╚══════════⚔️═══════════╝` ,
                    image: 'https://files.catbox.moe/son2ny.jpg'
                },
                '8': {
                    title: "📌 Other Menu 📌",
                    content: `
╭━━━〔 Other Menu 〕━━━┈⊷
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
╚══════════⚔️═══════════╝` ,
                    image: 'https://files.catbox.moe/9jzx6b.jpg'
                },
                '9': {
                    title: "💞 Movie Menu 💞",
                    content: `
╭━━〔 *Movie List* 〕━━┈⊷
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
╚══════════⚔️═══════════╝` ,
                    image: 'https://u.pone.rs/mdpjxmfa.jpg'
                },
                '10': {
                    title: "🏠 Main Menu 🏠",
                    content: `
╭━━━〔 Main Menu 〕━━━┈⊷
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
╚══════════⚔️═══════════╝` ,
                    image: 'https://files.catbox.moe/qor3ew.jpg'
                }
            };

            // අංක වලට අදාළ Menu එක දෙන්න හදපු Listener එක
            const handler = async (msgData) => {
                const receivedMsg = msgData.messages[0];
                if (!receivedMsg?.message || !receivedMsg.key?.remoteJid) return;

                const isReplyToMenu = receivedMsg.message.extendedTextMessage?.contextInfo?.stanzaId === messageID;

                if (isReplyToMenu) {
                    const receivedText = receivedMsg.message.conversation || 
                                         receivedMsg.message.extendedTextMessage?.text;
                    const senderID = receivedMsg.key.remoteJid;

                    await socket.sendMessage(senderID, {
                        react: { text: '⏳', key: receivedMsg.key }
                    });

                    // User 01 කියලා යැව්වත් 1 විදිහට අරන් වැඩකරන්න හදපු එක
                    const cleanText = receivedText ? receivedText.trim().replace(/^0+/, '') : '';

                    if (menuData[cleanText]) {
                        const selectedMenu = menuData[cleanText];
                        
                        await socket.sendMessage(
                            senderID,
                            {
                                image: { url: selectedMenu.image },
                                caption: selectedMenu.content,
                                contextInfo: contextInfo
                            },
                            { quoted: receivedMsg }
                        );

                        await socket.sendMessage(senderID, {
                            react: { text: '✅', key: receivedMsg.key }
                        });

                    } else {
                        await socket.sendMessage(
                            senderID,
                            {
                                text: `❌ *Invalid Option!* ❌\n\nPlease reply with a number between 1-10 to select a menu.\n\n*Example:* Reply with "1" for Download Menu`,
                                contextInfo: contextInfo
                            },
                            { quoted: receivedMsg }
                        );

                        await socket.sendMessage(senderID, {
                            react: { text: '❌', key: receivedMsg.key }
                        });
                    } 
                } 
            }; 
            
            // Listener එක on කිරීම
            socket.ev.on("messages.upsert", handler);
            
            // විනාඩි 5 කට පස්සේ listener එක අයින් කරනවා (Memory Leak නවත්තන්න)
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
