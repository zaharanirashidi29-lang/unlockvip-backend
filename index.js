const express = require("express");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());

// ===============================
// 🔐 ENV VARIABLES
// ===============================
const CLIENT_ID = process.env.CLICKPESA_CLIENT_ID;
const API_KEY = process.env.CLICKPESA_API_KEY;

// ===============================
// 🟢 ROOT TEST ROUTE
// ===============================
app.get("/", (req, res) => {
  res.json({
    message: "UnlockVIP Backend is running 🚀"
  });
});

// ===============================
// 🔥 CREATE PAYMENT
// ===============================
app.post("/create-payment", async (req, res) => {
  try {
    const { amount, phone } = req.body;

    if (!amount || !phone) {
      return res.status(400).json({
        error: "Amount and phone are required"
      });
    }

    // 1️⃣ Get Access Token
const authResponse = await axios.post(
  "https://api.clickpesa.com/v1/oauth/token",
  {
    grant_type: "client_credentials"
  },
  {
    auth: {
      username: CLIENT_ID,
      password: API_KEY
    },
    headers: {
      "Content-Type": "application/json"
    }
  }
);

const accessToken = authResponse.data.access_token;

    if (!accessToken) {
      return res.status(500).json({
        error: "Failed to get access token"
      });
    }

    // 2️⃣ Create Payment
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
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        }
      }
    );

    res.json(paymentResponse.data);

  } catch (error) {
    console.error("Payment Error:");
    console.error(error.response?.data || error.message);

    res.status(500).json({
      error: "Payment request failed",
      details: error.response?.data || error.message
    });
  }
});

// ===============================
// 🔔 PAYMENT CALLBACK
// ===============================
app.post("/payment-callback", (req, res) => {
  console.log("Payment callback received:");
  console.log(req.body);

  // Here you can:
  // - verify transaction
  // - update database
  // - unlock VIP
  // - send confirmation

  res.sendStatus(200);
});

// ===============================
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
