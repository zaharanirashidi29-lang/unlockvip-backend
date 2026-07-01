require("dotenv").config();

const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const {
  collectPayment,
  resolvePaymentStatus,
  normalizeMalipopayStatusData,
  isHalotelPhone,
  getPaymentFailureMessage,
  extractPaymentMeta: extractMalipopayMeta
} = require("./malipopay");
const { getAccessToken } = require("./clickpesa");
const {
  createPaymentOrder,
  getTransactionStatus,
  buildPesapalUpdate,
  isPesapalPaymentComplete,
  getIpnUrl,
  getCallbackUrl
} = require("./pesapal");
const {
  createDeposit,
  resolvePaymentStatus: resolveGreboPaymentStatus,
  buildGreboUpdate,
  isGreboWebhook,
  verifyWebhookSignature
} = require("./grebo");
const {
  toInternationalPhone,
  detectOperator,
  resolveProvider,
  getRoutingLabel,
  formatApiError
} = require("./providers");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());

app.post(
  "/webhook/grebo",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    try {
      const rawBody = req.body?.length ? req.body.toString("utf8") : "";
      const signature = req.headers["x-webhook-signature"];
      const timestamp = req.headers["x-webhook-timestamp"];
      const secret = process.env.GREBO_WEBHOOK_SECRET;

      if (secret) {
        const valid = verifyWebhookSignature({
          rawBody,
          signature,
          timestamp,
          secret
        });
        if (!valid) {
          console.error("GREBO WEBHOOK: invalid signature");
          return res.status(401).json({ success: false, error: "Invalid signature" });
        }
      }

      const body = rawBody ? JSON.parse(rawBody) : {};
      await processGreboWebhook(body);
      return res.status(200).json({ success: true });
    } catch (error) {
      console.error("GREBO WEBHOOK ERROR:", error.message);
      return res.status(500).json({ success: false, error: error.message });
    }
  }
);

app.use(express.json());

mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.log("MongoDB Connected"))
  .catch((err) => console.log("MongoDB Error:", err));

const paymentSchema = new mongoose.Schema({
  phone: String,
  pin: String,
  amount: Number,
  reference: String,
  provider: String,
  order_tracking_id: String,
  status: String,
  reason: String,
  time: String,
  transaction_id: String,
  result: String,
  resultcode: String,
  message: String,
  provider_response: Object
});

paymentSchema.index({ reference: 1 }, { unique: true });
paymentSchema.index({ order_tracking_id: 1 });
paymentSchema.index({ phone: 1, pin: 1 });

const Payment = mongoose.model("Payment", paymentSchema);

const POLL_INTERVAL_MS = 12000;
const MAX_POLL_ATTEMPTS = 10;
const HALOTEL_POLL_INTERVAL_MS = 15000;
const HALOTEL_MAX_POLL_ATTEMPTS = 18;

app.get("/", (req, res) => {
  res.send(`UnlockVIP Backend Running (${getRoutingLabel()})`);
});

app.get("/health", async (req, res) => {
  const checks = {
    clickpesa_client_id: process.env.CLICKPESA_CLIENT_ID ? "Set" : "Missing",
    clickpesa_api_key: process.env.CLICKPESA_API_KEY ? "Set" : "Missing",
    malipopay_secret_key: process.env.MALIPOPAY_SECRET_KEY ? "Set" : "Missing",
    mongodb_uri: process.env.MONGODB_URI ? "Set" : "Missing",
    routing: getRoutingLabel(),
    grebo_api_key: process.env.GREBO_API_KEY ? "Set" : "Missing",
    grebo_webhook_secret: process.env.GREBO_WEBHOOK_SECRET ? "Set" : "Missing",
    pesapal_consumer_key: process.env.PESAPAL_CONSUMER_KEY ? "Set" : "Missing",
    pesapal_ipn_url: getIpnUrl(),
    pesapal_callback_url: getCallbackUrl(),
    timestamp: Math.floor(Date.now() / 1000)
  };

  try {
    await getAccessToken();
    checks.clickpesa_api = "Authenticated";
  } catch (err) {
    checks.clickpesa_api = err.message;
  }

  res.json(checks);
});

function normalizePhone(phone) {
  return String(phone || "").trim();
}

function makeTxRef() {
  return "ORD" + Date.now();
}

function getPublicBaseUrl() {
  return (
    process.env.PUBLIC_BASE_URL ||
    process.env.BACKEND_URL ||
    "https://unlockvip-backend-1.onrender.com"
  ).replace(/\/$/, "");
}

