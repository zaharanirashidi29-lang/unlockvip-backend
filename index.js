require("dotenv").config();

const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

// Load environment variables
const CLIENT_ID = process.env.CLICKPESA_CLIENT_ID;
const API_KEY = process.env.CLICKPESA_API_KEY;

// Debug (REMOVE later after confirming)
console.log("CLIENT_ID:", CLIENT_ID ? "Loaded ✅" : "Missing ❌");
console.log("API_KEY:", API_KEY ? "Loaded ✅" : "Missing ❌");

// ROOT ROUTE
app.get("/", (req, res) => {
  res.send("UnlockVIP Backend is running 🚀");
});

// ===============================
// GET ACCESS TOKEN
// ===============================
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

    // ClickPesa already includes Bearer prefix
    return response.data.token;

  } catch (error) {
    console.error("❌ Token Error:", error.response?.data || error.message);
    throw new Error("Failed to get access token");
  }
}

// ===============================
// REAL USSD PUSH
// ===============================
app.post("/create-payment", async (req, res) => {
  try {
    let { amount, phone } = req.body;

    if (!amount || !phone) {
      return res.status(400).json({
        success: false,
        error: "Amount and phone are required"
      });
    }

    // Format Tanzania phone number
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
        error: "Invalid Tanzanian phone number format"
      });
    }

    const token = await getAccessToken();

    const orderReference = "ORDER" + Date.now();

    const paymentResponse = await axios.post(
      "https://api.clickpesa.com/third-parties/payments/ussd-push-request",
      {
        amount: amount.toString(),
        currency: "TZS",
        orderReference: orderReference,
        phoneNumber: phone
      },
      {
        headers: {
          Authorization: token, // DO NOT add Bearer again
          "Content-Type": "application/json",
        },
      }
    );

    console.log("✅ Push Response:", paymentResponse.data);

    res.json({
      success: true,
      response: paymentResponse.data
    });

  } catch (error) {
    console.error("❌ Payment Error:", error.response?.data || error.message);

    res.status(500).json({
      success: false,
      error: error.response?.data || error.message
    });
  }
});

// ===============================
// START SERVER
// ===============================
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});