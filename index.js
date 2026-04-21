const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

// 🔐 Secure token from Render environment
const BOT_TOKEN = process.env.BOT_TOKEN;

// in-memory storage (resets on restart)
let db = {};

// =======================
// TELEGRAM WEBHOOK
// =======================
app.post("/telegram", async (req, res) => {
  try {
    const msg = req.body.message;

    if (!msg) return res.sendStatus(200);

    if (msg.video) {
      const file_id = msg.video.file_id;

      const id = Date.now().toString();
      db[id] = file_id;

      // movie name (caption OR file name)
      const movieName =
        msg.caption ||
        msg.video.file_name ||
        "Untitled Movie";

      const link = `https://ott-backend-5iwy.onrender.com/watch/${id}`;

      // send reply to Telegram
      await axios.get(
        `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
        {
          params: {
            chat_id: msg.chat.id,
            text: `🎬 ${movieName}\n👉 Watch: ${link}`
          }
        }
      );
    }

    res.sendStatus(200);
  } catch (err) {
    console.log("Webhook error:", err.message);
    res.sendStatus(200);
  }
});

// =======================
// STREAM ROUTE
// =======================
app.get("/watch/:id", async (req, res) => {
  try {
    const file_id = db[req.params.id];
    if (!file_id) return res.send("Not found");

    // get file path from Telegram
    const tg = await axios.get(
      `https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${file_id}`
    );

    const url = `https://api.telegram.org/file/bot${BOT_TOKEN}/${tg.data.result.file_path}`;

    const response = await axios({
      url,
      responseType: "stream"
    });

    response.data.pipe(res);
  } catch (err) {
    console.log("Stream error:", err.message);
    res.send("Stream error");
  }
});

// =======================
// HOME ROUTE
// =======================
app.get("/", (req, res) => {
  res.send("OTT Backend Running");
});

// =======================
// START SERVER
// =======================
app.listen(process.env.PORT || 3000, () => {
  console.log("Server running");
});