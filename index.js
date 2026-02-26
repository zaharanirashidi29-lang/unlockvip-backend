const express = require("express");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());

// Environment Variables
const CLIENT_ID = process.env.CLICKPESA_CLIENT_ID;
const API_KEY = process.env.CLICKPESA_API_KEY;

// Root test route
app.get("/", (req, res) => {
  res.send("UnlockVIP Backend is running 🚀");
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

    const response = await axios.post(
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
          "x-client-id": CLIENT_ID,
          "x-api-key": API_KEY
        }
      }
    );

    res.json(response.data);
  } catch (error) {
    console.error(
      error.response ? error.response.data : error.message
    );
    res.status(500).json({
      error: "Payment request failed"
    });
  }
});

// ===============================
// 🔔 PAYMENT CALLBACK
// ===============================
app.post("/payment-callback", (req, res) => {
  console.log("Payment callback received:");
  console.log(req.body);

  // Here you can update database or unlock user

  res.sendStatus(200);
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
