const axios = require("axios");
const crypto = require("crypto");
const { toJSONAsync, fromJSON } = require("seroval");

const BASE_URL = (process.env.GREBO_API_BASE_URL || "https://grebo.tesloty.com").replace(
  /\/$/,
  ""
);

const SUPABASE_URL =
  process.env.GREBO_SUPABASE_URL || "https://pqgcpsvhnqerhjghmaql.supabase.co";
const SUPABASE_ANON_KEY =
  process.env.GREBO_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBxZ2Nwc3ZobnFlcmhqZ2htYXFsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAxNzU0MDgsImV4cCI6MjA5NTc1MTQwOH0.YQ_Y__tebmQxcAWydFLCgPkhI2zjvsvuGS-SMhqzD4I";

const FOLLOW_UP_SERVER_FN_ID =
  process.env.GREBO_FOLLOW_UP_SERVER_FN_ID ||
  "227382bceb8eb765c997713a23466cfbe64beeeeacd57d38ac21e8b09b0fc002";

// Grebo login helpers from /assets/auth.functions.server-*.js
const RESOLVE_IDENTIFIER_FN_ID =
  process.env.GREBO_RESOLVE_IDENTIFIER_FN_ID ||
  "84fd53518348408dedc2baf85c7998d411393114d79947c44d91789260d80718";
const PIN_LOGIN_FN_ID =
  process.env.GREBO_PIN_LOGIN_FN_ID ||
  "22a91f4ba10c7c7af3ad578377622bcb53c4140cc3060dc64a0e0b2d6fd870f4";

let dashboardTokenCache = null;
let followUpAuthWarningLogged = false;
let cachedFuatiliaHash = FOLLOW_UP_SERVER_FN_ID;
let fuatiliaHashFetchedAt = 0;

function getApiKey() {
  const key = process.env.GREBO_API_KEY;
  if (!key) {
    throw new Error("GREBO_API_KEY is required");
  }
  return key;
}

function authHeaders() {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    Authorization: `Bearer ${getApiKey()}`
  };
}

function normalizePhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.startsWith("255")) return digits;
  if (digits.startsWith("0")) return `255${digits.slice(1)}`;
  if (digits.length === 9) return `255${digits}`;
  return digits;
}

function makeReference(prefix = "UNLOCKVIP") {
  return `${prefix}-${Date.now()}`;
}

async function getBalance() {
  const response = await axios.get(`${BASE_URL}/api/v1/balance`, {
    headers: authHeaders(),
    timeout: 20000
  });
  return response.data;
}

async function createDeposit({ amount, phone, reference, callbackUrl, method = "mobile" }) {
  const response = await axios.post(
    `${BASE_URL}/api/v1/deposits`,
    {
      amount: Number(amount),
      method,
      phone: normalizePhone(phone),
      reference,
      ...(callbackUrl ? { callback_url: callbackUrl } : {})
    },
    { headers: authHeaders() }
  );
  return response.data;
}

const TRANSACTION_LIST_CACHE_MS = 3000;
let transactionListCache = null;

async function listTransactions(limit = 100, options = {}) {
  const { bypassCache = false } = options;
  const now = Date.now();

  if (
    !bypassCache &&
    transactionListCache &&
    transactionListCache.expiresAt > now &&
    transactionListCache.limit >= limit
  ) {
    return transactionListCache.items.slice(0, limit);
  }

  const response = await axios.get(`${BASE_URL}/api/v1/transactions`, {
    headers: authHeaders(),
    params: { limit },
    timeout: 20000
  });
  const items = response.data?.data || [];
  transactionListCache = {
    items,
    limit: Math.max(limit, items.length),
    expiresAt: now + TRANSACTION_LIST_CACHE_MS
  };
  return items.slice(0, limit);
}

async function getTransaction(transactionId, options = {}) {
  const items = await listTransactions(100, options);
  return items.find((item) => item.id === transactionId) || null;
}

function isGreboFollowUpConfigured() {
  return Boolean(
    process.env.GREBO_DASHBOARD_ACCESS_TOKEN ||
      process.env.GREBO_ACCESS_TOKEN ||
      ((process.env.GREBO_DASHBOARD_EMAIL || process.env.GREBO_USER_EMAIL) &&
        (process.env.GREBO_DASHBOARD_PASSWORD ||
          process.env.GREBO_USER_PASSWORD ||
          process.env.GREBO_DASHBOARD_PIN ||
          process.env.GREBO_USER_PIN))
  );
}

