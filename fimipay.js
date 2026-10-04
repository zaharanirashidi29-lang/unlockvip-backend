const {
  collect,
  getOrder,
  isPaid,
  isFailed,
  isPushOk,
  paidAmount,
  orderIdOf,
  publicError,
  checkoutRequest,
  MERCHANT_NAME
} = require("./paribet/fimipay");

function normalizePhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.startsWith("255")) return digits.slice(0, 12);
  if (digits.startsWith("0") && digits.length === 10) return `255${digits.slice(1)}`;
  if (digits.length === 9) return `255${digits}`;
  return digits;
}

function merchantLabel() {
  return (
    process.env.FIMIPAY_MERCHANT_NAME ||
    process.env.FIMIPAY_MERCHANT_SLUG ||
    "Kopo"
  );
}

async function createCharge({ amount, phone, name, email }) {
  const result = await collect({
    phone: normalizePhone(phone),
    amount: Number(amount),
    name: name || "UnlockVIP customer",
    email
  });

  if (!result.ok) {
    const err = new Error(result.message || "FimiPay charge failed");
    err.details = result.raw || result;
    err.status = result.http;
    throw err;
  }

  return {
    success: true,
    status: result.paid ? "success" : result.result || "pending",
    transaction_id: result.orderId,
    order_id: result.orderId,
    merchant: result.merchant,
    amount: Number(amount),
    message: result.message,
    provider_response: result.raw,
    raw: result
  };
}

async function resolvePaymentStatus(payment) {
  const orderId =
    payment?.order_tracking_id ||
    payment?.transaction_id ||
    payment?.provider_response?.order_id ||
    payment?.provider_response?.orderId;

  if (!orderId) {
    const err = new Error("Missing FimiPay order id");
    err.code = "NOT_FOUND";
    throw err;
  }

  const data = await getOrder(orderId);
  if (!data) {
    const err = new Error("FimiPay transaction not found");
    err.code = "NOT_FOUND";
    throw err;
  }
  return data;
}

function normalizeFimipayStatus(data) {
  if (isPaid(data)) return "COMPLETED";
  if (isFailed(data)) return "FAILED";
  const token = String(data?.result || data?.status || data?.payment_status || "").toLowerCase();
  if (["success", "successful", "completed", "paid"].includes(token)) return "COMPLETED";
  if (["failed", "fail", "cancelled", "canceled", "rejected", "expired"].includes(token)) {
    return "FAILED";
  }
  return "PROCESSING";
}

function extractFimipayFailureMessage(data) {
  if (!data) return "FimiPay payment failed";
  const text = publicError(data, "");
  if (text && !/success|pending|processing/i.test(text)) return text;
  return "FimiPay payment failed";
}

function isFimipayFailed(data) {
  return normalizeFimipayStatus(data) === "FAILED";
}

function buildFimipayUpdate(statusData, source) {
  const mapped = normalizeFimipayStatus(statusData);
  const amount = paidAmount(statusData) || undefined;
  const txId = orderIdOf(statusData) || undefined;

  let message;
  if (mapped === "COMPLETED") {
    message = "Payment successful via FimiPay";
  } else if (mapped === "FAILED") {
    message = extractFimipayFailureMessage(statusData);
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
    amount,
    transaction_id: txId,
    result: statusData?.payment_status || statusData?.result || statusData?.status,
    resultcode: statusData?.payment_status || statusData?.result || statusData?.status,
    provider_response: statusData
  };
}

function enrichPaymentForAdmin(payment) {
  const doc = payment?.toObject ? payment.toObject() : { ...payment };
  const response = doc.provider_response || {};

  doc.fimipay_status = response.payment_status || response.status || doc.result || null;
  doc.fimipay_transaction_id =
    orderIdOf(response) || doc.transaction_id || doc.order_tracking_id || null;
  doc.fimipay_merchant = response.merchant || merchantLabel();

  const failed =
    doc.status === "FAILED" ||
    isFimipayFailed(response) ||
    doc.reason === "WEBHOOK_FAILED" ||
    doc.reason === "PAYMENT_FAILED" ||
    doc.reason === "FAILED_BY_QUERY";

  if (failed) {
    doc.fimipay_failed = true;
    doc.fimipay_failure = extractFimipayFailureMessage(response) || doc.message || "Payment failed";
    if (!doc.message || doc.message === "FimiPay failed") {
      doc.message = doc.fimipay_failure;
    }
  } else {
    doc.fimipay_failed = false;
    doc.fimipay_failure = null;
  }

  doc.provider_status = doc.fimipay_status;
  doc.provider_failed = doc.fimipay_failed;
  doc.provider_failure = doc.fimipay_failure;
  doc.provider_transaction_id = doc.fimipay_transaction_id;

  return doc;
}

function isFimipayWebhook(body) {
  if (!body || typeof body !== "object") return false;
  return Boolean(
    body.order_id ||
      body.orderId ||
      body.payment_status ||
      (body.merchant && String(body.merchant).toLowerCase().includes("kopo"))
  );
}

function formatFimipayError(error) {
  const data = error.response?.data || error.details;
  return {
    message: publicError(data, error.message || "FimiPay request failed"),
    error: data?.error || null,
    status: error.response?.status || error.status,
    details: data || null
  };
}

module.exports = {
  MERCHANT_NAME,
  merchantLabel,
  normalizePhone,
  createCharge,
  checkoutRequest,
  collect,
  getOrder,
  isPaid,
  isFailed,
  isPushOk,
  resolvePaymentStatus,
  normalizeFimipayStatus,
  extractFimipayFailureMessage,
  isFimipayFailed,
  buildFimipayUpdate,
  enrichPaymentForAdmin,
  isFimipayWebhook,
  formatFimipayError
};
