const axios = require("axios");
const crypto = require("crypto");

const CHECKOUT_BASE_URL = process.env.BEEM_CHECKOUT_BASE_URL || "https://checkout.beem.africa";

function getCredentials() {
  const apiKey = process.env.BEEM_API_KEY;
  const secretKey = process.env.BEEM_SECRET_KEY;

  if (!apiKey || !secretKey) {
    throw new Error("BEEM_API_KEY and BEEM_SECRET_KEY are required");
  }

  return { apiKey, secretKey };
}

function authHeader() {
  const { apiKey, secretKey } = getCredentials();
  return `Basic ${Buffer.from(`${apiKey}:${secretKey}`).toString("base64")}`;
}

function makeTransactionId() {
  return crypto.randomUUID();
}

function makeReference(prefix = "SAMPLE") {
  return `${prefix}-${Date.now()}`;
}

async function initiateCheckout({
  amount,
  phoneNumber,
  transactionId = makeTransactionId(),
  referenceNumber = makeReference(),
  callbackToken,
  sendSource = true
}) {
  const params = {
    amount: String(amount),
    transaction_id: transactionId,
    reference_number: referenceNumber,
    mobile: String(phoneNumber).replace(/\D/g, ""),
    sendSource: sendSource ? "true" : "false"
  };

  const headers = {
    Accept: "application/json",
    Authorization: authHeader()
  };

  if (callbackToken) {
    headers["beem-secure-token"] = callbackToken;
  }

  const response = await axios.get(`${CHECKOUT_BASE_URL}/v1/checkout`, {
    params,
    headers,
    maxRedirects: 0,
    validateStatus: (status) => status >= 200 && status < 400
  });

  const checkoutUrl =
    response.headers?.location ||
    response.data?.src ||
    response.data?.url ||
    response.data?.checkout_url ||
    response.data?.redirect_url ||
    (typeof response.data === "string" ? response.data : null);

  return {
    transactionId,
    referenceNumber,
    checkoutUrl,
    status: response.status,
    data: response.data
  };
}

function formatBeemError(error) {
  const data = error.response?.data;
  let message = data?.message || error.message || "Beem request failed";

  if (data?.src && String(data.src).includes("/checkout/error")) {
    try {
      const url = new URL(data.src);
      const beemMessage = url.searchParams.get("message");
      if (beemMessage) {
        message = decodeURIComponent(beemMessage.replace(/\+/g, " "));
      }
    } catch (_) {}
  }

  return {
    message,
    status: error.response?.status,
    details: data || null
  };
}

module.exports = {
  initiateCheckout,
  makeTransactionId,
  makeReference,
  formatBeemError
};
