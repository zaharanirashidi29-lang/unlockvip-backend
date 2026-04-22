require("dotenv").config();
const axios = require("axios");
const crypto = require("crypto");

const APP_ID = "CHUO_ASILI";
const SECRET_KEY = "UrESzERfxSxNOcGmtigm5ovnztw49F7bJMuBFJJ/NeA=";

const payloadObj = {
  action: "collection",
  amount: 3000,
  msisdn: "255757230102",
  reference: "TEST" + Date.now(),
  channel: "MPESA",
  callback_url: "https://unlockvip-backend-1.onrender.com/webhook"
};

const bodyString = JSON.stringify(payloadObj);
const timestamp = Math.floor(Date.now() / 1000);
const signature = crypto.createHmac("sha256", SECRET_KEY).update(bodyString + timestamp).digest("base64");

console.log("Payload:", bodyString);
console.log("Timestamp:", timestamp);
console.log("Signature:", signature);

axios.post("https://portal.paymeafrica.com/api/v1/transact", payloadObj, {
  headers: {
    "Content-Type": "application/json",
    "X-App-ID": APP_ID,
    "X-Timestamp": timestamp,
    "X-Signature": signature
  }
})
.then(r => console.log("SUCCESS:", JSON.stringify(r.data, null, 2)))
.catch(e => {
  console.error("ERROR STATUS:", e.response?.status);
  console.error("ERROR DATA:", JSON.stringify(e.response?.data, null, 2));
  console.error("MESSAGE:", e.message);
});
