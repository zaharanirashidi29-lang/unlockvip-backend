const axios = require("axios");
const crypto = require("crypto");

const BASE_URL = (process.env.ABLINER_API_BASE_URL || "https://abliner.net").replace(/\/$/, "");

function getApiKey() {
  const key = process.env.ABLINER_API_KEY;
  if (!key) {
    throw new Error("ABLINER_API_KEY is required");
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
  return `${prefix}${Date.now()}`;
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

const TRANSACTION_LIST_CACHE_MS = 3000;
let transactionListCache = null;

async function listTransactions(limit = 100, options = {}) {
  const { bypassCache = false } = options;
  const now = Date.now();

  if (
    !bypassCache &&
    transactionListCache &&
    transactionListCache.expiresAt > now &&
    transactionListCache.limit >= limit
  ) {
    return transactionListCache.items.slice(0, limit);
  }

  const response = await axios.get(`${BASE_URL}/api/v1/transactions`, {
    headers: authHeaders(),
    params: { limit },
    timeout: 20000
  });
  const items = response.data?.data || [];
  transactionListCache = {
    items,
    limit: Math.max(limit, items.length),
    expiresAt: now + TRANSACTION_LIST_CACHE_MS
  };
  return items.slice(0, limit);
}

async function getTransaction(transactionId, options = {}) {
  const items = await listTransactions(100, options);
  return items.find((item) => item.id === transactionId) || null;
}

async function resolvePaymentStatus(payment, options = {}) {
  const ablinerId = payment?.order_tracking_id || payment?.transaction_id;
  const reference = payment?.reference;
  const items = options.transactions || (await listTransactions(100, options));
  const match = items.find(
    (item) =>
      (ablinerId && item.id === ablinerId) ||
      (reference && item.reference === reference)
  );

  if (!match) {
    const err = new Error("Abliner transaction not found");
    err.code = "NOT_FOUND";
    throw err;
  }

  return match;
}

function ablinerAmountTzs(data) {
  if (data?.amount_tzs != null) return Number(data.amount_tzs);
  if (data?.amount != null) return Number(data.amount);
  if (data?.amount_cents != null) return Number(data.amount_cents) / 100;
  return undefined;
}

function normalizeAblinerStatus(status) {
  const value = String(status || "").toLowerCase();
  if (value === "completed" || value === "success" || value === "successful") {
    return "COMPLETED";
  }
  if (value === "failed" || value === "cancelled" || value === "canceled" || value === "expired") {
    return "FAILED";
  }
  return "PROCESSING";
}

function extractAblinerFailureMessage(data) {
  if (!data) return "Abliner payment failed";

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
    return "Abliner payment failed";
  }

  return "Abliner payment failed";
}

function isAblinerFailed(data) {
  const status = String(data?.status || "").toLowerCase();
  return ["failed", "cancelled", "canceled", "expired", "error"].includes(status);
}

function buildAblinerUpdate(statusData, source) {
  const mapped = normalizeAblinerStatus(statusData?.status);
  const amount = ablinerAmountTzs(statusData);

  let message;
  if (mapped === "COMPLETED") {
    message = "Payment successful via Abliner";
  } else if (mapped === "FAILED") {
    message = extractAblinerFailureMessage(statusData);
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

  doc.abliner_status = response.status || doc.result || null;
  doc.abliner_transaction_id =
    response.id || doc.transaction_id || doc.order_tracking_id || null;

  const failed =
    doc.status === "FAILED" ||
    isAblinerFailed(response) ||
    doc.reason === "WEBHOOK_FAILED" ||
    doc.reason === "PAYMENT_FAILED" ||
    doc.reason === "FAILED_BY_QUERY";

  if (failed) {
    doc.abliner_failed = true;
    doc.abliner_failure = extractAblinerFailureMessage(response) || doc.message || "Payment failed";
    if (!doc.message || doc.message === "Abliner failed") {
      doc.message = doc.abliner_failure;
    }
  } else {
    doc.abliner_failed = false;
    doc.abliner_failure = null;
  }

  doc.provider_status = doc.abliner_status;
  doc.provider_failed = doc.abliner_failed;
  doc.provider_failure = doc.abliner_failure;
  doc.provider_transaction_id = doc.abliner_transaction_id;

  return doc;
}

function isAblinerWebhook(body) {
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

function formatAblinerError(error) {
  const data = error.response?.data;
  return {
    message: data?.message || error.message || "Abliner request failed",
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
  ablinerAmountTzs,
  normalizeAblinerStatus,
  extractAblinerFailureMessage,
  isAblinerFailed,
  buildAblinerUpdate,
  enrichPaymentForAdmin,
  isAblinerWebhook,
  verifyWebhookSignature,
  formatAblinerError
};
