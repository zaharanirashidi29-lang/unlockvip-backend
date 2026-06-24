require("dotenv").config();

const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const {
  collectPayment,
  resolvePaymentStatus,
  normalizeMalipopayStatusData,
  extractPaymentMeta: extractMalipopayMeta
} = require("./malipopay");
const { getAccessToken } = require("./clickpesa");
const {
  toInternationalPhone,
  detectOperator,
  resolveProvider,
  formatApiError
} = require("./providers");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
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

const POLL_INTERVAL_MS = 8000;
const MAX_POLL_ATTEMPTS = 10;

app.get("/", (req, res) => {
  res.send("UnlockVIP Backend Running (MaliPoPay)");
});

app.get("/health", async (req, res) => {
  const checks = {
    clickpesa_client_id: process.env.CLICKPESA_CLIENT_ID ? "Set" : "Missing",
    clickpesa_api_key: process.env.CLICKPESA_API_KEY ? "Set" : "Missing",
    malipopay_secret_key: process.env.MALIPOPAY_SECRET_KEY ? "Set" : "Missing",
    mongodb_uri: process.env.MONGODB_URI ? "Set" : "Missing",
    routing: "All networks → MaliPoPay",
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
  if (!payment?.order_tracking_id && !payment?.reference) {
    throw new Error("Missing MaliPoPay reference");
  }

  const data = await resolvePaymentStatus(payment, options);
  return { provider: "malipopay", data };
}

function buildProviderUpdate(provider, statusData, source) {
  return buildMalipopayUpdate(statusData, source);
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
    console.error("Final MaliPoPay check failed for", localReference, error.message);
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

function pollPaymentStatus(localReference) {
  let attempts = 0;

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

      if (attempts >= MAX_POLL_ATTEMPTS) {
        await finalizePolling(localReference);
        clearInterval(interval);
        return;
      }

      const { data, update } = await applyStatusFromQuery(existing, "QUERY", {
        bypassCache: true
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
        await finalizePolling(localReference);
        clearInterval(interval);
      }
    }
  }, POLL_INTERVAL_MS);
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
      await Payment.findByIdAndUpdate(existing._id, {
        time: new Date().toLocaleString()
      }).catch(() => {});

      return res.json({
        success: true,
        message: "Already requested",
        reference: existing.reference,
        provider: existing.provider,
        data: existing
      });
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

    if (provider === "malipopay") {
      const push = await collectPayment({
        amount,
        phoneNumber: phone,
        reference,
        description: "UnlockVIP subscription payment"
      });

      const mno = push.customer?.mno || "M-Pesa";
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

      pollPaymentStatus(reference);

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
    }

    throw new Error("Unsupported payment provider");
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

app.post("/webhook", async (req, res) => {
  try {
    const body = req.body || {};
    console.log("WEBHOOK RECEIVED:", JSON.stringify(body, null, 2));

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

    if (payment.status === "COMPLETED") {
      return res.status(200).json({ success: true });
    }

    const eventName = String(event || "").toLowerCase();

    if (isMalipopayWebhook(body)) {
      if (eventName === "payment.completed") {
        const update = buildMalipopayUpdate(
          { ...data, status: data.status || "SUCCESS" },
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
    provider: "malipopay",
    status: { $ne: "COMPLETED" },
    order_tracking_id: { $exists: true, $ne: null }
  })
    .sort({ _id: -1 })
    .limit(3);

  const results = [];
  for (const payment of pending) {
    results.push(await syncMalipopayPayment(payment));
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
