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
const {
  initiateUssdPush,
  getPaymentStatus: getClickpesaStatus,
  mapClickPesaStatus,
  extractPaymentMeta: extractClickpesaMeta,
  getAccessToken
} = require("./clickpesa");
const {
  createPaymentOrder,
  getTransactionStatus,
  buildPesapalUpdate,
  isPesapalPaymentComplete,
  getCallbackUrl,
  testPesapalAuth
} = require("./pesapal");
const {
  createDeposit,
  resolvePaymentStatus: resolveGreboPaymentStatus,
  buildGreboUpdate,
  isGreboWebhook,
  verifyWebhookSignature: verifyGreboWebhookSignature,
  enrichPaymentForAdmin: enrichGreboPaymentForAdmin,
  extractGreboFailureMessage,
  followUpTransaction,
  warnFollowUpAuthOnce
} = require("./grebo");
const {
  createDeposit: createAblinerDeposit,
  resolvePaymentStatus: resolveAblinerPaymentStatus,
  buildAblinerUpdate,
  isAblinerWebhook,
  verifyWebhookSignature: verifyAblinerWebhookSignature,
  enrichPaymentForAdmin: enrichAblinerPaymentForAdmin,
  extractAblinerFailureMessage
} = require("./abliner");
const {
  createCharge: createWenacyCharge,
  resolvePaymentStatus: resolveWenacyPaymentStatus,
  buildWenacyUpdate,
  enrichPaymentForAdmin: enrichWenacyPaymentForAdmin,
  extractWenacyFailureMessage
} = require("./wenacy");
const {
  createPayment: createSnippePayment,
  resolvePaymentStatus: resolveSnippePaymentStatus,
  buildSnippeUpdate,
  enrichPaymentForAdmin: enrichSnippePaymentForAdmin,
  extractSnippeFailureMessage,
  verifyWebhookSignature: verifySnippeWebhookSignature,
  getBalance: getSnippeBalance
} = require("./snippe");
const {
  createCollection: createPaymeCollection,
  resolvePaymentStatus: resolvePaymePaymentStatus,
  buildPaymeUpdate,
  verifyWebhookSignature: verifyPaymeWebhookSignature,
  enrichPaymentForAdmin: enrichPaymePaymentForAdmin,
  extractPaymeFailureMessage,
  getAccountSummary: getPaymeAccountSummary
} = require("./paymeafrica");
const {
  toInternationalPhone,
  detectOperator,
  resolveProvider,
  getRoutingLabel,
  formatApiError
} = require("./providers");
const { startGreboBalanceTracker } = require("./grebo-balance-tracker");

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
        const valid = verifyGreboWebhookSignature({
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
      await processTeslotyWebhook(body, "grebo");
      return res.status(200).json({ success: true });
    } catch (error) {
      console.error("GREBO WEBHOOK ERROR:", error.message);
      return res.status(500).json({ success: false, error: error.message });
    }
  }
);

app.post(
  "/webhook/abliner",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    try {
      const rawBody = req.body?.length ? req.body.toString("utf8") : "";
      const signature = req.headers["x-webhook-signature"];
      const timestamp = req.headers["x-webhook-timestamp"];
      const secret = process.env.ABLINER_WEBHOOK_SECRET;

      if (secret) {
        const valid = verifyAblinerWebhookSignature({
          rawBody,
          signature,
          timestamp,
          secret
        });
        if (!valid) {
          console.error("ABLINER WEBHOOK: invalid signature");
          return res.status(401).json({ success: false, error: "Invalid signature" });
        }
      }

      const body = rawBody ? JSON.parse(rawBody) : {};
      await processTeslotyWebhook(body, "abliner");
      return res.status(200).json({ success: true });
    } catch (error) {
      console.error("ABLINER WEBHOOK ERROR:", error.message);
      return res.status(500).json({ success: false, error: error.message });
    }
  }
);

app.post("/webhook/wenacy", express.json(), async (req, res) => {
  try {
    await processWenacyWebhook(req.body || {});
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("WENACY WEBHOOK ERROR:", error.message);
    return res.status(500).json({ success: false, error: error.message });
  }
});

app.post(
  "/webhook/snippe",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    try {
      const rawBody = req.body?.length ? req.body.toString("utf8") : "";
      const signature = req.headers["x-webhook-signature"];
      const timestamp = req.headers["x-webhook-timestamp"];
      const secret = process.env.SNIPPE_WEBHOOK_SECRET;

      if (secret) {
        const valid = verifySnippeWebhookSignature({
          rawBody,
          signature,
          timestamp,
          secret
        });
        if (!valid) {
          console.error("SNIPPE WEBHOOK: invalid signature");
          return res.status(401).json({ success: false, error: "Invalid signature" });
        }
      }

      const body = rawBody ? JSON.parse(rawBody) : {};
      await processSnippeWebhook(body, req.headers["x-webhook-event"]);
      return res.status(200).json({ success: true });
    } catch (error) {
      console.error("SNIPPE WEBHOOK ERROR:", error.message);
      return res.status(500).json({ success: false, error: error.message });
    }
  }
);

// Legacy path used by older Snippe docs / clear.js
app.post(
  "/webhooks/snippe",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    try {
      const rawBody = req.body?.length ? req.body.toString("utf8") : "";
      const body = rawBody ? JSON.parse(rawBody) : {};
      await processSnippeWebhook(body, req.headers["x-webhook-event"]);
      return res.status(200).send("Webhook received");
    } catch (error) {
      console.error("SNIPPE WEBHOOK ERROR:", error.message);
      return res.status(500).json({ success: false, error: error.message });
    }
  }
);

