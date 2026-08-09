const axios = require("axios");

function normalizeHttpUrl(raw, fallback = "") {
  let url = String(raw ?? "").trim();
  // Strip accidental wrapping quotes from env dashboards
  if (
    (url.startsWith('"') && url.endsWith('"')) ||
    (url.startsWith("'") && url.endsWith("'"))
  ) {
    url = url.slice(1, -1).trim();
  }
  if (!url) return fallback;
  // Common env typo: ttps:// instead of https://
  if (/^ttps:\/\//i.test(url)) url = `h${url}`;
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  return url;
}

function normalizeBaseUrl(raw) {
  return normalizeHttpUrl(raw, "https://wenac.space").replace(/\/$/, "");
}

const BASE_URL = normalizeBaseUrl(process.env.WENACY_API_BASE_URL);

function getApiKey() {
  const key = process.env.WENACY_API_KEY;
  if (!key) {
    throw new Error("WENACY_API_KEY is required");
  }
  return key;
}

function authHeaders() {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    "x-api-key": getApiKey()
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

async function createCharge({
  amount,
  phone,
  reference,
  callbackUrl,
  description = "UnlockVIP subscription payment"
}) {
  const safeCallback = normalizeHttpUrl(callbackUrl);
  const response = await axios.post(
    `${BASE_URL}/api/public/v1/charge`,
    {
      amount: Number(amount),
      phone: normalizePhone(phone),
      reference,
      description,
      ...(safeCallback ? { callback_url: safeCallback } : {})
    },
    { headers: authHeaders(), timeout: 45000 }
  );
  return response.data;
}

async function getStatus(reference) {
  const response = await axios.get(`${BASE_URL}/api/public/v1/status`, {
    headers: authHeaders(),
    params: { reference },
    timeout: 30000
  });
  return response.data;
}

async function resolvePaymentStatus(payment) {
  const reference = payment?.reference;
  if (!reference) {
    const err = new Error("Missing Wenacy payment reference");
    err.code = "NOT_FOUND";
    throw err;
  }

  const data = await getStatus(reference);
  if (!data?.success && !data?.status && !data?.reference) {
    const err = new Error(data?.message || data?.error || "Wenacy transaction not found");
    err.code = "NOT_FOUND";
    throw err;
  }
  return data;
}

function wenacyAmountTzs(data) {
  if (data?.amount != null) return Number(data.amount);
  return undefined;
}

function normalizeWenacyStatus(status) {
  const value = String(status || "").toLowerCase();
  if (value === "success" || value === "successful" || value === "completed" || value === "paid") {
    return "COMPLETED";
  }
  if (value === "failed" || value === "fail" || value === "cancelled" || value === "canceled") {
    return "FAILED";
  }
  return "PROCESSING";
}

function extractWenacyFailureMessage(data) {
  if (!data) return "Wenacy payment failed";

  const candidates = [
    data.failure_reason,
    data.failure_message,
    data.error_message,
    data.error,
    data.message,
    data.description,
    data.reason,
    data.provider
  ];

  for (const candidate of candidates) {
    const text = String(candidate || "").trim();
    if (!text) continue;
    const lower = text.toLowerCase();
    if (["failed", "error", "success", "pending"].includes(lower)) continue;
    return text;
  }

  if (String(data.status || "").toLowerCase() === "failed") {
    return "Wenacy payment failed";
  }

  return "Wenacy payment failed";
}

function isWenacyFailed(data) {
  return normalizeWenacyStatus(data?.status) === "FAILED";
}

function buildWenacyUpdate(statusData, source) {
  const mapped = normalizeWenacyStatus(statusData?.status);
  const amount = wenacyAmountTzs(statusData);
  const txId =
    statusData?.transaction_id ||
    statusData?.provider_reference ||
    statusData?.order_id ||
    undefined;

  let message;
  if (mapped === "COMPLETED") {
    message = "Payment successful via Wenacy";
  } else if (mapped === "FAILED") {
    message = extractWenacyFailureMessage(statusData);
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
    result: statusData?.status,
    resultcode: statusData?.status,
    provider_response: statusData
  };
}

function enrichPaymentForAdmin(payment) {
  const doc = payment?.toObject ? payment.toObject() : { ...payment };
  const response = doc.provider_response || {};

  doc.wenacy_status = response.status || doc.result || null;
  doc.wenacy_transaction_id =
    response.transaction_id ||
    response.provider_reference ||
    doc.transaction_id ||
    doc.order_tracking_id ||
    null;

  const failed =
    doc.status === "FAILED" ||
    isWenacyFailed(response) ||
    doc.reason === "WEBHOOK_FAILED" ||
    doc.reason === "PAYMENT_FAILED" ||
    doc.reason === "FAILED_BY_QUERY";

  if (failed) {
    doc.wenacy_failed = true;
    doc.wenacy_failure = extractWenacyFailureMessage(response) || doc.message || "Payment failed";
    if (!doc.message || doc.message === "Wenacy failed") {
      doc.message = doc.wenacy_failure;
    }
  } else {
    doc.wenacy_failed = false;
    doc.wenacy_failure = null;
  }

  doc.provider_status = doc.wenacy_status;
  doc.provider_failed = doc.wenacy_failed;
  doc.provider_failure = doc.wenacy_failure;
  doc.provider_transaction_id = doc.wenacy_transaction_id;

  return doc;
}

function formatWenacyError(error) {
  const data = error.response?.data;
  return {
    message: data?.message || data?.error || error.message || "Wenacy request failed",
    error: data?.error || null,
    status: error.response?.status,
    details: data || null
  };
}

module.exports = {
  BASE_URL,
  normalizeHttpUrl,
  normalizeBaseUrl,
  normalizePhone,
  makeReference,
  createCharge,
  getStatus,
  resolvePaymentStatus,
  wenacyAmountTzs,
  normalizeWenacyStatus,
  extractWenacyFailureMessage,
  isWenacyFailed,
  buildWenacyUpdate,
  enrichPaymentForAdmin,
  formatWenacyError
};
