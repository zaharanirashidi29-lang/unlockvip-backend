const axios = require("axios");

const BASE = "https://harakapay.net";
let runtimeKey = "";

function setKey(key) {
  runtimeKey = String(key || "").trim();
}

function apiKey() {
  return String(process.env.HARAKAPAY_API_KEY || runtimeKey || "").trim();
}

function localPhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.startsWith("255") && digits.length >= 12) return "0" + digits.slice(3, 12);
  if (digits.startsWith("0") && digits.length >= 10) return digits.slice(0, 10);
  if (digits.length === 9) return "0" + digits;
  return digits;
}

async function request(method, path, body) {
  const key = apiKey();
  if (!key) {
    const err = new Error("HarakaPay is not configured");
    err.code = "NO_KEY";
    throw err;
  }
  const res = await axios({
    method,
    url: BASE + path,
    data: body,
    timeout: 45000,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-API-Key": key
    },
    validateStatus: () => true
  });
  const data = res.data && typeof res.data === "object" ? res.data : {};
  return { http: res.status, data };
}

async function collect({ phone, amount, description, webhookUrl }) {
  const { data } = await request("POST", "/api/v1/collect", {
    phone: localPhone(phone),
    amount: Number(amount),
    description: description || "Paribet deposit",
    webhook_url: webhookUrl || undefined
  });
  return data;
}

async function status(orderId) {
  const { data } = await request("GET", "/api/v1/status/" + encodeURIComponent(orderId));
  return data;
}

module.exports = { collect, status, localPhone, setKey, configured: () => Boolean(apiKey()) };
