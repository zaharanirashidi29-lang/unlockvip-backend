const axios = require("axios");

function env(name, fallback = "") {
  const value = process.env[name];
  return value == null || value === "" ? fallback : String(value);
}

const BASE = env("FIMIPAY_API_BASE_URL", "https://fimipay.com").replace(/\/+$/, "");
const MIN_DEPOSIT = 60000;
const MIN_WITHDRAW = 10000;

const NETWORKS = [
  { id: "mpesa", name: "M-Pesa", brand: "Vodacom", prefixes: ["74", "75", "76", "79"] },
  { id: "tigo", name: "Mixx by Yas", brand: "Tigo", prefixes: ["65", "67", "70", "71", "77"] },
  { id: "airtel", name: "Airtel Money", brand: "Airtel", prefixes: ["66", "68", "69", "78"] },
  { id: "halopesa", name: "HaloPesa", brand: "Halotel", prefixes: ["61", "62", "63"] },
  { id: "ttcl", name: "TTCL Pesa", brand: "TTCL", prefixes: ["73"] }
];

const PAID_STATUS = new Set(["COMPLETED", "PAID", "SUCCESSFUL", "SUCCESS"]);
const FAILED_STATUS = new Set([
  "CANCEL",
  "CANCELLED",
  "CANCELED",
  "FAILED",
  "REJECTED",
  "USERCANCELLED",
  "EXPIRED",
  "TIMEOUT"
]);

const MERCHANTS = [
  {
    slug: env("FIMIPAY_MERCHANT_SLUG", "kopo"),
    name: env("FIMIPAY_MERCHANT_NAME", "Kopo"),
    id: env("FIMIPAY_MERCHANT_ID", "a29bd943-0611-4075-8fed-db74c554c5e6")
  }
];

let activeMerchant = MERCHANTS[0];

function proxyEnvSnapshot() {
  return {
    HTTP_PROXY: process.env.HTTP_PROXY || process.env.http_proxy || null,
    HTTPS_PROXY: process.env.HTTPS_PROXY || process.env.https_proxy || null,
    ALL_PROXY: process.env.ALL_PROXY || process.env.all_proxy || null,
    NO_PROXY: process.env.NO_PROXY || process.env.no_proxy || null,
    axios_defaults_proxy: axios.defaults.proxy ?? null
  };
}

function fimiHeaders(slug, contentType = "application/json") {
  const s = slug || activeMerchant?.slug || "kopo";
  return {
    Accept: "application/json",
    "Content-Type": contentType,
    Origin: BASE,
    Referer: `${BASE}/pay/${s}/${s}`,
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  };
}

function prefix2(phone) {
  const n = String(phone || "").replace(/\D/g, "");
  const d = n.startsWith("255") ? n.slice(3) : n.startsWith("0") ? n.slice(1) : n;
  return d.slice(0, 2);
}

function detectNetwork(phone) {
  const p = prefix2(phone);
  return NETWORKS.find((n) => n.prefixes.includes(p)) || null;
}

function networkOk(phone, networkId) {
  if (!networkId || networkId === "auto") return Boolean(detectNetwork(phone));
  const net = NETWORKS.find((n) => n.id === networkId);
  return net ? net.prefixes.includes(prefix2(phone)) : Boolean(detectNetwork(phone));
}

function publicError(data, fallback) {
  return String(
    data?.message ||
      data?.error ||
      data?.result_message ||
      data?.provider_response?.message ||
      fallback ||
      "FimiPay request failed"
  );
}

function resultToken(data) {
  return String(data?.result || data?.status || "").toUpperCase();
}

function orderIdOf(data) {
  return String(data?.order_id || data?.orderId || data?.id || data?.transid || data?.row?.order_id || "").trim();
}

function orderRow(data) {
  if (!data || typeof data !== "object") return null;
  if (Array.isArray(data.data) && data.data[0] && typeof data.data[0] === "object") return data.data[0];
  if (data.row && typeof data.row === "object") return data.row;
  return data;
}

function paymentStatusOf(data) {
  const row = orderRow(data);
  return String(row?.payment_status || row?.order_status || row?.paid_status || row?.transaction_status || "").toUpperCase();
}