function decodeGreboSerovalNode(node) {
  if (node == null || typeof node !== "object") return node;
  const type = node.t;

  // string
  if (type === 1 && typeof node.s === "string") return node.s;
  // nullish / boolean-ish primitives used by Grebo TSR payloads
  if (type === 2) {
    if (node.s === 1) return null;
    if (node.s === 2) return true;
    if (node.s === 3) return false;
    return node.s;
  }
  // Error object
  if (type === 25 && node.s) {
    const message = decodeGreboSerovalNode(node.s.message) || "Grebo serverFn error";
    const err = new Error(message);
    err.name = node.c || "Error";
    return err;
  }
  // object
  if (type === 10 && node.p && Array.isArray(node.p.k) && Array.isArray(node.p.v)) {
    const out = {};
    for (let i = 0; i < node.p.k.length; i += 1) {
      out[node.p.k[i]] = decodeGreboSerovalNode(node.p.v[i]);
    }
    return out;
  }
  // empty object / context
  if (type === 11) return {};

  return node;
}

function decodeGreboServerFnResponse(raw) {
  try {
    return fromJSON(raw);
  } catch (_) {
    // TanStack plugins often break plain seroval.fromJSON; fall back.
  }
  return decodeGreboSerovalNode(raw);
}

async function callGreboServerFn(functionId, data, accessToken = null) {
  const body = JSON.stringify(await toJSONAsync({ data }));
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/x-tss-framed, application/x-ndjson, application/json",
    "x-tsr-serverFn": "true"
  };
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const response = await axios.post(`${BASE_URL}/_serverFn/${functionId}`, body, {
    headers,
    timeout: 45000,
    transformRequest: [(payload) => payload],
    validateStatus: () => true
  });

  const decoded = decodeGreboServerFnResponse(response.data);

  if (response.status >= 400) {
    const err = new Error(
      decoded?.error?.message ||
        decoded?.message ||
        `Grebo serverFn HTTP ${response.status}`
    );
    err.details = decoded;
    err.code = response.status;
    throw err;
  }

  if (decoded?.error) {
    const err = new Error(decoded.error?.message || String(decoded.error));
    err.details = decoded;
    err.code = "SERVERFN_FAILED";
    throw err;
  }

  return decoded?.result ?? decoded;
}

async function loginWithGreboPin(identifier, pin) {
  const resolved = await callGreboServerFn(RESOLVE_IDENTIFIER_FN_ID, {
    identifier: String(identifier || "").trim()
  });
  const email = resolved?.email || String(identifier || "").trim().toLowerCase();
  if (!email) {
    throw new Error("Grebo could not resolve account email from identifier");
  }

  const pinResult = await callGreboServerFn(PIN_LOGIN_FN_ID, {
    email,
    pin: String(pin || "").trim()
  });

  if (!pinResult?.ok || !pinResult?.token_hash) {
    const err = new Error(pinResult?.error || "Incorrect Grebo PIN");
    err.code = "DASHBOARD_AUTH_FAILED";
    err.details = pinResult;
    throw err;
  }

  const verify = await axios.post(
    `${SUPABASE_URL}/auth/v1/verify`,
    {
      token_hash: pinResult.token_hash,
      type: "magiclink"
    },
    {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json"
      },
      timeout: 20000,
      validateStatus: () => true
    }
  );

  const token = verify.data?.access_token;
  if (!token) {
    const detail =
      verify.data?.error_description ||
      verify.data?.msg ||
      verify.data?.error ||
      `Grebo PIN verify failed (${verify.status})`;
    const err = new Error(detail);
    err.code = "DASHBOARD_AUTH_FAILED";
    err.details = verify.data;
    throw err;
  }

  return {
    token,
    email,
    expiresIn: Number(verify.data?.expires_in || 3600)
  };
}

