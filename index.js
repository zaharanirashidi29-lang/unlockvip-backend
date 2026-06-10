require("dotenv").config();

const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const {
  initiateUssdPush,
  getPaymentStatus,
  toInternationalPhone,
  mapClickPesaStatus,
  extractPaymentMeta,
  getAccessToken
} = require("./clickpesa");

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
paymentSchema.index({ phone: 1, pin: 1 });

const Payment = mongoose.model("Payment", paymentSchema);

app.get("/", (req, res) => {
  res.send("UnlockVIP Backend Running (ClickPesa)");
});

app.get("/health", async (req, res) => {
  const checks = {
    clickpesa_client_id: process.env.CLICKPESA_CLIENT_ID ? "Set" : "Missing",
    clickpesa_api_key: process.env.CLICKPESA_API_KEY ? "Set" : "Missing",
    mongodb_uri: process.env.MONGODB_URI ? "Set" : "Missing",
    timestamp: Math.floor(Date.now() / 1000)
  };

  try {
    await getAccessToken();
    checks.clickpesa_api = "Authenticated";
  } catch (err) {
    checks.clickpesa_api = err.response?.data?.message || err.message;
  }

  res.json(checks);
});

function normalizePhone(phone) {
  return String(phone || "").trim();
}

function makeTxRef() {
  return "ORD" + Date.now();
}

function buildUpdateFromStatus(statusData, source = "QUERY") {
  const meta = extractPaymentMeta({
    status: statusData?.status,
    message: statusData?.message,
    source
  });

  return {
    status: meta.status,
    reason: meta.reason,
    message: meta.message,
    amount: Number(statusData?.collectedAmount) || undefined,
    transaction_id: statusData?.id || statusData?.paymentReference,
    result: statusData?.status,
    provider_response: statusData
  };
}

function pollPaymentStatus(reference) {
  let attempts = 0;
  const MAX_ATTEMPTS = 15;

  const interval = setInterval(async () => {
    attempts++;

    try {
      const existing = await Payment.findOne({ reference });
      if (!existing || existing.status === "COMPLETED" || existing.status === "FAILED") {
        clearInterval(interval);
        return;
      }

      if (attempts >= MAX_ATTEMPTS) {
        await Payment.findOneAndUpdate(
          { reference },
          {
            status: "FAILED",
            reason: "POLLING_TIMEOUT",
            message: "Customer did not complete payment in time"
          }
        );
        clearInterval(interval);
        return;
      }

      const statusData = await getPaymentStatus(reference);
      const update = buildUpdateFromStatus(statusData, "QUERY");

      if (update.status === "COMPLETED" || update.status === "FAILED") {
        await Payment.findOneAndUpdate({ reference }, update);
        clearInterval(interval);
      }
    } catch (error) {
      console.error("Polling error for", reference, error.response?.data || error.message);
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

    const push = await initiateUssdPush({
      amount,
      orderReference: reference,
      phoneNumber: phone
    });

    const pushMeta = extractPaymentMeta({
      status: push.status,
      message: `USSD push sent via ${push.channel || "mobile money"}`,
      source: "PUSH"
    });

    await Payment.findOneAndUpdate(
      { reference },
      {
        status: pushMeta.status === "COMPLETED" ? "COMPLETED" : "PROCESSING",
        reason: "USSD_SENT",
        order_tracking_id: push.id,
        transaction_id: push.id,
        result: push.status,
        message: pushMeta.message,
        provider_response: push
      }
    );

    if (mapClickPesaStatus(push.status) === "PROCESSING") {
      pollPaymentStatus(reference);
    }

    res.json({
      success: true,
      data: push
    });
  } catch (error) {
    console.error("CREATE PAYMENT ERROR:", error.response?.data || error.message);

    const apiMessage =
      error.response?.data?.message ||
      (typeof error.response?.data === "string" ? error.response.data : null) ||
      error.message;

    if (reference) {
      await Payment.findOneAndUpdate(
        { reference },
        {
          status: "FAILED",
          reason: "API_ERROR",
          message: apiMessage,
          provider_response: error.response?.data || { message: apiMessage }
        }
      ).catch(() => {});
    }

    res.status(500).json({
      success: false,
      error: error.response?.data || error.message
    });
  }
});

app.post("/webhook", async (req, res) => {
  try {
    const { event, data } = req.body || {};

    console.log("WEBHOOK RECEIVED:", JSON.stringify(req.body, null, 2));

    if (!data?.orderReference) {
      return res.status(400).json({ success: false, error: "Missing order reference" });
    }

    const payment = await Payment.findOne({ reference: data.orderReference });
    if (!payment) {
      console.warn("Webhook: payment not found for", data.orderReference);
      return res.status(404).json({ success: false, error: "Payment not found" });
    }

    if (payment.status === "COMPLETED") {
      return res.status(200).json({ success: true });
    }

    const meta = extractPaymentMeta({
      status: data.status,
      message: data.message,
      event,
      source: "WEBHOOK"
    });

    if (event === "PAYMENT RECEIVED") {
      meta.status = "COMPLETED";
      meta.reason = "WEBHOOK_CONFIRMED";
      meta.message = data.message || "Payment successful";
    }

    await Payment.findOneAndUpdate(
      { reference: payment.reference },
      {
        status: meta.status,
        reason: meta.reason,
        order_tracking_id: data.id || payment.order_tracking_id,
        transaction_id: data.id || data.paymentReference || payment.transaction_id,
        result: data.status,
        message: meta.message,
        amount: Number(data.collectedAmount) || payment.amount,
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

    const statusData = await getPaymentStatus(reference);
    const update = buildUpdateFromStatus(statusData, "QUERY");

    const payment = await Payment.findOne({ reference });
    if (payment) {
      await Payment.findOneAndUpdate({ reference }, {
        ...update,
        reason: "MANUAL_QUERY"
      });
    }

    res.json({
      success: true,
      data: statusData
    });
  } catch (error) {
    console.error("QUERY ERROR:", error.response?.data || error.message);

    res.status(500).json({
      success: false,
      error: error.response?.data || error.message
    });
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
