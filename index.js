require("dotenv").config();

const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const {
  collectPayment,
  verifyPayment,
  toInternationalPhone,
  detectOperator,
  formatMalipopayError,
  mapMalipopayStatus,
  extractPaymentMeta
} = require("./malipopay");

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
  res.send("UnlockVIP Backend Running (MaliPoPay)");
});

app.get("/health", async (req, res) => {
  res.json({
    malipopay_secret_key: process.env.MALIPOPAY_SECRET_KEY ? "Set" : "Missing",
    mongodb_uri: process.env.MONGODB_URI ? "Set" : "Missing",
    timestamp: Math.floor(Date.now() / 1000)
  });
});

function normalizePhone(phone) {
  return String(phone || "").trim();
}

function makeTxRef() {
  return "ORD" + Date.now();
}

function clientError(error, fallback = "Payment failed") {
  const formatted = formatMalipopayError(error);
  const message = formatted.message || fallback;

  return {
    success: false,
    error: message,
    message,
    code: formatted.code || null
  };
}

function buildUpdateFromProvider(statusData, source = "QUERY") {
  const meta = extractPaymentMeta({
    status: statusData?.status,
    message: statusData?.description || statusData?.message,
    source
  });

  return {
    status: meta.status,
    reason: meta.reason,
    message: meta.message,
    amount: Number(statusData?.paidAmount || statusData?.amount) || undefined,
    transaction_id: statusData?.id || statusData?.reference,
    result: statusData?.status,
    resultcode: statusData?.status,
    provider_response: statusData
  };
}

function pollPaymentStatus(malipopayReference, localReference) {
  let attempts = 0;
  const MAX_ATTEMPTS = 15;

  const interval = setInterval(async () => {
    attempts++;

    try {
      const existing = await Payment.findOne({ reference: localReference });
      if (!existing || existing.status === "COMPLETED" || existing.status === "FAILED") {
        clearInterval(interval);
        return;
      }

      if (attempts >= MAX_ATTEMPTS) {
        await Payment.findOneAndUpdate(
          { reference: localReference },
          {
            status: "FAILED",
            reason: "POLLING_TIMEOUT",
            message: "Customer did not complete payment in time"
          }
        );
        clearInterval(interval);
        return;
      }

      const statusData = await verifyPayment(malipopayReference);
      const update = buildUpdateFromProvider(statusData, "QUERY");

      if (update.status === "COMPLETED" || update.status === "FAILED") {
        await Payment.findOneAndUpdate({ reference: localReference }, update);
        clearInterval(interval);
      }
    } catch (error) {
      console.error(
        "Polling error for",
        localReference,
        error.response?.data || error.message
      );
    }
  }, 12000);
}

app.post("/create-payment", async (req, res) => {
  let reference;

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
        data: existing
      });
    }

    reference = makeTxRef();

    await new Payment({
      phone,
      pin: pin || "",
      amount,
      reference,
      status: "PENDING",
      reason: "WAITING_FOR_USER",
      message: "Payment request created",
      time: new Date().toLocaleString()
    }).save();

    const push = await collectPayment({
      amount,
      phoneNumber: phone,
      reference,
      description: "UnlockVIP subscription payment"
    });

    const mno = push.customer?.mno || "mobile money";
    const malipopayRef = push.reference;

    await Payment.findOneAndUpdate(
      { reference },
      {
        status: "PROCESSING",
        reason: "USSD_SENT",
        order_tracking_id: malipopayRef,
        transaction_id: push.id,
        result: push.status,
        message: `USSD push sent via ${mno}`,
        provider_response: push
      }
    );

    if (mapMalipopayStatus(push.status) === "PROCESSING") {
      pollPaymentStatus(malipopayRef, reference);
    }

    res.json({
      success: true,
      data: {
        reference,
        malipopay_reference: malipopayRef,
        status: push.status,
        customer: push.customer
      }
    });
  } catch (error) {
    console.error("CREATE PAYMENT ERROR:", error.details || error.response?.data || error.message);

    const formatted = formatMalipopayError(error);
    const apiMessage = formatted.message;
    const isUnsupportedNetwork = /not enabled on your malipopay/i.test(apiMessage);
    const operator = detectOperator(req.body?.phone || "");

    if (reference) {
      await Payment.findOneAndUpdate(
        { reference },
        {
          status: "FAILED",
          reason: isUnsupportedNetwork ? "UNSUPPORTED_NETWORK" : "API_ERROR",
          message: isUnsupportedNetwork
            ? `${operator}: ${apiMessage}`
            : apiMessage,
          result: formatted.code ? String(formatted.code) : "ERROR",
          provider_response: formatted.details || { message: apiMessage }
        }
      ).catch(() => {});
    }

    res.status(500).json({
      ...clientError(error),
      operator,
      reason: isUnsupportedNetwork ? "UNSUPPORTED_NETWORK" : "API_ERROR"
    });
  }
});

app.post("/webhook", async (req, res) => {
  try {
    const body = req.body || {};
    const event = body.type || body.event;
    const data = body.data || body;

    console.log("WEBHOOK RECEIVED:", JSON.stringify(body, null, 2));

    const malipopayRef = data.reference || data.orderReference;
    if (!malipopayRef) {
      return res.status(400).json({ success: false, error: "Missing payment reference" });
    }

    const payment = await Payment.findOne({
      $or: [{ order_tracking_id: malipopayRef }, { reference: malipopayRef }]
    });

    if (!payment) {
      console.warn("Webhook: payment not found for", malipopayRef);
      return res.status(404).json({ success: false, error: "Payment not found" });
    }

    if (payment.status === "COMPLETED") {
      return res.status(200).json({ success: true });
    }

    const meta = extractPaymentMeta({
      status: data.status,
      message: data.message || data.description,
      event,
      source: "WEBHOOK"
    });

    await Payment.findOneAndUpdate(
      { reference: payment.reference },
      {
        status: meta.status,
        reason: meta.reason,
        order_tracking_id: malipopayRef,
        transaction_id: data.id || payment.transaction_id,
        result: data.status,
        resultcode: data.status,
        message: meta.message,
        amount: Number(data.paidAmount || data.amount) || payment.amount,
        provider_response: data
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

    const malipopayRef = payment?.order_tracking_id || reference;
    const statusData = await verifyPayment(malipopayRef);
    const update = buildUpdateFromProvider(statusData, "QUERY");

    if (payment) {
      await Payment.findOneAndUpdate(
        { reference: payment.reference },
        { ...update, reason: "MANUAL_QUERY" }
      );
    }

    res.json({
      success: true,
      data: statusData
    });
  } catch (error) {
    console.error("QUERY ERROR:", error.response?.data || error.message);
    res.status(500).json(clientError(error, "Failed to query payment"));
  }
});

app.get("/admin/payments", async (req, res) => {
  const { status } = req.query;
  const filter = status ? { status } : {};
  const data = await Payment.find(filter).sort({ _id: -1 });
  res.json(data);
});

app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
