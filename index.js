const express = require("express");
const axios = require("axios");
const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { S3Client } = require("@aws-sdk/client-s3");
const { Upload } = require("@aws-sdk/lib-storage");

const app = express();
app.use(express.json());

// ================= ENV =================
const {
  BOT_TOKEN,
  CF_ACCOUNT_ID,
  R2_BUCKET,
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
  TG_API_ID,
  TG_API_HASH,
  TG_SESSION
} = process.env;

// ================= R2 PUBLIC URL =================
const R2_PUBLIC_URL =
  "https://pub-1032004a583a464caf18df15b07cda3c.r2.dev";

// ================= R2 CLIENT =================
const s3Client = new S3Client({
  region: "auto",
  endpoint: `https://${CF_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
});

// ================= TELEGRAM CLIENT =================
const client = new TelegramClient(
  new StringSession(TG_SESSION),
  parseInt(TG_API_ID),
  TG_API_HASH,
  { connectionRetries: 5 }
);

(async () => {
  await client.connect();
  console.log("✅ Telegram Connected");
})();

// ================= WEBHOOK =================
app.post("/telegram", async (req, res) => {
  res.sendStatus(200);

  try {
    console.log("\n🔥 NEW UPDATE RECEIVED");

    const msg =
      req.body.message ||
      req.body.channel_post ||
      req.body.edited_message;

    if (!msg) return;

    const file =
      msg.video ||
      msg.document ||
      msg.audio ||
      msg.animation ||
      msg.photo?.[msg.photo.length - 1];

    if (!file) return;

    const messages = await client.getMessages(msg.chat.id, {
      ids: msg.message_id
    });

    const msgObj = messages?.[0];
    if (!msgObj) return;

    const fileName = file.file_name || `file_${Date.now()}.mp4`;

    // ✅ FIX 1: SAFE FILE NAME
    const safeName = fileName.replace(/[^a-zA-Z0-9.\-_]/g, "_");
    const key = `${Date.now()}-${safeName}`;

    console.log("🎬 FILE:", fileName);

    // ✅ FIX 2: STREAM DOWNLOAD (IMPORTANT FIX)
    const fileStream = await client.downloadMedia(msgObj, {
      workers: 4,
      asStream: true
    });

    if (!fileStream) {
      console.log("❌ DOWNLOAD FAILED");
      return;
    }

    // ================= UPLOAD TO R2 =================
    const upload = new Upload({
      client: s3Client,
      params: {
        Bucket: R2_BUCKET,
        Key: key,
        Body: fileStream,
        ContentType: file.mime_type?.includes("video")
          ? file.mime_type
          : "video/mp4",
      },
      queueSize: 4,
      partSize: 10 * 1024 * 1024,
    });

    await upload.done();

    console.log("☁️ UPLOADED TO R2");

    const directLink = `${R2_PUBLIC_URL}/${key}`;

    // ================= SEND TO TELEGRAM =================
    await axios.post(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      {
        chat_id: msg.chat.id,
        text: `🎬 ${fileName}\n\n🚀 Direct Link:\n${directLink}`,
        reply_to_message_id: msg.message_id
      }
    );

    console.log("📤 LINK SENT");

  } catch (err) {
    console.log("❌ ERROR:", err.message);
  }
});

// ================= HOME =================
app.get("/", (req, res) => {
  res.send("🚀 Telegram → R2 OTT ACTIVE");
});

// ================= START =================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on", PORT));