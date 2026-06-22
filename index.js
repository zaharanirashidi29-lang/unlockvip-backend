require("dotenv").config();

const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const {
  initiateStkPush,
  verifyPayment,
  buildVoxopayUpdate
} = require("./voxopay");
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

app.get("/", (req, res) => {
  res.send("UnlockVIP Backend Running (VoxoPay)");
});

app.get("/health", async (req, res) => {
  const checks = {
    voxopay_merchant_id: process.env.VOXOPAY_MERCHANT_ID ? "Set" : "Missing",
    voxopay_api_key: process.env.VOXOPAY_API_KEY ? "Set" : "Missing",
    voxopay_api_secret: process.env.VOXOPAY_API_SECRET ? "Set" : "Missing",
    voxopay_ipn_url: process.env.VOXOPAY_IPN_URL ? "Set" : "Missing",
    mongodb_uri: process.env.MONGODB_URI ? "Set" : "Missing",
    routing: "All networks → VoxoPay",
    timestamp: Math.floor(Date.now() / 1000)
  };

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

function isVoxopayWebhook(body) {
  const status = String(body?.status || "").toLowerCase();
  const data = body?.data;
  return Boolean(data && (data.ref_trx || data.trx_id) && status);
}

function buildPaymentLookup(data) {
  const refs = [
    data?.ref_trx,
    data?.trx_id,
    data?.merchant_reference,
    data?.external_reference
  ].filter(Boolean);

  const lookup = [];
  for (const ref of refs) {
    lookup.push({ reference: ref }, { order_tracking_id: ref });
  }
  return lookup;
}

async function queryProviderStatus(payment) {
  const trxId = payment.order_tracking_id || payment.transaction_id;
  if (!trxId) {
    throw new Error("Missing VoxoPay transaction ID");
  }

  const data = await verifyPayment(trxId);
  return { provider: "voxopay", data };
}

async function applyStatusFromQuery(payment, source) {
  const { provider, data } = await queryProviderStatus(payment);
  const update = buildVoxopayUpdate(data, source);
  return { provider, data, update };
}

async function syncVoxopayPayment(payment) {
  if (!payment?.order_tracking_id && !payment?.transaction_id) {
    return payment;
  }

  try {
    const { update } = await applyStatusFromQuery(payment, "SYNC");
    if (update.status === payment.status && update.reason === payment.reason) {
      return payment;
    }

    return Payment.findOneAndUpdate(
      { reference: payment.reference },
      {
        ...update,
        reason: update.status === "COMPLETED" ? "SYNCED_FROM_VOXOPAY" : update.reason
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
  const MAX_ATTEMPTS = 24;

  const interval = setInterval(async () => {
    attempts++;

    try {
      const existing = await Payment.findOne({ reference: localReference });
      if (!existing || existing.status === "COMPLETED") {
        clearInterval(interval);
        return;
      }

      if (attempts >= MAX_ATTEMPTS) {
        await Payment.findOneAndUpdate(
          { reference: localReference, status: { $ne: "COMPLETED" } },
          {
            reason: "POLLING_STOPPED",
            message: "Awaiting VoxoPay confirmation"
          }
        );
        clearInterval(interval);
        return;
      }

      const { data, update } = await applyStatusFromQuery(existing, "QUERY");
      console.log("Inquiry result for", localReference, ":", data?.status || data);

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
        clearInterval(interval);
      }
    }
  }, 20000);
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

    const push = await initiateStkPush({
      amount,
      phone,
      refTrx: reference,
      description: "UnlockVIP subscription payment"
    });

    await Payment.findOneAndUpdate(
      { reference },
      {
        status: "PROCESSING",
        reason: "USSD_SENT",
        order_tracking_id: push.trx_id,
        transaction_id: push.trx_id,
        result: push.stk_push_initiated ? "PROCESSING" : "UNKNOWN",
        message: `USSD push sent via VoxoPay (${operator})`,
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
        trx_id: push.trx_id,
        stk_push_initiated: push.stk_push_initiated,
        status: push.stk_push_initiated ? "PROCESSING" : "UNKNOWN"
      }
    });
  } catch (error) {
    console.error("CREATE PAYMENT ERROR:", error.details || error.response?.data || error.message);

    const formatted = formatApiError(error, provider || "voxopay");
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

    if (!isVoxopayWebhook(body)) {
      return res.status(400).json({ success: false, error: "Unrecognized webhook format" });
    }

    const data = body.data || {};
    const lookup = buildPaymentLookup(data);

    if (!lookup.length) {
      return res.status(400).json({ success: false, error: "Missing payment reference" });
    }

    const payment = await Payment.findOne({ $or: lookup });

    if (!payment) {
      return res.status(404).json({ success: false, error: "Payment not found" });
    }

    if (payment.status === "COMPLETED") {
      return res.status(200).json({ success: true });
    }

    const webhookStatus = String(body.status || data.status || "").toLowerCase();
    const statusData = {
      ...data,
      status: webhookStatus === "completed" ? "success" : webhookStatus,
      message: body.message || data.message
    };

    const update = buildVoxopayUpdate(statusData, "WEBHOOK");
    const trxId = data.trx_id || payment.order_tracking_id;

    await Payment.findOneAndUpdate(
      { reference: payment.reference },
      {
        ...update,
        order_tracking_id: trxId || payment.order_tracking_id,
        transaction_id: trxId || payment.transaction_id,
        provider_response: body
      }
    );

    console.log(
      "VoxoPay webhook",
      update.status,
      "for",
      payment.reference,
      "(" + webhookStatus + ")"
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

    const { provider, data, update } = await applyStatusFromQuery(payment, "QUERY");

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
      .json(clientError(error, payment?.provider || "voxopay", "Failed to query payment"));
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
    provider: "voxopay",
    status: { $ne: "COMPLETED" },
    order_tracking_id: { $exists: true, $ne: null }
  })
    .sort({ _id: -1 })
    .limit(3);

  const results = [];
  for (const payment of pending) {
    results.push(await syncVoxopayPayment(payment));
  }

  res.json({ success: true, synced: results.length });
});

app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
