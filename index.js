app.post("/telegram", async (req, res) => {
  try {
    const update = req.body;

    const msg =
      update.message ||
      update.edited_message ||
      update.channel_post;

    if (!msg) return res.sendStatus(200);

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
    console.log("WEBHOOK ERROR:", err.message);
    res.sendStatus(200);
  }
});