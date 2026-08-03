/**
 * Production Grebo balance tracker.
 * Polls Grebo balance + recent deposits; when money lands, marks matching
 * UnlockVIP payments COMPLETED (even if Grebo status stays "processing").
 */
const { getBalance, listTransactions, buildGreboUpdate } = require("./grebo");

function amountTzs(tx) {
  if (tx?.amount_tzs != null) return Number(tx.amount_tzs);
  if (tx?.amount_cents != null) return Number(tx.amount_cents) / 100;
  if (tx?.amount != null) return Number(tx.amount);
  return 0;
}

function isCompleted(tx) {
  return /^(completed|success|successful)$/i.test(String(tx?.status || ""));
}

function isFailed(tx) {
  return /^(failed|cancelled|canceled|expired|error)$/i.test(String(tx?.status || ""));
}

function startGreboBalanceTracker({
  Payment,
  intervalMs = Number(process.env.GREBO_BALANCE_POLL_MS || 5000),
  expectedAmount = Number(process.env.PAYMENT_AMOUNT || 3061)
} = {}) {
  if (!process.env.GREBO_API_KEY) {
    console.warn("Grebo balance tracker skipped: GREBO_API_KEY missing");
    return { stop() {} };
  }
  if (!Payment) {
    throw new Error("Payment model is required");
  }

  let lastBalance = null;
  let running = false;
  const seenCompleted = new Set();
  const claimedByBalanceJump = new Set();
  const pollMs = Math.max(3000, intervalMs);

  async function markPaid(tx, reason) {
    const payment = await Payment.findOne({
      $or: [
        { reference: tx.reference },
        { order_tracking_id: tx.id },
        { transaction_id: tx.id }
      ]
    });

    if (!payment) {
      console.log(
        "Grebo balance tracker: no admin row for",
        tx.reference || tx.id,
        "amount=",
        amountTzs(tx)
      );
      return null;
    }

    if (payment.status === "COMPLETED") {
      return payment;
    }

    const update = {
      ...buildGreboUpdate({ ...tx, status: "completed" }, "SYNC"),
      status: "COMPLETED",
      reason,
      message: "Payment successful via Grebo (balance tracked)"
    };

    const updated = await Payment.findOneAndUpdate(
      { _id: payment._id, status: { $ne: "COMPLETED" } },
      { $set: update },
      { new: true }
    );

    if (updated) {
      console.log(
        "Grebo balance tracker COMPLETED",
        updated.phone,
        "pin=",
        updated.pin,
        "ref=",
        updated.reference,
        "was=",
        payment.status
      );
    }
    return updated;
  }

  async function tick() {
    if (running) return;
    running = true;
    try {
      let balance = lastBalance;
      try {
        const balRes = await getBalance();
        balance = Number(balRes?.data?.balance ?? balRes?.balance);
      } catch (error) {
        console.error(
          "Grebo balance tracker balance error:",
          error.code || error.message
        );
      }

      const txs = await listTransactions(100);
      const deposits = txs.filter((t) => String(t.type || "deposit") === "deposit");

      if (lastBalance == null && Number.isFinite(balance)) {
        lastBalance = balance;
        console.log(
          "Grebo balance tracker started | balance=",
          balance,
          "TZS | poll=",
          pollMs,
          "ms"
        );
        for (const tx of deposits.filter(isCompleted)) {
          seenCompleted.add(tx.id || tx.reference);
        }
      } else if (
        Number.isFinite(balance) &&
        lastBalance != null &&
        balance !== lastBalance
      ) {
        const delta = balance - lastBalance;
        console.log(
          "Grebo balance",
          lastBalance,
          "→",
          balance,
          `(${delta >= 0 ? "+" : ""}${delta} TZS)`
        );

        if (delta > 0) {
          let candidates = deposits.filter(
            (tx) => isCompleted(tx) && !seenCompleted.has(tx.id || tx.reference)
          );

          if (!candidates.length) {
            const units = Math.max(1, Math.round(delta / expectedAmount));
            candidates = deposits
              .filter((tx) => !isFailed(tx) && !claimedByBalanceJump.has(tx.id || tx.reference))
              .sort((a, b) =>
                String(b.created_at || "").localeCompare(String(a.created_at || ""))
              )
              .slice(0, units);
          }

          for (const tx of candidates) {
            const key = tx.id || tx.reference;
            seenCompleted.add(key);
            claimedByBalanceJump.add(key);
            await markPaid(tx, "BALANCE_TRACKED");
          }
        }

        lastBalance = balance;
      }

      for (const tx of deposits.filter(isCompleted)) {
        const key = tx.id || tx.reference;
        if (claimedByBalanceJump.has(key)) continue;
        seenCompleted.add(key);
        const updated = await markPaid(tx, "SYNCED_FROM_GREBO");
        if (updated) claimedByBalanceJump.add(key);
      }
    } catch (error) {
      console.error(
        "Grebo balance tracker error:",
        error.response?.data || error.message
      );
    } finally {
      running = false;
    }
  }

  const timer = setInterval(tick, pollMs);
  if (typeof timer.unref === "function") timer.unref();
  tick().catch(() => {});

  return {
    stop() {
      clearInterval(timer);
    }
  };
}

module.exports = {
  startGreboBalanceTracker
};
