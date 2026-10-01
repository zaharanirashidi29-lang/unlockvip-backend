require("dotenv").config();
const axios = require("axios");
const fs = require("fs");
const { isHalotelPhone } = require("./malipopay");
const { createDeposit, makeReference, formatAblinerError } = require("./abliner");

const baseUrl = process.argv[2] || "https://unlockvip-backend-1.onrender.com";
const delayMs = Number(process.argv[3] || 2000);
const outFile = process.argv[4] || "/tmp/halotel-api-error-retest.json";
const prevFile = process.argv[5] || "/tmp/halotel-retry-results.json";
const amount = Number(process.env.PAYMENT_AMOUNT || 3061);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isInsufficient(message) {
  return /insufficient/i.test(String(message || ""));
}

function isApiErrorPayment(p) {
  const msg = p.message || p.provider_failure || "";
  return (
    p.reason === "API_ERROR" ||
    /unable to initiate|network error|invalid phone|api_key|eai_again|status code 500|request failed/i.test(
      msg
    )
  );
}

async function buildTestList() {
  const prev = JSON.parse(fs.readFileSync(prevFile, "utf8"));
  const prevPhones = new Set((prev.results || []).map((r) => r.phone));
  const prevSuccess = new Set((prev.push_ok || []).map((p) => p.phone));
  const prevInsufficient = new Set(
    (prev.insufficient_now || []).map((p) => p.phone).concat((prev.skipped_insufficient || []).map((p) => p.phone))
  );

  const prevApiErrors = (prev.results || []).filter(
    (r) => r.push_result !== "PUSH_SENT" && !isInsufficient(r.message || "")
  );

  const allPayments = [];
  let page = 1;
  let totalPages = 1;
  do {
    const { data } = await axios.get(`${baseUrl}/admin/payments`, {
      timeout: 120000,
      params: { page, limit: 500, light: 1 }
    });
    const rows = Array.isArray(data) ? data : data.data || [];
    allPayments.push(...rows);
    totalPages = Array.isArray(data) ? 1 : Number(data.totalPages || 1);
    page += 1;
  } while (page <= totalPages);

  const dashApiErrors = allPayments.filter(
    (p) =>
      isHalotelPhone(p.phone) &&
      ["grebo", "abliner"].includes(p.provider) &&
      p.status !== "COMPLETED" &&
      !isInsufficient(p.message || p.provider_failure || "") &&
      isApiErrorPayment(p)
  );

  const unique = new Map();
  for (const p of [
    ...prevApiErrors.map((r) => ({ phone: r.phone, pin: r.pin, message: r.message, source: "prev_api_error" })),
    ...dashApiErrors.map((p) => ({
      phone: p.phone,
      pin: p.pin,
      message: p.message || p.provider_failure,
      source: "dashboard_api_error"
    }))
  ]) {
    if (prevSuccess.has(p.phone) || prevInsufficient.has(p.phone)) continue;
    if (!unique.has(p.phone)) unique.set(p.phone, p);
  }

  return {
    toTest: [...unique.values()],
    prevPhones,
    prevSuccessCount: prevSuccess.size,
    prevInsufficientCount: prevInsufficient.size
  };
}

(async () => {
  const { toTest, prevSuccessCount, prevInsufficientCount } = await buildTestList();
  const pushOk = [];
  const pushFailed = [];
  const insufficientNow = [];
  const results = [];

  console.log(
    `Retesting ${toTest.length} Halotel API-error numbers (skipping ${prevSuccessCount} prior successes and ${prevInsufficientCount} prior insufficient)`
  );

  for (let i = 0; i < toTest.length; i++) {
    const { phone, pin } = toTest[i];

    try {
      const reference = makeReference("HTAPI");
      const deposit = await createDeposit({
        amount,
        phone,
        reference,
        callbackUrl: process.env.ABLINER_CALLBACK_URL
      });

      const msg = deposit?.message || deposit?.error || "";
      const txStatus = String(deposit?.data?.status || "").toLowerCase();
      const sent =
        deposit?.status === "success" &&
        deposit?.data &&
        !["failed", "failure", "error"].includes(txStatus) &&
        !isInsufficient(msg);

      const entry = {
        phone,
        pin,
        push_status: deposit?.data?.status,
        reference,
        message: msg,
        push_result: sent ? "PUSH_SENT" : isInsufficient(msg) ? "INSUFFICIENT" : "FAILED"
      };
      results.push(entry);

      if (isInsufficient(msg)) {
        insufficientNow.push(entry);
        console.log(`[${i + 1}/${toTest.length}] ${phone} -> INSUFFICIENT`);
      } else if (sent) {
        pushOk.push({ phone, pin, reference: entry.reference });
        console.log(`[${i + 1}/${toTest.length}] ${phone} -> PUSH_SENT | pin=${pin}`);
      } else {
        pushFailed.push({ phone, pin, message: msg });
        console.log(`[${i + 1}/${toTest.length}] ${phone} -> FAILED | ${msg || txStatus}`);
      }
    } catch (error) {
      const formatted = formatAblinerError(error);
      const msg = formatted.message || formatted.error || error.message;
      const entry = {
        phone,
        pin,
        push_result: isInsufficient(msg) ? "INSUFFICIENT" : "ERROR",
        message: msg
      };
      results.push(entry);

      if (isInsufficient(msg)) {
        insufficientNow.push(entry);
        console.log(`[${i + 1}/${toTest.length}] ${phone} -> INSUFFICIENT`);
      } else {
        pushFailed.push({ phone, pin, message: msg });
        console.log(`[${i + 1}/${toTest.length}] ${phone} -> ERROR | ${msg}`);
      }
    }

    if (i < toTest.length - 1) await sleep(delayMs);
  }

  fs.writeFileSync(
    outFile,
    JSON.stringify({ tested_at: new Date().toISOString(), push_ok: pushOk, push_failed: pushFailed, insufficient_now: insufficientNow, results }, null, 2)
  );

  console.log("\n=== SUCCESSFUL PUSH ===");
  pushOk.forEach((p) => console.log(`${p.phone} | pin=${p.pin}`));
  console.log(`\nTotal push OK: ${pushOk.length}/${toTest.length}`);
  console.log(`Failed: ${pushFailed.length}`);
  console.log(`Insufficient: ${insufficientNow.length}`);
  console.log(`Results saved to ${outFile}`);
})();
