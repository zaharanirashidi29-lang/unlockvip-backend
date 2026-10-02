const axios = require("axios");

const BASE = "https://fimipay.com";
const MIN_DEPOSIT = 10000;
const MIN_WITHDRAW = 10000;

const NETWORKS = [
  { id: "mpesa", name: "M-Pesa", brand: "Vodacom", prefixes: ["74", "75", "76", "79"] },
  { id: "tigo", name: "Mixx by Yas", brand: "Tigo", prefixes: ["65", "67", "70", "71", "77"] },
  { id: "airtel", name: "Airtel Money", brand: "Airtel", prefixes: ["66", "68", "69", "78"] },
  { id: "halopesa", name: "HaloPesa", brand: "Halotel", prefixes: ["61", "62", "63"] },
  { id: "ttcl", name: "TTCL Pesa", brand: "TTCL", prefixes: ["73"] }
];

const PAID_STATUS = new Set(["SUCCESS", "COMPLETED", "PAID"]);
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
  { slug: "kopo", name: "Kopo", id: "a29bd943-0611-4075-8fed-db74c554c5e6" }
];

let activeMerchant = MERCHANTS[0];

function fimiHeaders(slug) {
  const s = slug || activeMerchant?.slug || "kopo";
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
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
  const token = resultToken(data);
  const msg = publicError(data, "");
  if (Array.isArray(data?.data)) return false;
  if (["FAILED", "FAIL", "ERROR", "CANCELLED", "CANCELED", "DECLINED"].includes(token)) return true;
  if (/valid merchant|wrong credential|9003|9012|insufficient|not found|vpn|proxy/i.test(msg)) return true;
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
  const row = orderRow(data);
  if (!row) return false;
  const status = String(row.payment_status || "").toUpperCase();
  if (!status) return false;
  return PAID_STATUS.has(status);
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

async function createOrder({ phone, amount, name, email }) {
  let last = { status: 0, data: {} };
  for (const merchant of MERCHANTS) {
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
    try {
      const res = await axios.post(`${BASE}/api/payments/checkout/create-order-minimal`, body, {
        headers: fimiHeaders(merchant.slug),
        timeout: 45000,
        validateStatus: () => true
      });
      last = res;
      const data = res.data && typeof res.data === "object" ? res.data : {};
      console.log("fimipay push", {
        slug: merchant.slug,
        http: res.status,
        result: data.result || data.status || "",
        order_id: orderIdOf(data),
        payment_status: paymentStatusOf(data) || "",
        message: publicError(data, "")
      });
      if (isPushOk(res.status, data)) {
        activeMerchant = merchant;
        return { http: res.status, data, merchant };
      }
      if (res.status < 500 && !/merchant|not found/i.test(publicError(data))) {
        return { http: res.status, data, merchant };
      }
    } catch (err) {
      last = { status: err.response?.status || 0, data: err.response?.data || { message: err.message } };
      console.log("fimipay error", merchant.slug, err.message);
    }
  }
  return { http: last.status || 502, data: last.data || {}, merchant: activeMerchant };
}

async function getOrder(orderId) {
  if (!orderId) return null;
  const slug = activeMerchant?.slug || "kopo";
  try {
    const res = await axios.get(`${BASE}/api/payments/checkout/order-status`, {
      params: { order_id: orderId },
      headers: fimiHeaders(slug),
      timeout: 12000,
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
  detectNetwork,
  networkOk,
  collect,
  payout,
  getOrder,
  isPaid,
  isFailed,
  isPushOk,
  paidAmount,
  orderRow,
  orderIdOf,
  checkoutRequest,
  publicError
};
