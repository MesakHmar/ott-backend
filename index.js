const express = require("express");
const axios = require("axios");
const mongoose = require("mongoose");

const app = express();
app.use(express.json());

// ================= ENV =================
const BOT_TOKEN = process.env.BOT_TOKEN;
const MONGO_URL = process.env.MONGO_URL;

const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const CF_API_TOKEN = process.env.CF_API_TOKEN;
const R2_BUCKET = process.env.R2_BUCKET;

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

// ================= HOME =================
app.get("/", (req, res) => {
  res.send("🚀 OTT Backend Running");
});

// ================= WATCH =================
app.get("/watch/:id", async (req, res) => {
  const movie = await Movie.findById(req.params.id);
  if (!movie) return res.send("Not found");

  const url = `${R2_PUBLIC_URL}/${encodeURIComponent(movie.key)}`;

  res.send(`
  <html>
  <body style="margin:0;background:black;">
  <video controls autoplay style="width:100%;height:100%">
    <source src="${url}" type="video/mp4">
  </video>
  </body>
  </html>
  `);
});

// ================= TELEGRAM WEBHOOK =================
app.post("/telegram", async (req, res) => {
  res.sendStatus(200); // VERY IMPORTANT

  try {
    console.log("\n🔥 NEW UPDATE");

    const msg =
      req.body.message ||
      req.body.channel_post ||
      req.body.edited_message;

    if (!msg) return;

    console.log("📩 CHAT ID:", msg.chat.id);

    const file =
      msg.video ||
      msg.document ||
      msg.animation ||
      msg.audio;

    if (!file) {
      console.log("❌ NO FILE");
      return;
    }

    console.log("🎬 FILE RECEIVED");

    // ================= GET FILE PATH FROM TELEGRAM =================
    const fileRes = await axios.get(
      `https://api.telegram.org/bot${BOT_TOKEN}/getFile`,
      {
        params: { file_id: file.file_id }
      }
    );

    if (!fileRes.data.ok) {
      console.log("❌ getFile FAILED");
      return;
    }

    const filePath = fileRes.data.result.file_path;

    console.log("📂 FILE PATH:", filePath);

    // ================= DOWNLOAD FILE =================
    const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;

    console.log("📥 DOWNLOADING FROM TELEGRAM CDN...");

    const tgFile = await axios.get(fileUrl, {
      responseType: "arraybuffer"
    });

    const buffer = tgFile.data;

    if (!buffer || buffer.length === 0) {
      console.log("❌ EMPTY BUFFER");
      return;
    }

    console.log("📦 SIZE:", buffer.length);

    // ================= FILE NAME =================
    const fileName = (file.file_name || "movie.mp4")
      .replace(/[^a-zA-Z0-9.\-_]/g, "_");

    const key = `${Date.now()}-${fileName}`;

    // ================= UPLOAD TO R2 =================
    console.log("⬆ UPLOADING TO R2...");

    const uploadRes = await axios.put(
      `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/r2/buckets/${R2_BUCKET}/objects/${key}`,
      buffer,
      {
        headers: {
          Authorization: `Bearer ${CF_API_TOKEN}`,
          "Content-Type": "video/mp4",
          "Content-Length": buffer.length
        },
        maxBodyLength: Infinity
      }
    );

    if (!uploadRes.data?.success) {
      console.log("❌ R2 FAILED");
      return;
    }

    console.log("☁️ UPLOADED");

    const saved = await Movie.create({
      key,
      name: fileName
    });

    const link = `https://ott-backend-5iwy.onrender.com/watch/${saved._id}`;

    console.log("🔗 LINK:", link);

    // ================= SEND MESSAGE =================
    await axios.post(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      {
        chat_id: msg.chat.id,
        text: `🎬 ${fileName}\n👉 ${link}`
      }
    );

    console.log("📤 SENT");
  } catch (err) {
    console.log("❌ ERROR:", err.message);
  }
});

// ================= START =================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on", PORT);
});