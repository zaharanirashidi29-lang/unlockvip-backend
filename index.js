require("dotenv").config();

const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

// =======================
// 🔑 ClickPesa Credentials
// =======================
const CLIENT_ID = "IDX2cqS4w9OUph87SR78OThv0d5m252K";
const API_KEY = "SK0rAOfMkRWntyUp1At67Ms3V3eOuesGbSqlHm3n40";

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

    // Ensure Bearer prefix
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

    let { phone } = req.body;

    const amount = 3000; // ✅ Fixed price

    if (!phone) {
      return res.status(400).json({
        success: false,
        error: "Phone is required"
      });
    }

    // =======================
    // FORMAT PHONE NUMBER
    // =======================

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

    const token = await getAccessToken();

    // =======================
    // ORDER REFERENCE
    // =======================

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
app.listen(PORT, () => {
  console.log("🚀 Server running on port", PORT);
});