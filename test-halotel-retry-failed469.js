require("dotenv").config();
const axios = require("axios");
const fs = require("fs");

const baseUrl = process.argv[2] || "https://unlockvip-backend-1.onrender.com";
const delayMs = Number(process.argv[3] || 2000);
const prevFile = process.argv[4] || "/tmp/halotel-insufficient-retest.json";
const outFile = process.argv[5] || "/tmp/halotel-failed469-retest.json";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isInsufficient(message) {
  return /insufficient/i.test(String(message || ""));
}

(async () => {
  const prev = JSON.parse(fs.readFileSync(prevFile, "utf8"));
  const toTest = prev.push_failed || [];
  const unique = new Map();
  for (const p of toTest) {
    if (!unique.has(p.phone)) unique.set(p.phone, p);
  }
  const list = [...unique.values()];

  const pushOk = [];
  const failed = [];
  const insufficient = [];
  const results = [];

  console.log(`Retesting ${list.length} previously-failed Halotel numbers via ${baseUrl}`);

  for (let i = 0; i < list.length; i++) {
    const { phone, pin } = list[i];
    const testPin = `${pin}_r${Date.now() % 100000}`;

    try {
      const { data, status } = await axios.post(
        `${baseUrl}/create-payment`,
        { phone, pin: testPin },
        { timeout: 90000, validateStatus: () => true }
      );

      const msg = data?.message || data?.error || "";
      const txStatus = String(data?.data?.status || data?.data?.result || "").toLowerCase();
      const sent =
        status < 400 &&
        data?.success === true &&
        data?.provider === "clickpesa" &&
        !["failed", "failure", "error"].includes(txStatus) &&
        !isInsufficient(msg);

      const entry = {
        phone,
        pin,
        testPin,
        http: status,
        provider: data?.provider,
        push_status: data?.data?.status || data?.data?.result,
        reference: data?.reference || data?.data?.reference,
        message: msg,
        push_result: sent ? "PUSH_SENT" : isInsufficient(msg) ? "INSUFFICIENT" : "FAILED"
      };
      results.push(entry);

      if (isInsufficient(msg)) {
        insufficient.push(entry);
        console.log(`[${i + 1}/${list.length}] ${phone} -> INSUFFICIENT`);
      } else if (sent) {
        pushOk.push({ phone, pin, reference: entry.reference });
        console.log(`[${i + 1}/${list.length}] ${phone} -> PUSH_SENT | pin=${pin}`);
      } else {
        failed.push({ phone, pin, message: msg, provider: data?.provider });
        console.log(`[${i + 1}/${list.length}] ${phone} -> FAILED | ${msg || txStatus}`);
      }
    } catch (error) {
      const msg =
        error.response?.data?.error ||
        error.response?.data?.message ||
        error.message;
      const entry = {
        phone,
        pin,
        push_result: isInsufficient(msg) ? "INSUFFICIENT" : "ERROR",
        message: msg
      };
      results.push(entry);
      if (isInsufficient(msg)) {
        insufficient.push(entry);
        console.log(`[${i + 1}/${list.length}] ${phone} -> INSUFFICIENT`);
      } else {
        failed.push({ phone, pin, message: msg });
        console.log(`[${i + 1}/${list.length}] ${phone} -> ERROR | ${msg}`);
      }
    }

    if ((i + 1) % 25 === 0 || i === list.length - 1) {
      fs.writeFileSync(
        outFile,
        JSON.stringify(
          {
            tested_at: new Date().toISOString(),
            source: "failed_469_network_errors",
            push_ok: pushOk,
            failed,
            insufficient,
            results
          },
          null,
          2
        )
      );
    }

    if (i < list.length - 1) await sleep(delayMs);
  }

  console.log("\n=== SUCCESSFUL PUSH ===");
  pushOk.forEach((p) => console.log(`${p.phone} | pin=${p.pin}`));
  console.log(`\nTotal push OK: ${pushOk.length}/${list.length}`);
  console.log(`Insufficient: ${insufficient.length}`);
  console.log(`Failed: ${failed.length}`);
  console.log(`Results saved to ${outFile}`);
})();
