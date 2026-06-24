const axios = require("axios");

const BASE_URL =
  process.env.MALIPOPAY_ENV === "uat"
    ? "https://core-uat.malipopay.co.tz"
    : "https://core-prod.malipopay.co.tz";

function apiHeaders() {
  const token = process.env.MALIPOPAY_API_TOKEN || process.env.MALIPOPAY_SECRET_KEY;

  if (!token) {
    throw new Error("MALIPOPAY_SECRET_KEY is required");
  }

  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
    apiToken: token
  };

  if (process.env.MALIPOPAY_KEY_ID) {
    headers["x-key-id"] = process.env.MALIPOPAY_KEY_ID;
  }

  return headers;
}

let apiCooldownUntil = 0;
let lastApiCallAt = 0;
const MIN_API_GAP_MS = 3000;
const verifyCache = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForApiSlot() {
  if (Date.now() < apiCooldownUntil) {
    const err = new Error("Too many payment requests. Please wait a moment and try again.");
    err.code = 429;
    throw err;
  }

  const wait = Math.max(0, MIN_API_GAP_MS - (Date.now() - lastApiCallAt));
  if (wait > 0) {
    await sleep(wait);
  }

  lastApiCallAt = Date.now();
}

function detectOperator(phone) {
  const normalized = toInternationalPhone(phone);
  const prefix3 = normalized.substring(3, 6);

  if (/^(74|75|76|79)/.test(prefix3)) return "M-Pesa (Vodacom)";
  if (/^(66|68|69|78)/.test(prefix3)) return "Airtel Money";
  if (/^(71|65|67)/.test(prefix3)) return "Mixx by YAS (Tigo Pesa)";
  if (/^(61|62|63)/.test(prefix3)) return "Halopesa";
  return `Network (${prefix3 || "unknown"})`;
}

function formatMalipopayError(error) {
  const data = error.response?.data;
  const rawMessage = data?.message || error.message || "MaliPoPay request failed";
  let message = rawMessage;

  if (/payment method not found|not supported/i.test(rawMessage)) {
    message =
      "This mobile network is not enabled on your MaliPoPay merchant account. Ask MaliPoPay to enable collection for this operator.";
  }

  if (error.response?.status === 429 || /too many requests|rate limit/i.test(rawMessage)) {
    message = "Too many payment requests. Please wait a moment and try again.";
  }

  return {
    message,
    code: data?.code || error.response?.status || error.code,
    details: data || null,
    metadata: data?.metadata || data?.details || null
  };
}

function unwrapMalipopayData(body) {
  if (!body || typeof body !== "object") {
    return body;
  }

  if ("success" in body && "data" in body) {
    if (body.data && typeof body.data === "object") {
      return body.data;
    }
    return null;
  }

  return body;
}

function isPaymentRecord(data) {
  return Boolean(
    data &&
      typeof data === "object" &&
      !("success" in data && "message" in data && !data.status) &&
      (data.reference || data.id || data.status || data.amount !== undefined)
  );
}

async function apiRequest(method, path, data) {
  await waitForApiSlot();

  try {
    const { data: body } = await axios({
      method,
      url: `${BASE_URL}${path}`,
      data,
      headers: apiHeaders()
    });

    if (body?.success === false) {
      const err = new Error(body.message || body.details || "MaliPoPay request failed");
      err.code = body.code;
      err.details = body;
      throw err;
    }

    return unwrapMalipopayData(body);
  } catch (error) {
    if (error.response?.status === 429) {
      apiCooldownUntil = Date.now() + 90000;
    }

    if (error.details || !error.response?.data) {
      throw error;
    }

    const formatted = formatMalipopayError(error);
    const err = new Error(formatted.message);
    err.code = formatted.code;
    err.details = formatted.details;
    throw err;
  }
}

function resolvePaymentMethodType(phone) {
  const prefix3 = toInternationalPhone(phone).substring(3, 6);

  if (/^(74|75|76|79)/.test(prefix3)) return "MPESA_TZ_PUSH";
  if (/^(66|68|69|78)/.test(prefix3)) return "AIRTELMONEY_TZ_PUSH";
  if (/^(71|65|67)/.test(prefix3)) return "TIGOPESA_TZ_PUSH";
  if (/^(61|62|63)/.test(prefix3)) return "HALOPESA_TZ_PUSH";

  return null;
}

