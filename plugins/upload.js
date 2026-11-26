const axios = require("axios");
const fs = require("fs");
const path = require("path");
const url = require("url");
const os = require("os");

// URL එකෙන් File name එක ගන්න Function එක
const extractFileNameFromUrl = (fileUrl) => {
    const parsedUrl = url.parse(fileUrl, true);
    const fileName = parsedUrl.query.file;
    return fileName ? decodeURIComponent(fileName) : path.basename(fileUrl);
};

module.exports = {
    command: ['upload', 'uploadfile', 'dlfile'],
    description: 'Download a file from a direct URL and send it',
    ownerOnly: false,

    handler: async ({ socket, msg, sender, args }) => {
        try {
            const q = args.join(" "); // Arguments ටික එකට එකතු කරනවා
            
            if (!q || q.trim() === "") {
                return await socket.sendMessage(sender, { 
                    text: "❌ Please provide a URL and optional file name!\n📌 *Example:* `.upload2 https://example.com/file.zip, Spy x Family.mp4`" 
                }, { quoted: msg });
            }

            // Download වෙන බව පෙන්නන්න Reaction එකක් දාමු
            await socket.sendMessage(sender, {
                react: { text: '⬇️', key: msg.key }
            });

            // Input එක URL එකටයි, File name එකටයි වෙන් කිරීම
            const [urlPart, namePart] = q.split(",").map(part => part.trim());

            if (!urlPart || !urlPart.startsWith("http")) {
                return await socket.sendMessage(sender, { 
                    text: "❌ Please provide a valid direct URL." 
                }, { quoted: msg });
            }

            const fileUrl = urlPart;
            let fileName = namePart || extractFileNameFromUrl(fileUrl); 
            
            // File name එකේ අවුල් අකුරු (/, \) අයින් කිරීම
            fileName = fileName.replace(/[/\\]/g, "");
            if (!fileName) fileName = "downloaded_file.bin";

            // Bot ගෙ ෆෝල්ඩරේ පුරවන්නෙ නැතුව OS එකේ Temp ෆෝල්ඩරේට සේව් කිරීම (ආරක්ෂිතයි)
            const filePath = path.join(os.tmpdir(), fileName);

            // File එක Download කිරීම
            const { data } = await axios({
                url: fileUrl,
                method: "GET",
                responseType: "stream",
            });

            const writer = fs.createWriteStream(filePath);
            data.pipe(writer);

            // Download එක ඉවරවෙනකම් ඉන්න Promise එකක් භාවිතා කිරීම
            await new Promise((resolve, reject) => {
                writer.on("finish", resolve);
                writer.on("error", reject);
            });

            // Download උනාට පස්සේ File එක යැවීම
            await socket.sendMessage(sender, {
                document: { url: filePath }, // RAM එක Save කරගන්න කෙලින්ම URL (Path) එක දෙනවා
                mimetype: "application/octet-stream",
                fileName: fileName,
                caption: `✅ *Download complete!*\n📂 File: ${fileName}`,
            }, { quoted: msg });

            // යවලා ඉවර උනාට පස්සේ ඒ File එක මකලා දානවා (Space ඉතුරු කරන්න)
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }

            // සාර්ථකව යැව්වම ✅ වැටෙන්න හදමු
            await socket.sendMessage(sender, {
                react: { text: '✅', key: msg.key }
            });

        } catch (err) {
            console.error("Upload command error:", err);
            
            // Error එකක් ආවොත් ❌ වැටෙන්න
            await socket.sendMessage(sender, {
                react: { text: '❌', key: msg.key }
            });

            await socket.sendMessage(sender, { 
                text: `❌ Something went wrong. Try again later.\n\n_Error: ${err.message}_` 
            }, { quoted: msg });
        }
    }
};