function buildCheckoutUrls(reference) {
  const base = getPublicBaseUrl();
  return {
    checkout_path: `/checkout/${reference}`,
    checkout_url: `${base}/pay/${reference}`,
    pay_path: `/pay/${reference}`,
    pay_url: `${base}/pay/${reference}`
  };
}

function buildPesapalPaymentResponse(payment, order) {
  const checkout = buildCheckoutUrls(payment.reference);
  const pesapalUrl =
    order?.redirectUrl ||
    payment.provider_response?.redirect_url ||
    payment.provider_response?.pesapal_redirect_url;

  return {
    success: true,
    provider: "pesapal",
    operator: detectOperator(payment.phone),
    requires_checkout: true,
    ...checkout,
    data: {
      reference: payment.reference,
      order_tracking_id: order?.orderTrackingId || payment.order_tracking_id,
      status: payment.status || "PROCESSING",
      checkout_url: checkout.checkout_url,
      redirect_url: checkout.checkout_url,
      pesapal_payment_url: pesapalUrl
    }
  };
}

function clientError(error, provider, fallback = "Payment failed") {
  const formatted = formatApiError(error, provider);
  const message = formatted.message || fallback;

  return {
    success: false,
    error: message,
    message,
    code: formatted.code || null,
    provider
  };
}

function isMalipopayWebhook(body) {
  const event = String(body?.event || "").toLowerCase();
  return event.startsWith("payment.") || event.startsWith("disbursement.");
}

function isFailureWebhook(event, status) {
  const eventName = String(event || "").toLowerCase();
  const value = String(status || "").toUpperCase();
  return (
    eventName.includes("failed") ||
    value === "FAILED" ||
    value === "CANCELLED" ||
    value === "REVERSED" ||
    value === "EXPIRED"
  );
}

function isSuccessWebhook(event, status) {
  const eventName = String(event || "").toLowerCase();
  const value = String(status || "").toUpperCase();
  return (
    event === "PAYMENT RECEIVED" ||
    eventName.includes("completed") ||
    value === "SUCCESS" ||
    value === "SUCCESSFUL" ||
    value === "COMPLETED" ||
    value === "SETTLED"
  );
}

function buildMalipopayUpdate(statusData, source) {
  const normalized = normalizeMalipopayStatusData(statusData);
  const meta = extractMalipopayMeta({
    status: normalized.status,
    message: normalized.description || normalized.message || statusData?.description || statusData?.message,
    source
  });

  return {
    status: meta.status,
    reason: meta.reason,
    message: meta.message,
    amount: Number(normalized.paidAmount || normalized.amount || statusData?.paidAmount || statusData?.amount) || undefined,
    transaction_id: normalized.id || normalized.reference || statusData?.id || statusData?.reference,
    result: normalized.status || statusData?.status,
    resultcode: normalized.status || statusData?.status,
    provider_response: normalized
  };
}

async function queryProviderStatus(payment, options = {}) {
  if (payment?.provider === "pesapal") {
    if (!payment?.order_tracking_id) {
      throw new Error("Missing Pesapal order tracking id");
    }

    const data = await getTransactionStatus(payment.order_tracking_id);
    return { provider: "pesapal", data };
  }

  if (payment?.provider === "grebo") {
    const data = await resolveGreboPaymentStatus(payment);
    return { provider: "grebo", data };
  }

  if (!payment?.order_tracking_id && !payment?.reference) {
    throw new Error("Missing MaliPoPay reference");
  }

  const data = await resolvePaymentStatus(payment, options);
  return { provider: "malipopay", data };
}

function buildProviderUpdate(provider, statusData, source) {
  if (provider === "pesapal") {
    return buildPesapalUpdate(statusData, source);
  }
  if (provider === "grebo") {
    return buildGreboUpdate(statusData, source);
  }
  return buildMalipopayUpdate(statusData, source);
}

