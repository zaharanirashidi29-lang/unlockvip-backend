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
    headers: authHeaders(),
    timeout: 20000
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
    params: { limit },
    timeout: 20000
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

function extractGreboFailureMessage(data) {
  if (!data) return "Grebo payment failed";

  const candidates = [
    data.failure_reason,
    data.failure_message,
    data.failureReason,
    data.error_message,
    data.error,
    data.message,
    data.description,
    data.reason
  ];

  for (const candidate of candidates) {
    const text = String(candidate || "").trim();
    if (!text) continue;
    const lower = text.toLowerCase();
    if (lower === "failed" || lower === "error" || lower === "success") continue;
    return text;
  }

  const status = String(data.status || "").toLowerCase();
  if (status === "cancelled" || status === "canceled") {
    return "Payment cancelled by customer";
  }
  if (status === "expired") {
    return "Payment expired";
  }
  if (status === "failed") {
    return "Grebo payment failed";
  }

  return "Grebo payment failed";
}

function isGreboFailed(data) {
  const status = String(data?.status || "").toLowerCase();
  return ["failed", "cancelled", "canceled", "expired", "error"].includes(status);
}

function buildGreboUpdate(statusData, source) {
  const mapped = normalizeGreboStatus(statusData?.status);
  const amount = greboAmountTzs(statusData);

  let message;
  if (mapped === "COMPLETED") {
    message = "Payment successful via Grebo";
  } else if (mapped === "FAILED") {
    message = extractGreboFailureMessage(statusData);
  } else {
    message = "Waiting for customer to authorize payment";
  }

  return {
    status: mapped,
    reason:
      mapped === "COMPLETED"
        ? source === "WEBHOOK"
          ? "WEBHOOK_CONFIRMED"
          : "CONFIRMED_BY_QUERY"
        : mapped === "FAILED"
          ? source === "WEBHOOK"
            ? "WEBHOOK_FAILED"
            : "FAILED_BY_QUERY"
          : "USSD_SENT",
    message,
    amount: amount || undefined,
    transaction_id: statusData?.id,
    result: statusData?.status,
    resultcode: statusData?.status,
    provider_response: statusData
  };
}

function enrichPaymentForAdmin(payment) {
  const doc = payment?.toObject ? payment.toObject() : { ...payment };
  const response = doc.provider_response || {};
  const greboStatus = String(response.status || doc.result || "").toLowerCase();

  doc.grebo_status = response.status || doc.result || null;
  doc.grebo_transaction_id =
    response.id || doc.transaction_id || doc.order_tracking_id || null;

  const failed =
    doc.status === "FAILED" ||
    isGreboFailed(response) ||
    doc.reason === "WEBHOOK_FAILED" ||
    doc.reason === "PAYMENT_FAILED" ||
    doc.reason === "FAILED_BY_QUERY";

  if (failed) {
    doc.grebo_failed = true;
    doc.grebo_failure = extractGreboFailureMessage(response) || doc.message || "Payment failed";
    if (!doc.message || doc.message === "Grebo failed") {
      doc.message = doc.grebo_failure;
    }
  } else {
    doc.grebo_failed = false;
    doc.grebo_failure = null;
  }

  doc.provider_status = doc.grebo_status;
  doc.provider_failed = doc.grebo_failed;
  doc.provider_failure = doc.grebo_failure;
  doc.provider_transaction_id = doc.grebo_transaction_id;

  return doc;
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
  extractGreboFailureMessage,
  isGreboFailed,
  buildGreboUpdate,
  enrichPaymentForAdmin,
  isGreboWebhook,
  verifyWebhookSignature,
  formatGreboError
};
