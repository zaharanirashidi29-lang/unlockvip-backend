/**
 * Standalone Pesapal demo server — does NOT use index.js or production routes.
 * Run: node pesapal-demo/server.js
 */
const path = require("path");
const express = require("express");
const { createOrder, getTransactionStatus } = require("./lib/pesapal");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const app = express();
const PORT = Number(process.env.PESAPAL_DEMO_PORT || 3099);
const SESSION_TTL_MS = 30 * 60 * 1000;

const sessions = new Map();

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

function purgeExpiredSessions() {
  const now = Date.now();
  for (const [id, session] of sessions.entries()) {
    if (session.expiresAt <= now) {
      sessions.delete(id);
    }
  }
}

function createSession(order) {
  purgeExpiredSessions();
  const sessionId = `ps_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  sessions.set(sessionId, {
    ...order,
    expiresAt: Date.now() + SESSION_TTL_MS
  });
  return sessionId;
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    demo: true,
    port: PORT,
    message: "Isolated Pesapal demo — production app untouched"
  });
});

app.post("/api/order", async (req, res) => {
  try {
    const phone = String(req.body.phone || "255794316132").replace(/\D/g, "");
    const amount = Number(req.body.amount || 3061);

    if (!phone.startsWith("255") || phone.length !== 12) {
      return res.status(400).json({ success: false, error: "Use Tanzanian number like 255794316132" });
    }

    const order = await createOrder({ phone, amount });
    const sessionId = createSession(order);

    res.json({
      success: true,
      sessionId,
      orderTrackingId: order.orderTrackingId,
      merchantReference: order.merchantReference,
      embedPath: `/embed/${sessionId}`,
      checkoutPath: `/checkout/${sessionId}`,
      amount,
      phone
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.response?.data?.message || error.message
    });
  }
});

app.get("/api/status/:orderTrackingId", async (req, res) => {
  try {
    const status = await getTransactionStatus(req.params.orderTrackingId);
    res.json({ success: true, status });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.response?.data?.message || error.message
    });
  }
});

app.get("/checkout/:sessionId", (req, res) => {
  const session = sessions.get(req.params.sessionId);
  if (!session) {
    return res.status(404).send("Demo session expired. Start payment again.");
  }

  res.redirect(302, session.redirectUrl);
});

app.get("/embed/:sessionId", (req, res) => {
  const session = sessions.get(req.params.sessionId);
  if (!session) {
    return res.status(404).send("Demo session expired. Start payment again.");
  }

  const safeUrl = session.redirectUrl.replace(/"/g, "&quot;");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Payment</title>
  <style>
    html, body { margin: 0; height: 100%; background: #0b1020; }
    iframe { width: 100%; height: 100%; border: 0; }
  </style>
</head>
<body>
  <iframe src="${safeUrl}" title="Payment processor" allow="payment *"></iframe>
</body>
</html>`);
});

app.listen(PORT, () => {
  console.log("Pesapal demo running (isolated from main app)");
  console.log(`Hub:              http://localhost:${PORT}/`);
  console.log(`1 Hidden iframe:    http://localhost:${PORT}/demo/1-hidden-iframe.html`);
  console.log(`2 Modal overlay:    http://localhost:${PORT}/demo/2-modal-overlay.html`);
  console.log(`3 Branded shell:    http://localhost:${PORT}/demo/3-branded-shell.html`);
});
