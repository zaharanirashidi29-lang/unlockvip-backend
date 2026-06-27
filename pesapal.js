const axios = require("axios");

const BASE_URL =
  process.env.PESAPAL_ENV === "sandbox"
    ? "https://cybqa.pesapal.com/pesapalv3/api"
    : "https://pay.pesapal.com/v3/api";

const CONSUMER_KEY = process.env.PESAPAL_CONSUMER_KEY || "";
const CONSUMER_SECRET = process.env.PESAPAL_CONSUMER_SECRET || "";

let cachedToken = null;
let cachedIpnId = process.env.PESAPAL_IPN_ID || null;

function getCallbackUrl() {
  return (
    process.env.PESAPAL_CALLBACK_URL ||
    process.env.CALLBACK_URL ||
    "https://unlockvip-backend-1.onrender.com/webhook"
  );
}

function authHeaders(token) {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`
  };
}

function formatPesapalError(error) {
  const data = error.response?.data;
  const message =
    data?.message ||
    data?.error?.message ||
    error.message ||
    "Pesapal request failed";

  return {
    message,
    code: data?.error?.code || error.response?.status || error.code,
    details: data || null
  };
}

async function requestToken() {
  if (!CONSUMER_KEY || !CONSUMER_SECRET) {
    throw new Error("PESAPAL_CONSUMER_KEY and PESAPAL_CONSUMER_SECRET are required");
  }

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
    throw new Error(data.message || "Pesapal authentication failed");
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
      url: getCallbackUrl(),
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

function normalizePesapalStatus(data) {
  const code = String(data?.payment_status_code || data?.status || "").toUpperCase();
  const description = String(
    data?.payment_status_description || data?.message || data?.error?.message || ""
  ).toUpperCase();

  let status = "PROCESSING";
  if (code === "COMPLETED" || description === "COMPLETED") {
    status = "COMPLETED";
  } else if (code === "FAILED" || description === "FAILED" || description === "INVALID") {
    if (description === "INVALID" && !code) {
      status = "PROCESSING";
    } else if (description === "FAILED" || code === "FAILED") {
      status = "FAILED";
    }
  }

  return {
    status,
    payment_status_code: code,
    payment_status_description: data?.payment_status_description || data?.message || description,
    amount: Number(data?.amount || 0),
    currency: data?.currency || "TZS",
    order_tracking_id: data?.order_tracking_id,
    merchant_reference: data?.merchant_reference,
    confirmation_code: data?.confirmation_code || "",
    raw: data
  };
}

function buildPesapalUpdate(statusData, source) {
  const normalized = normalizePesapalStatus(statusData);

  return {
    status: normalized.status,
    reason:
      normalized.status === "COMPLETED"
        ? source === "WEBHOOK"
          ? "WEBHOOK_CONFIRMED"
          : "CONFIRMED_BY_QUERY"
        : normalized.status === "FAILED"
          ? "FAILED_BY_QUERY"
          : "WAITING_FOR_USER",
    message:
      normalized.status === "COMPLETED"
        ? "Payment confirmed via Pesapal"
        : normalized.status === "FAILED"
          ? normalized.payment_status_description || "Pesapal payment failed"
          : "Complete payment in Pesapal checkout",
    amount: normalized.amount || undefined,
    transaction_id: normalized.confirmation_code || statusData?.confirmation_code || undefined,
    result: normalized.payment_status_code || normalized.status,
    resultcode: normalized.payment_status_code || normalized.status,
    provider_response: normalized.raw || statusData
  };
}

function isPesapalPaymentComplete(data) {
  return normalizePesapalStatus(data).status === "COMPLETED";
}

async function createPaymentOrder({ reference, phone, amount, description }) {
  const token = await requestToken();
  const notificationId = await ensureIpnId(token);
  const callbackUrl = getCallbackUrl();

  const { data } = await axios.post(
    `${BASE_URL}/Transactions/SubmitOrderRequest`,
    {
      id: reference,
      currency: "TZS",
      amount: Number(amount),
      description: description || "UnlockVIP subscription payment",
      callback_url: callbackUrl,
      redirect_mode: "PARENT_WINDOW",
      notification_id: notificationId,
      billing_address: {
        phone_number: String(phone).replace(/\D/g, ""),
        country_code: "TZ",
        first_name: "Customer",
        last_name: "UnlockVIP"
      }
    },
    {
      headers: authHeaders(token),
      timeout: 30000
    }
  );

  if (!data.redirect_url || !data.order_tracking_id) {
    throw new Error(data.message || data.error?.message || "Pesapal order creation failed");
  }

  return {
    orderTrackingId: data.order_tracking_id,
    merchantReference: data.merchant_reference || reference,
    redirectUrl: data.redirect_url,
    raw: data
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
  createPaymentOrder,
  getTransactionStatus,
  normalizePesapalStatus,
  buildPesapalUpdate,
  isPesapalPaymentComplete,
  formatPesapalError,
  getCallbackUrl
};
