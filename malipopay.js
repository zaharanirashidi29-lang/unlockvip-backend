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

async function apiRequest(method, path, data) {
  const { data: body } = await axios({
    method,
    url: `${BASE_URL}${path}`,
    data,
    headers: apiHeaders()
  });

  if (body?.success === false) {
    throw new Error(body.message || body.details || "MaliPoPay request failed");
  }

  return body?.data ?? body;
}

async function collectPayment({ amount, phoneNumber, reference, description }) {
  return apiRequest("POST", "/api/v1/payment/collection", {
    amount: Number(amount),
    phoneNumber,
    reference,
    description: description || "UnlockVIP payment"
  });
}

async function verifyPayment(reference) {
  return apiRequest("GET", `/api/v1/payment/verify/${encodeURIComponent(reference)}`);
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

function mapMalipopayStatus(status) {
  const value = String(status || "").toUpperCase();
  if (value === "SUCCESS" || value === "COMPLETED") return "COMPLETED";
  if (value === "FAILED" || value === "CANCELLED" || value === "REVERSED") {
    return "FAILED";
  }
  return "PROCESSING";
}

function extractPaymentMeta({ status, message, event, source = "QUERY" }) {
  const rawStatus = String(status || "").toUpperCase();
  const mappedStatus = mapMalipopayStatus(status);
  const text = String(message || "").toLowerCase();
  const eventName = String(event || "").toLowerCase();

  if (
    eventName.includes("completed") ||
    eventName === "payment received" ||
    rawStatus === "SUCCESS" ||
    rawStatus === "COMPLETED"
  ) {
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

  if (mappedStatus === "FAILED" || eventName.includes("failed")) {
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
  verifyPayment,
  toInternationalPhone,
  mapMalipopayStatus,
  extractPaymentMeta
};