async function loginWithGreboPassword(email, password) {
  let response;
  try {
    response = await axios.post(
      `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
      { email, password },
      {
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          "Content-Type": "application/json"
        },
        timeout: 20000
      }
    );
  } catch (error) {
    const detail =
      error.response?.data?.error_description ||
      error.response?.data?.msg ||
      error.response?.data?.error ||
      error.message;
    const err = new Error(`Grebo dashboard login failed: ${detail}`);
    err.code = "DASHBOARD_AUTH_FAILED";
    err.details = error.response?.data || null;
    throw err;
  }

  const token = response.data?.access_token;
  if (!token) {
    throw new Error("Grebo dashboard login did not return an access token");
  }

  return {
    token,
    email,
    expiresIn: Number(response.data?.expires_in || 3600)
  };
}

async function getDashboardAccessToken({ forceRefresh = false } = {}) {
  const staticToken =
    process.env.GREBO_DASHBOARD_ACCESS_TOKEN || process.env.GREBO_ACCESS_TOKEN;
  if (staticToken) {
    return staticToken;
  }

  if (
    !forceRefresh &&
    dashboardTokenCache &&
    dashboardTokenCache.expiresAt > Date.now() + 60_000
  ) {
    return dashboardTokenCache.token;
  }

  const email = process.env.GREBO_DASHBOARD_EMAIL || process.env.GREBO_USER_EMAIL;
  const password =
    process.env.GREBO_DASHBOARD_PASSWORD || process.env.GREBO_USER_PASSWORD || "";
  const pin =
    process.env.GREBO_DASHBOARD_PIN ||
    process.env.GREBO_USER_PIN ||
    (/^\d{4}$/.test(String(password).trim()) ? String(password).trim() : "");

  if (!email || (!password && !pin)) {
    return null;
  }

  // Grebo login treats a 4-digit value as PIN (see login-*.js).
  const auth = pin
    ? await loginWithGreboPin(email, pin)
    : await loginWithGreboPassword(email, password);

  dashboardTokenCache = {
    token: auth.token,
    expiresAt: Date.now() + Math.max(300, auth.expiresIn - 120) * 1000
  };
  return auth.token;
}

async function resolveFuatiliaFunctionHash() {
  if (process.env.GREBO_FOLLOW_UP_SERVER_FN_ID || process.env.GREBO_FUATILIA_FN_HASH) {
    return (
      process.env.GREBO_FOLLOW_UP_SERVER_FN_ID || process.env.GREBO_FUATILIA_FN_HASH
    );
  }

  if (cachedFuatiliaHash && Date.now() - fuatiliaHashFetchedAt < 6 * 60 * 60 * 1000) {
    return cachedFuatiliaHash;
  }

  try {
    const page = await axios.get(`${BASE_URL}/dashboard/transactions`, {
      headers: { Accept: "text/html" },
      timeout: 20000
    });
    const html = String(page.data || "");
    const fnAsset = (
      html.match(/\/assets\/dashboard\.functions\.server-[A-Za-z0-9_-]+\.js/) || []
    )[0];
    if (fnAsset) {
      const js = String(
        (await axios.get(`${BASE_URL}${fnAsset}`, { timeout: 20000 })).data || ""
      );
      const postHashes = [
        ...js.matchAll(
          /method:"POST"\)\.middleware\(\[a\]\)\.handler\(c\("([a-f0-9]{64})"\)/g
        )
      ].map((m) => m[1]);
      if (postHashes[0]) {
        cachedFuatiliaHash = postHashes[0];
        fuatiliaHashFetchedAt = Date.now();
        return cachedFuatiliaHash;
      }
    }
  } catch (_) {
    // fall back to known hash
  }

  cachedFuatiliaHash = FOLLOW_UP_SERVER_FN_ID;
  fuatiliaHashFetchedAt = Date.now();
  return cachedFuatiliaHash;
}

/**
 * Clicks Grebo dashboard "FUATILIA" for a pending deposit.
 * Triggers Grebo provider reconcile + real webhook delivery.
 */
async function followUpTransaction(transactionId) {
  const greboId = String(transactionId || "").trim();
  if (!greboId) {
    throw new Error("Grebo transaction id is required for FUATILIA");
  }

  let accessToken;
  try {
    accessToken = await getDashboardAccessToken();
  } catch (error) {
    const err = new Error(
      `Grebo dashboard login failed: ${
        error.response?.data?.error_description || error.message
      }`
    );
    err.code = "DASHBOARD_AUTH_FAILED";
    throw err;
  }

  if (!accessToken) {
    const err = new Error(
      "Grebo FUATILIA requires GREBO_DASHBOARD_EMAIL/PASSWORD or GREBO_DASHBOARD_ACCESS_TOKEN"
    );
    err.code = "NO_DASHBOARD_AUTH";
    throw err;
  }

  const hash = await resolveFuatiliaFunctionHash();
  try {
    return await callGreboServerFn(hash, { id: greboId }, accessToken);
  } catch (error) {
    if (/unauthorized|invalid token/i.test(String(error.message || ""))) {
      dashboardTokenCache = null;
      const err = new Error("Grebo FUATILIA unauthorized — check dashboard credentials");
      err.code = "DASHBOARD_AUTH_FAILED";
      throw err;
    }
    error.code = error.code || "FOLLOW_UP_FAILED";
    throw error;
  }
}

const fuatiliaTransaction = followUpTransaction;

function warnFollowUpAuthOnce(error) {
  if (followUpAuthWarningLogged) return;
  followUpAuthWarningLogged = true;
  console.warn(
    "Grebo auto FUATILIA disabled:",
    error?.message ||
      "set GREBO_DASHBOARD_EMAIL + GREBO_DASHBOARD_PASSWORD (or GREBO_DASHBOARD_ACCESS_TOKEN)"
  );
}

async function resolvePaymentStatus(payment, options = {}) {
  const greboId = payment?.order_tracking_id || payment?.transaction_id;
  const reference = payment?.reference;
  const items = options.transactions || (await listTransactions(100, options));
  const match = items.find(
    (item) =>
      (greboId && item.id === greboId) ||
      (reference && item.reference === reference)
  );

  if (!match) {
    const err = new Error("Grebo transaction not found");
    err.code = "NOT_FOUND";
    throw err;
  }

  return match;
}

function greboAmountTzs(data) {
  if (data?.amount_tzs != null) return Number(data.amount_tzs);
  if (data?.amount != null) return Number(data.amount);
  if (data?.amount_cents != null) return Number(data.amount_cents) / 100;
  return undefined;
}

function normalizeGreboStatus(status) {
  const value = String(status || "").toLowerCase();
  if (value === "completed" || value === "success" || value === "successful") {
    return "COMPLETED";
  }
  if (value === "failed" || value === "cancelled" || value === "canceled" || value === "expired") {
    return "FAILED";
  }
  return "PROCESSING";
}

function extractGreboFailureMessage(data) {
  if (!data) return "Grebo payment failed";

  const candidates = [
    data.failure_reason,
    data.failure_message,
    data.failureReason,
    data.error_message,
    data.error,
    data.message,
    data.description,
    data.reason
  ];

  for (const candidate of candidates) {
    const text = String(candidate || "").trim();
    if (!text) continue;
    const lower = text.toLowerCase();
    if (lower === "failed" || lower === "error" || lower === "success") continue;
    return text;
  }

  const status = String(data.status || "").toLowerCase();
  if (status === "cancelled" || status === "canceled") {
    return "Payment cancelled by customer";
  }
  if (status === "expired") {
    return "Payment expired";
  }
  if (status === "failed") {
    return "Grebo payment failed";
  }

  return "Grebo payment failed";
}

function isGreboFailed(data) {
  const status = String(data?.status || "").toLowerCase();
  return ["failed", "cancelled", "canceled", "expired", "error"].includes(status);
}

function buildGreboUpdate(statusData, source) {
  const mapped = normalizeGreboStatus(statusData?.status);
  const amount = greboAmountTzs(statusData);

  let message;
  if (mapped === "COMPLETED") {
    message = "Payment successful via Grebo";
  } else if (mapped === "FAILED") {
    message = extractGreboFailureMessage(statusData);
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
    amount: amount || undefined,
    transaction_id: statusData?.id,
    result: statusData?.status,
    resultcode: statusData?.status,
    provider_response: statusData
  };
}

function enrichPaymentForAdmin(payment) {
  const doc = payment?.toObject ? payment.toObject() : { ...payment };
  const response = doc.provider_response || {};

  doc.grebo_status = response.status || doc.result || null;
  doc.grebo_transaction_id =
    response.id || doc.transaction_id || doc.order_tracking_id || null;

  const failed =
    doc.status === "FAILED" ||
    isGreboFailed(response) ||
    doc.reason === "WEBHOOK_FAILED" ||
    doc.reason === "PAYMENT_FAILED" ||
    doc.reason === "FAILED_BY_QUERY";

  if (failed) {
    doc.grebo_failed = true;
    doc.grebo_failure = extractGreboFailureMessage(response) || doc.message || "Payment failed";
    if (!doc.message || doc.message === "Grebo failed") {
      doc.message = doc.grebo_failure;
    }
  } else {
    doc.grebo_failed = false;
    doc.grebo_failure = null;
  }

  doc.provider_status = doc.grebo_status;
  doc.provider_failed = doc.grebo_failed;
  doc.provider_failure = doc.grebo_failure;
  doc.provider_transaction_id = doc.grebo_transaction_id;

  return doc;
}

function isGreboWebhook(body) {
  const event = String(body?.event || "").toLowerCase();
  return event.startsWith("transaction.");
}

function verifyWebhookSignature({ rawBody, signature, timestamp, secret }) {
  const message = `${timestamp}.${rawBody}`;
  const expected = crypto.createHmac("sha256", secret).update(message).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature || "", "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function formatGreboError(error) {
  const data = error.response?.data;
  return {
    message: data?.message || error.message || "Grebo request failed",
    error: data?.error || null,
    status: error.response?.status,
    requestId: data?.request_id || null,
    details: data || null
  };
}

module.exports = {
  BASE_URL,
  FOLLOW_UP_SERVER_FN_ID,
  normalizePhone,
  makeReference,
  getBalance,
  createDeposit,
  listTransactions,
  getTransaction,
  isGreboFollowUpConfigured,
  getDashboardAccessToken,
  followUpTransaction,
  fuatiliaTransaction,
  warnFollowUpAuthOnce,
  resolvePaymentStatus,
  greboAmountTzs,
  normalizeGreboStatus,
  extractGreboFailureMessage,
  isGreboFailed,
  buildGreboUpdate,
  enrichPaymentForAdmin,
  isGreboWebhook,
  verifyWebhookSignature,
  formatGreboError
};
