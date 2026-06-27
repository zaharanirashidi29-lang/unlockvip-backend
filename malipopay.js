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

  if (process.env.MALIPOPAY_KEY_ID && process.env.MALIPOPAY_USE_KEY_ID === "true") {
    headers["x-key-id"] = process.env.MALIPOPAY_KEY_ID;
  }

  return headers;
}

let queryCooldownUntil = 0;
let lastApiCallAt = 0;
const MIN_API_GAP_MS = 1500;
const QUERY_COOLDOWN_MS = 45000;
const verifyCache = new Map();

function isWriteRequest(method, path) {
  return method === "POST" || method === "PUT" || method === "PATCH";
}

function isQueryCooldownActive() {
  return Date.now() < queryCooldownUntil;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForApiSlot({ isWrite = false } = {}) {
  if (!isWrite && isQueryCooldownActive()) {
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

const TIGO_PREFIXES = new Set(["65", "67", "71", "77"]);
const AIRTEL_PREFIXES = new Set(["66", "68", "69", "78"]);

function getMobilePrefix2(phone) {
  const normalized = toInternationalPhone(phone);
  if (!normalized.startsWith("255") || normalized.length < 5) {
    return "";
  }
  return normalized.substring(3, 5);
}

function isTigoPhone(phone) {
  return TIGO_PREFIXES.has(getMobilePrefix2(phone));
}

function isAirtelPhone(phone) {
  return AIRTEL_PREFIXES.has(getMobilePrefix2(phone));
}

function detectOperator(phone) {
  const prefix2 = getMobilePrefix2(phone);

  if (["74", "75", "76", "79"].includes(prefix2)) return "M-Pesa (Vodacom)";
  if (["66", "68", "69", "78"].includes(prefix2)) return "Airtel Money";
  if (isTigoPhone(phone)) return "Mixx by YAS (Tigo Pesa)";
  if (["61", "62", "63"].includes(prefix2)) return "Halopesa";
  return `Network (${prefix2 || "unknown"})`;
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

  if (/^unlockvip/i.test(message) || message === "UnlockVIP payment") {
    message =
      "Halotel payment prompt could not be sent. The number may not have an active Halopesa wallet or MaliPoPay rejected the push.";
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

async function apiRequest(method, path, data, options = {}) {
  const isWrite = options.isWrite ?? isWriteRequest(method, path);
  await waitForApiSlot({ isWrite });

  try {
    const { data: body } = await axios({
      method,
      url: `${BASE_URL}${path}`,
      data,
      headers: apiHeaders(),
      timeout: options.timeout || 30000
    });

    if (body?.success === false) {
      const err = new Error(body.message || body.details || "MaliPoPay request failed");
      err.code = body.code;
      err.details = body;
      throw err;
    }

    return unwrapMalipopayData(body);
  } catch (error) {
    if (error.response?.status === 429 && !isWrite) {
      queryCooldownUntil = Date.now() + QUERY_COOLDOWN_MS;
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

function resolveDisbursementProvider(phone) {
  const prefix2 = getMobilePrefix2(phone);

  if (["74", "75", "76", "79"].includes(prefix2)) return "Vodacom";
  if (["66", "68", "69", "78"].includes(prefix2)) return "Airtel";
  if (isTigoPhone(phone)) return "Tigo";
  if (["61", "62", "63"].includes(prefix2)) return "Halotel";

  return null;
}

function resolvePaymentMethodType(phone) {
  const prefix2 = getMobilePrefix2(phone);

  if (["74", "75", "76", "79"].includes(prefix2)) return "MPESA_TZ_PUSH";
  if (["66", "68", "69", "78"].includes(prefix2)) return "AIRTELMONEY_TZ_PUSH";
  if (isTigoPhone(phone)) return "TIGOPESA_TZ_PUSH";
  if (["61", "62", "63"].includes(prefix2)) return "HALOPESA_TZ_PUSH";

  return null;
}

function needsExplicitPaymentMethod(phone) {
  // MaliPoPay collection auto-routing fails for 066 (Airtel). Halotel handled separately.
  return getMobilePrefix2(phone) === "66";
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
  return ["61", "62", "63"].includes(getMobilePrefix2(phone));
}

function getPaymentFailureMessage(push, operator = "Halotel") {
  const description = String(push?.description || "");
  const candidates = [
    push?.failureReason,
    push?.failureMessage,
    push?.resultDescription,
    push?.lastError,
    push?.message,
    push?.metadata
  ]
    .map((value) => String(value || "").trim())
    .filter(
      (value) =>
        value &&
        value !== description &&
        !/^unlockvip/i.test(value)
    );

  if (candidates.length) {
    return candidates[0];
  }

  return `${operator} payment prompt could not be sent. Ensure the number has an active Halopesa wallet and can receive USSD pushes.`;
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

async function disburseViaCollectionEndpoint({ amount, phoneNumber, reference, description, provider }) {
  return apiRequest(
    "POST",
    "/api/v1/payment/disbursement",
    {
      reference,
      description: description || `UnlockVIP disbursement ${reference}`,
      amount: Number(amount),
      phoneNumber,
      provider
    },
    { isWrite: true }
  );
}

async function disburseViaPayoutIntent({ amount, phoneNumber, reference, description, pushType }) {
  return apiRequest(
    "POST",
    "/api/v1/payment",
    {
      mode: "PAYOUT",
      amount: Number(amount),
      currency: "TZS",
      reference,
      description: description || `UnlockVIP disbursement ${reference}`,
      paymentMethodDetails: {
        type: pushType,
        phoneNumber
      }
    },
    { isWrite: true }
  );
}

function normalizeDisbursementResult(data, method) {
  const status = String(data?.status || "").toUpperCase();
  const failureReason = data?.failureReason || data?.message;

  if (status === "FAILED" || data?.failure === true) {
    const err = new Error(failureReason || "Disbursement failed");
    err.code = "DISBURSEMENT_FAILED";
    err.details = { method, ...data };
    throw err;
  }

  return { method, ...data };
}

async function approvePayment(reference, approved = true) {
  return apiRequest(
    "POST",
    "/api/v1/payment/approve",
    { reference, approved },
    { isWrite: true }
  );
}

async function confirmPaymentApproval(reference, approved = true) {
  return apiRequest(
    "POST",
    "/api/v1/payment/approve/confirm",
    { reference, approved },
    { isWrite: true }
  );
}

async function disbursePayment({ amount, phoneNumber, reference, description }) {
  const phone = toInternationalPhone(phoneNumber);
  const provider = resolveDisbursementProvider(phone);
  const pushType = resolvePaymentMethodType(phone);

  if (!provider || !pushType) {
    const err = new Error(
      `Unsupported Tanzanian number prefix ${phone.substring(3, 6)}. Use a valid Vodacom, Airtel, Tigo, or Halotel number.`
    );
    err.code = "UNSUPPORTED_PREFIX";
    throw err;
  }

  let data;
  let method = "disbursement";

  try {
    data = await disburseViaCollectionEndpoint({
      amount,
      phoneNumber: phone,
      reference,
      description,
      provider
    });
  } catch (error) {
    const authBlocked =
      error.code === 403 ||
      /authentication token missing|unauthorized/i.test(String(error.message || ""));

    if (!authBlocked) {
      throw error;
    }

    method = "payout_intent";
    data = await disburseViaPayoutIntent({
      amount,
      phoneNumber: phone,
      reference,
      description,
      pushType
    });
  }

  return normalizeDisbursementResult(data, method);
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

  const data = await apiRequest("GET", `/api/v1/payment/verify/${encodeURIComponent(reference)}`, undefined, {
    isWrite: false
  });
  const ttl = isMalipopayPaymentComplete(data) ? 300000 : 20000;
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
  const { lightweight = false } = options;
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
      if (error.code === 429) {
        throw error;
      }
    }
  }

  if (lightweight) {
    if (lastData) {
      return lastData;
    }
    throw lastError || new Error("Missing MaliPoPay reference");
  }

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
  disbursePayment,
  approvePayment,
  confirmPaymentApproval,
  resolveDisbursementProvider,
  createPaymentIntent,
  resolvePaymentMethodType,
  needsExplicitPaymentMethod,
  isHalotelPhone,
  getPaymentFailureMessage,
  verifyPayment,
  lookupPaymentStatus,
  resolvePaymentStatus,
  searchPaymentByReferences,
  getPaymentByReference,
  searchPayments,
  toInternationalPhone,
  getMobilePrefix2,
  isTigoPhone,
  isAirtelPhone,
  detectOperator,
  formatMalipopayError,
  mapMalipopayStatus,
  isMalipopaySuccessStatus,
  isMalipopayPaymentComplete,
  normalizeMalipopayStatusData,
  extractPaymentMeta,
  isQueryCooldownActive
};
