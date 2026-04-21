const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

// 🔐 Secure token from environment (Render)
const BOT_TOKEN = process.env.BOT_TOKEN;

// In-memory database (resets on restart)
let db = {};

// =======================
// HEALTH CHECK
// =======================
app.get("/", (req, res) => {
  res.send("OTT Backend Running");
});

// =======================
// TELEGRAM WEBHOOK
// =======================
app.post("/telegram", async (req, res) => {
  try {
    const msg = req.body.message || req.body.edited_message;

    if (!msg) return res.sendStatus(200);

    // Support video + document (VERY IMPORTANT)
    const media = msg.video || msg.document;

    if (!media) return res.sendStatus(200);

    const file_id = media.file_id;

    const id = Date.now().toString();
    db[id] = file_id;

    const movieName =
      msg.caption ||
      media.file_name ||
      "Untitled Movie";

    const link = `https://ott-backend-5iwy.onrender.com/watch/${id}`;

    await axios.get(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      {
        params: {
          chat_id: msg.chat.id,
          text: `🎬 ${movieName}\n👉 Watch: ${link}`
        }
      }
    );

    res.sendStatus(200);
  } catch (err) {
    console.log("Webhook error:", err.message);
    res.sendStatus(200);
  }
});

// =======================
// STREAM VIDEO ROUTE
// =======================
app.get("/watch/:id", async (req, res) => {
  try {
    const file_id = db[req.params.id];

    if (!file_id) {
      return res.status(404).send("Video not found");
    }

    const tg = await axios.get(
      `https://api.telegram.org/bot${BOT_TOKEN}/getFile`,
      {
        params: { file_id }
      }
    );

    const filePath = tg.data.result.file_path;

    const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;

    const response = await axios({
      url: fileUrl,
      method: "GET",
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
// START SERVER
// =======================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});