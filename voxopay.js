const axios = require("axios");
const crypto = require("crypto");

const BASE_URL = process.env.VOXOPAY_BASE_URL || "https://voxopay.com";

function getConfig() {
  const merchantKey = process.env.VOXOPAY_MERCHANT_ID;
  const apiKey = process.env.VOXOPAY_API_KEY;
  const apiSecret = process.env.VOXOPAY_API_SECRET;
  const environment = process.env.VOXOPAY_ENV || "production";

  if (!merchantKey || !apiKey || !apiSecret) {
    throw new Error("VOXOPAY_MERCHANT_ID, VOXOPAY_API_KEY, and VOXOPAY_API_SECRET are required");
  }

  return { merchantKey, apiKey, apiSecret, environment };
}

function signRequest({ method, path, body, apiSecret }) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const rawBody = body ? JSON.stringify(body) : "";
  const payload = `${timestamp}.${method.toUpperCase()}.${path}.${rawBody}`;
  const signature = crypto.createHmac("sha256", apiSecret).update(payload).digest("hex");

  return {
    timestamp,
    signature: `sha256=${signature}`
  };
}

function authHeaders({ method, path, body }) {
  const { merchantKey, apiKey, apiSecret, environment } = getConfig();
  const { timestamp, signature } = signRequest({ method, path, body, apiSecret });

  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    "X-Environment": environment,
    "X-Merchant-Key": merchantKey,
    "X-API-Key": apiKey,
    "X-Timestamp": timestamp,
    "X-Signature": signature
  };
}

async function apiRequest(method, path, body) {
  const rawBody = body ? JSON.stringify(body) : "";
  const headers = authHeaders({ method, path, body });
  const { data, status } = await axios({
    method,
    url: `${BASE_URL}${path}`,
    data: rawBody || undefined,
    headers,
    validateStatus: () => true
  });

  if (status >= 400 || data?.status === "error" || data?.error) {
    const err = new Error(data?.message || data?.error || `VoxoPay request failed (${status})`);
    err.code = data?.code || status;
    err.details = data;
    throw err;
  }

  return data;
}

function toVoxopayPhone(phone) {
  const normalized = String(phone || "").trim();
  if (normalized.startsWith("255")) return normalized;
  if (normalized.startsWith("0")) return "255" + normalized.substring(1);
  if (normalized.startsWith("+")) return normalized.substring(1);
  return normalized;
}

async function initiateStkPush({
  amount,
  phone,
  refTrx,
  description,
  customerName,
  customerEmail,
  ipnUrl,
  successRedirect,
  cancelRedirect
}) {
  const payload = {
    payment_amount: Number(amount),
    currency_code: "TZS",
    ref_trx: refTrx,
    description: description || "UnlockVIP payment",
    success_redirect: successRedirect || process.env.VOXOPAY_SUCCESS_URL,
    cancel_redirect: cancelRedirect || process.env.VOXOPAY_CANCEL_URL,
    ipn_url: ipnUrl || process.env.VOXOPAY_IPN_URL || process.env.CALLBACK_URL,
    phone: toVoxopayPhone(phone),
    tz: "TZ"
  };

  if (customerName) payload.customer_name = customerName;
  if (customerEmail) payload.customer_email = customerEmail;

  return apiRequest("POST", "/api/v1/initiate-payment", payload);
}

async function verifyPayment(trxId) {
  return apiRequest("GET", `/api/v1/verify-payment/${encodeURIComponent(trxId)}`);
}

function mapVoxopayStatus(status) {
  const value = String(status || "").toLowerCase();
  if (value === "success" || value === "completed") return "COMPLETED";
  if (value === "failed") return "FAILED";
  return "PROCESSING";
}

function extractPaymentMeta({ status, message, source = "QUERY" }) {
  const mapped = mapVoxopayStatus(status);

  if (mapped === "COMPLETED") {
    return {
      status: "COMPLETED",
      reason: source === "WEBHOOK" ? "WEBHOOK_CONFIRMED" : "CONFIRMED_BY_QUERY",
      message: message || "Payment successful"
    };
  }

  if (mapped === "FAILED") {
    return {
      status: "FAILED",
      reason: source === "WEBHOOK" ? "WEBHOOK_CALLBACK" : "FAILED_BY_QUERY",
      message: message || "Payment failed"
    };
  }

  return {
    status: "PROCESSING",
    reason: "USSD_SENT",
    message: message || "Waiting for customer to authorize payment"
  };
}

function buildVoxopayUpdate(statusData, source) {
  const meta = extractPaymentMeta({
    status: statusData?.status,
    message: statusData?.message,
    source
  });

  return {
    status: meta.status,
    reason: meta.reason,
    message: meta.message,
    amount: Number(statusData?.amount || statusData?.net_amount) || undefined,
    transaction_id: statusData?.trx_id || statusData?.transaction_id,
    result: statusData?.status,
    resultcode: statusData?.status,
    provider_response: statusData
  };
}

function formatVoxopayError(error) {
  const data = error.details || error.response?.data;
  const rawMessage = data?.message || error.message || "VoxoPay request failed";
  let message = rawMessage;

  if (error.response?.status === 429 || /too many requests|rate limit/i.test(rawMessage)) {
    message = "Too many payment requests. Please wait a moment and try again.";
  }

  return {
    message,
    code: data?.code || error.response?.status || error.code,
    details: data || null
  };
}

module.exports = {
  initiateStkPush,
  verifyPayment,
  toVoxopayPhone,
  mapVoxopayStatus,
  extractPaymentMeta,
  buildVoxopayUpdate,
  formatVoxopayError
};
