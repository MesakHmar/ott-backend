const express = require("express");
const axios = require("axios");
const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());

// =======================
// ENV
// =======================
const BOT_TOKEN = process.env.BOT_TOKEN;
const MONGO_URL = process.env.MONGO_URL;

// =======================
// DB
// =======================
mongoose.connect(MONGO_URL)
  .then(() => console.log("MongoDB Connected"))
  .catch(err => console.log(err));

const movieSchema = new mongoose.Schema({
  file_id: String,
  name: String
});

const Movie = mongoose.model("Movie", movieSchema);

// =======================
// TEMP FOLDER
// =======================
const TEMP_DIR = path.join(__dirname, "temp");
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR);
}

// =======================
// WEBHOOK
// =======================
app.post("/telegram", async (req, res) => {
  try {
    const msg =
      req.body.message ||
      req.body.channel_post;

    if (!msg) return res.sendStatus(200);

    const file_id =
      msg.video?.file_id ||
      msg.document?.file_id;

    if (!file_id) return res.sendStatus(200);

    const name =
      msg.caption ||
      msg.video?.file_name ||
      msg.document?.file_name ||
      "movie";

    const saved = await Movie.create({ file_id, name });

    const link = `https://ott-backend-5iwy.onrender.com/watch/${saved._id}`;

    await axios.post(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      {
        chat_id: msg.chat.id,
        text: `🎬 ${name}\n👉 Watch: ${link}`
      }
    );

    res.sendStatus(200);

  } catch (e) {
    console.log(e.message);
    res.sendStatus(200);
  }
});

// =======================
// BUFFERED STREAM ROUTE
// =======================
app.get("/watch/:id", async (req, res) => {
  try {
    const movie = await Movie.findById(req.params.id);
    if (!movie) return res.status(404).send("Not found");

    console.log("FILE ID:", movie.file_id);

    // STEP 1: get file path from Telegram
    const tg = await axios.get(
      `https://api.telegram.org/bot${BOT_TOKEN}/getFile`,
      { params: { file_id: movie.file_id } }
    );

    if (!tg.data.ok) {
      return res.status(500).send("Telegram error");
    }

    const filePath = tg.data.result.file_path;

    const fileUrl =
      `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;

    // STEP 2: download full file first (BUFFER)
    const fileName = `${movie._id}.mp4`;
    const filePathLocal = path.join(TEMP_DIR, fileName);

    const writer = fs.createWriteStream(filePathLocal);

    const response = await axios({
      url: fileUrl,
      method: "GET",
      responseType: "stream"
    });

    await new Promise((resolve, reject) => {
      response.data.pipe(writer);
      writer.on("finish", resolve);
      writer.on("error", reject);
    });

    console.log("Downloaded to temp:", fileName);

    // STEP 3: stream locally (FAST + STABLE)
    const stat = fs.statSync(filePathLocal);
    const fileSize = stat.size;

    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

      const chunkSize = end - start + 1;
      const file = fs.createReadStream(filePathLocal, { start, end });

      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Accept-Ranges": "bytes",
        "Content-Length": chunkSize,
        "Content-Type": "video/mp4"
      });

      file.pipe(res);
    } else {
      res.writeHead(200, {
        "Content-Length": fileSize,
        "Content-Type": "video/mp4"
      });

      fs.createReadStream(filePathLocal).pipe(res);
    }

  } catch (err) {
    console.log("STREAM ERROR:", err.message);
    res.status(500).send("Stream error");
  }
});

// =======================
app.get("/", (req, res) => {
  res.send("Buffered OTT Running");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Running on", PORT));