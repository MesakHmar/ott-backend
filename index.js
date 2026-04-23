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

// ================= R2 =================
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
  console.log("✅ MTProto Connected");
})();

// ================= HOME =================
app.get("/", (req, res) => {
  res.send("🚀 MTProto OTT Running");
});

// ================= WATCH =================
app.get("/watch/:id", async (req, res) => {
  try {
    const movie = await Movie.findById(req.params.id);
    if (!movie) return res.send("Not found");

    const videoUrl = `${R2_PUBLIC_URL}/${encodeURIComponent(movie.key)}`;

    res.send(`
    <html>
    <body style="margin:0;background:black;">
      <video controls autoplay style="width:100%;height:100%">
        <source src="${videoUrl}" type="video/mp4">
      </video>
    </body>
    </html>
    `);
  } catch (err) {
    console.log("STREAM ERROR:", err);
    res.send("Error");
  }
});

// ================= TELEGRAM WEBHOOK =================
app.post("/telegram", async (req, res) => {
  res.sendStatus(200); // important

  try {
    console.log("\n🔥 NEW UPDATE");

    const msg =
      req.body.message ||
      req.body.channel_post ||
      req.body.edited_message;

    if (!msg) {
      console.log("❌ NO MESSAGE");
      return;
    }

    console.log("📩 CHAT ID:", msg.chat?.id);

    const file = msg.video || msg.document;

    if (!file) {
      console.log("❌ NO FILE");
      return;
    }

    const fileName = file.file_name || "movie.mp4";
    console.log("🎬 FILE:", fileName);

    // ================= GET FULL MESSAGE =================
    const messages = await client.getMessages(msg.chat.id, {
      ids: msg.message_id
    });

    if (!messages || !messages[0]) {
      console.log("❌ MESSAGE NOT FOUND");
      return;
    }

    // ================= DOWNLOAD (BUFFER SAFE) =================
    console.log("📥 DOWNLOADING FROM TELEGRAM...");

    const buffer = await client.downloadMedia(messages[0]);

    if (!buffer) {
      console.log("❌ DOWNLOAD FAILED");
      return;
    }

    console.log("📦 BUFFER SIZE:", buffer.length);

    // ================= FILE KEY =================
    const cleanName = fileName.replace(/[^a-zA-Z0-9.\-_]/g, "_");
    const key = `${Date.now()}-${cleanName}`;

    // ================= UPLOAD TO R2 =================
    console.log("⬆ UPLOADING TO R2...");

    const uploadRes = await axios.put(
      `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/r2/buckets/${R2_BUCKET}/objects/${key}`,
      buffer,
      {
        headers: {
          Authorization: `Bearer ${CF_API_TOKEN}`,
          "Content-Type": "video/mp4"
        },
        maxBodyLength: Infinity
      }
    );

    if (!uploadRes.data?.success) {
      console.log("❌ R2 FAILED:", uploadRes.data);
      return;
    }

    console.log("☁️ UPLOADED SUCCESS");

    // ================= SAVE =================
    const saved = await Movie.create({
      key,
      name: cleanName
    });

    const link = `https://ott-backend-5iwy.onrender.com/watch/${saved._id}`;

    console.log("🔗 LINK:", link);

    // ================= SEND BACK =================
    await axios.post(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      {
        chat_id: msg.chat.id,
        text: `🎬 ${cleanName}\n👉 ${link}`
      }
    );

    console.log("📤 SENT TO TELEGRAM");

  } catch (err) {
    console.log("❌ ERROR:", err.message);
  }
});

// ================= START =================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on", PORT);
});