
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
// 🔥 CREATE PAYMENT (PRODUCTION)
// ===============================
app.post("/create-payment", async (req, res) => {
  try {
    const { amount, phone } = req.body;

    if (!amount || !phone) {
      return res.status(400).json({
        error: "Amount and phone are required"
      });
    }

    if (!CLIENT_ID || !API_KEY) {
      return res.status(500).json({
        error: "ClickPesa credentials missing in environment variables"
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
          "x-client-id": CLIENT_ID.trim(),
          "x-api-key": API_KEY.trim()
        }
      }
    );

    res.json(response.data);

  } catch (error) {
    console.error("ClickPesa Error:");
    console.error(error.response?.data || error.message);

    res.status(500).json({
      error: error.response?.data || "Payment request failed"
    });
  }
});

// ===============================
// 🔔 PAYMENT CALLBACK
// ===============================
app.post("/payment-callback", (req, res) => {
  console.log("Payment callback received:");
  console.log(req.body);

  // TODO:
  // - verify payment status
  // - unlock VIP
  // - store transaction in DB

  res.sendStatus(200);
});

// ===============================
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
