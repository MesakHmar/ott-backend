const express = require("express");
const axios = require("axios");
const mongoose = require("mongoose");

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

// ================= TELEGRAM =================
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

// ================= TELEGRAM WEBHOOK =================
app.post("/telegram", async (req, res) => {
  try {
    console.log("\n================ NEW UPDATE ================");

    const msg =
      req.body.message ||
      req.body.channel_post ||
      req.body.edited_message;

    if (!msg) return res.sendStatus(200);

    const file =
      msg.video ||
      msg.document ||
      msg.audio ||
      msg.animation ||
      msg.photo?.[msg.photo.length - 1];

    if (!file) {
      console.log("❌ NO FILE");
      return res.sendStatus(200);
    }

    console.log("🎬 FILE:", file.file_name || "media");

    const messages = await client.getMessages(msg.chat.id, {
      ids: msg.message_id
    });

    const msgObj = messages?.[0];
    if (!msgObj) {
      console.log("❌ MESSAGE NOT FOUND");
      return res.sendStatus(200);
    }

    console.log("📥 DOWNLOADING FROM TELEGRAM...");

    // ================= FIX: ALWAYS BUFFER =================
    const fileBuffer = await client.downloadMedia(msgObj);

    if (!fileBuffer || fileBuffer.length === 0) {
      console.log("❌ EMPTY FILE BUFFER");
      return res.sendStatus(200);
    }

    console.log("📦 FILE SIZE:", fileBuffer.length);

    // ================= KEY =================
    const fileName = file.file_name || "movie.mp4";
    const key = `${Date.now()}-${fileName}`;

    // ================= UPLOAD TO R2 =================
    console.log("⬆ UPLOADING TO R2...");

    const uploadRes = await axios.put(
      `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/r2/buckets/${R2_BUCKET}/objects/${key}`,
      fileBuffer,
      {
        headers: {
          Authorization: `Bearer ${CF_API_TOKEN}`,
          "Content-Type": "video/mp4"
        }
      }
    );

    if (!uploadRes.data?.success) {
      console.log("❌ R2 UPLOAD FAILED");
      return res.sendStatus(200);
    }

    console.log("☁️ UPLOADED TO R2");

    // ================= SAVE DB =================
    const saved = await Movie.create({
      key,
      name: fileName
    });

    const link = `https://ott-backend-5iwy.onrender.com/watch/${saved._id}`;

    console.log("🔗 LINK:", link);

    // ================= SEND BOT MESSAGE =================
    await axios.post(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      {
        chat_id: msg.chat.id,
        text: `🎬 ${fileName}\n👉 ${link}`
      }
    );

    console.log("📤 SENT");

    res.sendStatus(200);
  } catch (err) {
    console.log("❌ ERROR:", err);
    res.sendStatus(200);
  }
});

// ================= STREAM PAGE =================
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
            justify-content: center;
            align-items: center;
            height: 100vh;
          }
          video {
            width: 100%;
            max-height: 100vh;
          }
        </style>
      </head>
      <body>
        <video controls autoplay playsinline>
          <source src="${videoUrl}" type="video/mp4">
        </video>
      </body>
      </html>
    `);
  } catch (err) {
    console.log("STREAM ERROR:", err);
    res.status(500).send("Error");
  }
});

// ================= HOME =================
app.get("/", (req, res) => {
  res.send("🚀 OTT Backend Running");
});

// ================= START =================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on", PORT);
});