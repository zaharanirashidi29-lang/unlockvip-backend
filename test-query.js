require("dotenv").config();
const axios = require("axios");
const crypto = require("crypto");

const APP_ID = "CHUO_ASILI";
const SECRET_KEY = "UrESzERfxSxNOcGmtigm5ovnztw49F7bJMuBFJJ/NeA=";
const reference = "TEST1776854002808";

const timestamp = Math.floor(Date.now() / 1000);
const payload = JSON.stringify({ reference });
const signature = crypto.createHmac("sha256", SECRET_KEY).update(payload + timestamp).digest("base64");

axios.post("https://portal.paymeafrica.com/api/v1/query", { reference }, {
  headers: {
    "Content-Type": "application/json",
    "X-App-ID": APP_ID,
    "X-Timestamp": timestamp,
    "X-Signature": signature
  }
})
.then(r => console.log("QUERY RESPONSE:", JSON.stringify(r.data, null, 2)))
.catch(e => {
  console.error("ERROR STATUS:", e.response?.status);
  console.error("ERROR DATA:", JSON.stringify(e.response?.data, null, 2));
});
