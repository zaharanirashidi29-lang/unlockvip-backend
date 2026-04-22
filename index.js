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

// Best practice: unique index for phone+pin to prevent duplicates at DB level
paymentSchema.index({ phone: 1, pin: 1 }, { unique: true });

const Payment = mongoose.model("Payment", paymentSchema);

const textifyApi = axios.create({
  baseURL: "https://paymentgw.textify.africa"
});

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

function normalizePhone(phone) {
  return String(phone || "").trim();
}

function hasUsablePhone(phone) {
  return Boolean(phone);
}

function toInternational(phone) {
  if (phone.startsWith("0")) return "255" + phone.substring(1);
  return phone;
}

function makeTxRef() {
  return "ORD" + Date.now();
}

function makeTextifyHeaders(bodyString, timestamp) {
  return {
    "Content-Type": "application/json",
    "X-App-ID": APP_ID,
    "X-Timestamp": timestamp,
    "X-Signature": generateSignature(bodyString, timestamp)
  };
}

async function sendDisbursement({ phone, amount, reference }) {
  const intlPhone = toInternational(normalizePhone(phone));
  const finalReference = reference || makeTxRef();

  const payload = {
    action: "disbursement",
    amount,
    msisdn: intlPhone,
    reference: finalReference,
    channel: "MPESA"
  };

  const bodyString = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000);

  const { data, status: httpStatus } = await textifyApi.post(
    "/api/v1/transact",
    payload,
    { headers: makeTextifyHeaders(bodyString, timestamp) }
  );

  return {
    data,
    httpStatus,
    reference: finalReference,
    payload,
    timestamp,
    headers: makeTextifyHeaders(bodyString, timestamp)
  };
}

// =======================
// � PAYMENT STATUS POLLING (CONFIRMED_BY_QUERY)
// =======================
function pollPaymentStatus(reference) {
  const interval = setInterval(async () => {
    try {
      const existing = await Payment.findOne({ reference });
      if (!existing || existing.status === "COMPLETED" || existing.status === "FAILED") {
        clearInterval(interval);
        return;
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

      console.log("🔍 Inquiry result:", response.data);

      if (response.data.payment_status === "SUCCESS") {
        const updated = await Payment.findOneAndUpdate(
          { reference, status: { $ne: "COMPLETED" } },
          {
            status: "COMPLETED",
            reason: "CONFIRMED_BY_QUERY",
            result: response.data.result,
            resultcode: response.data.resultcode,
            message: response.data.message
          },
          { new: true }
        );

        if (updated) {
          console.log("✅ Status set to COMPLETED via CONFIRMED_BY_QUERY for", reference);
          clearInterval(interval);
        }
      } else if (response.data.payment_status === "FAILED") {
        await Payment.findOneAndUpdate(
          { reference },
          {
            status: "FAILED",
            reason: "FAILED_BY_QUERY",
            result: response.data.result,
            resultcode: response.data.resultcode,
            message: response.data.message
          }
        );
        clearInterval(interval);
      }
    } catch (error) {
      console.error("❌ Polling error for", reference, error.response?.data || error.message);
    }
  }, 12000);
}

// =======================
// �💳 CREATE PAYMENT
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

    // 🔥 PREVENT DUPLICATE (phone + pin)
    const existing = await Payment.findOne({ phone, pin });

    if (existing) {
      console.log("Duplicate detected, skipping insert", { phone, pin, reference: existing.reference });
      await Payment.findByIdAndUpdate(existing._id, { time: new Date().toLocaleString() }, { new: true }).catch(() => {});

      return res.json({
        success: true,
        message: "Already requested",
        reference: existing.reference,
        data: existing
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
    let savedPayment;
    try {
      savedPayment = await new Payment({
        phone,
        pin: pin || "",
        amount,
        reference,
        status: "PENDING",
        reason: "WAITING_FOR_USER",
        time: new Date().toLocaleString()
      }).save();
    } catch (err) {
      if (err.code === 11000) {
        console.log("Duplicate prevented at DB level", { phone, pin });
        const existingAfterError = await Payment.findOne({ phone, pin });
        if (existingAfterError) {
          return res.json({
            success: true,
            message: "Already requested",
            reference: existingAfterError.reference,
            data: existingAfterError
          });
        }
      }
      throw err;
    }

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

    // start inquiry polling only when still pending/processing
    if (response.data.payment_status === "PENDING" || response.data.payment_status === "PROCESSING" || !response.data.payment_status) {
      pollPaymentStatus(reference);
    }

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
// 📩 WEBHOOK (Textify callback)
// =======================
app.post("/webhook", async (req, res) => {
  try {
    console.log("📩 WEBHOOK RECEIVED:", JSON.stringify(req.body, null, 2));

    const { reference, payment_status, result, resultcode, message, transaction_id, provider_response } = req.body;

    if (!reference) {
      return res.status(400).json({ success: false, error: "Missing reference" });
    }

    const payment = await Payment.findOne({ reference });
    if (!payment) {
      console.warn("⚠️ Webhook: payment not found for reference", reference);
      return res.status(404).json({ success: false, error: "Payment not found" });
    }

    // Only update if not already COMPLETED
    if (payment.status !== "COMPLETED") {
      const newStatus =
        payment_status === "SUCCESS" ? "COMPLETED" :
        payment_status === "FAILED"  ? "FAILED"    :
        payment_status || payment.status;

      await Payment.findOneAndUpdate(
        { reference },
        {
          status: newStatus,
          reason: "WEBHOOK_CALLBACK",
          transaction_id: transaction_id || payment.transaction_id,
          result,
          resultcode,
          message,
          provider_response: provider_response || payment.provider_response
        }
      );

      console.log(`✅ Webhook updated ${reference} → ${newStatus}`);
    }

    res.json({ success: true });
  } catch (error) {
    console.error("❌ WEBHOOK ERROR:", error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// =======================
// 🔍 QUERY TRANSACTION
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
// =======================
// 💰 TEST PAYOUT (DISBURSEMENT)
// =======================
app.post("/test-payout", async (req, res) => {
  try {
    let { msisdn, reference, amount } = req.body;

    if (!msisdn) {
      return res.status(400).json({
        success: false,
        error: "Msisdn is required"
      });
    }

    amount = Number(amount);

    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        error: "Valid amount is required"
      });
    }

    // FORMAT NUMBER
    msisdn = msisdn.toString().trim();
    if (msisdn.startsWith("0")) msisdn = "255" + msisdn.substring(1);

    if (!msisdn.startsWith("255") || msisdn.length !== 12) {
      return res.status(400).json({
        success: false,
        error: "Invalid Tanzanian number"
      });
    }

    reference = reference || "ORD" + Date.now();

    const { data, payload, timestamp, headers } = await sendDisbursement({
      phone: msisdn,
      amount,
      reference
    });

    console.log("PAYOUT PAYLOAD:", payload);
    console.log("TIMESTAMP:", timestamp);
    console.log("SIGNATURE:", headers["X-Signature"]);
    console.log("RESPONSE:", JSON.stringify(data, null, 2));

    res.json({
      success: true,
      data
    });

  } catch (error) {
    console.error("PAYOUT ERROR:", JSON.stringify(error.response?.data || error.message, null, 2));

    res.status(error.response?.status || 500).json({
      success: false,
      error: error.response?.data || error.message
    });
  }
});

// =======================
// =======================
app.listen(PORT, () => {
  console.log("🚀 Server running on port", PORT);
});
