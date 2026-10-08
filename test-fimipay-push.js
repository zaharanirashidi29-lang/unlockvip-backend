require("dotenv").config();
const axios = require("axios");
const { collect, checkoutRequest, proxyEnvSnapshot, MERCHANTS, BASE } = require("./paribet/fimipay");

const phoneArg = process.argv[2] || "0794316132";
const amount = Number(process.argv[3] || 10000);

function normalizePhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.startsWith("255")) return digits.slice(0, 12);
  if (digits.startsWith("0") && digits.length === 10) return `255${digits.slice(1)}`;
  if (digits.length === 9) return `255${digits}`;
  return digits;
}

(async () => {
  const phone = normalizePhone(phoneArg);
  let egressIp = null;
  try {
    const ipRes = await axios.get("https://api.ipify.org?format=json", { timeout: 8000, proxy: false });
    egressIp = ipRes.data?.ip || null;
  } catch (_) {
    egressIp = "(could not resolve)";
  }

  console.log("=== FimiPay env check ===");
  console.log({
    FIMIPAY_API_BASE_URL: process.env.FIMIPAY_API_BASE_URL || "(missing)",
    FIMIPAY_MERCHANT_SLUG: process.env.FIMIPAY_MERCHANT_SLUG || "(missing)",
    FIMIPAY_MERCHANT_NAME: process.env.FIMIPAY_MERCHANT_NAME || "(missing)",
    FIMIPAY_MERCHANT_ID: process.env.FIMIPAY_MERCHANT_ID || "(missing)",
    FIMIPAY_API_KEY: process.env.FIMIPAY_API_KEY ? "(set)" : "(not used by checkout)",
    FIMIPAY_API_SECRET: process.env.FIMIPAY_API_SECRET ? "(set)" : "(not used by checkout)",
    resolved_BASE: BASE,
    resolved_MERCHANTS: MERCHANTS,
    egressIp,
    proxy: proxyEnvSnapshot()
  });

  console.log("=== Checkout payload preview ===");
  console.log(JSON.stringify(checkoutRequest({ phone, amount, name: "UnlockVIP test" }), null, 2));

  console.log("=== Sending collect() ===");
  const result = await collect({
    phone,
    amount,
    name: "UnlockVIP test"
  });
  console.log("=== Result ===");
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
})().catch((err) => {
  console.error("FATAL:", err.message);
  if (err.details) console.error(JSON.stringify(err.details, null, 2));
  process.exit(1);
});
