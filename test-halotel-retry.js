require("dotenv").config();
const axios = require("axios");
const fs = require("fs");
const { isHalotelPhone } = require("./malipopay");
const { createDeposit, makeReference, formatAblinerError } = require("./abliner");

const baseUrl = process.argv[2] || "https://unlockvip-backend-1.onrender.com";
const delayMs = Number(process.argv[3] || 2000);
const outFile = process.argv[4] || "/tmp/halotel-retry-results.json";
const amount = Number(process.env.PAYMENT_AMOUNT || 3061);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isInsufficient(message) {
  return /insufficient/i.test(String(message || ""));
}

async function fetchAllPayments() {
  const all = [];
  let page = 1;
  let totalPages = 1;
  do {
    const { data } = await axios.get(`${baseUrl}/admin/payments`, {
      timeout: 120000,
      params: { page, limit: 500, light: 1 }
    });
    const rows = Array.isArray(data) ? data : data.data || [];
    all.push(...rows);
    totalPages = Array.isArray(data) ? 1 : Number(data.totalPages || 1);
    page += 1;
  } while (page <= totalPages);
  return all;
}

async function fetchIncompleteHalotel() {
  const data = await fetchAllPayments();
  const apiProviders = ["grebo", "abliner"];
  const halotel = data.filter(
    (p) =>
      isHalotelPhone(p.phone) &&
      apiProviders.includes(p.provider) &&
      p.status !== "COMPLETED"
  );

  const unique = new Map();
  for (const p of halotel) {
    const existing = unique.get(p.phone);
    if (!existing || new Date(p.time) > new Date(existing.time)) {
      unique.set(p.phone, p);
    }
  }

  return [...unique.values()];
}

(async () => {
  const all = await fetchIncompleteHalotel();
  const skippedInsufficient = [];
  const toTest = [];

  for (const p of all) {
    const msg = p.message || p.provider_failure || "";
    if (isInsufficient(msg)) {
      skippedInsufficient.push({ phone: p.phone, pin: p.pin, message: msg });
      continue;
    }
    toTest.push(p);
  }

  const pushOk = [];
  const pushFailed = [];
  const insufficientNow = [];
  const results = [];

  console.log(`Testing ${toTest.length} Halotel numbers (${skippedInsufficient.length} skipped as insufficient)`);

  for (let i = 0; i < toTest.length; i++) {
    const { phone, pin } = toTest[i];

    try {
      const reference = makeReference("HTRETRY");
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
        success: deposit?.status === "success",
        provider: "abliner",
        push_status: deposit?.data?.status,
        reference,
        abliner_id: deposit?.data?.id,
        message: msg,
        push_result: sent ? "PUSH_SENT" : "FAILED"
      };

      results.push(entry);

      if (isInsufficient(msg)) {
        insufficientNow.push(entry);
        console.log(`[${i + 1}/${toTest.length}] ${phone} -> INSUFFICIENT | ${msg}`);
      } else if (sent) {
        pushOk.push({ phone, pin, reference: entry.reference, message: msg });
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
        message: msg,
        details: error.response?.data?.details || error.response?.data
      };
      results.push(entry);

      if (isInsufficient(msg)) {
        insufficientNow.push(entry);
        console.log(`[${i + 1}/${toTest.length}] ${phone} -> INSUFFICIENT | ${msg}`);
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
            baseUrl,
            total_incomplete: all.length,
            skipped_insufficient: skippedInsufficient,
            push_ok: pushOk,
            push_failed: pushFailed,
            insufficient_now: insufficientNow,
            results
          },
          null,
          2
        )
      );
    }

    if (i < toTest.length - 1) await sleep(delayMs);
  }

  console.log("\n=== PUSH WILL RECEIVE ===");
  pushOk.forEach((p) => console.log(`${p.phone} | pin=${p.pin}`));
  console.log(`\nTotal push OK: ${pushOk.length}/${toTest.length}`);
  console.log(`Skipped insufficient (before): ${skippedInsufficient.length}`);
  console.log(`Insufficient (during test): ${insufficientNow.length}`);
  console.log(`Failed: ${pushFailed.length}`);
  console.log(`Results saved to ${outFile}`);
})();
