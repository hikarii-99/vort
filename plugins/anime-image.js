const axios = require('axios');

module.exports = {
    // හැම command එකක්ම මෙතනට ඇතුලත් කරලා තියෙනවා
    command: ['loli', 'imgloli', 'waifu', 'imgwaifu', 'neko', 'imgneko', 'megumin', 'imgmegumin', 'maid', 'imgmaid', 'awoo', 'imgawoo'],
    description: 'Download random anime images (loli, waifu, neko, megumin, maid, awoo).',
    ownerOnly: false,

    handler: async ({ socket, msg, sender, args, body, prefix }) => {
        try {
            // User type කරපු command එක (prefix එක නැතුව) වෙන් කරගැනීම
            const cmdName = body.trim().split(/ +/)[0].slice(prefix.length).toLowerCase();

            // ඒ ඒ command එකට අදාල API ලින්ක් එක, emoji එක සහ පින්තූරය ගන්න විදිය
            const apiConfigs = {
                'loli': { url: 'https://api.lolicon.app/setu/v2?num=1&r18=0&tag=lolicon', react: '🧧', name: 'loli', getImg: (res) => res.data.data[0].urls.original },
                'imgloli': { url: 'https://api.lolicon.app/setu/v2?num=1&r18=0&tag=lolicon', react: '🧧', name: 'loli', getImg: (res) => res.data.data[0].urls.original },
                
                'waifu': { url: 'https://api.waifu.pics/sfw/waifu', react: '🧧', name: 'Waifu', getImg: (res) => res.data.url },
                'imgwaifu': { url: 'https://api.waifu.pics/sfw/waifu', react: '🧧', name: 'Waifu', getImg: (res) => res.data.url },
                
                'neko': { url: 'https://api.waifu.pics/sfw/neko', react: '💫', name: 'neko', getImg: (res) => res.data.url },
                'imgneko': { url: 'https://api.waifu.pics/sfw/neko', react: '💫', name: 'neko', getImg: (res) => res.data.url },
                
                'megumin': { url: 'https://api.waifu.pics/sfw/megumin', react: '🧧', name: 'megumin', getImg: (res) => res.data.url },
                'imgmegumin': { url: 'https://api.waifu.pics/sfw/megumin', react: '🧧', name: 'megumin', getImg: (res) => res.data.url },
                
                'maid': { url: 'https://api.waifu.im/search/?included_tags=maid', react: '💫', name: 'maid', getImg: (res) => res.data.images[0].url },
                'imgmaid': { url: 'https://api.waifu.im/search/?included_tags=maid', react: '💫', name: 'maid', getImg: (res) => res.data.images[0].url },
                
                'awoo': { url: 'https://api.waifu.pics/sfw/awoo', react: '🧧', name: 'awoo', getImg: (res) => res.data.url },
                'imgawoo': { url: 'https://api.waifu.pics/sfw/awoo', react: '🧧', name: 'awoo', getImg: (res) => res.data.url }
            };

            // අදාල config එක තෝරාගැනීම
            const config = apiConfigs[cmdName];
            
            if (!config) return; // Command එක match උනේ නැත්නම් නතර වෙනවා

            // අදාල Emoji එකෙන් React කිරීම
            await socket.sendMessage(sender, { react: { text: config.react, key: msg.key } });

            // API එකෙන් Data ගැනීම
            let res = await axios.get(config.url);
            let imageUrl = config.getImg(res); // අදාල විදියට URL එක වෙන් කරගැනීම
            
            let caption = `❤️ Random ${config.name} image ❤️\n\n> VORTEX MD`;

            // පින්තූරය යැවීම
            await socket.sendMessage(sender, { 
                image: { url: imageUrl }, 
                caption: caption 
            }, { quoted: msg });

        } catch (e) {
            console.error('Anime Image Command Error:', e.message);
            await socket.sendMessage(sender, { text: '❌ *I cant find this anime image.*' }, { quoted: msg });
        }
    }
};