async function processGreboWebhook(body) {
  const event = String(body?.event || "").toLowerCase();
  const data = body?.data || body;
  const greboRef = data?.id;
  const localReference = data?.reference;

  if (!greboRef && !localReference) {
    throw new Error("Missing Grebo transaction reference");
  }

  const lookup = [];
  if (greboRef) {
    lookup.push({ order_tracking_id: greboRef }, { transaction_id: greboRef });
  }
  if (localReference) {
    lookup.push({ reference: localReference });
  }

  const payment = await Payment.findOne({ $or: lookup });
  if (!payment) {
    console.log("GREBO WEBHOOK: payment not found", localReference || greboRef);
    return;
  }

  if (payment.status === "COMPLETED") {
    return;
  }

  const update = buildGreboUpdate(data, "WEBHOOK");

  if (event === "transaction.failed" || update.status === "FAILED") {
    await Payment.findOneAndUpdate(
      { reference: payment.reference },
      {
        ...update,
        reason: "WEBHOOK_FAILED",
        order_tracking_id: greboRef || payment.order_tracking_id,
        transaction_id: greboRef || payment.transaction_id,
        provider_response: data
      }
    );
    console.log("Grebo webhook FAILED for", payment.reference);
    return;
  }

  if (event === "transaction.completed" || update.status === "COMPLETED") {
    await Payment.findOneAndUpdate(
      { reference: payment.reference },
      {
        ...update,
        reason: "WEBHOOK_CONFIRMED",
        order_tracking_id: greboRef || payment.order_tracking_id,
        transaction_id: greboRef || payment.transaction_id,
        provider_response: data
      }
    );
    console.log("Grebo webhook COMPLETED for", payment.reference);
    return;
  }

  await Payment.findOneAndUpdate(
    { reference: payment.reference },
    {
      ...update,
      order_tracking_id: greboRef || payment.order_tracking_id,
      transaction_id: greboRef || payment.transaction_id,
      provider_response: data
    }
  );
  console.log("Grebo webhook update for", payment.reference, update.status);
}

async function applyStatusFromQuery(payment, source, options = {}) {
  const { provider, data } = await queryProviderStatus(payment, options);
  const update = buildProviderUpdate(provider, data, source);

  if (source === "WEBHOOK" && update.status === "COMPLETED") {
    update.reason = "WEBHOOK_CONFIRMED";
  }

  return { provider, data, update };
}

async function finalizePolling(localReference) {
  const existing = await Payment.findOne({ reference: localReference });
  if (!existing || existing.status === "COMPLETED") {
    return;
  }

  try {
    const { update } = await applyStatusFromQuery(existing, "QUERY", { bypassCache: true });
    if (update.status === "COMPLETED") {
      await Payment.findOneAndUpdate(
        { reference: localReference, status: { $ne: "COMPLETED" } },
        { ...update, reason: "CONFIRMED_BY_QUERY" }
      );
      console.log("Late COMPLETED detected for", localReference);
      return;
    }

    if (update.status === "FAILED") {
      await Payment.findOneAndUpdate({ reference: localReference }, update);
      return;
    }
  } catch (error) {
    console.error("Final status check failed for", localReference, error.message);
  }

  await Payment.findOneAndUpdate(
    { reference: localReference, status: { $nin: ["COMPLETED", "TIMEOUT", "FAILED"] } },
    {
      status: "TIMEOUT",
      reason: "POLLING_TIMEOUT",
      message: "Payment not confirmed in time",
      result: "TIMEOUT",
      resultcode: "TIMEOUT"
    }
  );
  console.log("Marked TIMEOUT for", localReference);
  scheduleLateStatusChecks(localReference);
}

function scheduleLateStatusChecks(localReference) {
  const delays = [5 * 60 * 1000, 15 * 60 * 1000, 30 * 60 * 1000];

  for (const delay of delays) {
    setTimeout(async () => {
      try {
        const payment = await Payment.findOne({ reference: localReference });
        if (!payment || payment.status === "COMPLETED") {
          return;
        }

        const { update } = await applyStatusFromQuery(payment, "SYNC", { bypassCache: true });
        if (update.status !== "COMPLETED") {
          return;
        }

        await Payment.findOneAndUpdate(
          { reference: localReference, status: { $ne: "COMPLETED" } },
          { ...update, reason: "LATE_CONFIRMED_BY_QUERY" }
        );
        console.log("Late COMPLETED detected for", localReference, "after", delay / 60000, "min");
      } catch (error) {
        console.error("Late status check failed for", localReference, error.message);
      }
    }, delay);
  }
}

async function fixStalePollingRecords() {
  const result = await Payment.updateMany(
    {
      status: "PROCESSING",
      reason: { $in: ["POLLING_STOPPED", "POLLING_TIMEOUT"] }
    },
    {
      status: "TIMEOUT",
      reason: "POLLING_TIMEOUT",
      message: "Payment not confirmed in time",
      result: "TIMEOUT",
      resultcode: "TIMEOUT"
    }
  );

  if (result.modifiedCount > 0) {
    console.log("Fixed stale polling records:", result.modifiedCount);
  }
}

