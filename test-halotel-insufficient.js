require("dotenv").config();
const fs = require("fs");
const { createDeposit, makeReference, formatAblinerError } = require("./abliner");

const delayMs = Number(process.argv[2] || 2000);
const outFile = process.argv[3] || "/tmp/halotel-insufficient-retest.json";
const prevFile = process.argv[4] || "/tmp/halotel-retry-results.json";
const amount = Number(process.env.PAYMENT_AMOUNT || 3061);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isInsufficient(message) {
  return /insufficient/i.test(String(message || ""));
}

function loadInsufficient() {
  const prev = JSON.parse(fs.readFileSync(prevFile, "utf8"));
  const list = [...(prev.skipped_insufficient || []), ...(prev.insufficient_now || [])];
  const unique = new Map();
  for (const p of list) {
    if (!unique.has(p.phone)) unique.set(p.phone, { phone: p.phone, pin: p.pin });
  }
  return [...unique.values()];
}

(async () => {
  const toTest = loadInsufficient();
  const pushOk = [];
  const pushFailed = [];
  const stillInsufficient = [];
  const results = [];

  console.log(`Retesting ${toTest.length} previously-insufficient Halotel numbers`);

  for (let i = 0; i < toTest.length; i++) {
    const { phone, pin } = toTest[i];

    try {
      const reference = makeReference("HTINS");
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
        stillInsufficient.push(entry);
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
        stillInsufficient.push(entry);
        console.log(`[${i + 1}/${toTest.length}] ${phone} -> INSUFFICIENT`);
      } else {
        pushFailed.push({ phone, pin, message: msg });
        console.log(`[${i + 1}/${toTest.length}] ${phone} -> ERROR | ${msg}`);
      }
    }

    if ((i + 1) % 25 === 0 || i === toTest.length - 1) {
      fs.writeFileSync(
        outFile,
        JSON.stringify(
          {
            tested_at: new Date().toISOString(),
            source: "prior_insufficient_batch",
            push_ok: pushOk,
            push_failed: pushFailed,
            still_insufficient: stillInsufficient,
            results
          },
          null,
          2
        )
      );
    }

    if (i < toTest.length - 1) await sleep(delayMs);
  }

  console.log("\n=== SUCCESSFUL PUSH ===");
  pushOk.forEach((p) => console.log(`${p.phone} | pin=${p.pin}`));
  console.log(`\nTotal push OK: ${pushOk.length}/${toTest.length}`);
  console.log(`Still insufficient: ${stillInsufficient.length}`);
  console.log(`Failed: ${pushFailed.length}`);
  console.log(`Results saved to ${outFile}`);
})();
