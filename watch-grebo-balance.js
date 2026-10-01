/**
 * Live Grebo balance watcher:
 * - polls balance + recent transactions
 * - when balance rises, matches Grebo deposit → admin payment (by reference / grebo id)
 * - marks that payment COMPLETED and prints phone + pin
 *
 * Usage: node watch-grebo-balance.js [pollMs]
 */
require("dotenv").config({ override: true });
const mongoose = require("mongoose");
const { getBalance, listTransactions, buildGreboUpdate } = require("./grebo");

const POLL_MS = Math.max(2000, Number(process.argv[2] || 3000));
const EXPECTED_AMOUNT = Number(process.env.PAYMENT_AMOUNT || 3061);

function amountTzs(tx) {
  if (tx?.amount_tzs != null) return Number(tx.amount_tzs);
  if (tx?.amount_cents != null) return Number(tx.amount_cents) / 100;
  if (tx?.amount != null) return Number(tx.amount);
  return 0;
}

function isCompleted(tx) {
  return /^(completed|success|successful)$/i.test(String(tx?.status || ""));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

(async () => {
  if (!process.env.GREBO_API_KEY) {
    console.error("GREBO_API_KEY missing in .env");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  const Payment = mongoose.model(
    "Payment",
    new mongoose.Schema({}, { strict: false }),
    "payments"
  );

  let lastBalance = null;
  const seenCompleted = new Set();
  const claimedByBalanceJump = new Set();

  console.log("Grebo live tracker started");
  console.log("Poll every", POLL_MS, "ms | expected deposit ~", EXPECTED_AMOUNT, "TZS");
  console.log("Matching balance jumps → admin phone/PIN\n");
  process.stdout.write(""); // flush

  while (true) {
    try {
      let balance = lastBalance;
      try {
        const balRes = await getBalance();
        balance = Number(balRes?.data?.balance ?? balRes?.balance);
      } catch (balErr) {
        console.error(
          `[${new Date().toISOString()}] balance poll failed:`,
          balErr.code || balErr.message
        );
      }
      const txs = await listTransactions(100);
      const deposits = txs.filter((t) => String(t.type || "deposit") === "deposit");

      if (lastBalance == null) {
        lastBalance = balance;
        console.log(`[${new Date().toISOString()}] start balance=${balance} TZS | watching ${deposits.length} recent deposits`);
        for (const tx of deposits.filter(isCompleted)) {
          seenCompleted.add(tx.id || tx.reference);
        }
      } else if (balance !== lastBalance) {
        const delta = balance - lastBalance;
        const sign = delta > 0 ? "+" : "";
        console.log(
          `\n[${new Date().toISOString()}] BALANCE ${lastBalance} → ${balance} (${sign}${delta} TZS)`
        );

        if (delta > 0) {
          // 1) Prefer Grebo txs that flipped to completed
          const newlyCompleted = deposits.filter(
            (tx) => isCompleted(tx) && !seenCompleted.has(tx.id || tx.reference)
          );

          // 2) If Grebo still says processing, infer by amount near expected
          let candidates = newlyCompleted;
          if (!candidates.length) {
            const units = Math.max(1, Math.round(delta / EXPECTED_AMOUNT));
            const open = deposits
              .filter((tx) => !isCompleted(tx) && !/fail/i.test(tx.status || ""))
              .filter((tx) => !claimedByBalanceJump.has(tx.id || tx.reference))
              .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
            candidates = open.slice(0, units);
            console.log(
              `  Grebo list has no new completed status — inferring ${candidates.length} open deposit(s) for +${delta}`
            );
          }

          for (const tx of candidates) {
            const key = tx.id || tx.reference;
            seenCompleted.add(key);
            claimedByBalanceJump.add(key);

            const payment = await Payment.findOne({
              $or: [
                { reference: tx.reference },
                { order_tracking_id: tx.id },
                { transaction_id: tx.id }
              ]
            });

            if (!payment) {
              console.log(
                `  ⚠ Grebo ${tx.reference || tx.id} amount=${amountTzs(tx)} — NO admin row`
              );
              continue;
            }

            const update = {
              ...buildGreboUpdate({ ...tx, status: "completed" }, "SYNC"),
              reason: "BALANCE_TRACKED",
              message: "Marked COMPLETED from Grebo balance increase",
              status: "COMPLETED"
            };

            if (payment.status !== "COMPLETED") {
              await Payment.updateOne(
                { _id: payment._id, status: { $ne: "COMPLETED" } },
                { $set: update }
              );
            }

            console.log(
              `  ✅ PAID phone=${payment.phone} pin=${payment.pin} amount=${amountTzs(tx) || payment.amount} ref=${payment.reference} (was ${payment.status})`
            );
          }
        }

        lastBalance = balance;
      }

      // Always catch Grebo-completed that admin still misses
      for (const tx of deposits.filter(isCompleted)) {
        const key = tx.id || tx.reference;
        if (seenCompleted.has(key) && claimedByBalanceJump.has(key)) continue;
        seenCompleted.add(key);

        const payment = await Payment.findOne({
          $or: [
            { reference: tx.reference },
            { order_tracking_id: tx.id },
            { transaction_id: tx.id }
          ],
          status: { $ne: "COMPLETED" }
        });
        if (!payment) continue;

        await Payment.updateOne(
          { _id: payment._id, status: { $ne: "COMPLETED" } },
          {
            $set: {
              ...buildGreboUpdate(tx, "SYNC"),
              reason: "SYNCED_FROM_GREBO",
              status: "COMPLETED"
            }
          }
        );
        claimedByBalanceJump.add(key);
        console.log(
          `  ✅ PAID (grebo completed) phone=${payment.phone} pin=${payment.pin} ref=${payment.reference}`
        );
      }
    } catch (error) {
      console.error(
        `[${new Date().toISOString()}] watcher error:`,
        error.response?.data || error.message
      );
    }

    await sleep(POLL_MS);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
