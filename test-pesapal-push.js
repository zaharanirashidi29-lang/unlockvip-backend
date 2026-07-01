/**
 * Standalone Pesapal API 3.0 test — does not use or modify main app code.
 * Usage: node test-pesapal-push.js [phone] [amount]
 */
require("dotenv").config();
const axios = require("axios");

const CONSUMER_KEY = process.env.PESAPAL_CONSUMER_KEY || "";
const CONSUMER_SECRET = process.env.PESAPAL_CONSUMER_SECRET || "";

const ENVIRONMENTS = [
  {
    name: "production",
    baseUrl: "https://pay.pesapal.com/v3/api"
  },
  {
    name: "sandbox",
    baseUrl: "https://cybqa.pesapal.com/pesapalv3/api"
  }
];

const phone = String(process.argv[2] || "255794316132").replace(/\D/g, "");
const amount = Number(process.argv[3] || 3061);
const orderId = `UNLOCKVIP${Date.now()}`;
const callbackUrl = process.env.CALLBACK_URL || "https://unlockvip-backend-1.onrender.com/webhook";
const ipnUrl = callbackUrl;

function authHeaders(token) {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`
  };
}

async function requestToken(env) {
  const { data } = await axios.post(
    `${env.baseUrl}/Auth/RequestToken`,
    {
      consumer_key: CONSUMER_KEY,
      consumer_secret: CONSUMER_SECRET
    },
    {
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      timeout: 30000,
      validateStatus: () => true
    }
  );

  return data;
}

async function registerIpn(env, token) {
  const { data } = await axios.post(
    `${env.baseUrl}/URLSetup/RegisterIPN`,
    {
      url: ipnUrl,
      ipn_notification_type: "GET"
    },
    {
      headers: authHeaders(token),
      timeout: 30000,
      validateStatus: () => true
    }
  );

  return data;
}

async function submitOrder(env, token, notificationId) {
  const { data } = await axios.post(
    `${env.baseUrl}/Transactions/SubmitOrderRequest`,
    {
      id: orderId,
      currency: "TZS",
      amount,
      description: "UnlockVIP Pesapal test",
      callback_url: callbackUrl,
      notification_id: notificationId,
      billing_address: {
        phone_number: phone,
        country_code: "TZ",
        first_name: "Test",
        last_name: "Customer"
      }
    },
    {
      headers: authHeaders(token),
      timeout: 30000,
      validateStatus: () => true
    }
  );

  return data;
}

async function getTransactionStatus(env, token, orderTrackingId) {
  const { data } = await axios.get(
    `${env.baseUrl}/Transactions/GetTransactionStatus`,
    {
      params: { orderTrackingId },
      headers: authHeaders(token),
      timeout: 30000,
      validateStatus: () => true
    }
  );

  return data;
}

(async () => {
  console.log("=== Pesapal Integration Test (standalone) ===");
  console.log("Phone:", phone);
  console.log("Amount:", amount, "TZS");
  console.log("Order ID:", orderId);
  console.log("IPN / callback:", callbackUrl);

  for (const env of ENVIRONMENTS) {
    console.log(`\n--- ${env.name.toUpperCase()} ---`);

    try {
      const auth = await requestToken(env);
      console.log("Auth status:", auth.status, auth.message || auth.error);

      if (!auth.token) {
        console.log("Auth failed:", JSON.stringify(auth, null, 2));
        continue;
      }

      console.log("Token OK, expires:", auth.expiryDate);

      const ipn = await registerIpn(env, auth.token);
      const notificationId = ipn.ipn_id || ipn.notification_id;

      if (!notificationId) {
        console.log("IPN registration failed:", JSON.stringify(ipn, null, 2));
        continue;
      }

      console.log("IPN ID:", notificationId);

      const order = await submitOrder(env, auth.token, notificationId);
      console.log("Submit order:", JSON.stringify(order, null, 2));

      if (!order.redirect_url) {
        continue;
      }

      console.log("\nPesapal payment URL (customer completes STK push here):");
      console.log(order.redirect_url);

      if (order.order_tracking_id) {
        const status = await getTransactionStatus(env, auth.token, order.order_tracking_id);
        console.log("Transaction status:", JSON.stringify(status, null, 2));
      }

      console.log(
        "\nNote: Pesapal does not expose a direct server-side STK push API.",
        "The mobile money prompt is triggered when the customer opens the payment URL and selects Vodacom M-Pesa."
      );

      return;
    } catch (error) {
      console.log("Error:", error.response?.data || error.message);
    }
  }

  process.exitCode = 1;
})();
