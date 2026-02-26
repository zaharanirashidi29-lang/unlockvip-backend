const express = require("express");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());

// 🔐 ClickPesa Credentials (from Render Environment Variables)
const CLIENT_ID = process.env.CLICKPESA_CLIENT_ID;
const API_KEY = process.env.CLICKPESA_API_KEY;

// Root route
app.get("/", (req, res) => {
  res.send("UnlockVIP Backend is running 🚀");
});

// ===============================
// 🔑 STEP 1: GET ACCESS TOKEN
// ===============================
async function getAccessToken() {
  try {
    const response = await axios.post(
      "https://api.clickpesa.com/oauth/token",
      {},
      {
        headers: {
          "Content-Type": "application/json",
          "x-client-id": CLIENT_ID,
          "x-api-key": API_KEY
        }
      }
    );

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
// 💳 STEP 2: CREATE PAYMENT
// ===============================
app.post("/create-payment", async (req, res) => {
  try {
    const { amount, phone } = req.body;

    if (!amount || !phone) {
      return res.status(400).json({
        error: "Amount and phone are required"
      });
    }

    const token = await getAccessToken();

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
          Authorization: `Bearer ${token}`
        }
      }
    );

    res.json(response.data);
  } catch (error) {
    console.error(
      "Payment Error:",
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
  console.log("Payment callback received:", req.body);
  res.sendStatus(200);
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
