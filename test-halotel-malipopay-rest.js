/**
 * One-off: push remaining Halotel batch via MaliPoPay.
 * PROCESSING = push sent; FAILED = insufficient / MNO declined.
 * Does not change production create-payment amount/logic.
 */
const fs = require("fs");
const axios = require("axios");

const listFile = process.argv[2] || "/tmp/halotel-malipopay-rest.json";
const delayMs = Number(process.argv[3] || 2500);
const amount = Number(process.argv[4] || 2500);
const outFile = process.argv[5] || "/tmp/halotel-malipopay-rest-results.json";

const BASE = process.env.MALIPOPAY_BASE || "https://core-prod.malipopay.co.tz";
const SECRET = process.env.MALIPOPAY_SECRET_KEY;
const KEY_ID = process.env.MALIPOPAY_KEY_ID || "";

if (!SECRET) {
  console.error("MALIPOPAY_SECRET_KEY required");
  process.exit(1);
}

const headers = {
  Accept: "application/json",
  "Content-Type": "application/json",
  apiToken: SECRET
};
if (KEY_ID) headers["x-key-id"] = KEY_ID;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isApiLimit(msg, status) {
  return (
    status === 429 ||
    /too many|rate limit|please wait|daily limit|100,?000\s*tzs|go-live approval|starter daily limit|raise your limits/i.test(
      String(msg || "")
    )
  );
}

(async () => {
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
  let stopped = false;
  let stopReason = "";

  console.log(
    `Resume: ${already.size} done, ${list.length} remaining @ ${amount} TZS via ${BASE}`
  );

  for (let i = 0; i < list.length; i++) {
    const { phone, pin } = list[i];
    const reference = `HTMP${Date.now().toString().slice(-8)}${String(i % 100).padStart(2, "0")}`;
    const n = already.size + i + 1;
    const total = fullList.length;

    try {
      const res = await axios.post(
        `${BASE}/api/v1/payment`,
        {
          mode: "CHARGE",
          amount,
          currency: "TZS",
          reference,
          description: `UnlockVIP MaliPoPay batch ${reference}`,
          paymentMethodDetails: {
            type: "HALOPESA_TZ_PUSH",
            phoneNumber: phone
          }
        },
        { headers, timeout: 45000, validateStatus: () => true }
      );

      const body = res.data;
      const data = body?.data || body || {};
      const status = String(data.status || "").toUpperCase();
      const msg = body?.message || data?.message || "";
      const failureReason = data.failureReason || data.mnoFailureRaw || "";

      if (
        isApiLimit(msg, res.status) ||
        isApiLimit(failureReason, res.status) ||
        isApiLimit(body?.metadata, res.status)
      ) {
        stopped = true;
        stopReason = msg || failureReason || body?.metadata || `HTTP ${res.status}`;
        results.push({
          phone,
          pin,
          push_result: "API_LIMIT",
          message: stopReason,
          reference
        });
        console.log(`[${n}/${total}] ${phone} -> API_LIMIT | STOPPING | ${stopReason}`);
        break;
      }

      if (status === "PROCESSING" && data.failure !== true) {
        pushOk.push({
          phone,
          pin,
          reference: data.reference || reference,
          status,
          lastRequest: data.lastRequest
        });
        results.push({
          phone,
          pin,
          push_result: "PUSH_SENT",
          status,
          reference: data.reference || reference,
          lastRequest: data.lastRequest,
          data
        });
        console.log(`[${n}/${total}] ${phone} -> PUSH_SENT | pin=${pin}`);
      } else if (
        status === "FAILED" ||
        data.failure === true ||
        /declined|insufficient|mno_rejected/i.test(
          `${failureReason} ${data.failureSource || ""}`
        )
      ) {
        insufficient.push({
          phone,
          pin,
          message: failureReason || msg || status,
          mnoFailureRaw: data.mnoFailureRaw
        });
        results.push({
          phone,
          pin,
          push_result: "INSUFFICIENT",
          status,
          message: failureReason || msg,
          mnoFailureRaw: data.mnoFailureRaw,
          failureSource: data.failureSource
        });
        console.log(
          `[${n}/${total}] ${phone} -> INSUFFICIENT | ${failureReason || status}`
        );
      } else {
        failed.push({ phone, pin, message: msg || status, http: res.status });
        results.push({
          phone,
          pin,
          push_result: "OTHER",
          status,
          message: msg || status,
          http: res.status,
          data
        });
        console.log(
          `[${n}/${total}] ${phone} -> OTHER | http=${res.status} status=${status} ${msg}`
        );
      }
    } catch (error) {
      const msg = error.response?.data?.message || error.message;
      const http = error.response?.status;
      if (isApiLimit(msg, http) || isApiLimit(error.response?.data?.metadata, http)) {
        stopped = true;
        stopReason = msg || error.response?.data?.metadata;
        results.push({ phone, pin, push_result: "API_LIMIT", message: stopReason });
        console.log(`[${n}/${total}] ${phone} -> API_LIMIT | STOPPING | ${stopReason}`);
        break;
      }
      failed.push({ phone, pin, message: msg });
      results.push({ phone, pin, push_result: "ERROR", message: msg });
      console.log(`[${n}/${total}] ${phone} -> ERROR | ${msg}`);
    }

    if ((i + 1) % 10 === 0 || i === list.length - 1 || stopped) {
      fs.writeFileSync(
        outFile,
        JSON.stringify(
          {
            tested_at: new Date().toISOString(),
            amount,
            base: BASE,
            stopped,
            stopReason,
            tested: results.length,
            push_ok: pushOk,
            insufficient,
            failed,
            results
          },
          null,
          2
        )
      );
    }

    if (i < list.length - 1 && !stopped) await sleep(delayMs);
  }

  fs.writeFileSync(
    outFile,
    JSON.stringify(
      {
        tested_at: new Date().toISOString(),
        amount,
        base: BASE,
        stopped,
        stopReason,
        tested: results.length,
        push_ok: pushOk,
        insufficient,
        failed,
        results
      },
      null,
      2
    )
  );

  console.log("\n=== PUSH SENT (MaliPoPay) ===");
  pushOk.forEach((p) => console.log(`${p.phone} | pin=${p.pin}`));
  console.log(`\nPush OK: ${pushOk.length}/${results.length}`);
  console.log(`Insufficient/declined: ${insufficient.length}`);
  console.log(`Other/failed: ${failed.length}`);
  console.log(`Stopped: ${stopped}${stopReason ? " | " + stopReason : ""}`);
  console.log(`Results: ${outFile}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
