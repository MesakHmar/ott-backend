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

// ================= R2 PUBLIC =================
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
  try {
    const movie = await Movie.findById(req.params.id);
    if (!movie) return res.send("Not found");

    const videoUrl = `${R2_PUBLIC_URL}/${encodeURIComponent(movie.key)}`;

    res.send(`
    <!DOCTYPE html>
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
  res.sendStatus(200); // IMPORTANT

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

    const file =
      msg.video ||
      msg.document ||
      msg.animation ||
      msg.audio;

    // ================= FILE VALIDATION =================
    if (!file || !file.file_id) {
      console.log("❌ INVALID FILE");
      return;
    }

    console.log("🎬 FILE RECEIVED:", file.file_name || "media");

    // ================= SIZE LIMIT =================
    if (file.file_size && file.file_size > 200 * 1024 * 1024) {
      await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        chat_id: msg.chat.id,
        text: "❌ File too large (max ~200MB on Render)"
      });
      return;
    }

    // ================= GET FILE PATH =================
    console.log("📡 Getting file path...");

    const fileRes = await axios.get(
      `https://api.telegram.org/bot${BOT_TOKEN}/getFile`,
      {
        params: { file_id: file.file_id }
      }
    );

    if (!fileRes.data?.ok) {
      console.log("❌ getFile FAILED:", fileRes.data);
      return;
    }

    const filePath = fileRes.data.result.file_path;
    console.log("📂 FILE PATH:", filePath);

    const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;

    // ================= STREAM DOWNLOAD =================
    console.log("📥 STREAMING FROM TELEGRAM...");

    const tgStream = await axios({
      url: fileUrl,
      method: "GET",
      responseType: "stream"
    });

    const fileName = (file.file_name || "movie.mp4")
      .replace(/[^a-zA-Z0-9.\-_]/g, "_");

    const key = `${Date.now()}-${fileName}`;

    // ================= STREAM UPLOAD =================
    console.log("⬆ UPLOADING TO R2...");

    const uploadRes = await axios.put(
      `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/r2/buckets/${R2_BUCKET}/objects/${key}`,
      tgStream.data,
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
      name: fileName
    });

    const link = `https://ott-backend-5iwy.onrender.com/watch/${saved._id}`;

    console.log("🔗 LINK:", link);

    // ================= SEND MESSAGE =================
    console.log("📤 SENDING MESSAGE...");

    const botRes = await axios.post(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      {
        chat_id: msg.chat.id,
        text: `🎬 ${fileName}\n👉 ${link}`
      }
    );

    console.log("📤 BOT RESPONSE:", botRes.data);

  } catch (err) {
    console.log("❌ ERROR STATUS:", err.response?.status);
    console.log("❌ ERROR DATA:", err.response?.data);
    console.log("❌ ERROR MSG:", err.message);
  }
});

// ================= START =================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on", PORT);
});