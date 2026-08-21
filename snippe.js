const axios = require("axios");
const crypto = require("crypto");

const BASE_URL = String(process.env.SNIPPE_API_BASE_URL || "https://api.snippe.sh")
  .replace(/\/$/, "");

function getApiKey() {
  const key = process.env.SNIPPE_API_KEY;
  if (!key) {
    throw new Error("SNIPPE_API_KEY is required");
  }
  return key;
}

function authHeaders(idempotencyKey) {
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
    Authorization: `Bearer ${getApiKey()}`
  };
  if (idempotencyKey) {
    headers["Idempotency-Key"] = String(idempotencyKey);
  }
  return headers;
}

function normalizePhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.startsWith("255")) return digits;
  if (digits.startsWith("0")) return `255${digits.slice(1)}`;
  if (digits.length === 9) return `255${digits}`;
  return digits;
}

function formatSnippeError(error) {
  const data = error?.response?.data;
  if (!data) return error?.message || "Snippe request failed";
  return data.message || data.error || error.message || "Snippe request failed";
}

async function createPayment({
  amount,
  phone,
  reference,
  webhookUrl,
  firstname = "Customer",
  lastname = "User",
  email = "customer@unlockvip.local"
}) {
  const idempotencyKey = reference || crypto.randomUUID();
  const response = await axios.post(
    `${BASE_URL}/v1/payments`,
    {
      payment_type: "mobile",
      details: {
        amount: Number(amount),
        currency: "TZS"
      },
      phone_number: normalizePhone(phone),
      customer: {
        firstname,
        lastname,
        email
      },
      webhook_url: webhookUrl,
      metadata: {
        order_id: reference
      }
    },
    {
      headers: authHeaders(idempotencyKey),
      timeout: 45000
    }
  );
  return response.data?.data || response.data;
}

async function getPayment(reference) {
  const response = await axios.get(
    `${BASE_URL}/v1/payments/${encodeURIComponent(reference)}`,
    {
      headers: authHeaders(),
      timeout: 30000
    }
  );
  return response.data?.data || response.data;
}

async function getBalance() {
  const response = await axios.get(`${BASE_URL}/v1/payments/balance`, {
    headers: authHeaders(),
    timeout: 20000
  });
  return response.data?.data || response.data;
}

async function resolvePaymentStatus(payment) {
  const snippeRef =
    payment?.order_tracking_id ||
    payment?.transaction_id ||
    payment?.provider_response?.reference;

  if (!snippeRef) {
    const err = new Error("Missing Snippe payment reference");
    err.code = "NOT_FOUND";
    throw err;
  }

  return getPayment(snippeRef);
}

function snippeAmountTzs(data) {
  if (data?.amount?.value != null) return Number(data.amount.value);
  if (data?.amount != null && typeof data.amount !== "object") {
    return Number(data.amount);
  }
  return undefined;
}

function normalizeSnippeStatus(status) {
  const value = String(status || "").toLowerCase();
  if (["completed", "success", "successful", "paid"].includes(value)) {
    return "COMPLETED";
  }
  if (["failed", "fail", "declined", "cancelled", "canceled", "voided", "expired"].includes(value)) {
    return "FAILED";
  }
  return "PROCESSING";
}

function extractSnippeFailureMessage(data) {
  if (!data) return "Snippe payment failed";
  const candidates = [
    data.failure_reason,
    data.failure_message,
    data.error_message,
    data.error,
    data.message,
    data.reason
  ];
  for (const candidate of candidates) {
    const text = String(candidate || "").trim();
    if (!text) continue;
    const lower = text.toLowerCase();
    if (["failed", "error", "success", "pending"].includes(lower)) continue;
    return text;
  }
  return "Snippe payment failed";
}

function buildSnippeUpdate(statusData, source) {
  const mapped = normalizeSnippeStatus(statusData?.status);
  const amount = snippeAmountTzs(statusData);
  const txId = statusData?.reference || statusData?.external_reference || undefined;

  let message;
  if (mapped === "COMPLETED") {
    message = "Payment successful via Snippe";
  } else if (mapped === "FAILED") {
    message = extractSnippeFailureMessage(statusData);
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
    transaction_id: txId,
    order_tracking_id: txId,
    result: statusData?.status,
    resultcode: statusData?.status,
    provider_response: statusData
  };
}

function verifyWebhookSignature({ rawBody, signature, timestamp, secret }) {
  if (!secret) return true;
  if (!signature || !timestamp) return false;

  const eventTime = Number(timestamp);
  if (Number.isFinite(eventTime)) {
    const age = Math.floor(Date.now() / 1000) - eventTime;
    if (age > 300 || age < -60) return false;
  }

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");

  try {
    return crypto.timingSafeEqual(
      Buffer.from(String(signature)),
      Buffer.from(expected)
    );
  } catch (_) {
    return false;
  }
}

function enrichPaymentForAdmin(payment) {
  const doc = payment?.toObject ? payment.toObject() : { ...payment };
  const response = doc.provider_response || {};
  doc.snippe_status = response.status || doc.result || null;
  doc.snippe_reference =
    response.reference || doc.order_tracking_id || doc.transaction_id || null;
  return doc;
}

module.exports = {
  createPayment,
  getPayment,
  getBalance,
  resolvePaymentStatus,
  buildSnippeUpdate,
  extractSnippeFailureMessage,
  verifyWebhookSignature,
  enrichPaymentForAdmin,
  formatSnippeError,
  normalizePhone
};