app.post(
  "/webhook/paymeafrica",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    try {
      const rawBody = req.body?.length ? req.body.toString("utf8") : "";
      const signature =
        req.headers["x-middleware-signature"] || req.headers["x-signature"];
      const timestamp = req.headers["x-timestamp"];
      const secret = process.env.PAYMEAFRICA_SECRET_KEY;

      if (secret && signature) {
        const valid = verifyPaymeWebhookSignature({
          rawBody,
          signature,
          timestamp,
          secret
        });
        if (!valid) {
          console.error("PAYME AFRICA WEBHOOK: invalid signature");
          return res.status(401).json({ success: false, error: "Invalid signature" });
        }
      }

      const body = rawBody ? JSON.parse(rawBody) : {};
      await processPaymeWebhook(body);
      return res.status(200).json({ success: true });
    } catch (error) {
      console.error("PAYME AFRICA WEBHOOK ERROR:", error.message);
      return res.status(500).json({ success: false, error: error.message });
    }
  }
);

app.use(express.json());

mongoose
  .connect(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 8000,
    socketTimeoutMS: 20000,
    maxPoolSize: 10
  })
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
paymentSchema.index({ phone: 1 });
paymentSchema.index({ status: 1, _id: -1 });

const Payment = mongoose.model("Payment", paymentSchema);

const POLL_INTERVAL_MS = 12000;
const MAX_POLL_ATTEMPTS = 10;
const GREBO_POLL_INTERVAL_MS = Number(process.env.GREBO_POLL_INTERVAL_MS || 10000);
const GREBO_MAX_POLL_ATTEMPTS = Number(process.env.GREBO_MAX_POLL_ATTEMPTS || 36);
const HALOTEL_POLL_INTERVAL_MS = 15000;
const HALOTEL_MAX_POLL_ATTEMPTS = 18;