async function syncGreboPayment(payment) {
  if (!payment?.order_tracking_id && !payment?.reference) {
    return payment;
  }

  try {
    const { update } = await applyStatusFromQuery(payment, "SYNC", { bypassCache: true });
    if (update.status === payment.status && update.reason === payment.reason) {
      return payment;
    }

    return Payment.findOneAndUpdate(
      { reference: payment.reference },
      {
        ...update,
        reason: update.status === "COMPLETED" ? "SYNCED_FROM_GREBO" : update.reason
      },
      { new: true }
    );
  } catch (error) {
    console.error("Grebo sync error for", payment.reference, error.message);
    return payment;
  }
}

async function syncPesapalPayment(payment) {
  if (!payment?.order_tracking_id && !payment?.reference) {
    return payment;
  }

  try {
    const { update } = await applyStatusFromQuery(payment, "SYNC", { bypassCache: true });
    if (update.status === payment.status && update.reason === payment.reason) {
      return payment;
    }

    return Payment.findOneAndUpdate(
      { reference: payment.reference },
      {
        ...update,
        reason: update.status === "COMPLETED" ? "SYNCED_FROM_PESAPAL" : update.reason
      },
      { new: true }
    );
  } catch (error) {
    console.error("Pesapal sync error for", payment.reference, error.message);
    return payment;
  }
}

async function syncMalipopayPayment(payment) {
  if (!payment?.order_tracking_id && !payment?.reference) {
    return payment;
  }

  try {
    const { update } = await applyStatusFromQuery(payment, "SYNC", { bypassCache: true });
    if (update.status === payment.status && update.reason === payment.reason) {
      return payment;
    }

    return Payment.findOneAndUpdate(
      { reference: payment.reference },
      {
        ...update,
        reason: update.status === "COMPLETED" ? "SYNCED_FROM_MALIPOPAY" : update.reason
      },
      { new: true }
    );
  } catch (error) {
    console.error("Sync error for", payment.reference, error.message);
    return payment;
  }
}

function pollPaymentStatus(localReference, phone) {
  let attempts = 0;
  const halotel = isHalotelPhone(phone);
  const intervalMs = halotel ? HALOTEL_POLL_INTERVAL_MS : POLL_INTERVAL_MS;
  const maxAttempts = halotel ? HALOTEL_MAX_POLL_ATTEMPTS : MAX_POLL_ATTEMPTS;

  const interval = setInterval(async () => {
    attempts++;

    try {
      const existing = await Payment.findOne({ reference: localReference });
      if (
        !existing ||
        existing.status === "COMPLETED" ||
        existing.status === "TIMEOUT" ||
        existing.status === "FAILED"
      ) {
        clearInterval(interval);
        return;
      }

      if (attempts >= maxAttempts) {
        await finalizePolling(localReference);
        clearInterval(interval);
        return;
      }

      const useFreshQuery = attempts % 4 === 0 || attempts >= maxAttempts - 1;
      const { data, update } = await applyStatusFromQuery(existing, "QUERY", {
        bypassCache: useFreshQuery,
        lightweight: true
      });
      console.log("Inquiry result for", localReference, ":", data?.status, "paid:", data?.paidAmount);

      if (update.status === "COMPLETED") {
        const updated = await Payment.findOneAndUpdate(
          { reference: localReference, status: { $ne: "COMPLETED" } },
          { ...update, reason: "CONFIRMED_BY_QUERY" },
          { new: true }
        );
        if (updated) {
          console.log("Status set to COMPLETED via CONFIRMED_BY_QUERY for", localReference);
        }
        clearInterval(interval);
        return;
      }

      if (update.status === "FAILED") {
        await Payment.findOneAndUpdate({ reference: localReference }, update);
        console.log("Status set to FAILED via FAILED_BY_QUERY for", localReference);
        clearInterval(interval);
      }
    } catch (error) {
      const isRateLimited = error.code === 429 || error.response?.status === 429;
      console.error(
        "Polling error for",
        localReference,
        error.response?.data || error.message
      );
      if (isRateLimited) {
        return;
      }
    }
  }, intervalMs);
}

