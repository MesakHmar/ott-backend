const express = require("express");
const axios = require("axios");

const app = express();

app.get("/", (req, res) => {
  res.send("OTT Backend Running");
});

app.listen(process.env.PORT || 3000);