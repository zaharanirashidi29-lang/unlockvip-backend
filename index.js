const express = require("express");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());

// ===============================
// ENV VARIABLES
// ===============================
const CLIENT_ID = process.env.CLICKPESA_CLIENT_ID;
const API_KEY = process.env.CLICKPESA_API_KEY;

// ===============================
// ROOT ROUTE
// ===============================
app.get("/", (req, res) => {
  res.json({
    message: "UnlockVIP Backend is running 🚀"
  });
});

// ===============================
// DEBUG ROUTE TEST
// ===============================
app.post("/create-payment", async (req, res) => {
  console.log("==== CREATE PAYMENT ROUTE HIT ====");
  console.log("BODY RECEIVED:", req.body);
  console.log("CLIENT_ID:", CLIENT_ID ? "EXISTS" : "MISSING");
  console.log("API_KEY:", API_KEY ? "EXISTS" : "MISSING");

  return res.json({
    route: "create-payment",
    received: req.body,
    env: {
      client_id: CLIENT_ID ? "OK" : "MISSING",
      api_key: API_KEY ? "OK" : "MISSING"
    }
  });
});

// ===============================
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
