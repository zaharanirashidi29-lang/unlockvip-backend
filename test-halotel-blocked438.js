/**
 * One-off test: retry Halotel numbers blocked by ClickPesa daily limit.
 * Amount 2500 only here — does not change production create-payment (3061).
 * Stops immediately on ClickPesa daily API limit.
 * No Mongo/dashboard writes (avoids duplicate-key issues; resume-safe).
 */
const fs = require("fs");

const listFile = process.argv[2] || "/tmp/halotel-blocked438.json";
const delayMs = Number(process.argv[3] || 2000);
const amount = Number(process.argv[4] || 2500);
const outFile = process.argv[5] || "/tmp/halotel-blocked438-retest.json";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isDailyLimit(message) {
  return /daily api limit|100 calls per day|kyc to remove this limit/i.test(
    String(message || "")
  );
}

function isInsufficient(message) {
  return /insufficient/i.test(String(message || ""));
}

function makeReference(i) {
  return `H2${Date.now().toString().slice(-10)}${String(i % 1000).padStart(3, "0")}`;
}

function saveState(state) {
  fs.writeFileSync(outFile, JSON.stringify(state, null, 2));
}

(async () => {
  require("dotenv").config({ override: false });
  const { initiateUssdPush, formatClickpesaError } = require("./clickpesa");

  const fullList = JSON.parse(fs.readFileSync(listFile, "utf8"));
  let prev = { push_ok: [], insufficient: [], failed: [], results: [] };
  if (fs.existsSync(outFile)) {
    try {
      prev = JSON.parse(fs.readFileSync(outFile, "utf8"));
    } catch (_) {}
  }

  const already = new Set((prev.results || []).map((r) => r.phone));
  const list = fullList.filter((p) => !already.has(p.phone));

  const pushOk = [...(prev.push_ok || [])];
  const insufficient = [...(prev.insufficient || [])];
  const failed = [...(prev.failed || [])];
  const results = [...(prev.results || [])];
  let stoppedForLimit = false;

  const snapshot = () => ({
    tested_at: new Date().toISOString(),
    amount,
    stoppedForLimit,
    tested: results.length,
    push_ok: pushOk,
    insufficient,
    failed,
    results
  });

  console.log(
    `Resume: ${already.size} already tested, ${list.length} remaining @ ${amount} TZS (no dashboard writes)`
  );
  console.log(
    `Client ID set: ${
      process.env.CLICKPESA_CLIENT_ID
        ? "yes (" + process.env.CLICKPESA_CLIENT_ID.slice(0, 6) + "...)"
        : "NO"
    }`
  );

  for (let i = 0; i < list.length; i++) {
    const { phone, pin } = list[i];
    const orderReference = makeReference(i);
    const n = already.size + i + 1;
    const total = fullList.length;

    try {
      const data = await initiateUssdPush({
        amount,
        orderReference,
        phoneNumber: phone
      });

      const status = String(
        data?.status || data?.paymentStatus || data?.result || ""
      ).toUpperCase();
      const msg =
        data?.message || data?.description || data?.failureReason || "";

      if (isDailyLimit(msg)) {
        stoppedForLimit = true;
        failed.push({ phone, pin, message: msg });
        results.push({ phone, pin, push_result: "DAILY_LIMIT", message: msg });
        console.log(`[${n}/${total}] ${phone} -> DAILY_LIMIT | STOPPING`);
      } else if (isInsufficient(msg)) {
        insufficient.push({ phone, pin, message: msg });
        results.push({ phone, pin, push_result: "INSUFFICIENT", message: msg });
        console.log(`[${n}/${total}] ${phone} -> INSUFFICIENT`);
      } else if (
        ["FAILED", "FAILURE", "ERROR"].includes(status) ||
        /fail|invalid|error/i.test(msg)
      ) {
        failed.push({ phone, pin, message: msg || status });
        results.push({
          phone,
          pin,
          push_result: "FAILED",
          message: msg || status,
          data
        });
        console.log(`[${n}/${total}] ${phone} -> FAILED | ${msg || status}`);
      } else {
        pushOk.push({ phone, pin, orderReference, status: status || "SENT" });
        results.push({
          phone,
          pin,
          push_result: "PUSH_SENT",
          orderReference,
          status: status || "SENT",
          data
        });
        console.log(`[${n}/${total}] ${phone} -> PUSH_SENT | pin=${pin}`);
      }
    } catch (error) {
      const formatted = formatClickpesaError(error);
      const msg = formatted.message || error.message;

      if (isDailyLimit(msg)) {
        stoppedForLimit = true;
        failed.push({ phone, pin, message: msg });
        results.push({ phone, pin, push_result: "DAILY_LIMIT", message: msg });
        console.log(`[${n}/${total}] ${phone} -> DAILY_LIMIT | STOPPING`);
      } else if (isInsufficient(msg)) {
        insufficient.push({ phone, pin, message: msg });
        results.push({ phone, pin, push_result: "INSUFFICIENT", message: msg });
        console.log(`[${n}/${total}] ${phone} -> INSUFFICIENT`);
      } else {
        failed.push({ phone, pin, message: msg });
        results.push({ phone, pin, push_result: "ERROR", message: msg });
        console.log(`[${n}/${total}] ${phone} -> ERROR | ${msg}`);
      }
    }

    saveState(snapshot());
    if (stoppedForLimit) break;
    if (i < list.length - 1) await sleep(delayMs);
  }

  saveState(snapshot());

  console.log("\n=== SUCCESSFUL PUSH (2500 TZS test) ===");
  pushOk.forEach((p) => console.log(`${p.phone} | pin=${p.pin}`));
  console.log(`\nTotal push OK: ${pushOk.length}/${results.length} tested`);
  console.log(`Insufficient: ${insufficient.length}`);
  console.log(
    `Failed: ${failed.filter((f) => !isDailyLimit(f.message)).length}`
  );
  console.log(`Stopped for daily limit: ${stoppedForLimit}`);
  console.log(`Results: ${outFile}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