function needsExplicitPaymentMethod(phone) {
  const prefix3 = toInternationalPhone(phone).substring(3, 6);
  // MaliPoPay collection auto-routing fails for 066 (Airtel). Halotel handled separately.
  return /^66/.test(prefix3);
}

async function createPaymentIntent({ amount, phoneNumber, reference, description, type }) {
  const phone = toInternationalPhone(phoneNumber);
  const pushType = type || resolvePaymentMethodType(phone);

  if (!pushType) {
    const err = new Error(
      `Unsupported Tanzanian number prefix ${phone.substring(3, 6)}. Use a valid Vodacom, Airtel, Tigo, or Halotel number.`
    );
    err.code = "UNSUPPORTED_PREFIX";
    throw err;
  }

  const payload = {
    mode: "CHARGE",
    amount: Number(amount),
    currency: "TZS",
    reference,
    description: description || `UnlockVIP ${reference}`,
    paymentMethodDetails: {
      type: pushType,
      phoneNumber: phone
    }
  };

  return apiRequest("POST", "/api/v1/payment", payload);
}

function isHalotelPhone(phone) {
  const prefix3 = toInternationalPhone(phone).substring(3, 6);
  return /^(61|62|63)/.test(prefix3);
}

async function collectHalotelPayment({ amount, phoneNumber, reference, description }) {
  const phone = toInternationalPhone(phoneNumber);

  return createPaymentIntent({
    amount,
    phoneNumber: phone,
    reference,
    description,
    type: "HALOPESA_TZ_PUSH"
  });
}

async function collectPayment({ amount, phoneNumber, reference, description }) {
  const phone = toInternationalPhone(phoneNumber);

  if (isHalotelPhone(phone)) {
    return collectHalotelPayment({ amount, phoneNumber: phone, reference, description });
  }

  if (needsExplicitPaymentMethod(phone)) {
    return createPaymentIntent({ amount, phoneNumber: phone, reference, description });
  }

  return apiRequest("POST", "/api/v1/payment/collection", {
    amount: Number(amount),
    phoneNumber: phone,
    reference,
    description: description || "UnlockVIP payment"
  });
}

async function verifyPayment(reference, options = {}) {
  const { bypassCache = false } = options;

  if (!bypassCache) {
    const cached = verifyCache.get(reference);
    if (cached && cached.expiry > Date.now()) {
      return cached.data;
    }
  }

  const data = await apiRequest("GET", `/api/v1/payment/verify/${encodeURIComponent(reference)}`);
  const ttl =
    isMalipopayPaymentComplete(data) ? 300000 : 15000;
  verifyCache.set(reference, { data, expiry: Date.now() + ttl });
  return data;
}

async function getPaymentByReference(reference) {
  return apiRequest("GET", `/api/v1/payment/reference/${encodeURIComponent(reference)}`);
}

async function searchPayments({ status, from, to } = {}) {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const query = params.toString();
  return apiRequest("GET", `/api/v1/payment/search${query ? `?${query}` : ""}`);
}

function toInternationalPhone(phone) {
  const normalized = String(phone || "").trim();
  if (normalized.startsWith("0")) {
    return "255" + normalized.substring(1);
  }
  if (normalized.startsWith("+")) {
    return normalized.substring(1);
  }
  return normalized;
}

function isMalipopayPaymentComplete(data) {
  if (!data) return false;

  if (isMalipopaySuccessStatus(data.status)) {
    return true;
  }

  const paidAmount = Number(data.paidAmount || 0);
  const amount = Number(data.amount || 0);
  const providerStatus = String(data.status || "").toUpperCase();

  if (paidAmount > 0 && providerStatus !== "FAILED" && providerStatus !== "CANCELLED") {
    return true;
  }

  return amount > 0 && paidAmount >= amount;
}

function normalizeMalipopayStatusData(statusData) {
  const paidAmount = Number(statusData?.paidAmount || 0);
  const providerStatus = statusData?.status;

  if (isMalipopayPaymentComplete(statusData)) {
    return {
      ...statusData,
      status: isMalipopaySuccessStatus(providerStatus) ? providerStatus : "SUCCESS"
    };
  }

  return statusData;
}

async function lookupPaymentStatus(reference, options = {}) {
  return verifyPayment(reference, options);
}

