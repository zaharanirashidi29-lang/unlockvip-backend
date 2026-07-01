const axios = require("axios");

const CONSUMER_KEY = process.env.PESAPAL_CONSUMER_KEY || "";
const CONSUMER_SECRET = process.env.PESAPAL_CONSUMER_SECRET || "";
const BASE_URL =
  process.env.PESAPAL_ENV === "sandbox"
    ? "https://cybqa.pesapal.com/pesapalv3/api"
    : "https://pay.pesapal.com/v3/api";

const CALLBACK_URL =
  process.env.PESAPAL_DEMO_CALLBACK_URL ||
  process.env.CALLBACK_URL ||
  "https://unlockvip-backend-1.onrender.com/webhook";

let cachedToken = null;
let cachedIpnId = null;

function authHeaders(token) {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`
  };
}

async function requestToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.value;
  }

  const { data } = await axios.post(
    `${BASE_URL}/Auth/RequestToken`,
    {
      consumer_key: CONSUMER_KEY,
      consumer_secret: CONSUMER_SECRET
    },
    {
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      timeout: 30000
    }
  );

  if (!data.token) {
    const message = data.message || data.error?.message || "Pesapal authentication failed";
    throw new Error(message);
  }

  cachedToken = {
    value: data.token,
    expiresAt: Date.now() + 4 * 60 * 1000
  };

  return data.token;
}

async function ensureIpnId(token) {
  if (cachedIpnId) {
    return cachedIpnId;
  }

  const { data } = await axios.post(
    `${BASE_URL}/URLSetup/RegisterIPN`,
    {
      url: CALLBACK_URL,
      ipn_notification_type: "GET"
    },
    {
      headers: authHeaders(token),
      timeout: 30000
    }
  );

  const ipnId = data.ipn_id || data.notification_id;
  if (!ipnId) {
    throw new Error("Pesapal IPN registration failed");
  }

  cachedIpnId = ipnId;
  return ipnId;
}

function makeOrderId() {
  return `DEMO${Date.now()}`;
}

async function createOrder({ phone, amount, firstName = "Test", lastName = "Customer" }) {
  if (!CONSUMER_KEY || !CONSUMER_SECRET) {
    throw new Error("Set PESAPAL_CONSUMER_KEY and PESAPAL_CONSUMER_SECRET in .env");
  }

  const token = await requestToken();
  const notificationId = await ensureIpnId(token);
  const orderId = makeOrderId();

  const { data } = await axios.post(
    `${BASE_URL}/Transactions/SubmitOrderRequest`,
    {
      id: orderId,
      currency: "TZS",
      amount: Number(amount),
      description: "UnlockVIP Pesapal demo",
      callback_url: CALLBACK_URL,
      redirect_mode: "PARENT_WINDOW",
      notification_id: notificationId,
      billing_address: {
        phone_number: String(phone).replace(/\D/g, ""),
        country_code: "TZ",
        first_name: firstName,
        last_name: lastName
      }
    },
    {
      headers: authHeaders(token),
      timeout: 30000
    }
  );

  if (!data.redirect_url || !data.order_tracking_id) {
    const message = data.message || data.error?.message || "Pesapal order creation failed";
    throw new Error(message);
  }

  return {
    orderId,
    orderTrackingId: data.order_tracking_id,
    merchantReference: data.merchant_reference || orderId,
    redirectUrl: data.redirect_url
  };
}

async function getTransactionStatus(orderTrackingId) {
  const token = await requestToken();

  const { data } = await axios.get(`${BASE_URL}/Transactions/GetTransactionStatus`, {
    params: { orderTrackingId },
    headers: authHeaders(token),
    timeout: 30000,
    validateStatus: () => true
  });

  return data;
}

module.exports = {
  createOrder,
  getTransactionStatus,
  CALLBACK_URL
};