function isFailed(data) {
  const status = paymentStatusOf(data);
  if (FAILED_STATUS.has(status)) return true;
  if (Array.isArray(data?.data) && data.data[0]) return false;
  const token = resultToken(data);
  const msg = publicError(data, "");
  if (["FAILED", "FAIL", "ERROR", "CANCELLED", "CANCELED", "DECLINED"].includes(token)) return true;
  if (/valid merchant|wrong credential|9003|9012|insufficient|not found/i.test(msg)) return true;
  return false;
}

function isPushOk(http, data) {
  const id = orderIdOf(data);
  if (http >= 400 || !id || isFailed(data)) return false;
  const token = resultToken(data);
  return token === "SUCCESS" || token === "SUCCESSFUL" || token === "PENDING" || token === "PROCESSING" || Boolean(id);
}

function isPaid(data) {
  if (!data || typeof data !== "object") return false;
  const status = paymentStatusOf(data);
  if (PAID_STATUS.has(status)) return true;
  const row = orderRow(data);
  if (!row) return false;
  if (row.paid === true || row.is_paid === true) return true;
  const paidAmt = Number(row.paid_amount || row.amount_paid || 0);
  if (Number.isFinite(paidAmt) && paidAmt > 0 && !FAILED_STATUS.has(status)) return true;
  return false;
}

function hasUsableFimiStatus(data) {
  if (!data || typeof data !== "object") return false;
  if (String(data.error || data.result || "").toLowerCase() === "vpn_blocked") return false;
  return Boolean(paymentStatusOf(data));
}

