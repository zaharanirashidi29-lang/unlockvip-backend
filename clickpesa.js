const axios = require("axios");

const BASE_URL = "https://api.clickpesa.com/third-parties";

let tokenCache = { token: null, expiry: 0 };

function authHeader(token) {
  return token.startsWith("Bearer ") ? token : `Bearer ${token}`;
}

async function getAccessToken() {
  const now = Date.now();
  if (tokenCache.token && tokenCache.expiry > now) {
    return tokenCache.token;
  }

  const clientId = process.env.CLICKPESA_CLIENT_ID;
  const apiKey = process.env.CLICKPESA_API_KEY;

  if (!clientId || !apiKey) {
    throw new Error("CLICKPESA_CLIENT_ID and CLICKPESA_API_KEY are required");
  }

  const { data } = await axios.post(
    `${BASE_URL}/generate-token`,
    {},
    {
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "client-id": clientId,
        "api-key": apiKey
      }
    }
  );

  if (!data.token) {
    throw new Error(data.message || "Failed to obtain ClickPesa access token");
  }

  tokenCache = {
    token: data.token,
    expiry: now + 55 * 60 * 1000
  };

  return data.token;
}

async function authorizedRequest(config) {
  const token = await getAccessToken();
  return axios({
    ...config,
    baseURL: BASE_URL,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: authHeader(token),
      ...config.headers
    }
  });
}

async function previewUssdPush({ amount, orderReference, phoneNumber, currency = "TZS" }) {
  const { data } = await authorizedRequest({
    method: "POST",
    url: "/payments/preview-ussd-push-request",
    data: {
      amount: String(amount),
      currency,
      orderReference,
      phoneNumber,
      fetchSenderDetails: true
    }
  });

  return data;
}

async function initiateUssdPush({ amount, orderReference, phoneNumber, currency = "TZS" }) {
  const { data } = await authorizedRequest({
    method: "POST",
    url: "/payments/initiate-ussd-push-request",
    data: {
      amount: String(amount),
      currency,
      orderReference,
      phoneNumber
    }
  });

  return data;
}

async function getPaymentStatus(orderReference) {
  const { data } = await authorizedRequest({
    method: "GET",
    url: `/payments/${encodeURIComponent(orderReference)}`
  });

  return Array.isArray(data) ? data[0] : data;
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

function mapClickPesaStatus(status) {
  const value = String(status || "").toUpperCase();
  if (value === "SUCCESS" || value === "SETTLED") return "COMPLETED";
  if (value === "FAILED" || value === "REFUNDED" || value === "REVERSED") {
    return "FAILED";
  }
  return "PROCESSING";
}

function extractPaymentMeta({
  status,
  message,
  event,
  source = "QUERY"
}) {
  const mappedStatus = mapClickPesaStatus(status);
  const text = String(message || "").toLowerCase();

  if (mappedStatus === "COMPLETED") {
    return {
      status: "COMPLETED",
      reason:
        source === "WEBHOOK"
          ? "WEBHOOK_CONFIRMED"
          : source === "PUSH"
            ? "USSD_SENT"
            : "CONFIRMED_BY_QUERY",
      message: message || "Payment successful"
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

    if (text.includes("cancel")) {
      return {
        status: "FAILED",
        reason: "CANCELLED",
        message: message || "Payment cancelled by user"
      };
    }

    if (text.includes("timeout") || text.includes("expired")) {
      return {
        status: "FAILED",
        reason: "EXPIRED",
        message: message || "Payment expired"
      };
    }

    if (event === "PAYMENT FAILED") {
      return {
        status: "FAILED",
        reason: "WEBHOOK_CALLBACK",
        message: message || "Payment failed"
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
    reason: "USSD_SENT",
    message: message || "Waiting for customer to authorize payment"
  };
}

module.exports = {
  getAccessToken,
  previewUssdPush,
  initiateUssdPush,
  getPaymentStatus,
  toInternationalPhone,
  mapClickPesaStatus,
  extractPaymentMeta
};
