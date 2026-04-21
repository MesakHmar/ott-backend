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

// 👉 PUT YOUR R2 PUBLIC URL HERE
const R2_PUBLIC_URL = "https://pub-1032004a583a464caf18df15b07cda3c.r2.dev";

// ================= DB =================
mongoose.connect(MONGO_URL)
  .then(() => console.log("MongoDB Connected"))
  .catch(err => console.log(err));

const Movie = mongoose.model("Movie", new mongoose.Schema({
  key: String,
  name: String
}));

// ================= MTProto =================
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

// ================= TELEGRAM WEBHOOK =================
app.post("/telegram", async (req, res) => {
  try {
    const msg = req.body.message || req.body.channel_post;
    if (!msg) return res.sendStatus(200);

    const file = msg.video || msg.document;
    if (!file) return res.sendStatus(200);

    const name = file.file_name || "movie.mp4";

    console.log("📥 Downloading via MTProto...");

    // 🔥 GET MESSAGE
    const messages = await client.getMessages(msg.chat.id, {
      ids: msg.message_id
    });

    // 🔥 DOWNLOAD LARGE FILE (NO LIMIT)
    const buffer = await client.downloadMedia(messages[0]);

    const key = Date.now() + "-" + name;

    console.log("⬆ Uploading to R2...");

    // 🔥 UPLOAD TO R2
    await axios.put(
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

    console.log("✅ Uploaded:", key);

    // SAVE DB
    const saved = await Movie.create({ key, name });

    const link = `https://ott-backend-5iwy.onrender.com/watch/${saved._id}`;

    console.log("📤 Sending link");

    // SEND LINK
    await axios.post(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      {
        chat_id: msg.chat.id,
        text: `🎬 ${name}\n👉 ${link}`
      }
    );

    res.sendStatus(200);

  } catch (err) {
    console.log("❌ ERROR:", err.message);
    res.sendStatus(200);
  }
});

// ================= STREAM =================
app.get("/watch/:id", async (req, res) => {
  try {
    const movie = await Movie.findById(req.params.id);
    if (!movie) return res.status(404).send("Not found");

    const publicUrl = `${https://pub-1032004a583a464caf18df15b07cda3c.r2.dev}/${movie.key}`;
    return res.redirect(publicUrl);

  } catch (err) {
    console.log("STREAM ERROR:", err.message);
    res.status(500).send("Stream error");
  }
});

// ================= HOME =================
app.get("/", (req, res) => {
  res.send("🚀 Telegram → R2 OTT Running");
});

// ================= START =================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});