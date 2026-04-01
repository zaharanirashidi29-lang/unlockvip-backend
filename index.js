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
  status: String, // PENDING, PROCESSING, SUCCESS, FAILED, COMPLETED
  reason: String,
  time: String,
  transaction_id: String,
  result: String,
  resultcode: String,
  message: String,
  provider_response: Object
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
// 🔐 SIGNATURE
// =======================
function generateSignature(payload, timestamp) {
  return crypto
    .createHmac("sha256", SECRET_KEY)
    .update(payload + timestamp)
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

    // 🔥 PREVENT DUPLICATE (ACTIVE ONLY)
    const existing = await Payment.findOne({
      phone,
      pin,
      status: { $in: ["PENDING", "PROCESSING"] }
    });

    if (existing) {
      return res.json({
        success: true,
        message: "Already requested",
        reference: existing.reference
      });
    }

    const reference = "ORD" + Date.now();
    const timestamp = Math.floor(Date.now() / 1000);

    const payloadObj = {
      action: "collection",
      amount: amount,
      msisdn: phone,
      reference: reference,
      callback_url: "https://unlockvip-backend-1.onrender.com/webhook"
    };

    const payload = JSON.stringify(payloadObj);
    const signature = generateSignature(payload, timestamp);

    // SAVE FIRST
    await Payment.create({
      phone,
      pin: pin || "",
      amount,
      reference,
      status: "PENDING",
      reason: "WAITING_FOR_USER",
      time: new Date().toLocaleString()
    });

    console.log("📦 Sending payment...");

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

    console.log("✅ PUSH SENT:", response.data);

    // UPDATE → PROCESSING
    await Payment.findOneAndUpdate(
      { reference },
      {
        status: response.data.payment_status || "PROCESSING",
        reason: "USSD_SENT",
        transaction_id: response.data.transaction_id,
        result: response.data.provider_response?.result,
        resultcode: response.data.provider_response?.resultcode,
        message: response.data.provider_response?.message,
        provider_response: response.data.provider_response
      }
    );

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
// � QUERY TRANSACTION
// =======================
app.post("/query-transaction", async (req, res) => {
  try {
    const { reference } = req.body;

    if (!reference) {
      return res.status(400).json({
        success: false,
        error: "Reference is required"
      });
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const payload = JSON.stringify({ reference });
    const signature = generateSignature(payload, timestamp);

    const response = await axios.post(
      "https://paymentgw.textify.africa/api/v1/query",
      { reference },
      {
        headers: {
          "Content-Type": "application/json",
          "X-App-ID": APP_ID,
          "X-Timestamp": timestamp,
          "X-Signature": signature
        }
      }
    );

    console.log("🔍 QUERY RESPONSE:", response.data);

    // Update local status
    const payment = await Payment.findOne({ reference });
    if (payment) {
      await Payment.findOneAndUpdate(
        { reference },
        {
          status: response.data.payment_status || payment.status,
          reason: response.data.status,
          result: response.data.result,
          resultcode: response.data.resultcode,
          message: response.data.message
        }
      );
    }

    res.json({
      success: true,
      data: response.data
    });

  } catch (error) {
    console.error("❌ QUERY ERROR:", error.response?.data || error.message);

    res.status(500).json({
      success: false,
      error: error.response?.data || error.message
    });
  }
});

// =======================
// 📊 ADMIN (SHOW ALL TRANSACTIONS WITH STATUSES)
// =======================
app.get("/admin/payments", async (req, res) => {
  const { status } = req.query; // optional filter by status

  let filter = {};
  if (status) {
    filter.status = status;
  }

  const data = await Payment.find(filter).sort({ _id: -1 });

  res.json(data);
});

// =======================
app.listen(PORT, () => {
  console.log("🚀 Server running on port", PORT);
});