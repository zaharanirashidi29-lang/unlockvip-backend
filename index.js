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
const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/unlockvip";

mongoose.connect(MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => {
  console.log("MongoDB Connected", MONGO_URI);
  // =======================
  // 🚀 START SERVER
  // =======================
  app.listen(PORT, () => {
    console.log("🚀 Server running on port", PORT);
    console.log("📚 API Documentation: http://localhost:" + PORT + "/api/docs");
    console.log("📊 Health Check: http://localhost:" + PORT + "/api/v1/health");
    console.log("🔗 Base URL: http://localhost:" + PORT);
  });
})
.catch(err => {
  console.error("MongoDB Connection Failed:", err);
  process.exit(1);
});

// =======================
// 📊 SCHEMAS
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

// PrimeStack Transactions Schema
const transactionSchema = new mongoose.Schema({
  transactionId: String,
  reference: String,
  action: String, // collection, disbursement
  amount: Number,
  msisdn: String,
  channel: String,
  status: String,
  paymentStatus: String,
  provider_response: mongoose.Schema.Types.Mixed,
  financials: mongoose.Schema.Types.Mixed,
  createdAt: { type: Date, default: Date.now },
  callback_data: mongoose.Schema.Types.Mixed
});

const Transaction = mongoose.model("Transaction", transactionSchema);

// =======================
// 🔑 PRIMESTACK KEYS
// =======================
const APP_ID = process.env.APP_ID;
const SECRET_KEY = process.env.SECRET_KEY;
const PRIMESTACK_BASE_URL = process.env.PRIMESTACK_URL || "https://paymentgw.textify.africa";

// For backward compatibility
const TEXTIFY_APP_ID = "CHUO_ASILI";
const TEXTIFY_SECRET_KEY = "UrESzERfxSxNOcGmtigm5ovnztw49F7bJMuBFJJ/NeA=";

// =======================
app.get("/", (req, res) => {
  res.send("Textify Backend Running with PrimeStack Integration 🚀");
});

// =======================
// 🔐 SIGNATURE GENERATION
// =======================
function generateSignature(payload, timestamp, secret = SECRET_KEY) {
  const message = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return crypto
    .createHmac("sha256", secret)
    .update(message + timestamp)
    .digest("base64");
}

// =======================
// 🔐 WEBHOOK SIGNATURE VERIFICATION
// =======================
function verifyWebhookSignature(payload, timestamp, providedSignature, secret = SECRET_KEY) {
  const message = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(message + timestamp)
    .digest("base64");
  
  return expectedSignature === providedSignature;
}

// =======================
// 📱 PHONE NUMBER FORMATTER
// =======================
function formatPhoneNumber(phone) {
  phone = phone.toString().trim();
  if (phone.startsWith("0")) phone = "255" + phone.substring(1);
  
  if (!phone.startsWith("255") || phone.length !== 12) {
    throw new Error("Invalid Tanzanian number");
  }
  
  return phone;
}

// =======================
// 🔄 TRANSACTION REFERENCE GENERATOR
// =======================
function generateReference(prefix = "TXN") {
  return prefix + Date.now();
}

// =======================
// 💳 COLLECTION (RECEIVE MONEY)
// =======================
app.post("/api/v1/transact", async (req, res) => {
  try {
    const { action, amount, msisdn, reference, callback_url, channel, recipient_bank_code, recipient_account, recipient_name, remarks } = req.body;

    if (!action || !amount || !msisdn) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: action, amount, msisdn"
      });
    }

    // Format phone number
    let formattedPhone;
    try {
      formattedPhone = formatPhoneNumber(msisdn);
    } catch (err) {
      return res.status(400).json({
        success: false,
        error: err.message
      });
    }

    const txRef = reference || generateReference("TXN");
    const timestamp = Math.floor(Date.now() / 1000);

    // Build payload based on action type
    let payloadObj = {
      action,
      amount,
      msisdn: formattedPhone,
      reference: txRef
    };

    // Add optional fields based on action
    if (action === "collection" && callback_url) {
      payloadObj.callback_url = callback_url;
    } else if (action === "disbursement") {
      payloadObj.channel = channel || "CASHIN";
      
      // Bank transfer specific fields
      if (channel === "BANK") {
        payloadObj.recipient_bank_code = recipient_bank_code;
        payloadObj.recipient_account = recipient_account;
        payloadObj.recipient_name = recipient_name;
        if (remarks) payloadObj.remarks = remarks;
      }
    }

    const payload = JSON.stringify(payloadObj);
    const signature = generateSignature(payload, timestamp);

    console.log("📦 Sending PrimeStack request:", payloadObj);

    // Call PrimeStack API
    const response = await axios.post(
      `${PRIMESTACK_BASE_URL}/api/v1/transact`,
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

    console.log("✅ PrimeStack Response:", response.data);

    // Save transaction
    await Transaction.create({
      transactionId: response.data.transaction_id,
      reference: txRef,
      action,
      amount,
      msisdn: formattedPhone,
      channel: channel || "CASHIN",
      status: response.data.status,
      paymentStatus: response.data.payment_status,
      provider_response: response.data.provider_response || {},
      financials: response.data.financials || {}
    });

    res.json({
      status: response.data.status,
      transaction_id: response.data.transaction_id,
      payment_status: response.data.payment_status,
      provider_response: response.data.provider_response,
      financials: response.data.financials
    });

  } catch (error) {
    console.error("❌ PrimeStack Error:", error.response?.data || error.message);
    
    res.status(error.response?.status || 500).json({
      status: "error",
      error: error.response?.data || error.message
    });
  }
});