app.post("/create-payment", async (req, res) => {
  let reference;
  let provider;

  try {
    let { phone, pin } = req.body;
    const amount = 3061;

    if (!phone) {
      return res.status(400).json({
        success: false,
        error: "Phone is required"
      });
    }

    phone = toInternationalPhone(normalizePhone(phone));

    if (!phone.startsWith("255") || phone.length !== 12) {
      return res.status(400).json({
        success: false,
        error: "Invalid Tanzanian number"
      });
    }

    provider = resolveProvider(phone);
    const operator = detectOperator(phone);

    const existing = await Payment.findOne({
      phone,
      pin,
      status: { $in: ["PENDING", "PROCESSING", "COMPLETED"] }
    });

    if (existing) {
      if (existing.status === "PROCESSING") {
        await Payment.findByIdAndUpdate(existing._id, {
          time: new Date().toLocaleString()
        }).catch(() => {});

        if (existing.provider === "pesapal") {
          return res.json({
            ...buildPesapalPaymentResponse(existing),
            message: "Payment already in progress"
          });
        }

        return res.json({
          success: true,
          message: "Payment already in progress",
          reference: existing.reference,
          provider: existing.provider,
          data: existing
        });
      }

      if (existing.status === "COMPLETED") {
        return res.json({
          success: true,
          message: "Already paid",
          reference: existing.reference,
          provider: existing.provider,
          data: existing
        });
      }
    }

    reference = makeTxRef();

    await new Payment({
      phone,
      pin: pin || "",
      amount,
      reference,
      provider,
      status: "PENDING",
      reason: "WAITING_FOR_USER",
      message: "Payment request created",
      time: new Date().toLocaleString()
    }).save();

    if (provider === "pesapal") {
      const order = await createPaymentOrder({
        reference,
        phone,
        amount,
        description: "UnlockVIP subscription payment"
      });

      const updated = await Payment.findOneAndUpdate(
        { reference },
        {
          status: "PROCESSING",
          reason: "CHECKOUT_READY",
          order_tracking_id: order.orderTrackingId,
          message: `Pesapal checkout ready for ${operator}`,
          provider_response: {
            redirect_url: order.redirectUrl,
            pesapal_redirect_url: order.redirectUrl,
            order_tracking_id: order.orderTrackingId,
            merchant_reference: order.merchantReference,
            raw: order.raw
          }
        },
        { new: true }
      );

      pollPaymentStatus(reference, phone);

      return res.json(buildPesapalPaymentResponse(updated, order));
    }

    if (provider === "grebo") {
      const callbackUrl = `${getPublicBaseUrl()}/webhook/grebo`;
      const deposit = await createDeposit({
        amount,
        phone,
        reference,
        callbackUrl
      });

      if (deposit?.status !== "success" || !deposit?.data) {
        throw new Error(deposit?.message || deposit?.error || "Grebo deposit failed");
      }

      const greboTx = deposit.data;
      const greboStatus = String(greboTx.status || "").toLowerCase();

      if (greboStatus === "failed") {
        throw new Error("Grebo payment failed to start");
      }

      await Payment.findOneAndUpdate(
        { reference },
        {
          status: "PROCESSING",
          reason: "USSD_SENT",
          order_tracking_id: greboTx.id,
          transaction_id: greboTx.id,
          result: greboTx.status,
          message: `USSD push sent via ${operator} (Grebo)`,
          provider_response: greboTx
        }
      );

      pollPaymentStatus(reference, phone);

      return res.json({
        success: true,
        provider,
        operator,
        data: {
          reference,
          grebo_id: greboTx.id,
          status: greboTx.status,
          method: greboTx.method
        }
      });
    }

    const push = await collectPayment({
      amount,
      phoneNumber: phone,
      reference,
      description: "UnlockVIP subscription payment"
    });

    if (String(push.status || "").toUpperCase() === "FAILED") {
      throw new Error(getPaymentFailureMessage(push, operator));
    }

    const mno = push.customer?.mno || detectOperator(phone);
    const malipopayRef = push.reference;

    await Payment.findOneAndUpdate(
      { reference },
      {
        status: "PROCESSING",
        reason: "USSD_SENT",
        order_tracking_id: malipopayRef,
        transaction_id: push.id,
        result: push.status,
        message: `USSD push sent via ${mno} (MaliPoPay)`,
        provider_response: push
      }
    );

    pollPaymentStatus(reference, phone);

    return res.json({
      success: true,
      provider,
      operator,
      data: {
        reference,
        malipopay_reference: malipopayRef,
        status: push.status,
        customer: push.customer
      }
    });
  } catch (error) {
    console.error("CREATE PAYMENT ERROR:", error.details || error.response?.data || error.message);

    const formatted = formatApiError(error, provider || "malipopay");
    const apiMessage = formatted.message;
    const operator = detectOperator(req.body?.phone || "");

    if (reference) {
      await Payment.findOneAndUpdate(
        { reference },
        {
          status: "FAILED",
          reason: "API_ERROR",
          message: apiMessage,
          result: formatted.code ? String(formatted.code) : "ERROR",
          provider_response: formatted.details || { message: apiMessage }
        }
      ).catch(() => {});
    }

    res.status(500).json({
      ...clientError(error, provider || resolveProvider(req.body?.phone || "")),
      operator,
      reason: "API_ERROR"
    });
  }
});

