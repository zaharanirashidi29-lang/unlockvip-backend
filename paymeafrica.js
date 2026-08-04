const axios = require("axios");
const crypto = require("crypto");

const BASE_URL = (
  process.env.PAYMEAFRICA_API_BASE_URL || "https://portal.paymeafrica.com/api/v1"
).replace(/\/$/, "");

function getAppId() {
  const id = process.env.PAYMEAFRICA_APP_ID;
  if (!id) throw new Error("PAYMEAFRICA_APP_ID is required");
  return id;
}

function getSecret() {
  const secret = process.env.PAYMEAFRICA_SECRET_KEY;
  if (!secret) throw new Error("PAYMEAFRICA_SECRET_KEY is required");
  return secret;
}

function normalizePhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.startsWith("255")) return digits;
  if (digits.startsWith("0")) return `255${digits.slice(1)}`;
  if (digits.length === 9) return `255${digits}`;
  return digits;
}

function signPayload(bodyString, timestamp, secret = getSecret()) {
  return crypto
    .createHmac("sha256", secret)
    .update(String(bodyString) + String(timestamp))
    .digest("base64");
}

function authHeaders(bodyString, timestamp = Math.floor(Date.now() / 1000)) {
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    "X-App-ID": getAppId(),
    "X-Timestamp": String(timestamp),
    "X-Signature": signPayload(bodyString, timestamp)
  };
}

async function apiPost(path, payload = {}) {
  const bodyString = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000);
  const response = await axios.post(`${BASE_URL}${path}`, bodyString, {
    headers: authHeaders(bodyString, timestamp),
    timeout: 45000,
    transformRequest: [(data) => data],
    validateStatus: () => true
  });

  if (response.status >= 400) {
    const err = new Error(
      response.data?.message ||
        response.data?.error ||
        response.data?.provider_response?.message ||
        `PayMe Africa HTTP ${response.status}`
    );
    err.response = response;
    err.details = response.data;
    err.code = response.status;
    throw err;
  }

  return response.data;
}

async function getAccountSummary() {
  return apiPost("/summarize", {});
}

async function createCollection({ amount, phone, reference, callbackUrl }) {
  const payload = {
    action: "collection",
    amount: Number(amount),
    msisdn: normalizePhone(phone),
    reference: String(reference),
    ...(callbackUrl ? { callback_url: callbackUrl } : {})
  };
  const data = await apiPost("/transact", payload);
  const paymentStatus = String(data?.payment_status || "").toUpperCase();
  const result = String(data?.provider_response?.result || data?.result || "").toUpperCase();
  if (
    data?.status === "failed" ||
    paymentStatus === "FAILED" ||
    result === "FAILED"
  ) {
    const err = new Error(extractPaymeFailureMessage(data));
    err.details = data;
    err.code = data?.result_code || data?.provider_response?.resultcode || "FAILED";
    throw err;
  }
  return data;
}

async function queryTransaction(reference) {
  return apiPost("/query", { reference: String(reference) });
}

async function resolvePaymentStatus(payment) {
  const reference = payment?.reference;
  if (!reference) {
    const err = new Error("Missing PayMe Africa reference");
    err.code = "NOT_FOUND";
    throw err;
  }
  return queryTransaction(reference);
}

function normalizePaymeStatus(data) {
  const paymentStatus = String(data?.payment_status || "").toUpperCase();
  const topStatus = String(data?.status || "").toUpperCase();
  const result = String(data?.result || data?.provider_response?.result || "").toUpperCase();
  const resultcode = String(
    data?.resultcode || data?.provider_response?.resultcode || ""
  );

  // Initiate responses use payment_status=PENDING with result=SUCCESS (push sent).
  if (["COMPLETED", "SUCCESS", "SUCCESSFUL"].includes(paymentStatus)) {
    return "COMPLETED";
  }
  if (["FAILED", "CANCELLED", "CANCELED", "EXPIRED"].includes(paymentStatus)) {
    return "FAILED";
  }
  if (result === "FAILED" || ["009", "052", "056"].includes(resultcode)) {
    return "FAILED";
  }
  if (["COMPLETED", "SUCCESS", "SUCCESSFUL"].includes(topStatus) && !paymentStatus) {
    return "COMPLETED";
  }

  return "PROCESSING";
}

function extractPaymeFailureMessage(data) {
  if (!data) return "PayMe Africa payment failed";

  const candidates = [
    data.provider_message,
    data.message,
    data.provider_response?.message,
    data.error,
    data.failure_reason,
    data.failureReason
  ];

  for (const candidate of candidates) {
    const text = String(candidate || "").trim();
    if (!text) continue;
    const lower = text.toLowerCase();
    if (["failed", "error", "success", "pending"].includes(lower)) continue;
    return text;
  }

  const code = String(data.resultcode || data.provider_response?.resultcode || "");
  if (code === "052") return "Insufficient wallet balance";
  if (code === "056") return "Payment cancelled by customer";
  if (code === "009") return "Payment failed";

  return "PayMe Africa payment failed";
}

function buildPaymeUpdate(statusData, source) {
  const mapped = normalizePaymeStatus(statusData);
  const amount =
    statusData?.amount != null ? Number(statusData.amount) : undefined;

  let message;
  if (mapped === "COMPLETED") {
    message = "Payment successful via PayMe Africa";
  } else if (mapped === "FAILED") {
    message = extractPaymeFailureMessage(statusData);
  } else {
    message = "Waiting for customer to authorize payment";
  }

  const txId =
    statusData?.transaction_id ||
    statusData?.transid ||
    statusData?.provider_response?.transid ||
    statusData?.provider_response?.reference ||
    null;

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
    amount: Number.isFinite(amount) ? amount : undefined,
    transaction_id: txId || undefined,
    result: statusData?.payment_status || statusData?.result || statusData?.status,
    resultcode: String(
      statusData?.resultcode ||
        statusData?.provider_response?.resultcode ||
        statusData?.payment_status ||
        ""
    ),
    provider_response: statusData
  };
}

function verifyWebhookSignature({ rawBody, signature, timestamp, secret }) {
  if (!secret || !signature || !timestamp) return false;
  const expected = signPayload(rawBody || "", timestamp, secret);
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(String(signature), "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function enrichPaymentForAdmin(payment) {
  const doc = payment?.toObject ? payment.toObject() : { ...payment };
  const response = doc.provider_response || {};
  doc.provider_status = response.payment_status || response.status || doc.result || null;
  doc.provider_transaction_id =
    response.transaction_id || response.transid || doc.transaction_id || doc.order_tracking_id || null;
  doc.provider_failed = doc.status === "FAILED";
  doc.provider_failure = doc.provider_failed
    ? extractPaymeFailureMessage(response) || doc.message
    : null;
  return doc;
}

function formatPaymeError(error) {
  const data = error.response?.data || error.details || {};
  return {
    message:
      data.message ||
      data.error ||
      data.provider_response?.message ||
      error.message ||
      "PayMe Africa request failed",
    code: error.code || error.response?.status || data.code || null,
    details: data
  };
}

module.exports = {
  normalizePhone,
  getAccountSummary,
  createCollection,
  queryTransaction,
  resolvePaymentStatus,
  normalizePaymeStatus,
  extractPaymeFailureMessage,
  buildPaymeUpdate,
  verifyWebhookSignature,
  enrichPaymentForAdmin,
  formatPaymeError,
  signPayload
};
