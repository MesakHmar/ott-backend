const express = require("express");
const axios = require("axios");
const mongoose = require("mongoose");

const app = express();
app.use(express.json());

// =======================
// ENV VARIABLES
// =======================
const BOT_TOKEN = process.env.BOT_TOKEN;
const MONGO_URL = process.env.MONGO_URL;

// =======================
// SAFETY CHECK
// =======================
if (!BOT_TOKEN) console.log("❌ BOT_TOKEN missing");
if (!MONGO_URL) console.log("❌ MONGO_URL missing");

// =======================
// MONGODB CONNECT
// =======================
if (MONGO_URL) {
  mongoose.connect(MONGO_URL)
    .then(() => console.log("MongoDB Connected"))
    .catch(err => console.log("Mongo Error:", err.message));
}

// =======================
// SCHEMA
// =======================
const movieSchema = new mongoose.Schema({
  file_id: String,
  name: String
});

const Movie = mongoose.model("Movie", movieSchema);

// =======================
// TELEGRAM WEBHOOK (DEBUG + FIXED)
// =======================
app.post("/telegram", async (req, res) => {
  try {
    console.log("📩 UPDATE RECEIVED:", JSON.stringify(req.body));

    const msg =
      req.body.message ||
      req.body.channel_post ||
      req.body.edited_message;

    if (!msg) return res.sendStatus(200);

    const file_id =
      msg.video?.file_id ||
      msg.document?.file_id;

    console.log("📌 FILE ID:", file_id);

    if (!file_id) return res.sendStatus(200);

    const movieName =
      msg.caption ||
      msg.video?.file_name ||
      msg.document?.file_name ||
      "Untitled Movie";

    const saved = await Movie.create({
      file_id,
      name: movieName
    });

    const link = `https://ott-backend-5iwy.onrender.com/watch/${saved._id}`;

    console.log("🔗 GENERATED LINK:", link);

    await axios.post(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      {
        chat_id: msg.chat.id,
        text: `🎬 ${movieName}\n👉 Watch: ${link}`
      }
    );

    res.sendStatus(200);

  } catch (err) {
    console.log("❌ WEBHOOK ERROR:", err.message);
    res.sendStatus(200);
  }
});

// =======================
// STREAM ROUTE
// =======================
app.get("/watch/:id", async (req, res) => {
  try {
    const movie = await Movie.findById(req.params.id);

    if (!movie) return res.status(404).send("Not found");

    const tg = await axios.get(
      `https://api.telegram.org/bot${BOT_TOKEN}/getFile`,
      {
        params: { file_id: movie.file_id }
      }
    );

    const filePath = tg.data.result.file_path;

    const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;

    const response = await axios({
      url: fileUrl,
      responseType: "stream"
    });

    res.setHeader("Content-Type", "video/mp4");
    response.data.pipe(res);

  } catch (err) {
    console.log("Stream error:", err.message);
    res.status(500).send("Stream error");
  }
});

// =======================
// HOME
// =======================
app.get("/", (req, res) => {
  res.send("OTT Backend Running");
});

// =======================
// START SERVER
// =======================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});