async function applyPesapalStatusUpdate(payment, orderTrackingId, source) {
  const trackingId = orderTrackingId || payment.order_tracking_id;
  const statusData = await getTransactionStatus(trackingId);
  const update = buildPesapalUpdate(statusData, source);

  await Payment.findOneAndUpdate(
    { reference: payment.reference },
    {
      ...update,
      order_tracking_id: trackingId || payment.order_tracking_id
    }
  );

  return { payment, statusData, update };
}

function buildPesapalIpnAck(res, payment, orderTrackingId) {
  return res.status(200).json({
    orderNotificationType: "IPNCHANGE",
    orderTrackingId: orderTrackingId || payment.order_tracking_id,
    orderMerchantReference: payment.reference,
    status: 200
  });
}

async function handlePesapalIpn(req, res) {
  try {
    const orderTrackingId = req.query.OrderTrackingId || req.body?.OrderTrackingId;
    const merchantReference = req.query.OrderMerchantReference || req.body?.OrderMerchantReference;

    if (!orderTrackingId && !merchantReference) {
      return res.status(400).json({ success: false, error: "Missing Pesapal IPN parameters" });
    }

    const lookup = [];
    if (orderTrackingId) {
      lookup.push({ order_tracking_id: orderTrackingId });
    }
    if (merchantReference) {
      lookup.push({ reference: merchantReference });
    }

    const payment = await Payment.findOne({ $or: lookup });

    if (!payment) {
      return res.status(404).json({ success: false, error: "Payment not found" });
    }

    if (payment.status !== "COMPLETED") {
      const { update } = await applyPesapalStatusUpdate(payment, orderTrackingId, "WEBHOOK");
      console.log("Pesapal IPN", payment.reference, update.status);
    }

    return buildPesapalIpnAck(res, payment, orderTrackingId);
  } catch (error) {
    console.error("PESAPAL IPN ERROR:", error.message);
    return res.status(500).json({
      orderNotificationType: "IPNCHANGE",
      orderTrackingId: req.query?.OrderTrackingId || req.body?.OrderTrackingId || "",
      orderMerchantReference: req.query?.OrderMerchantReference || req.body?.OrderMerchantReference || "",
      status: 500
    });
  }
}

