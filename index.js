require("dotenv").config();

const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const {
  collectPayment,
  verifyPayment,
  mapMalipopayStatus,
  extractPaymentMeta: extractMalipopayMeta
} = require("./malipopay");
const {
  initiateUssdPush,
  getPaymentStatus: getClickpesaStatus,
  mapClickPesaStatus,
  extractPaymentMeta: extractClickpesaMeta,
  getAccessToken
} = require("./clickpesa");
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
  res.send("UnlockVIP Backend Running (ClickPesa + MaliPoPay)");
});

app.get("/health", async (req, res) => {
  const checks = {
    clickpesa_client_id: process.env.CLICKPESA_CLIENT_ID ? "Set" : "Missing",
    clickpesa_api_key: process.env.CLICKPESA_API_KEY ? "Set" : "Missing",
    malipopay_secret_key: process.env.MALIPOPAY_SECRET_KEY ? "Set" : "Missing",
    mongodb_uri: process.env.MONGODB_URI ? "Set" : "Missing",
    routing: "Vodacom→MaliPoPay, Airtel/Tigo/Halotel→ClickPesa",
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
    value === "COMPLETED" ||
    value === "SETTLED"
  );
}

function buildMalipopayUpdate(statusData, source) {
  const meta = extractMalipopayMeta({
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

function buildClickpesaUpdate(statusData, source) {
  const meta = extractClickpesaMeta({
    status: statusData?.status,
    message: statusData?.message || statusData?.description,
    source
  });

  return {
    status: meta.status,
    reason: meta.reason,
    message: meta.message,
    amount: Number(statusData?.collectedAmount) || undefined,
    transaction_id: statusData?.id || statusData?.paymentReference,
    result: statusData?.status,
    resultcode: String(statusData?.status_code ?? ""),
    provider_response: statusData
  };
}

async function queryProviderStatus(payment) {
  if (payment.provider === "malipopay") {
    const ref = payment.order_tracking_id || payment.reference;
    return { provider: "malipopay", data: await verifyPayment(ref) };
  }

  return { provider: "clickpesa", data: await getClickpesaStatus(payment.reference) };
}

function buildProviderUpdate(provider, statusData, source) {
  return provider === "malipopay"
    ? buildMalipopayUpdate(statusData, source)
    : buildClickpesaUpdate(statusData, source);
}

async function applyStatusFromQuery(payment, source) {
  const { provider, data } = await queryProviderStatus(payment);
  const update = buildProviderUpdate(provider, data, source);

  if (source === "WEBHOOK" && update.status === "COMPLETED") {
    update.reason = "WEBHOOK_CONFIRMED";
  }

  return { provider, data, update };
}

function pollPaymentStatus(localReference) {
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

      const { data, update } = await applyStatusFromQuery(existing, "QUERY");
      console.log("Inquiry result for", localReference, ":", data?.status || data);

      if (update.status === "COMPLETED") {
        const updated = await Payment.findOneAndUpdate(
          { reference: localReference, status: { $ne: "COMPLETED" } },
          update,
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

      if (mapMalipopayStatus(push.status) === "PROCESSING") {
        pollPaymentStatus(reference);
      }

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

    const push = await initiateUssdPush({
      amount,
      orderReference: reference,
      phoneNumber: phone
    });

    await Payment.findOneAndUpdate(
      { reference },
      {
        status: "PROCESSING",
        reason: "USSD_SENT",
        order_tracking_id: push.id,
        transaction_id: push.id,
        result: push.status,
        message: `USSD push sent via ${push.channel || operator} (ClickPesa)`,
        provider_response: push
      }
    );

    if (mapClickPesaStatus(push.status) === "PROCESSING") {
      pollPaymentStatus(reference);
    }

    res.json({
      success: true,
      provider,
      operator,
      data: push
    });
  } catch (error) {
    console.error("CREATE PAYMENT ERROR:", error.details || error.response?.data || error.message);

    const formatted = formatApiError(error, provider || "clickpesa");
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

    let event;
    let data;
    let payment;

    if (body.event && body.data?.orderReference) {
      event = body.event;
      data = body.data;
      payment = await Payment.findOne({ reference: data.orderReference });
    } else {
      event = body.type || body.event;
      data = body.data || body;
      const malipopayRef = data.reference || data.orderReference;
      if (!malipopayRef) {
        return res.status(400).json({ success: false, error: "Missing payment reference" });
      }
      payment = await Payment.findOne({
        $or: [{ order_tracking_id: malipopayRef }, { reference: malipopayRef }]
      });
    }

    if (!payment) {
      return res.status(404).json({ success: false, error: "Payment not found" });
    }

    if (payment.status === "COMPLETED") {
      return res.status(200).json({ success: true });
    }

    const webhookStatus = data.status || data.payment_status;

    if (isFailureWebhook(event, webhookStatus)) {
      const update = buildProviderUpdate(
        payment.provider,
        data,
        "WEBHOOK"
      );

      await Payment.findOneAndUpdate(
        { reference: payment.reference },
        {
          ...update,
          reason: update.reason || "WEBHOOK_CALLBACK",
          order_tracking_id: data.reference || data.orderReference || payment.order_tracking_id,
          transaction_id: data.id || data.paymentReference || payment.transaction_id,
          provider_response: data
        }
      );

      console.log("Webhook marked FAILED for", payment.reference);
      return res.status(200).json({ success: true });
    }

    if (isSuccessWebhook(event, webhookStatus)) {
      try {
        const { data: queryData, update } = await applyStatusFromQuery(payment, "WEBHOOK");
        const confirmedStatus = (queryData?.status || "").toUpperCase();

        console.log(
          `Webhook verify query for ${payment.reference}: status=${confirmedStatus}`
        );

        if (update.status === "COMPLETED") {
          await Payment.findOneAndUpdate(
            { reference: payment.reference },
            {
              ...update,
              reason: "WEBHOOK_CONFIRMED",
              order_tracking_id: data.id || data.reference || payment.order_tracking_id,
              transaction_id:
                data.id || data.paymentReference || queryData?.id || payment.transaction_id,
              provider_response: queryData
            }
          );
          console.log("Webhook CONFIRMED COMPLETED for", payment.reference);
        } else if (update.status === "FAILED") {
          await Payment.findOneAndUpdate(
            { reference: payment.reference },
            {
              ...update,
              reason: "WEBHOOK_CALLBACK",
              provider_response: queryData
            }
          );
        } else {
          await Payment.findOneAndUpdate(
            { reference: payment.reference },
            {
              status: "PROCESSING",
              reason: "USSD_SENT",
              transaction_id: data.id || payment.transaction_id,
              message: `Push sent but not paid yet (query says ${confirmedStatus || "PROCESSING"})`
            }
          );
          console.log(
            "Webhook: push sent but not paid yet for",
            payment.reference,
            "- staying PROCESSING"
          );
        }
      } catch (queryError) {
        console.error(
          "Webhook verify query failed:",
          queryError.response?.data || queryError.message
        );
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
      .json(clientError(error, payment?.provider || "clickpesa", "Failed to query payment"));
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
