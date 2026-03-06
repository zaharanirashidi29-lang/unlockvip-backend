require("dotenv").config();

const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

const CLIENT_ID = process.env.CLICKPESA_CLIENT_ID;
const API_KEY = process.env.CLICKPESA_API_KEY;

// ROOT TEST
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

    // IMPORTANT: token already includes "Bearer "
    return response.data.token;

  } catch (error) {
    console.error("Token Error:", error.response?.data || error.message);
    throw new Error("Failed to get access token");
  }
}

// =======================
// 💳 REAL USSD PUSH
// =======================
app.post("/create-payment", async (req, res) => {
  try {
    let { phone } = req.body;

    const amount = 18500;

    if (!phone) {
      return res.status(400).json({
        success: false,
        error: "Phone is required"
      });
    }

    // Format phone
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
    const orderReference = "ORDER" + Date.now();

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

    res.json({
      success: true,
      payment: paymentResponse.data
    });

  } catch (error) {
    console.error("Payment Error:", error.response?.data || error.message);

    res.status(500).json({
      success: false,
      error: error.response?.data || error.message
    });
  }
});

// =======================
app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});