function paidAmount(data) {
  const row = orderRow(data);
  const n = Number(row?.amount);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function checkoutRequest({ phone, amount, name, email }) {
  const merchant = MERCHANTS[0];
  return {
    url: `${BASE}/api/payments/checkout/create-order-minimal`,
    merchant: merchant.slug,
    body: {
      buyer_phone: phone,
      buyer_name: name || "Paribet customer",
      buyer_email: email || undefined,
      buyer_whatsapp: phone,
      amount: Number(amount),
      currency: "TZS",
      merchant_user_id: merchant.id,
      merchant_display_name: merchant.name
    }
  };
}

function logOutgoingRequest({ method, url, headers, body, merchant }) {
  console.log("fimipay request detail", {
    method,
    endpoint: url,
    merchant: {
      slug: merchant?.slug,
      name: merchant?.name,
      id: merchant?.id
    },
    env: {
      FIMIPAY_API_BASE_URL: env("FIMIPAY_API_BASE_URL", "(default https://fimipay.com)"),
      FIMIPAY_MERCHANT_SLUG: env("FIMIPAY_MERCHANT_SLUG", "(default kopo)"),
      FIMIPAY_MERCHANT_NAME: env("FIMIPAY_MERCHANT_NAME", "(default Kopo)"),
      FIMIPAY_MERCHANT_ID: env("FIMIPAY_MERCHANT_ID", "(default a29bd943-0611-4075-8fed-db74c554c5e6)"),
      // Checkout create-order-minimal does not use API keys/secrets.
      FIMIPAY_API_KEY: process.env.FIMIPAY_API_KEY ? "(set)" : "(not used by checkout)",
      FIMIPAY_API_SECRET: process.env.FIMIPAY_API_SECRET ? "(set)" : "(not used by checkout)"
    },
    headers,
    body,
    proxy: proxyEnvSnapshot()
  });
}

async function postCreateOrder(url, body, merchant, contentType) {
  const headers = fimiHeaders(merchant.slug, contentType);
  logOutgoingRequest({
    method: "POST",
    url,
    headers,
    body,
    merchant
  });

  const res = await axios.post(url, body, {
    headers,
    timeout: 45000,
    // Force direct egress — never inherit an HTTP(S)_PROXY that Fimi flags as VPN/proxy.
    proxy: false,
    validateStatus: () => true
  });
  const data = res.data && typeof res.data === "object" ? res.data : {};
  console.log("fimipay push response", {
    slug: merchant.slug,
    contentType,
    http: res.status,
    result: data.result || data.status || "",
    error: data.error || "",
    order_id: orderIdOf(data),
    payment_status: paymentStatusOf(data) || "",
    message: publicError(data, ""),
    raw: data
  });
  return { http: res.status, data };
}

async function createOrder({ phone, amount, name, email }) {
  let last = { status: 0, data: {} };
  // Match the working Mac/browser bridge: try JSON first, then text/plain.
  const contentTypes = ["application/json", "text/plain;charset=UTF-8"];

  for (const merchant of MERCHANTS) {
    const url = `${BASE}/api/payments/checkout/create-order-minimal`;
    const body = {
      buyer_phone: phone,
      buyer_name: name || "Paribet customer",
      buyer_email: email || undefined,
      buyer_whatsapp: phone,
      amount: Number(amount),
      currency: "TZS",
      merchant_user_id: merchant.id,
      merchant_display_name: merchant.name
    };

    for (const contentType of contentTypes) {
      try {
        const res = await postCreateOrder(url, body, merchant, contentType);
        last = { status: res.http, data: res.data };
        if (isPushOk(res.http, res.data)) {
          activeMerchant = merchant;
          return { http: res.http, data: res.data, merchant };
        }
        // vpn_blocked is IP-based; retrying Content-Type will not help, but keep
        // trying so logs show both shapes from this environment.
        if (String(res.data?.error || "").toLowerCase() === "vpn_blocked") {
          continue;
        }
        if (res.http < 500 && !/merchant|not found/i.test(publicError(res.data))) {
          return { http: res.http, data: res.data, merchant };
        }
      } catch (err) {
        last = { status: err.response?.status || 0, data: err.response?.data || { message: err.message } };
        console.log("fimipay error", {
          slug: merchant.slug,
          contentType,
          message: err.message,
          code: err.code || null,
          response: err.response?.data || null
        });
      }
    }
  }
  return { http: last.status || 502, data: last.data || {}, merchant: activeMerchant };
}

async function getOrder(orderId) {
  if (!orderId) return null;
  const slug = activeMerchant?.slug || "kopo";
  const url = `${BASE}/api/payments/checkout/order-status`;
  const headers = fimiHeaders(slug);
  logOutgoingRequest({
    method: "GET",
    url: `${url}?order_id=${encodeURIComponent(orderId)}`,
    headers,
    body: null,
    merchant: activeMerchant
  });
  try {
    const res = await axios.get(url, {
      params: { order_id: orderId },
      headers,
      timeout: 12000,
      proxy: false,
      validateStatus: () => true
    });
    if (res.status >= 400 || !res.data || typeof res.data !== "object") return null;
    const row = orderRow(res.data);
    return { ...res.data, row };
  } catch (_) {
    return null;
  }
}

async function collect({ phone, amount, name, email }) {
  const { http, data, merchant } = await createOrder({ phone, amount, name, email });
  const orderId = orderIdOf(data);
  const pushed = isPushOk(http, data);
  const paid = isPaid(data);
  const failed = !pushed && (http >= 400 || isFailed(data) || !orderId);
  return {
    ok: pushed,
    paid,
    pending: pushed && !paid,
    failed,
    http,
    orderId,
    merchant: merchant?.slug || "kopo",
    result: data.result || data.status || "",
    message: publicError(
      data,
      pushed ? "PIN prompt sent. Approve it on your phone." : "Could not send FimiPay push"
    ),
    raw: data
  };
}

async function payout() {
  return {
    ok: false,
    message: "FimiPay checkout collects money only and cannot pay out to a phone"
  };
}

module.exports = {
  NETWORKS,
  MIN_DEPOSIT,
  MIN_WITHDRAW,
  MERCHANT_NAME: "FimiPay",
  BASE,
  MERCHANTS,
  detectNetwork,
  networkOk,
  collect,
  payout,
  getOrder,
  isPaid,
  isFailed,
  isPushOk,
  paidAmount,
  paymentStatusOf,
  hasUsableFimiStatus,
  orderRow,
  orderIdOf,
  checkoutRequest,
  publicError,
  fimiHeaders,
  proxyEnvSnapshot,
  logOutgoingRequest
};