async function searchPaymentByReferences(refs) {
  for (const ref of refs) {
    try {
      const results = await searchPayments({ query: ref });
      const list = Array.isArray(results) ? results : [];

      const hit = list.find((item) => {
        const itemRef = String(item?.reference || "");
        const itemId = String(item?.id || "");
        return refs.some((wanted) => wanted === itemRef || wanted === itemId);
      });

      if (hit) {
        return hit;
      }
    } catch (error) {
      // Try the next lookup strategy.
    }
  }

  return null;
}

async function resolvePaymentStatus(payment, options = {}) {
  const refs = [...new Set([payment.order_tracking_id, payment.reference].filter(Boolean))];
  let lastData = null;
  let lastError = null;

  for (const ref of refs) {
    try {
      const data = await verifyPayment(ref, options);
      if (!isPaymentRecord(data)) {
        continue;
      }
      lastData = data;
      if (isMalipopayPaymentComplete(data)) {
        return data;
      }
    } catch (error) {
      lastError = error;
    }
  }

  for (const ref of refs) {
    try {
      const data = await getPaymentByReference(ref);
      if (!isPaymentRecord(data)) {
        continue;
      }
      lastData = data;
      if (isMalipopayPaymentComplete(data)) {
        return data;
      }
    } catch (error) {
      lastError = error;
    }
  }

  try {
    const searched = await searchPaymentByReferences(refs);
    if (isPaymentRecord(searched)) {
      lastData = searched;
      if (isMalipopayPaymentComplete(searched)) {
        return searched;
      }
    }
  } catch (error) {
    lastError = error;
  }

  if (lastData) {
    return lastData;
  }

  throw lastError || new Error("Missing MaliPoPay reference");
}

function isMalipopaySuccessStatus(status) {
  const value = String(status || "").toUpperCase();
  return [
    "SUCCESS",
    "SUCCESSFUL",
    "SUCCEEDED",
    "COMPLETED",
    "SETTLED",
    "PAID",
    "APPROVED",
    "CONFIRMED"
  ].includes(value);
}

function mapMalipopayStatus(status) {
  const value = String(status || "").toUpperCase();
  if (isMalipopaySuccessStatus(status)) return "COMPLETED";
  if (value === "FAILED" || value === "CANCELLED" || value === "REVERSED") {
    return "FAILED";
  }
  return "PROCESSING";
}

function extractPaymentMeta({ status, message, event, source = "QUERY" }) {
  const rawStatus = String(status || "").toUpperCase();
  const mappedStatus = mapMalipopayStatus(status);
  const text = String(message || "").toLowerCase();

  if (isMalipopaySuccessStatus(status)) {
    return {
      status: "COMPLETED",
      reason: source === "WEBHOOK" ? "WEBHOOK_CONFIRMED" : "CONFIRMED_BY_QUERY",
      message: message || "Payment successful"
    };
  }

  if (rawStatus === "CANCELLED" || text.includes("cancel")) {
    return {
      status: "FAILED",
      reason: "CANCELLED",
      message: message || "Payment cancelled by user"
    };
  }

  if (mappedStatus === "FAILED") {
    if (text.includes("insufficient")) {
      return {
        status: "FAILED",
        reason: "INSUFFICIENT_BALANCE",
        message: message || "Insufficient balance"
      };
    }

    if (text.includes("timeout") || text.includes("expired")) {
      return {
        status: "FAILED",
        reason: "EXPIRED",
        message: message || "Payment expired"
      };
    }

    return {
      status: "FAILED",
      reason: source === "WEBHOOK" ? "WEBHOOK_CALLBACK" : "FAILED_BY_QUERY",
      message: message || "Payment failed"
    };
  }

  return {
    status: "PROCESSING",
    reason: source === "PUSH" ? "USSD_SENT" : "WAITING_FOR_USER",
    message: message || "Waiting for customer to authorize payment"
  };
}

module.exports = {
  collectPayment,
  createPaymentIntent,
  resolvePaymentMethodType,
  needsExplicitPaymentMethod,
  isHalotelPhone,
  verifyPayment,
  lookupPaymentStatus,
  resolvePaymentStatus,
  searchPaymentByReferences,
  getPaymentByReference,
  searchPayments,
  toInternationalPhone,
  detectOperator,
  formatMalipopayError,
  mapMalipopayStatus,
  isMalipopaySuccessStatus,
  isMalipopayPaymentComplete,
  normalizeMalipopayStatusData,
  extractPaymentMeta
};
