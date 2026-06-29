const axios = require("axios");
const crypto = require("crypto");

const BASE_URL = (process.env.GREBO_API_BASE_URL || "https://grebo.tesloty.com").replace(
  /\/$/,
  ""
);

function getApiKey() {
  const key = process.env.GREBO_API_KEY;
  if (!key) {
    throw new Error("GREBO_API_KEY is required");
  }
  return key;
}

function authHeaders() {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    Authorization: `Bearer ${getApiKey()}`
  };
}

function normalizePhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.startsWith("255")) return digits;
  if (digits.startsWith("0")) return `255${digits.slice(1)}`;
  if (digits.length === 9) return `255${digits}`;
  return digits;
}

function makeReference(prefix = "UNLOCKVIP") {
  return `${prefix}-${Date.now()}`;
}

async function getBalance() {
  const response = await axios.get(`${BASE_URL}/api/v1/balance`, {
    headers: authHeaders()
  });
  return response.data;
}

async function createDeposit({ amount, phone, reference, callbackUrl, method = "mobile" }) {
  const response = await axios.post(
    `${BASE_URL}/api/v1/deposits`,
    {
      amount: Number(amount),
      method,
      phone: normalizePhone(phone),
      reference,
      ...(callbackUrl ? { callback_url: callbackUrl } : {})
    },
    { headers: authHeaders() }
  );
  return response.data;
}

async function listTransactions(limit = 100) {
  const response = await axios.get(`${BASE_URL}/api/v1/transactions`, {
    headers: authHeaders(),
    params: { limit }
  });
  return response.data?.data || [];
}

async function getTransaction(transactionId) {
  const items = await listTransactions(100);
  return items.find((item) => item.id === transactionId) || null;
}

async function resolvePaymentStatus(payment) {
  const greboId = payment?.order_tracking_id || payment?.transaction_id;
  const reference = payment?.reference;
  const items = await listTransactions(100);
  const match = items.find(
    (item) =>
      (greboId && item.id === greboId) ||
      (reference && item.reference === reference)
  );

  if (!match) {
    const err = new Error("Grebo transaction not found");
    err.code = "NOT_FOUND";
    throw err;
  }

  return match;
}

function greboAmountTzs(data) {
  if (data?.amount_tzs != null) return Number(data.amount_tzs);
  if (data?.amount != null) return Number(data.amount);
  if (data?.amount_cents != null) return Number(data.amount_cents) / 100;
  return undefined;
}

function normalizeGreboStatus(status) {
  const value = String(status || "").toLowerCase();
  if (value === "completed" || value === "success" || value === "successful") {
    return "COMPLETED";
  }
  if (value === "failed" || value === "cancelled" || value === "canceled" || value === "expired") {
    return "FAILED";
  }
  return "PROCESSING";
}

function buildGreboUpdate(statusData, source) {
  const mapped = normalizeGreboStatus(statusData?.status);
  const amount = greboAmountTzs(statusData);

  return {
    status: mapped,
    reason:
      mapped === "COMPLETED"
        ? source === "WEBHOOK"
          ? "WEBHOOK_CONFIRMED"
          : "CONFIRMED_BY_QUERY"
        : mapped === "FAILED"
          ? "PAYMENT_FAILED"
          : "USSD_SENT",
    message: `Grebo ${statusData?.status || mapped}`,
    amount: amount || undefined,
    transaction_id: statusData?.id,
    result: statusData?.status,
    resultcode: statusData?.status,
    provider_response: statusData
  };
}

function isGreboWebhook(body) {
  const event = String(body?.event || "").toLowerCase();
  return event.startsWith("transaction.");
}

function verifyWebhookSignature({ rawBody, signature, timestamp, secret }) {
  const message = `${timestamp}.${rawBody}`;
  const expected = crypto.createHmac("sha256", secret).update(message).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature || "", "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function formatGreboError(error) {
  const data = error.response?.data;
  return {
    message: data?.message || error.message || "Grebo request failed",
    error: data?.error || null,
    status: error.response?.status,
    requestId: data?.request_id || null,
    details: data || null
  };
}

module.exports = {
  BASE_URL,
  normalizePhone,
  makeReference,
  getBalance,
  createDeposit,
  listTransactions,
  getTransaction,
  resolvePaymentStatus,
  greboAmountTzs,
  normalizeGreboStatus,
  buildGreboUpdate,
  isGreboWebhook,
  verifyWebhookSignature,
  formatGreboError
};