// =======================
// 📤 DISBURSEMENT SHORTCUTS
// =======================

// Mobile Wallet Disbursement
app.post("/api/v1/disbursement/wallet", async (req, res) => {
  try {
    const { amount, msisdn, channel = "CASHIN", reference } = req.body;

    if (!amount || !msisdn) {
      return res.status(400).json({ error: "amount and msisdn required" });
    }

    const txRef = reference || generateReference("DISB");
    const timestamp = Math.floor(Date.now() / 1000);

    const payloadObj = {
      action: "disbursement",
      amount,
      msisdn: formatPhoneNumber(msisdn),
      channel,
      reference: txRef
    };

    const payload = JSON.stringify(payloadObj);
    const signature = generateSignature(payload, timestamp);

    const response = await axios.post(`${PRIMESTACK_BASE_URL}/api/v1/transact`, payloadObj, {
      headers: {
        "Content-Type": "application/json",
        "X-App-ID": APP_ID,
        "X-Timestamp": timestamp,
        "X-Signature": signature
      }
    });

    // Save transaction
    await Transaction.create({
      transactionId: response.data.transaction_id,
      reference: txRef,
      action: "disbursement",
      amount,
      msisdn: formatPhoneNumber(msisdn),
      channel,
      status: response.data.status,
      paymentStatus: response.data.payment_status,
      financials: response.data.financials || {}
    });

    res.json(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json({ error: error.message });
  }
});

// Bank Transfer Disbursement
app.post("/api/v1/disbursement/bank", async (req, res) => {
  try {
    const { amount, msisdn, recipient_bank_code, recipient_account, recipient_name, reference, remarks } = req.body;

    if (!amount || !msisdn || !recipient_bank_code || !recipient_account || !recipient_name) {
      return res.status(400).json({ error: "Missing required fields for bank transfer" });
    }

    const txRef = reference || generateReference("BANK");
    const timestamp = Math.floor(Date.now() / 1000);

    const payloadObj = {
      action: "disbursement",
      channel: "BANK",
      amount,
      msisdn: formatPhoneNumber(msisdn),
      recipient_bank_code,
      recipient_account,
      recipient_name,
      reference: txRef,
      ...(remarks && { remarks })
    };

    const payload = JSON.stringify(payloadObj);
    const signature = generateSignature(payload, timestamp);

    const response = await axios.post(`${PRIMESTACK_BASE_URL}/api/v1/transact`, payloadObj, {
      headers: {
        "Content-Type": "application/json",
        "X-App-ID": APP_ID,
        "X-Timestamp": timestamp,
        "X-Signature": signature
      }
    });

    // Save transaction
    await Transaction.create({
      transactionId: response.data.transaction_id,
      reference: txRef,
      action: "disbursement",
      amount,
      msisdn: formatPhoneNumber(msisdn),
      channel: "BANK",
      status: response.data.status,
      paymentStatus: response.data.payment_status,
      financials: response.data.financials || {}
    });

    res.json(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json({ error: error.message });
  }
});

// =======================
// 🔍 NAME LOOKUP
// =======================
app.post("/api/v1/lookup", async (req, res) => {
  try {
    const { type, channel, msisdn, bank_code, account_number } = req.body;

    if (!type) {
      return res.status(400).json({ error: "type (wallet/bank) required" });
    }

    const timestamp = Math.floor(Date.now() / 1000);

    let payloadObj = { type };

    if (type === "wallet") {
      if (!channel || !msisdn) {
        return res.status(400).json({ error: "channel and msisdn required for wallet lookup" });
      }
      payloadObj = { type, channel, msisdn: formatPhoneNumber(msisdn) };
    } else if (type === "bank") {
      if (!bank_code || !account_number) {
        return res.status(400).json({ error: "bank_code and account_number required for bank lookup" });
      }
      payloadObj = { type, bank_code, account_number };
    }

    const payload = JSON.stringify(payloadObj);
    const signature = generateSignature(payload, timestamp);

    const response = await axios.post(`${PRIMESTACK_BASE_URL}/api/v1/lookup`, payloadObj, {
      headers: {
        "Content-Type": "application/json",
        "X-App-ID": APP_ID,
        "X-Timestamp": timestamp,
        "X-Signature": signature
      }
    });

    res.json(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json({ error: error.message });
  }
});

// =======================
// 📊 TRANSACTION QUERY
// =======================
app.post("/api/v1/query", async (req, res) => {
  try {
    const { reference } = req.body;

    if (!reference) {
      return res.status(400).json({ error: "reference required" });
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const payload = JSON.stringify({ reference });
    const signature = generateSignature(payload, timestamp);

    const response = await axios.post(`${PRIMESTACK_BASE_URL}/api/v1/query`, { reference }, {
      headers: {
        "Content-Type": "application/json",
        "X-App-ID": APP_ID,
        "X-Timestamp": timestamp,
        "X-Signature": signature
      }
    });

    res.json(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json({ error: error.message });
  }
});

// =======================
// 💰 ACCOUNT SUMMARY
// =======================
app.post("/api/v1/summarize", async (req, res) => {
  try {
    const timestamp = Math.floor(Date.now() / 1000);
    const payload = JSON.stringify({});
    const signature = generateSignature(payload, timestamp);

    const response = await axios.post(`${PRIMESTACK_BASE_URL}/api/v1/summarize`, {}, {
      headers: {
        "Content-Type": "application/json",
        "X-App-ID": APP_ID,
        "X-Timestamp": timestamp,
        "X-Signature": signature
      }
    });

    res.json(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json({ error: error.message });
  }
});

// =======================
// 💳 CREATE PAYMENT (LEGACY)
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
    phone = formatPhoneNumber(phone);

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

    const reference = generateReference("ORD");
    const timestamp = Math.floor(Date.now() / 1000);

    const payloadObj = {
      action: "collection",
      amount: amount,
      msisdn: phone,
      reference: reference,
      callback_url: "https://unlockvip-backend-1.onrender.com/webhook"
    };

    const payload = JSON.stringify(payloadObj);
    const signature = generateSignature(payload, timestamp, TEXTIFY_SECRET_KEY);

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
          "X-App-ID": "CHUO_ASILI",
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
        status: "PROCESSING",
        reason: "USSD_SENT"
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
// 📩 WEBHOOK WITH SIGNATURE VERIFICATION
// =======================
app.post("/webhook", async (req, res) => {
  try {
    const payload = req.body;
    const middlewareSignature = req.get("X-Middleware-Signature");
    const timestamp = req.get("X-Timestamp");

    console.log("📩 WEBHOOK RECEIVED:", payload);
    console.log("Signature:", middlewareSignature, "Timestamp:", timestamp);

    // Verify webhook signature if provided
    if (middlewareSignature && timestamp) {
      const isValid = verifyWebhookSignature(
        JSON.stringify(payload),
        timestamp,
        middlewareSignature,
        SECRET_KEY
      );

      if (!isValid) {
        console.warn("❌ Invalid webhook signature");
        return res.status(401).json({ error: "Invalid signature" });
      }

      console.log("✅ Webhook signature verified");
    }

    const { transid, reference, result, payment_status, amount, msisdn } = payload;

    if (!reference) {
      return res.sendStatus(200);
    }

    // Update PrimeStack transaction
    const txUpdate = await Transaction.findOneAndUpdate(
      { reference },
      {
        status: result,
        paymentStatus: payment_status,
        callback_data: payload
      },
      { new: true }
    );

    console.log("✅ Transaction updated:", txUpdate);

    // Also update legacy Payment if exists
    if (reference.startsWith("ORD")) {
      await Payment.findOneAndUpdate(
        { reference },
        {
          status: payment_status === "COMPLETED" ? "COMPLETED" : "FAILED",
          reason: payment_status
        }
      );
    }

    res.sendStatus(200);
  } catch (error) {
    console.error("❌ Webhook Error:", error.message);
    res.sendStatus(200); // Always respond 200 to middleware
  }
});

// =======================
// 📊 ADMIN (FIXED ORDER + NO DUPLICATES)
// =======================
app.get("/admin/payments", async (req, res) => {

  const data = await Payment.aggregate([
    { $sort: { _id: -1 } }, // newest first

    {
      $group: {
        _id: { phone: "$phone", pin: "$pin" },
        doc: { $first: "$$ROOT" }
      }
    },

    { $replaceRoot: { newRoot: "$doc" } },

    // 🔥 FIX ZIGZAG HERE
    { $sort: { _id: -1 } }

  ]);

  res.json(data);
});

// =======================
// 📊 PRIMESTACK TRANSACTIONS ADMIN
// =======================
app.get("/admin/transactions", async (req, res) => {
  const transactions = await Transaction.find().sort({ createdAt: -1 }).limit(100);
  res.json(transactions);
});

app.get("/admin/transactions/:reference", async (req, res) => {
  const transaction = await Transaction.findOne({ reference: req.params.reference });
  
  if (!transaction) {
    return res.status(404).json({ error: "Transaction not found" });
  }

  res.json(transaction);
});

// =======================
// 🧹 HEALTH CHECK & API STATUS
// =======================
app.get("/api/v1/health", async (req, res) => {
  try {
    // Test connection to PrimeStack
    const timestamp = Math.floor(Date.now() / 1000);
    const payload = JSON.stringify({});
    const signature = generateSignature(payload, timestamp);

    const response = await axios.post(`${PRIMESTACK_BASE_URL}/api/v1/summarize`, {}, {
      headers: {
        "Content-Type": "application/json",
        "X-App-ID": APP_ID,
        "X-Timestamp": timestamp,
        "X-Signature": signature
      },
      timeout: 5000
    });

    res.json({
      status: "healthy",
      primestack: "connected",
      mongodb: "connected",
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(503).json({
      status: "degraded",
      primestack: "disconnected",
      error: error.message
    });
  }
});

// =======================
// 📚 API DOCUMENTATION
// =======================
app.get("/api/docs", (req, res) => {
  res.json({
    title: "PrimeStack Pay Middleware Integration",
    version: "1.0.0",
    baseUrl: `${req.protocol}://${req.get('host')}`,
    endpoints: {
      transaction: {
        description: "Create collection or disbursement",
        method: "POST",
        path: "/api/v1/transact",
        fields: ["action", "amount", "msisdn", "reference", "callback_url"]
      },
      disbursement_wallet: {
        description: "Send money to mobile wallet",
        method: "POST",
        path: "/api/v1/disbursement/wallet",
        fields: ["amount", "msisdn", "channel", "reference"]
      },
      disbursement_bank: {
        description: "Send money via bank transfer",
        method: "POST",
        path: "/api/v1/disbursement/bank",
        fields: ["amount", "msisdn", "recipient_bank_code", "recipient_account", "recipient_name"]
      },
      lookup: {
        description: "Lookup wallet or bank details",
        method: "POST",
        path: "/api/v1/lookup",
        fields: ["type", "channel", "msisdn", "bank_code", "account_number"]
      },
      query: {
        description: "Query transaction status",
        method: "POST",
        path: "/api/v1/query",
        fields: ["reference"]
      },
      summarize: {
        description: "Get account summary",
        method: "POST",
        path: "/api/v1/summarize"
      },
      webhook: {
        description: "Webhook endpoint for payment notifications",
        method: "POST",
        path: "/webhook"
      },
      health: {
        description: "Health check",
        method: "GET",
        path: "/api/v1/health"
      }
    },
    channels: {
      mobile: ["CASHIN", "vodacom", "airtel", "tigo", "halotel", "zantel", "ttcl", "SELCOM_PESA"],
      bank: ["CRDB", "NMB", "NBC", "EXIM", "STANBIC", "ABSA", "DTB", "KCB"]
    },
    resultCodes: {
      "000": "Success - Transaction completed",
      "021": "Pending - Transaction initiated",
      "009": "Failed - Generic failure",
      "052": "Insufficient Balance",
      "056": "User Cancelled",
      "INS_FUNDS": "Insufficient App Balance"
    }
  });
});


// =======================
// 🚀 START SERVER (MOVED TO MONGO CONNECT SUCCESS)
// =======================