app.get("/", (req, res) => {
  res.send(`UnlockVIP Backend Running (${getRoutingLabel()})`);
});

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timeout`)), ms)
    )
  ]);
}

app.get("/health", async (req, res) => {
  const checks = {
    clickpesa_client_id: process.env.CLICKPESA_CLIENT_ID ? "Set" : "Missing",
    clickpesa_api_key: process.env.CLICKPESA_API_KEY ? "Set" : "Missing",
    malipopay_secret_key: process.env.MALIPOPAY_SECRET_KEY ? "Set" : "Missing",
    mongodb_uri: process.env.MONGODB_URI ? "Set" : "Missing",
    mongodb:
      mongoose.connection.readyState === 1
        ? "Connected"
        : mongoose.connection.readyState === 2
          ? "Connecting"
          : "Disconnected",
    routing: getRoutingLabel(),
    grebo_api_key: process.env.GREBO_API_KEY ? "Set" : "Missing",
    grebo_webhook_secret: process.env.GREBO_WEBHOOK_SECRET ? "Set" : "Missing",
    grebo_fuatilia_auth:
      process.env.GREBO_DASHBOARD_ACCESS_TOKEN || process.env.GREBO_ACCESS_TOKEN
        ? "Token"
        : process.env.GREBO_DASHBOARD_EMAIL || process.env.GREBO_USER_EMAIL
          ? "Email/Password"
          : "Missing",
    paymeafrica_app_id: process.env.PAYMEAFRICA_APP_ID ? "Set" : "Missing",
    paymeafrica_secret_key: process.env.PAYMEAFRICA_SECRET_KEY ? "Set" : "Missing",
    abliner_api_key: process.env.ABLINER_API_KEY ? "Set" : "Missing",
    abliner_webhook_secret: process.env.ABLINER_WEBHOOK_SECRET ? "Set" : "Missing",
    wenacy_api_key: process.env.WENACY_API_KEY ? "Set" : "Missing",
    snippe_api_key: process.env.SNIPPE_API_KEY ? "Set" : "Missing",
    pesapal_consumer_key: process.env.PESAPAL_CONSUMER_KEY ? "Set" : "Missing",
    pesapal_callback_url: getCallbackUrl(),
    timestamp: Math.floor(Date.now() / 1000)
  };

  if (String(req.query.deep || "") !== "1") {
    return res.json(checks);
  }

  await Promise.allSettled([
    withTimeout(getAccessToken(), 4000, "clickpesa")
      .then(() => {
        checks.clickpesa_api = "Authenticated";
      })
      .catch((err) => {
        checks.clickpesa_api = err.message;
      }),
    withTimeout(testPesapalAuth(), 4000, "pesapal")
      .then((value) => {
        checks.pesapal_api = value;
      })
      .catch((err) => {
        checks.pesapal_api = err.message;
      }),
    withTimeout(
      (async () => {
        const { getBalance, isGreboFollowUpConfigured } = require("./grebo");
        const bal = await getBalance();
        checks.grebo_api = "Authenticated";
        checks.grebo_balance = bal?.data?.balance ?? bal?.balance ?? null;
        checks.grebo_balance_tracker = "enabled";
        checks.grebo_fuatilia = isGreboFollowUpConfigured()
          ? "Configured"
          : "Missing dashboard credentials";
      })(),
      4000,
      "grebo"
    ).catch((err) => {
      checks.grebo_api = err.response?.data?.message || err.message;
      checks.grebo_balance_tracker = "enabled";
    }),
    withTimeout(getPaymeAccountSummary(), 4000, "payme")
      .then((summary) => {
        checks.paymeafrica_api = "Authenticated";
        checks.paymeafrica_balance = summary?.data?.account_balance ?? null;
      })
      .catch((err) => {
        checks.paymeafrica_api = err.response?.data?.message || err.message;
      }),
    withTimeout(
      (async () => {
        const { getBalance: getAblinerBalance } = require("./abliner");
        const bal = await getAblinerBalance();
        checks.abliner_api = "Authenticated";
        checks.abliner_balance = bal?.data?.balance ?? bal?.balance ?? null;
      })(),
      4000,
      "abliner"
    ).catch((err) => {
      checks.abliner_api = err.response?.data?.message || err.message;
    }),
    withTimeout(
      (async () => {
        if (!process.env.WENACY_API_KEY) {
          checks.wenacy_api = "Missing API key";
          return;
        }
        const { getStatus } = require("./wenacy");
        try {
          const probe = await getStatus(`HEALTH${Date.now()}`);
          if (
            probe?.success === false &&
            /unauthor|invalid.*key|api key/i.test(JSON.stringify(probe))
          ) {
            checks.wenacy_api = probe.message || probe.error || "Unauthorized";
          } else {
            checks.wenacy_api = "Authenticated";
          }
        } catch (err) {
          const status = err.response?.status;
          const msg = err.response?.data?.message || err.response?.data?.error || err.message;
          if (status === 401 || status === 403) {
            checks.wenacy_api = msg || "Unauthorized";
          } else if (status === 404 || /not found|hakupatikana|unknown/i.test(String(msg || ""))) {
            checks.wenacy_api = "Authenticated";
          } else {
            checks.wenacy_api = msg;
          }
        }
      })(),
      4000,
      "wenacy"
    ).catch((err) => {
      checks.wenacy_api = err.message;
    }),
    withTimeout(
      (async () => {
        if (!process.env.SNIPPE_API_KEY) {
          checks.snippe_api = "Missing API key";
          return;
        }
        const bal = await getSnippeBalance();
        checks.snippe_api = "Authenticated";
        checks.snippe_balance =
          bal?.available?.value ?? bal?.balance?.value ?? bal?.balance ?? null;
      })(),
      4000,
      "snippe"
    ).catch((err) => {
      checks.snippe_api =
        err.response?.data?.message || err.response?.data?.error || err.message;
    })
  ]);

  res.json(checks);
});

function normalizePhone(phone) {
  return String(phone || "").trim();
}

function makeTxRef() {
  return "ORD" + Date.now();
}

function getPublicBaseUrl() {
  const { normalizeHttpUrl } = require("./wenacy");
  return normalizeHttpUrl(
    process.env.PUBLIC_BASE_URL || process.env.BACKEND_URL,
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
      redirect_url: checkout.checkout_url
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

function buildClickpesaUpdate(statusData, source) {
  const meta = extractClickpesaMeta({
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
    resultcode: String(statusData?.status_code ?? ""),
    provider_response: statusData
  };
}

async function queryProviderStatus(payment, options = {}) {
  if (payment?.provider === "clickpesa") {
    if (!payment?.reference) {
      throw new Error("Missing ClickPesa order reference");
    }

    const data = await getClickpesaStatus(payment.reference);
    return { provider: "clickpesa", data };
  }

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

  if (payment?.provider === "abliner") {
    const data = await resolveAblinerPaymentStatus(payment);
    return { provider: "abliner", data };
  }

  if (payment?.provider === "wenacy") {
    const data = await resolveWenacyPaymentStatus(payment);
    return { provider: "wenacy", data };
  }

  if (payment?.provider === "snippe") {
    const data = await resolveSnippePaymentStatus(payment);
    return { provider: "snippe", data };
  }

  if (payment?.provider === "paymeafrica") {
    const data = await resolvePaymePaymentStatus(payment);
    return { provider: "paymeafrica", data };
  }

  if (!payment?.order_tracking_id && !payment?.reference) {
    throw new Error("Missing MaliPoPay reference");
  }

  const data = await resolvePaymentStatus(payment, options);
  return { provider: "malipopay", data };
}

function buildProviderUpdate(provider, statusData, source) {
  if (provider === "clickpesa") {
    return buildClickpesaUpdate(statusData, source);
  }
  if (provider === "pesapal") {
    return buildPesapalUpdate(statusData, source);
  }
  if (provider === "grebo") {
    return buildGreboUpdate(statusData, source);
  }
  if (provider === "abliner") {
    return buildAblinerUpdate(statusData, source);
  }
  if (provider === "wenacy") {
    return buildWenacyUpdate(statusData, source);
  }
  if (provider === "snippe") {
    return buildSnippeUpdate(statusData, source);
  }
  if (provider === "paymeafrica") {
    return buildPaymeUpdate(statusData, source);
  }
  return buildMalipopayUpdate(statusData, source);
}

async function processWenacyWebhook(body) {
  const localReference = body?.reference;
  const providerTxId = body?.transaction_id || body?.provider_reference;

  if (!localReference && !providerTxId) {
    throw new Error("Missing Wenacy transaction reference");
  }

  const lookup = [];
  if (localReference) lookup.push({ reference: localReference });
  if (providerTxId) {
    lookup.push({ order_tracking_id: providerTxId }, { transaction_id: providerTxId });
  }

  const payment = await Payment.findOne({ $or: lookup, provider: "wenacy" });
  if (!payment) {
    console.warn("Wenacy webhook for unknown payment", localReference || providerTxId);
    return null;
  }

  if (payment.status === "COMPLETED") {
    return payment;
  }

  const update = buildWenacyUpdate(body, "WEBHOOK");
  const updated = await Payment.findOneAndUpdate(
    { _id: payment._id, status: { $ne: "COMPLETED" } },
    {
      ...update,
      order_tracking_id: providerTxId || payment.order_tracking_id,
      transaction_id: providerTxId || payment.transaction_id,
      provider_response: body
    },
    { new: true }
  );

  if (updated?.status === "COMPLETED") {
    console.log("Wenacy webhook COMPLETED for", payment.reference);
  } else if (updated?.status === "FAILED") {
    console.log(
      "Wenacy webhook FAILED for",
      payment.reference,
      extractWenacyFailureMessage(body)
    );
  } else {
    console.log("Wenacy webhook update for", payment.reference, update.status);
  }

  return updated;
}

async function processSnippeWebhook(body, headerEvent) {
  const event = String(headerEvent || body?.type || body?.event || "").toLowerCase();
  const data = body?.data || body || {};
  const snippeRef = data.reference || data.external_reference || data.id;
  const localReference = data.metadata?.order_id || data.merchantReference;

  if (!snippeRef && !localReference) {
    throw new Error("Missing Snippe payment reference");
  }

  const lookup = [];
  if (localReference) lookup.push({ reference: localReference });
  if (snippeRef) {
    lookup.push({ order_tracking_id: snippeRef }, { transaction_id: snippeRef });
  }

  const payment = await Payment.findOne({ $or: lookup, provider: "snippe" });
  if (!payment) {
    console.warn("Snippe webhook for unknown payment", localReference || snippeRef);
    return null;
  }

  if (payment.status === "COMPLETED") {
    return payment;
  }

  let statusOverride = data.status;
  if (event === "payment.completed") statusOverride = "completed";
  if (
    event === "payment.failed" ||
    event === "payment.voided" ||
    event === "payment.expired"
  ) {
    statusOverride = "failed";
  }

  const update = buildSnippeUpdate({ ...data, status: statusOverride }, "WEBHOOK");
  const updated = await Payment.findOneAndUpdate(
    { _id: payment._id, status: { $ne: "COMPLETED" } },
    {
      ...update,
      order_tracking_id: snippeRef || payment.order_tracking_id,
      transaction_id: snippeRef || payment.transaction_id,
      provider_response: data
    },
    { new: true }
  );

  if (updated?.status === "COMPLETED") {
    console.log("Snippe webhook COMPLETED for", payment.reference);
  } else if (updated?.status === "FAILED") {
    console.log(
      "Snippe webhook FAILED for",
      payment.reference,
      extractSnippeFailureMessage(data)
    );
  } else {
    console.log("Snippe webhook update for", payment.reference, update.status);
  }

  return updated;
}

async function processPaymeWebhook(body) {
  const localReference = body?.reference || body?.order_id || body?.merchant_reference;
  const providerTxId = body?.transid || body?.transaction_id || body?.trans_id;

  if (!localReference && !providerTxId) {
    throw new Error("Missing PayMe Africa transaction reference");
  }

  const lookup = [];
  if (localReference) lookup.push({ reference: localReference });
  if (providerTxId) {
    lookup.push({ order_tracking_id: providerTxId }, { transaction_id: providerTxId });
  }

  const payment = await Payment.findOne({
    $or: lookup,
    provider: "paymeafrica"
  });

  if (!payment) {
    console.warn("PayMe Africa webhook for unknown payment", localReference || providerTxId);
    return null;
  }

  const update = buildPaymeUpdate(body, "WEBHOOK");
  const updated = await Payment.findOneAndUpdate(
    { _id: payment._id, status: { $ne: "COMPLETED" } },
    {
      ...update,
      order_tracking_id: providerTxId || payment.order_tracking_id,
      transaction_id: providerTxId || payment.transaction_id
    },
    { new: true }
  );

  if (updated?.status === "COMPLETED") {
    console.log("PayMe Africa webhook COMPLETED for", payment.reference);
  } else if (updated?.status === "FAILED") {
    console.log(
      "PayMe Africa webhook FAILED for",
      payment.reference,
      extractPaymeFailureMessage(body)
    );
  }

  return updated;
}

async function processTeslotyWebhook(body, provider) {
  const event = String(body?.event || "").toLowerCase();
  const data = body?.data || body;
  const providerTxId = data?.id;
  const localReference = data?.reference;
  const providerLabel = provider === "grebo" ? "Grebo" : "Abliner";
  const buildUpdate = provider === "grebo" ? buildGreboUpdate : buildAblinerUpdate;
  const extractFailure =
    provider === "grebo" ? extractGreboFailureMessage : extractAblinerFailureMessage;

  if (!providerTxId && !localReference) {
    throw new Error(`Missing ${providerLabel} transaction reference`);
  }

  const lookup = [];
  if (providerTxId) {
    lookup.push({ order_tracking_id: providerTxId }, { transaction_id: providerTxId });
  }
  if (localReference) {
    lookup.push({ reference: localReference });
  }

  const payment = await Payment.findOne({ $or: lookup, provider });
  if (!payment) {
    console.log(`${providerLabel.toUpperCase()} WEBHOOK: payment not found`, localReference || providerTxId);
    return;
  }

  if (payment.status === "COMPLETED") {
    return;
  }

  const update = buildUpdate(data, "WEBHOOK");

  if (event === "transaction.failed" || update.status === "FAILED") {
    await Payment.findOneAndUpdate(
      { reference: payment.reference },
      {
        ...update,
        status: "FAILED",
        reason: "WEBHOOK_FAILED",
        message: update.message || extractFailure(data),
        order_tracking_id: providerTxId || payment.order_tracking_id,
        transaction_id: providerTxId || payment.transaction_id,
        provider_response: data
      }
    );
    console.log(`${providerLabel} webhook FAILED for`, payment.reference);
    return;
  }

  if (event === "transaction.completed" || update.status === "COMPLETED") {
    await Payment.findOneAndUpdate(
      { reference: payment.reference },
      {
        ...update,
        reason: "WEBHOOK_CONFIRMED",
        order_tracking_id: providerTxId || payment.order_tracking_id,
        transaction_id: providerTxId || payment.transaction_id,
        provider_response: data
      }
    );
    console.log(`${providerLabel} webhook COMPLETED for`, payment.reference);
    return;
  }

  await Payment.findOneAndUpdate(
    { reference: payment.reference },
    {
      ...update,
      order_tracking_id: providerTxId || payment.order_tracking_id,
      transaction_id: providerTxId || payment.transaction_id,
      provider_response: data
    }
  );
  console.log(`${providerLabel} webhook update for`, payment.reference, update.status);
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
      await Payment.findOneAndUpdate(
        { reference: localReference },
        { ...update, status: "FAILED" }
      );
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

async function syncProviderPayment(payment) {
  if (!payment?.order_tracking_id && !payment?.reference) {
    return payment;
  }

  try {
    const { update } = await applyStatusFromQuery(payment, "SYNC", { bypassCache: true });
    if (update.status === payment.status && update.reason === payment.reason) {
      return payment;
    }

    const syncReason =
      update.status === "COMPLETED"
        ? payment.provider === "clickpesa"
          ? "SYNCED_FROM_CLICKPESA"
          : payment.provider === "pesapal"
            ? "SYNCED_FROM_PESAPAL"
            : payment.provider === "grebo"
              ? "SYNCED_FROM_GREBO"
              : payment.provider === "abliner"
                ? "SYNCED_FROM_ABLINER"
                : payment.provider === "wenacy"
                  ? "SYNCED_FROM_WENACY"
                  : "SYNCED_FROM_MALIPOPAY"
        : update.reason;

    return Payment.findOneAndUpdate(
      { reference: payment.reference },
      { ...update, reason: syncReason },
      { new: true }
    );
  } catch (error) {
    console.error("Sync error for", payment.reference, error.message);
    return payment;
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

async function syncAblinerPayment(payment) {
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
        reason: update.status === "COMPLETED" ? "SYNCED_FROM_ABLINER" : update.reason
      },
      { new: true }
    );
  } catch (error) {
    console.error("Abliner sync error for", payment.reference, error.message);
    return payment;
  }
}

async function syncWenacyPayment(payment) {
  if (!payment?.reference) {
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
        reason: update.status === "COMPLETED" ? "SYNCED_FROM_WENACY" : update.reason
      },
      { new: true }
    );
  } catch (error) {
    console.error("Wenacy sync error for", payment.reference, error.message);
    return payment;
  }
}

async function syncSnippePayment(payment) {
  if (!payment?.reference && !payment?.order_tracking_id) {
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
        reason: update.status === "COMPLETED" ? "SYNCED_FROM_SNIPPE" : update.reason
      },
      { new: true }
    );
  } catch (error) {
    console.error("Snippe sync error for", payment.reference, error.message);
    return payment;
  }
}

async function syncPaymePayment(payment) {
  if (!payment?.reference) {
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
        reason: update.status === "COMPLETED" ? "SYNCED_FROM_PAYMEAFRICA" : update.reason
      },
      { new: true }
    );
  } catch (error) {
    console.error("PayMe Africa sync error for", payment.reference, error.message);
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

function pollPaymentStatus(localReference, phone, provider) {
  let attempts = 0;
  const grebo = provider === "grebo";
  const halotel = !grebo && provider !== "clickpesa" && isHalotelPhone(phone);
  const intervalMs = grebo
    ? GREBO_POLL_INTERVAL_MS
    : halotel
      ? HALOTEL_POLL_INTERVAL_MS
      : POLL_INTERVAL_MS;
  const maxAttempts = grebo
    ? GREBO_MAX_POLL_ATTEMPTS
    : halotel
      ? HALOTEL_MAX_POLL_ATTEMPTS
      : MAX_POLL_ATTEMPTS;
  const greboFollowUpMs = Number(process.env.GREBO_FOLLOW_UP_INTERVAL_MS || 10000);
  let lastGreboFollowUpAt = 0;

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

      if (provider === "grebo") {
        const greboId = existing.order_tracking_id || existing.transaction_id;
        const now = Date.now();
        if (greboId && now - lastGreboFollowUpAt >= greboFollowUpMs) {
          lastGreboFollowUpAt = now;
          try {
            await followUpTransaction(greboId);
          } catch (error) {
            if (error.code === "NO_DASHBOARD_AUTH") {
              warnFollowUpAuthOnce(error);
            } else if (error.code !== "FOLLOW_UP_FAILED") {
              console.error("Grebo follow-up error for", localReference, error.message);
            }
          }
        }
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
        await Payment.findOneAndUpdate(
          { reference: localReference },
          { ...update, status: "FAILED" }
        );
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
            order_tracking_id: order.orderTrackingId,
            merchant_reference: order.merchantReference,
            raw: order.raw
          }
        },
        { new: true }
      );

      pollPaymentStatus(reference, phone, provider);

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
        throw new Error(extractGreboFailureMessage(greboTx));
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

      followUpTransaction(greboTx.id).catch((error) => {
        if (error.code === "NO_DASHBOARD_AUTH") {
          warnFollowUpAuthOnce(error);
          return;
        }
        console.error("Grebo initial follow-up error for", reference, error.message);
      });

      pollPaymentStatus(reference, phone, provider);

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

    if (provider === "paymeafrica") {
      const callbackUrl = `${getPublicBaseUrl()}/webhook/paymeafrica`;
      const deposit = await createPaymeCollection({
        amount,
        phone,
        reference,
        callbackUrl
      });

      const paymentStatus = String(deposit?.payment_status || "").toUpperCase();
      const result = String(deposit?.provider_response?.result || deposit?.result || "").toUpperCase();
      const resultcode = String(deposit?.provider_response?.resultcode || "");

      if (
        deposit?.status === "failed" ||
        paymentStatus === "FAILED" ||
        result === "FAILED" ||
        ["009", "052", "056"].includes(resultcode)
      ) {
        throw new Error(extractPaymeFailureMessage(deposit));
      }

      if (deposit?.status !== "success" && !deposit?.transaction_id && paymentStatus !== "PENDING") {
        throw new Error(deposit?.message || deposit?.error || "PayMe Africa collection failed");
      }

      const paymeTxId =
        deposit?.transaction_id ||
        deposit?.provider_response?.transid ||
        deposit?.provider_response?.reference ||
        null;

      await Payment.findOneAndUpdate(
        { reference },
        {
          status: "PROCESSING",
          reason: "USSD_SENT",
          order_tracking_id: paymeTxId,
          transaction_id: paymeTxId,
          result: deposit?.payment_status || deposit?.status,
          message: `USSD push sent via ${operator} (PayMe Africa)`,
          provider_response: deposit
        }
      );

      pollPaymentStatus(reference, phone, provider);

      return res.json({
        success: true,
        provider,
        operator,
        data: {
          reference,
          paymeafrica_id: paymeTxId,
          status: deposit?.payment_status || deposit?.status,
          provider_response: deposit?.provider_response || null
        }
      });
    }

    if (provider === "abliner") {
      const callbackUrl =
        process.env.ABLINER_CALLBACK_URL || `${getPublicBaseUrl()}/webhook/abliner`;
      const deposit = await createAblinerDeposit({
        amount,
        phone,
        reference,
        callbackUrl
      });

      if (deposit?.status !== "success" || !deposit?.data) {
        throw new Error(deposit?.message || deposit?.error || "Abliner deposit failed");
      }

      const ablinerTx = deposit.data;
      const ablinerStatus = String(ablinerTx.status || "").toLowerCase();

      if (ablinerStatus === "failed") {
        throw new Error(extractAblinerFailureMessage(ablinerTx));
      }

      await Payment.findOneAndUpdate(
        { reference },
        {
          status: "PROCESSING",
          reason: "USSD_SENT",
          order_tracking_id: ablinerTx.id,
          transaction_id: ablinerTx.id,
          result: ablinerTx.status,
          message: `USSD push sent via ${operator} (Abliner)`,
          provider_response: ablinerTx
        }
      );

      pollPaymentStatus(reference, phone, provider);

      return res.json({
        success: true,
        provider,
        operator,
        data: {
          reference,
          abliner_id: ablinerTx.id,
          status: ablinerTx.status,
          method: ablinerTx.method
        }
      });
    }

    if (provider === "wenacy") {
      const { normalizeHttpUrl } = require("./wenacy");
      const callbackUrl = normalizeHttpUrl(
        process.env.WENACY_CALLBACK_URL,
        `${getPublicBaseUrl()}/webhook/wenacy`
      );
      const charge = await createWenacyCharge({
        amount,
        phone,
        reference,
        callbackUrl,
        description: "UnlockVIP subscription payment"
      });

      if (!charge?.success && String(charge?.status || "").toLowerCase() === "failed") {
        throw new Error(extractWenacyFailureMessage(charge));
      }

      if (!charge?.success && !charge?.transaction_id && !charge?.reference) {
        throw new Error(charge?.message || charge?.error || "Wenacy charge failed");
      }

      const wenacyStatus = String(charge.status || "").toLowerCase();
      if (wenacyStatus === "failed") {
        throw new Error(extractWenacyFailureMessage(charge));
      }

      const wenacyTxId = charge.transaction_id || charge.order_id || null;

      await Payment.findOneAndUpdate(
        { reference },
        {
          status: "PROCESSING",
          reason: "USSD_SENT",
          order_tracking_id: wenacyTxId,
          transaction_id: wenacyTxId,
          result: charge.status,
          message: `USSD push sent via ${operator} (Wenacy)`,
          provider_response: charge
        }
      );

      pollPaymentStatus(reference, phone, provider);

      return res.json({
        success: true,
        provider,
        operator,
        data: {
          reference,
          wenacy_id: wenacyTxId,
          status: charge.status,
          amount: charge.amount
        }
      });
    }

    if (provider === "snippe") {
      const webhookUrl =
        process.env.SNIPPE_WEBHOOK_URL || `${getPublicBaseUrl()}/webhook/snippe`;
      const push = await createSnippePayment({
        amount,
        phone,
        reference,
        webhookUrl
      });

      const snippeStatus = String(push?.status || "").toLowerCase();
      if (snippeStatus === "failed") {
        throw new Error(extractSnippeFailureMessage(push));
      }

      const snippeRef = push?.reference;
      if (!snippeRef) {
        throw new Error("Snippe did not return a payment reference");
      }

      await Payment.findOneAndUpdate(
        { reference },
        {
          status: "PROCESSING",
          reason: "USSD_SENT",
          order_tracking_id: snippeRef,
          transaction_id: snippeRef,
          result: push.status,
          message: `USSD push sent via ${operator} (Snippe)`,
          provider_response: push
        }
      );

      pollPaymentStatus(reference, phone, provider);

      return res.json({
        success: true,
        provider,
        operator,
        data: {
          reference,
          snippe_reference: snippeRef,
          status: push.status,
          amount: push?.amount?.value || amount
        }
      });
    }

    if (provider === "malipopay") {
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

      pollPaymentStatus(reference, phone, provider);

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

    if (provider === "clickpesa") {
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
        pollPaymentStatus(reference, phone, provider);
      }

      return res.json({
        success: true,
        provider,
        operator,
        data: push
      });
    }

    throw new Error("Unsupported payment provider");
  } catch (error) {
    console.error("CREATE PAYMENT ERROR:", error.details || error.response?.data || error.message);

    const formatted = formatApiError(error, provider || "grebo");
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

async function handlePesapalIpn(req, res) {
  try {
    const orderTrackingId = req.query.OrderTrackingId;
    const merchantReference = req.query.OrderMerchantReference;

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

    if (payment.status === "COMPLETED") {
      return res.status(200).json({ success: true, status: "COMPLETED" });
    }

    const statusData = await getTransactionStatus(orderTrackingId || payment.order_tracking_id);
    const update = buildPesapalUpdate(statusData, "WEBHOOK");

    await Payment.findOneAndUpdate(
      { reference: payment.reference },
      {
        ...update,
        order_tracking_id: orderTrackingId || payment.order_tracking_id
      }
    );

    console.log("Pesapal IPN", payment.reference, update.status);
    return res.status(200).json({ success: true, status: update.status });
  } catch (error) {
    console.error("PESAPAL IPN ERROR:", error.message);
    return res.status(500).json({ success: false, error: error.message });
  }
}

app.get("/webhook", handlePesapalIpn);

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

    const pesapalUrl = payment.provider_response?.redirect_url;
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
      await processTeslotyWebhook(body, "grebo");
      return res.status(200).json({ success: true });
    }

    if (isAblinerWebhook(body)) {
      await processTeslotyWebhook(body, "abliner");
      return res.status(200).json({ success: true });
    }

    if (body.event && body.data?.orderReference) {
      const { event, data } = body;
      const payment = await Payment.findOne({ reference: data.orderReference });

      if (!payment) {
        return res.status(404).json({ success: false, error: "Payment not found" });
      }

      if (payment.status === "COMPLETED") {
        return res.status(200).json({ success: true });
      }

      const meta = extractClickpesaMeta({
        status: data.status,
        message: data.message,
        event,
        source: "WEBHOOK"
      });

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

      console.log("ClickPesa webhook", meta.status, "for", payment.reference);
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
      await processTeslotyWebhook(body, "grebo");
      return res.status(200).json({ success: true });
    }

    if (payment.provider === "abliner") {
      await processTeslotyWebhook(body, "abliner");
      return res.status(200).json({ success: true });
    }

    if (payment.provider === "wenacy") {
      await processWenacyWebhook(body);
      return res.status(200).json({ success: true });
    }

    if (payment.provider === "snippe") {
      await processSnippeWebhook(body, body.event || body.type);
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
      .json(clientError(error, payment?.provider || "grebo", "Failed to query payment"));
  }
});

function enrichPaymentForAdmin(payment) {
  const doc = payment?.toObject ? payment.toObject() : { ...payment };
  if (doc.provider === "abliner") {
    return enrichAblinerPaymentForAdmin(doc);
  }
  if (doc.provider === "wenacy") {
    return enrichWenacyPaymentForAdmin(doc);
  }
  if (doc.provider === "snippe") {
    return enrichSnippePaymentForAdmin(doc);
  }
  if (doc.provider === "paymeafrica") {
    return enrichPaymePaymentForAdmin(doc);
  }
  return enrichGreboPaymentForAdmin(doc);
}

app.get("/admin/payments", async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({
        success: false,
        error: "Database connecting, retry shortly"
      });
    }

    const { status, page, limit, light, phone, pin, q } = req.query;
    const filter = {};
    if (status) filter.status = status;

    const rawPhone = String(phone || q || "").trim();
    if (rawPhone) {
      const digits = rawPhone.replace(/\D/g, "");
      const variants = new Set([rawPhone, digits]);
      if (digits.startsWith("0") && digits.length === 10) {
        variants.add(`255${digits.slice(1)}`);
      }
      if (digits.startsWith("255") && digits.length === 12) {
        variants.add(`0${digits.slice(3)}`);
        variants.add(digits.slice(3));
      }
      if (digits.length === 9) {
        variants.add(`255${digits}`);
        variants.add(`0${digits}`);
      }
      filter.phone = { $in: [...variants] };
    }

    if (pin) {
      filter.pin = String(pin);
    }

    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.min(200, Math.max(1, Number(limit) || 50));
    const skip = (pageNum - 1) * limitNum;
    const lean = light !== "0";
    const hasFilter = Object.keys(filter).length > 0;

    let listQuery = Payment.find(filter)
      .sort({ _id: -1 })
      .skip(skip)
      .limit(limitNum)
      .maxTimeMS(8000)
      .lean();

    if (lean) {
      listQuery = listQuery.select(
        "phone pin amount reference provider status reason time message result transaction_id order_tracking_id"
      );
    }

    const countQuery = hasFilter
      ? Payment.countDocuments(filter).maxTimeMS(8000)
      : Payment.estimatedDocumentCount().maxTimeMS(4000);

    const [total, rows] = await Promise.all([countQuery, listQuery]);

    const data = rows.map(enrichPaymentForAdmin);

    res.json({
      data,
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.max(1, Math.ceil(total / limitNum))
    });
  } catch (error) {
    console.error("ADMIN PAYMENTS ERROR:", error.message);
    res.status(500).json({ success: false, error: "Failed to load payments" });
  }
});

app.post("/admin/sync-payments", async (req, res) => {
  const requestedLimit = Math.min(100, Math.max(1, Number(req.body?.limit) || 25));
  const pending = await Payment.find({
    provider: {
      $in: ["grebo", "abliner", "wenacy", "snippe", "malipopay", "pesapal", "clickpesa", "paymeafrica"]
    },
    status: { $in: ["PROCESSING", "TIMEOUT", "PENDING"] },
    $or: [
      { provider: "clickpesa", reference: { $exists: true, $ne: null } },
      { provider: "paymeafrica", reference: { $exists: true, $ne: null } },
      { provider: "wenacy", reference: { $exists: true, $ne: null } },
      { provider: "snippe", order_tracking_id: { $exists: true, $ne: null } },
      { order_tracking_id: { $exists: true, $ne: null } }
    ]
  })
    .sort({ _id: -1 })
    .limit(requestedLimit);

  const results = [];
  for (const payment of pending) {
    if (payment.provider === "clickpesa") {
      results.push(await syncProviderPayment(payment));
    } else if (payment.provider === "grebo") {
      results.push(await syncGreboPayment(payment));
    } else if (payment.provider === "abliner") {
      results.push(await syncAblinerPayment(payment));
    } else if (payment.provider === "wenacy") {
      results.push(await syncWenacyPayment(payment));
    } else if (payment.provider === "snippe") {
      results.push(await syncSnippePayment(payment));
    } else if (payment.provider === "paymeafrica") {
      results.push(await syncPaymePayment(payment));
    } else if (payment.provider === "pesapal") {
      results.push(await syncPesapalPayment(payment));
    } else {
      results.push(await syncMalipopayPayment(payment));
    }
  }

  const completed = results.filter((r) => r?.status === "COMPLETED").length;
  res.json({ success: true, synced: results.length, completed });
});

app.post("/admin/grebo-fuatilia", async (req, res) => {
  try {
    const {
      listTransactions,
      followUpTransaction,
      isGreboFollowUpConfigured
    } = require("./grebo");

    if (!isGreboFollowUpConfigured()) {
      return res.status(400).json({
        success: false,
        error: "Set GREBO_DASHBOARD_EMAIL/PASSWORD or GREBO_DASHBOARD_ACCESS_TOKEN"
      });
    }

    const limit = Math.min(50, Math.max(1, Number(req.body?.limit) || 25));
    const txs = await listTransactions(100);
    const pending = txs
      .filter(
        (tx) =>
          String(tx.type || "deposit") === "deposit" &&
          /^(pending|processing)$/i.test(String(tx.status || "")) &&
          tx.id
      )
      .slice(0, limit);

    const results = [];
    for (const tx of pending) {
      try {
        await followUpTransaction(tx.id);
        results.push({
          id: tx.id,
          reference: tx.reference,
          ok: true
        });
      } catch (error) {
        results.push({
          id: tx.id,
          reference: tx.reference,
          ok: false,
          error: error.message
        });
      }
    }

    res.json({
      success: true,
      pending: pending.length,
      ok: results.filter((r) => r.ok).length,
      results
    });
  } catch (error) {
    console.error("GREBO FUATILIA ADMIN ERROR:", error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.listen(PORT, async () => {
  try {
    await fixStalePollingRecords();
  } catch (error) {
    console.error("Failed to fix stale polling records:", error.message);
  }

  try {
    startGreboBalanceTracker({ Payment });
  } catch (error) {
    console.error("Failed to start Grebo balance tracker:", error.message);
  }

  console.log("Server running on port", PORT);
});
