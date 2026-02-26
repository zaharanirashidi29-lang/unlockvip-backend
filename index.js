const express = require("express");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());

// 🔐 ClickPesa Credentials (from Render Environment Variables)
const CLIENT_ID = process.env.CLICKPESA_CLIENT_ID;
const API_KEY = process.env.CLICKPESA_API_KEY;

// ===============================
// 🚀 ROOT ROUTE
// ===============================
app.get("/", (req, res) => {
  res.send("UnlockVIP Backend is running 🚀");
});

// ===============================
// 🔑 GET ACCESS TOKEN (FIXED)
// ===============================
async function getAccessToken() {
  try {
    const response = await axios.post(
      "https://api.clickpesa.com/v1/oauth/token",
      new URLSearchParams({
        grant_type: "client_credentials"
      }),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "x-client-id": CLIENT_ID,
          "x-api-key": API_KEY
        }
      }
    );

    if (!response.data.access_token) {
      console.log("Token Response:", response.data);
      throw new Error("No access token received");
    }

    return response.data.access_token;

  } catch (error) {
    console.error(
      "Access Token Error:",
      error.response ? error.response.data : error.message
    );
    throw new Error("Failed to get access token");
  }
}

// ===============================
// 💳 CREATE PAYMENT
// ===============================
app.post("/create-payment", async (req, res) => {
  try {
    const { amount, phone } = req.body;

    if (!amount || !phone) {
      return res.status(400).json({
        error: "Amount and phone are required"
      });
    }

    // 1️⃣ Get access token
    const token = await getAccessToken();

    // 2️⃣ Create payment
    const paymentResponse = await axios.post(
      "https://api.clickpesa.com/third-parties/payment",
      {
        amount: amount,
        currency: "TZS",
        phone_number: phone,
        callback_url:
          "https://unlockvip-backend.onrender.com/payment-callback"
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        }
      }
    );

    return res.json(paymentResponse.data);

  } catch (error) {
    console.error(
      "Payment Error:",
      error.response ? error.response.data : error.message
    );

    return res.status(500).json({
      error: "Payment request failed",
      details: error.response ? error.response.data : error.message
    });
  }
});

// ===============================
// 🔔 PAYMENT CALLBACK
// ===============================
app.post("/payment-callback", (req, res) => {
  console.log("Payment callback received:", req.body);
  res.sendStatus(200);
});

// ===============================
// 🟢 START SERVER
// ===============================
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
