const express = require("express");
const axios = require("axios");
const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");

const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");

const app = express();
app.use(express.json());

// ================= ENV =================
const BOT_TOKEN = process.env.BOT_TOKEN;
const MONGO_URL = process.env.MONGO_URL;

const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const CF_API_TOKEN = process.env.CF_API_TOKEN;
const R2_BUCKET = process.env.R2_BUCKET;

const TG_API_ID = parseInt(process.env.TG_API_ID);
const TG_API_HASH = process.env.TG_API_HASH;
const TG_SESSION = process.env.TG_SESSION;

// ================= R2 URL =================
const R2_PUBLIC_URL =
  "https://pub-1032004a583a464caf18df15b07cda3c.r2.dev";

// ================= DB =================
mongoose.connect(MONGO_URL);

const Movie = mongoose.model(
  "Movie",
  new mongoose.Schema({
    key: String,
    name: String
  })
);

// ================= TELEGRAM CLIENT =================
const client = new TelegramClient(
  new StringSession(TG_SESSION),
  TG_API_ID,
  TG_API_HASH,
  { connectionRetries: 5 }
);

(async () => {
  await client.connect();
  console.log("✅ Telegram Connected");
})();

// ================= DEBUG WEBHOOK =================
app.post("/telegram", async (req, res) => {
  try {
    console.log("\n==============================");
    console.log("📩 RAW UPDATE RECEIVED:");
    console.log(JSON.stringify(req.body, null, 2));
    console.log("==============================\n");

    const msg =
      req.body.message ||
      req.body.channel_post ||
      req.body.edited_message;

    if (!msg) {
      console.log("❌ NO MESSAGE OBJECT FOUND");
      return res.sendStatus(200);
    }

    console.log("📥 MESSAGE TYPE DETECTED");

    console.log("CHAT TYPE:", msg.chat?.type);
    console.log("CHAT ID:", msg.chat?.id);

    const file = msg.video || msg.document;

    if (!file) {
      console.log("❌ NO FILE FOUND IN MESSAGE");
      console.log("MESSAGE KEYS:", Object.keys(msg));
      return res.sendStatus(200);
    }

    console.log("🎬 FILE FOUND:");
    console.log("File Name:", file.file_name);
    console.log("File Size:", file.file_size);

    // ================= TELEGRAM DOWNLOAD =================
    const messages = await client.getMessages(msg.chat.id, {
      ids: msg.message_id
    });

    console.log("📡 DOWNLOADING FROM TELEGRAM...");

    const tgStream = await client.downloadMedia(messages[0], {
      asStream: true
    });

    if (!tgStream) {
      console.log("❌ TELEGRAM STREAM NULL");
      return res.sendStatus(200);
    }

    // ================= FILE KEY =================
    const key = `${Date.now()}-${Math.random()
      .toString(36)
      .substring(2)}-${file.file_name || "movie.mp4"}`;

    const tempPath = path.join("/tmp", key);

    console.log("💾 SAVING TO TEMP FILE:", tempPath);

    const writeStream = fs.createWriteStream(tempPath);

    tgStream.pipe(writeStream);

    await new Promise((resolve, reject) => {
      writeStream.on("finish", resolve);
      writeStream.on("error", reject);
    });

    console.log("✅ TEMP FILE SAVED");

    // ================= UPLOAD TO R2 =================
    console.log("⬆ UPLOADING TO R2...");

    const fileStream = fs.createReadStream(tempPath);

    const uploadRes = await axios.put(
      `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/r2/buckets/${R2_BUCKET}/objects/${key}`,
      fileStream,
      {
        headers: {
          Authorization: `Bearer ${CF_API_TOKEN}`,
          "Content-Type": "video/mp4"
        },
        maxBodyLength: Infinity
      }
    );

    console.log("📦 R2 RESPONSE:");
    console.log(JSON.stringify(uploadRes.data, null, 2));

    if (!uploadRes.data?.success) {
      console.log("❌ R2 UPLOAD FAILED");
      fs.unlinkSync(tempPath);
      return res.sendStatus(200);
    }

    fs.unlinkSync(tempPath);

    console.log("✅ UPLOAD SUCCESS");

    const saved = await Movie.create({
      key,
      name: file.file_name
    });

    const link = `https://ott-backend-5iwy.onrender.com/watch/${saved._id}`;

    console.log("🔗 GENERATED LINK:", link);

    await axios.post(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      {
        chat_id: msg.chat.id,
        text: `🎬 ${file.file_name}\n👉 ${link}`
      }
    );

    console.log("📤 BOT MESSAGE SENT");

    res.sendStatus(200);
  } catch (err) {
    console.log("❌ ERROR:");
    console.log(err);
    res.sendStatus(200);
  }
});

// ================= WATCH PAGE =================
app.get("/watch/:id", async (req, res) => {
  try {
    const movie = await Movie.findById(req.params.id);
    if (!movie) return res.status(404).send("Not found");

    const videoUrl = `${R2_PUBLIC_URL}/${movie.key}`;

    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>${movie.name}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body {
            margin: 0;
            background: black;
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100vh;
          }
          video {
            width: 100%;
            max-height: 100vh;
          }
        </style>
      </head>
      <body>
        <video controls autoplay playsinline preload="metadata">
          <source src="${videoUrl}" type="video/mp4">
        </video>
      </body>
      </html>
    `);
  } catch (err) {
    console.log("STREAM ERROR:", err.message);
    res.status(500).send("Stream error");
  }
});

// ================= HOME =================
app.get("/", (req, res) => {
  res.send("DEBUG MODE ACTIVE 🚀 Telegram → R2");
});

// ================= START =================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on", PORT);
});