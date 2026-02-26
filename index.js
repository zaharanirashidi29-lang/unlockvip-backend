const express = require("express");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());

// Test route
app.get("/", (req, res) => {
  res.send("UnlockVIP Backend is running 🚀");
});

// Create payment (1500 TZS fixed)
app.post("/create-payment", async (req, res) => {
  try {
    const { phone } = req.body;

    const response = await axios.post(
      "https://api.clickpesa.com/transaction/initiate",
      {
        amount: 1500,
        phone: phone,
        currency: "TZS"
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.CLICKPESA_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    res.json(response.data);

  } catch (error) {
    console.error(error.response?.data || error.message);
    res.status(500).json({
      error: "Payment request failed",
      details: error.response?.data || error.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
