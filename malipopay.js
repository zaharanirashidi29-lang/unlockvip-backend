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

function detectOperator(phone) {
  const normalized = toInternationalPhone(phone);
  const prefix3 = normalized.substring(3, 6);

  if (/^7[4-9]/.test(prefix3)) return "M-Pesa (Vodacom)";
  if (/^6[89]/.test(prefix3)) return "Airtel Money";
  if (/^(71|65|66|67)/.test(prefix3)) return "Mixx by YAS (Tigo Pesa)";
  if (/^62/.test(prefix3)) return "Halopesa";
  if (/^61/.test(prefix3)) return "Halopesa/EasyPesa";
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

  return {
    message,
    code: data?.code || error.code,
    details: data || null
  };
}

async function apiRequest(method, path, data) {
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

    return body?.data ?? body;
  } catch (error) {
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
  detectOperator,
  formatMalipopayError,
  mapMalipopayStatus,
  extractPaymentMeta
};