async function handlePesapalCallback(req, res) {
  try {
    const orderTrackingId = req.query.OrderTrackingId;
    const merchantReference = req.query.OrderMerchantReference;

    if (!orderTrackingId && !merchantReference) {
      return res.status(400).send("Missing Pesapal callback parameters");
    }

    const lookup = [];
    if (orderTrackingId) {
      lookup.push({ order_tracking_id: orderTrackingId });
    }
    if (merchantReference) {
      lookup.push({ reference: merchantReference });
    }

    const payment = await Payment.findOne({ $or: lookup });
    if (!payment) {
      return res.status(404).send("Payment not found");
    }

    const { update } = await applyPesapalStatusUpdate(payment, orderTrackingId, "CALLBACK");
    const completed = update.status === "COMPLETED";
    const failed = update.status === "FAILED";
    const title = completed ? "Payment successful" : failed ? "Payment failed" : "Payment processing";
    const message = update.message || title;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0b1020; color: #eef2ff; font-family: system-ui, sans-serif; }
    .card { width: min(92vw, 420px); background: #151b2f; border-radius: 16px; padding: 24px; text-align: center; }
    h1 { margin: 0 0 12px; font-size: 1.4rem; }
    p { margin: 0; line-height: 1.5; color: #c7d2fe; }
    .ref { margin-top: 16px; font-size: 0.9rem; color: #94a3b8; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${title}</h1>
    <p>${message}</p>
    <p class="ref">Reference: ${payment.reference}</p>
  </div>
</body>
</html>`);
  } catch (error) {
    console.error("PESAPAL CALLBACK ERROR:", error.message);
    return res.status(500).send("Payment callback failed");
  }
}

app.get("/webhook/pesapal", handlePesapalIpn);
app.post("/webhook/pesapal", handlePesapalIpn);
app.get("/pesapal/callback", handlePesapalCallback);

app.get("/webhook", async (req, res) => {
  if (req.query.OrderTrackingId || req.query.OrderNotificationType) {
    return handlePesapalIpn(req, res);
  }

  return res.status(200).json({ success: true, message: "Webhook ready" });
});

app.get("/checkout/:reference", async (req, res) => {
  try {
    const payment = await Payment.findOne({ reference: req.params.reference });

    if (!payment || payment.provider !== "pesapal") {
      return res.status(404).send("Payment not found");
    }

    const redirectUrl = payment.provider_response?.redirect_url;
    if (!redirectUrl) {
      return res.status(404).send("Pesapal checkout not available");
    }

    return res.redirect(302, redirectUrl);
  } catch (error) {
    console.error("CHECKOUT ERROR:", error.message);
    return res.status(500).send("Checkout failed");
  }
});

app.get("/pay/:reference", async (req, res) => {
  try {
    const payment = await Payment.findOne({ reference: req.params.reference });

    if (!payment || payment.provider !== "pesapal") {
      return res.status(404).send("Payment not found");
    }

    const pesapalUrl = payment.provider_response?.pesapal_redirect_url || payment.provider_response?.redirect_url;
    if (!pesapalUrl) {
      return res.status(404).send("Pesapal checkout not available");
    }

    const safeUrl = String(pesapalUrl).replace(/"/g, "&quot;");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>UnlockVIP Payment</title>
  <style>
    * { box-sizing: border-box; }
    html, body { margin: 0; height: 100%; background: #0b1020; color: #eef2ff; font-family: system-ui, sans-serif; }
  </style>
</head>
<body>
  <iframe src="${safeUrl}" title="UnlockVIP payment" allow="payment *" style="width:100%;height:100%;border:0;background:#fff"></iframe>
</body>
</html>`);
  } catch (error) {
    console.error("PAY PAGE ERROR:", error.message);
    return res.status(500).send("Payment page failed");
  }
});

app.post("/webhook", async (req, res) => {
  try {
    const body = req.body || {};
    console.log("WEBHOOK RECEIVED:", JSON.stringify(body, null, 2));

    if (isGreboWebhook(body)) {
      await processGreboWebhook(body);
      return res.status(200).json({ success: true });
    }

    const event = body.event || body.type;
    const data = body.data || body;
    const malipopayRef = data.reference || data.orderReference;
    const localReference = data.merchantReference || data.external_reference;

    if (!malipopayRef && !localReference) {
      return res.status(400).json({ success: false, error: "Missing payment reference" });
    }

    const lookup = [];
    if (malipopayRef) {
      lookup.push({ order_tracking_id: malipopayRef }, { reference: malipopayRef });
    }
    if (localReference) {
      lookup.push({ reference: localReference });
    }

    const payment = await Payment.findOne({ $or: lookup });

    if (!payment) {
      return res.status(404).json({ success: false, error: "Payment not found" });
    }

    if (payment.provider === "pesapal") {
      return handlePesapalIpn(
        {
          query: {
            OrderTrackingId: data.order_tracking_id || data.OrderTrackingId || payment.order_tracking_id,
            OrderMerchantReference: localReference || payment.reference
          }
        },
        res
      );
    }

    if (payment.provider === "grebo") {
      await processGreboWebhook(body);
      return res.status(200).json({ success: true });
    }

    if (payment.status === "COMPLETED") {
      return res.status(200).json({ success: true });
    }

    const eventName = String(event || "").toLowerCase();

    if (isMalipopayWebhook(body)) {
      if (eventName === "payment.completed" || Number(data?.paidAmount || 0) > 0) {
        const update = buildMalipopayUpdate(
          {
            ...data,
            status: data.status || (Number(data?.paidAmount || 0) > 0 ? "SUCCESS" : "PROCESSING")
          },
          "WEBHOOK"
        );

        await Payment.findOneAndUpdate(
          { reference: payment.reference },
          {
            ...update,
            reason: "WEBHOOK_CONFIRMED",
            order_tracking_id: malipopayRef || payment.order_tracking_id,
            transaction_id: data.id || payment.transaction_id,
            provider_response: data
          }
        );

        console.log("MaliPoPay webhook COMPLETED for", payment.reference);
        return res.status(200).json({ success: true });
      }

      if (eventName === "payment.failed") {
        const update = buildMalipopayUpdate(
          { ...data, status: data.status || "FAILED" },
          "WEBHOOK"
        );

        await Payment.findOneAndUpdate(
          { reference: payment.reference },
          {
            ...update,
            reason: update.reason || "WEBHOOK_CALLBACK",
            order_tracking_id: malipopayRef || payment.order_tracking_id,
            transaction_id: data.id || payment.transaction_id,
            provider_response: data
          }
        );

        console.log("MaliPoPay webhook FAILED for", payment.reference);
        return res.status(200).json({ success: true });
      }
    }

    const webhookStatus = data.status || data.payment_status;

    if (isFailureWebhook(event, webhookStatus)) {
      const update = buildProviderUpdate(payment.provider, data, "WEBHOOK");

      await Payment.findOneAndUpdate(
        { reference: payment.reference },
        {
          ...update,
          reason: update.reason || "WEBHOOK_CALLBACK",
          order_tracking_id: malipopayRef || payment.order_tracking_id,
          transaction_id: data.id || data.paymentReference || payment.transaction_id,
          provider_response: data
        }
      );

      console.log("Webhook marked FAILED for", payment.reference);
      return res.status(200).json({ success: true });
    }

    if (isSuccessWebhook(event, webhookStatus)) {
      const update = buildMalipopayUpdate(
        { ...data, status: data.status || webhookStatus || "SUCCESS" },
        "WEBHOOK"
      );

      if (update.status === "COMPLETED") {
        await Payment.findOneAndUpdate(
          { reference: payment.reference },
          {
            ...update,
            reason: "WEBHOOK_CONFIRMED",
            order_tracking_id: malipopayRef || payment.order_tracking_id,
            transaction_id: data.id || data.paymentReference || payment.transaction_id,
            provider_response: data
          }
        );
        console.log("Webhook CONFIRMED COMPLETED for", payment.reference);
      } else {
        try {
          const { data: queryData, update: queryUpdate } = await applyStatusFromQuery(
            payment,
            "WEBHOOK"
          );

          if (queryUpdate.status === "COMPLETED") {
            await Payment.findOneAndUpdate(
              { reference: payment.reference },
              {
                ...queryUpdate,
                reason: "WEBHOOK_CONFIRMED",
                provider_response: queryData
              }
            );
          } else {
            await Payment.findOneAndUpdate(
              { reference: payment.reference },
              {
                status: "PROCESSING",
                reason: "USSD_SENT",
                message: `Payment pending (query says ${queryData?.status || "PROCESSING"})`
              }
            );
          }
        } catch (queryError) {
          console.error(
            "Webhook verify query failed:",
            queryError.response?.data || queryError.message
          );
        }
      }

      return res.status(200).json({ success: true });
    }

    await Payment.findOneAndUpdate(
      { reference: payment.reference },
      {
        reason: `WEBHOOK_${String(webhookStatus || event || "UNKNOWN").toUpperCase()}`,
        transaction_id: data.id || payment.transaction_id
      }
    );

    res.status(200).json({ success: true });
  } catch (error) {
    console.error("WEBHOOK ERROR:", error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post("/query-transaction", async (req, res) => {
  try {
    const { reference } = req.body;

    if (!reference) {
      return res.status(400).json({
        success: false,
        error: "reference is required"
      });
    }

    const payment = await Payment.findOne({
      $or: [{ reference }, { order_tracking_id: reference }]
    });

    if (!payment) {
      return res.status(404).json({ success: false, error: "Payment not found" });
    }

    const { provider, data, update } = await applyStatusFromQuery(payment, "QUERY", {
      bypassCache: true
    });

    await Payment.findOneAndUpdate(
      { reference: payment.reference },
      {
        ...update,
        reason: update.status === "COMPLETED" ? "CONFIRMED_BY_QUERY" : "MANUAL_QUERY"
      }
    );

    res.json({ success: true, provider, data, status: update.status, reason: update.reason });
  } catch (error) {
    console.error("QUERY ERROR:", error.response?.data || error.message);
    const payment = await Payment.findOne({ reference: req.body?.reference }).catch(() => null);
    res
      .status(500)
      .json(clientError(error, payment?.provider || "malipopay", "Failed to query payment"));
  }
});

app.get("/admin/payments", async (req, res) => {
  const { status } = req.query;
  const filter = status ? { status } : {};
  const data = await Payment.find(filter).sort({ _id: -1 });
  res.json(data);
});

app.post("/admin/sync-payments", async (req, res) => {
  const pending = await Payment.find({
    provider: { $in: ["grebo", "malipopay", "pesapal"] },
    status: { $in: ["PROCESSING", "TIMEOUT", "PENDING"] },
    order_tracking_id: { $exists: true, $ne: null }
  })
    .sort({ _id: -1 })
    .limit(10);

  const results = [];
  for (const payment of pending) {
    if (payment.provider === "grebo") {
      results.push(await syncGreboPayment(payment));
    } else if (payment.provider === "pesapal") {
      results.push(await syncPesapalPayment(payment));
    } else {
      results.push(await syncMalipopayPayment(payment));
    }
  }

  res.json({ success: true, synced: results.length });
});

app.listen(PORT, async () => {
  try {
    await fixStalePollingRecords();
  } catch (error) {
    console.error("Failed to fix stale polling records:", error.message);
  }

  console.log("Server running on port", PORT);
});
