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

// 👉 REPLACE WITH YOUR PUBLIC R2 URL
const R2_PUBLIC_URL = "https://pub-1032004a583a464caf18df15b07cda3c.r2.dev";

// ================= DB =================
mongoose.connect(MONGO_URL)
  .then(() => console.log("MongoDB Connected"))
  .catch(err => console.log(err));

const Movie = mongoose.model("Movie", new mongoose.Schema({
  key: String,
  name: String
}));

// ================= TELEGRAM WEBHOOK =================
app.post("/telegram", async (req, res) => {
  try {
    const msg = req.body.message || req.body.channel_post;
    if (!msg) return res.sendStatus(200);

    const file_id = msg.video?.file_id || msg.document?.file_id;
    if (!file_id) return res.sendStatus(200);

    const name =
      msg.caption ||
      msg.video?.file_name ||
      msg.document?.file_name ||
      "movie.mp4";

    console.log("Getting Telegram file...");

    // STEP 1: GET FILE PATH
    const tg = await axios.get(
      `https://api.telegram.org/bot${BOT_TOKEN}/getFile`,
      { params: { file_id } }
    );

    const filePath = tg.data.result.file_path;

    const fileUrl =
      `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;

    console.log("Streaming download from Telegram...");

    // STEP 2: STREAM DOWNLOAD
    const fileResponse = await axios({
      url: fileUrl,
      responseType: "stream"
    });

    const key = Date.now() + "-" + name;

    console.log("Uploading to R2 (stream)...");

    // STEP 3: STREAM UPLOAD TO R2
    await axios.put(
      `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/r2/buckets/${R2_BUCKET}/objects/${key}`,
      fileResponse.data, // 👈 stream directly
      {
        headers: {
          Authorization: `Bearer ${CF_API_TOKEN}`,
          "Content-Type": "video/mp4"
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity
      }
    );

    console.log("Uploaded:", key);

    // STEP 4: SAVE TO DB
    const saved = await Movie.create({ key, name });

    const link = `https://ott-backend-5iwy.onrender.com/watch/${saved._id}`;

    // STEP 5: SEND LINK
    await axios.post(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      {
        chat_id: msg.chat.id,
        text: `🎬 ${name}\n👉 Watch: ${link}`
      }
    );

    res.sendStatus(200);

  } catch (err) {
    console.log("UPLOAD ERROR:", err.response?.data || err.message);
    res.sendStatus(200);
  }
});

// ================= STREAM ROUTE =================
app.get("/watch/:id", async (req, res) => {
  try {
    const movie = await Movie.findById(req.params.id);
    if (!movie) return res.status(404).send("Not found");

    const publicUrl = `${R2_PUBLIC_URL}/${movie.key}`;

    return res.redirect(publicUrl);

  } catch (err) {
    console.log("STREAM ERROR:", err.message);
    res.status(500).send("Stream error");
  }
});

// ================= HOME =================
app.get("/", (req, res) => {
  res.send("R2 OTT Streaming Running");
});

// ================= START =================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});