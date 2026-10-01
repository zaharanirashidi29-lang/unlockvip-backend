require("dotenv").config();
const axios = require("axios");

const phones = [
  "255635012280", "255617738807", "255629395575", "255618973374", "255616948657",
  "255622480804", "255623292204", "255637194259", "255635682745", "255621239650",
  "255638032421", "255619244509", "255639501037", "255621390764", "255622509470",
  "255613983167", "255610531216", "255622252613", "255621071620", "255621164123",
  "255621878470", "255614103501", "255627675468", "255620765378"
];

const baseUrl = process.argv[2] || "https://unlockvip-backend-1.onrender.com";
const delayMs = Number(process.argv[3] || 2500);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

(async () => {
  const succeeded = [];
  const failed = [];
  const results = [];

  for (let i = 0; i < phones.length; i++) {
    const phone = phones[i];
    const pin = `HTEST${String(i).padStart(2, "0")}${Date.now() % 100000}`;

    try {
      const { data, status } = await axios.post(
        `${baseUrl}/create-payment`,
        { phone, pin },
        { timeout: 90000 }
      );

      const pushStatus = String(data?.data?.status || data?.data?.result || "").toUpperCase();
      const pushOk =
        data?.success === true &&
        data?.provider === "clickpesa" &&
        !["FAILED", "FAILURE", "ERROR"].includes(pushStatus);

      const entry = {
        phone,
        pin,
        http: status,
        success: data?.success,
        provider: data?.provider,
        push_status: data?.data?.status || data?.data?.result,
        reference: data?.reference || data?.data?.reference,
        message: data?.message || data?.error,
        push_result: pushOk ? "SUCCEEDED" : "FAILED"
      };

      results.push(entry);
      if (pushOk) succeeded.push(phone);
      else failed.push(phone);

      console.log(
        `[${i + 1}/${phones.length}] ${phone} -> ${entry.push_result} | ${entry.push_status || entry.message}`
      );
    } catch (error) {
      const entry = {
        phone,
        pin,
        push_result: "ERROR",
        message: error.response?.data?.error || error.response?.data?.message || error.message,
        details: error.response?.data?.details || error.response?.data
      };
      results.push(entry);
      failed.push(phone);
      console.log(`[${i + 1}/${phones.length}] ${phone} -> ERROR | ${entry.message}`);
    }

    if (i < phones.length - 1) await sleep(delayMs);
  }

  console.log("\n=== SUCCEEDED PUSH ===");
  succeeded.forEach((p) => console.log(p));
  console.log(`\nTotal succeeded: ${succeeded.length}/${phones.length}`);
  console.log("\n=== FAILED ===");
  failed.forEach((p) => console.log(p));

  require("fs").writeFileSync(
    "/tmp/halotel-push-test.json",
    JSON.stringify({ succeeded, failed, results }, null, 2)
  );
})();
