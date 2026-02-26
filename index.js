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

// ROOT
app.get("/", (req, res) => {
  res.send("UnlockVIP Backend is running 🚀");
});

// GET TOKEN
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

    if (token.startsWith("Bearer ")) {
      token = token.replace("Bearer ", "");
    }

    return token;

  } catch (error) {
    console.error("Token Error:", error.response?.data || error.message);
    throw new Error("Failed to get access token");
  }
}

// CREATE PAYMENT
app.post("/create-payment", async (req, res) => {
  try {
    let { amount, phone } = req.body;

    if (!amount || !phone) {
      return res.status(400).json({
        success: false,
        error: "Amount and phone are required"
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
      "https://api.clickpesa.com/third-parties/payments/preview-ussd-push-request",
      {
        amount: amount.toString(),
        currency: "TZS",
        orderReference: orderReference,
        phoneNumber: phone,
        fetchSenderDetails: false
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }
    );

    res.json({
      success: true,
      orderReference,
      data: paymentResponse.data
    });

  } catch (error) {
    console.error("Payment Error:", error.response?.data || error.message);

    res.status(500).json({
      success: false,
      error: error.response?.data || error.message
    });
  }
});

app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});