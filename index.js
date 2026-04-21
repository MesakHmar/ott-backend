const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

const BOT_TOKEN = process.env.BOT_TOKEN;

// in-memory storage
let db = {};

// Telegram webhook
app.post("/telegram", async (req, res) => {
  const msg = req.body.message;

  if (msg && msg.video) {
    const file_id = msg.video.file_id;

    const id = Date.now().toString();
    db[id] = file_id;

    const link = `https://YOUR-RENDER-URL/watch/${id}`;

    try {
      await axios.get(
        `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
        {
          params: {
            chat_id: msg.chat.id,
            text: `🎬 Movie Ready!\n👉 ${link}`
          }
        }
      );
    } catch (e) {
      console.log("Telegram send error");
    }
  }

  res.sendStatus(200);
});

// watch route
app.get("/watch/:id", async (req, res) => {
  const file_id = db[req.params.id];
  if (!file_id) return res.send("Not found");

  const tg = await axios.get(
    `https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${file_id}`
  );

  const url = `https://api.telegram.org/file/bot${BOT_TOKEN}/${tg.data.result.file_path}`;

  const response = await axios({ url, responseType: "stream" });

  response.data.pipe(res);
});

app.get("/", (req, res) => {
  res.send("OTT Backend Running");
});

app.listen(process.env.PORT || 3000);