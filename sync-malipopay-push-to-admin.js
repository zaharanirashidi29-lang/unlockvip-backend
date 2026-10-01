/**
 * Sync MaliPoPay PUSH_SENT rows to admin dashboard while batch runs.
 * Pin stored as original~m2500 to avoid phone+pin collisions.
 */
const fs = require("fs");

const resultFiles = [
  "/tmp/halotel-last3days-results.json",
  "/tmp/halotel-malipopay-remain2-results.json",
  "/tmp/halotel-malipopay-rest-results.json",
  "/tmp/halotel-malipopay-compare.json"
];
const logFile = process.env.MALIPOPAY_SYNC_LOG || "/tmp/halotel-malipopay-remain2.log";
const amount = 2500;
const pollMs = Number(process.argv[2] || 5000);
const maxIdleMs = Number(process.argv[3] || 120000); // stop after batch quiet

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function collectPushOk() {
  const map = new Map();

  for (const f of resultFiles) {
    if (!fs.existsSync(f)) continue;
    try {
      const data = JSON.parse(fs.readFileSync(f, "utf8"));
      for (const p of data.push_ok || []) {
        if (!p.phone) continue;
        map.set(p.phone, {
          phone: p.phone,
          pin: p.pin,
          reference: p.reference || p.orderReference,
          lastRequest: p.lastRequest,
          status: p.status || "PROCESSING"
        });
      }
      for (const r of data.results || []) {
        if (r.push_result !== "PUSH_SENT" && r.push_result !== "PUSH_LIKELY") {
          continue;
        }
        if (!r.phone) continue;
        map.set(r.phone, {
          phone: r.phone,
          pin: r.pin,
          reference: r.reference || r.data?.reference,
          lastRequest: r.lastRequest || r.data?.lastRequest,
          status: r.status || "PROCESSING",
          data: r.data
        });
      }
    } catch (_) {}
  }

  // Fallback parse from log lines: ... -> PUSH_SENT | pin=XXXX
  if (fs.existsSync(logFile)) {
    const lines = fs.readFileSync(logFile, "utf8").split("\n");
    for (const line of lines) {
      const m = line.match(
        /\]\s+(255\d{9})\s+->\s+PUSH_SENT\s+\|\s+pin=(\S+)/
      );
      if (!m) continue;
      if (!map.has(m[1])) {
        map.set(m[1], {
          phone: m[1],
          pin: m[2],
          reference: `HTMPLOG${m[1].slice(-8)}`,
          status: "PROCESSING"
        });
      }
    }
  }

  return [...map.values()];
}

(async () => {
  require("dotenv").config({ override: false });
  const mongoose = require("mongoose");
  await mongoose.connect(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 30000
  });

  const Payment = mongoose.model(
    "Payment",
    new mongoose.Schema({}, { strict: false }),
    "payments"
  );

  const synced = new Set();
  let lastNewAt = Date.now();
  let batchAlive = true;

  console.log("Watching for MaliPoPay PUSH_SENT → admin dashboard...");

  while (batchAlive || Date.now() - lastNewAt < maxIdleMs) {
    // batch still running?
    try {
      const { execSync } = require("child_process");
      execSync("pgrep -f 'test-halotel-malipopay-rest.js'", { stdio: "ignore" });
      batchAlive = true;
    } catch (_) {
      batchAlive = false;
    }

    const pushes = collectPushOk();
    let newCount = 0;

    for (const p of pushes) {
      if (synced.has(p.phone)) continue;
      const reference = String(p.reference || `HTMP${p.phone.slice(-10)}`).slice(
        0,
        40
      );
      const dashPin = `${p.pin || ""}~m2500`;

      try {
        await Payment.findOneAndUpdate(
          { reference },
          {
            phone: p.phone,
            pin: dashPin,
            amount,
            reference,
            provider: "malipopay",
            order_tracking_id: reference,
            status: "PROCESSING",
            reason: "USSD_SENT",
            time: new Date().toLocaleString(),
            result: "PROCESSING",
            resultcode: "PROCESSING",
            message: `USSD push sent via Halopesa (MaliPoPay test ${amount} TZS) | original_pin=${p.pin || ""}`,
            provider_response: {
              test_batch: "malipopay_rest",
              amount,
              original_pin: p.pin,
              lastRequest: p.lastRequest,
              ...(p.data || {})
            }
          },
          { upsert: true, new: true }
        );
        synced.add(p.phone);
        newCount++;
        lastNewAt = Date.now();
        console.log(`DASHBOARD + ${p.phone} | pin=${p.pin} | ref=${reference}`);
      } catch (err) {
        if (err?.code === 11000) {
          // collision on phone+pin — retry unique reference
          const altRef = `HTMP${Date.now().toString().slice(-9)}${p.phone.slice(-4)}`;
          try {
            await Payment.findOneAndUpdate(
              { reference: altRef },
              {
                phone: p.phone,
                pin: `${p.pin || ""}~m2500`,
                amount,
                reference: altRef,
                provider: "malipopay",
                status: "PROCESSING",
                reason: "USSD_SENT",
                time: new Date().toLocaleString(),
                message: `USSD push sent via Halopesa (MaliPoPay test ${amount} TZS) | original_pin=${p.pin || ""}`,
                provider_response: {
                  test_batch: "malipopay_rest",
                  amount,
                  original_pin: p.pin
                }
              },
              { upsert: true, new: true }
            );
            synced.add(p.phone);
            newCount++;
            lastNewAt = Date.now();
            console.log(`DASHBOARD + ${p.phone} | pin=${p.pin} | ref=${altRef}`);
          } catch (e2) {
            console.error("save fail", p.phone, e2.message);
          }
        } else {
          console.error("save fail", p.phone, err.message);
        }
      }
    }

    if (newCount === 0) {
      process.stdout.write(
        `\rSynced ${synced.size} push-sent | batch ${batchAlive ? "running" : "done"}   `
      );
    }

    if (!batchAlive && Date.now() - lastNewAt >= maxIdleMs) break;
    await sleep(pollMs);
  }

  console.log(`\nDone. Total push-sent on admin: ${synced.size}`);
  await mongoose.disconnect();
})().catch(async (e) => {
  console.error(e);
  try {
    await require("mongoose").disconnect();
  } catch (_) {}
  process.exit(1);
});
