/**
 * Production Grebo tracker for EVERY incoming payment:
 * - polls Grebo balance (catch paid-but-still-processing)
 * - polls Grebo transaction list and matches every open admin row by reference / grebo id
 * - marks COMPLETED / FAILED as soon as Grebo flips
 */
const {
  getBalance,
  listTransactions,
  buildGreboUpdate,
  followUpTransaction,
  isGreboFollowUpConfigured,
  warnFollowUpAuthOnce
} = require("./grebo");

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
  followUpIntervalMs = Number(process.env.GREBO_FOLLOW_UP_INTERVAL_MS || 12000),
  followUpBatchSize = Number(process.env.GREBO_FOLLOW_UP_BATCH || 20),
  expectedAmount = Number(process.env.PAYMENT_AMOUNT || 3061),
  openLimit = Number(process.env.GREBO_OPEN_SYNC_LIMIT || 300)
} = {}) {
  if (!process.env.GREBO_API_KEY) {
    console.warn("Grebo tracker skipped: GREBO_API_KEY missing");
    return { stop() {} };
  }
  if (!Payment) {
    throw new Error("Payment model is required");
  }

  let lastBalance = null;
  let running = false;
  const claimedByBalanceJump = new Set();
  const lastFollowUpAt = new Map();
  const pollMs = Math.max(3000, intervalMs);
  const followUpMs = Math.max(8000, followUpIntervalMs);
  const followUpLimit = Math.max(1, followUpBatchSize);

  async function applyGreboTx(payment, tx, reason) {
    if (!payment || !tx) return null;
    if (payment.status === "COMPLETED") return payment;

    const update = buildGreboUpdate(tx, "SYNC");
    if (update.status === "PROCESSING") {
      return null;
    }

    if (update.status === "COMPLETED") {
      update.reason = reason || "SYNCED_FROM_GREBO";
      update.message = update.message || "Payment successful via Grebo";
    }

    const updated = await Payment.findOneAndUpdate(
      { _id: payment._id, status: { $ne: "COMPLETED" } },
      { $set: update },
      { new: true }
    );

    if (updated) {
      console.log(
        `Grebo tracker ${updated.status}`,
        updated.phone,
        "pin=",
        updated.pin,
        "ref=",
        updated.reference,
        "grebo=",
        tx.status,
        "was=",
        payment.status
      );
    }
    return updated;
  }

  async function markPaidFromBalance(tx, reason) {
    const payment = await Payment.findOne({
      $or: [
        { reference: tx.reference },
        { order_tracking_id: tx.id },
        { transaction_id: tx.id }
      ]
    });
    if (!payment) {
      console.log(
        "Grebo tracker: balance jump but no admin row for",
        tx.reference || tx.id,
        "amount=",
        amountTzs(tx)
      );
      return null;
    }
    return applyGreboTx(
      payment,
      { ...tx, status: "completed" },
      reason || "BALANCE_TRACKED"
    );
  }

  function indexDeposits(deposits) {
    const byRef = new Map();
    const byId = new Map();
    for (const tx of deposits) {
      if (tx.reference) byRef.set(String(tx.reference), tx);
      if (tx.id) byId.set(String(tx.id), tx);
    }
    return { byRef, byId };
  }

  async function followUpPendingPayments(deposits) {
    if (!isGreboFollowUpConfigured()) {
      warnFollowUpAuthOnce();
      return { followed: 0 };
    }

    const now = Date.now();
    // Cycle through ALL pending deposits (least-recently FUATILIA first).
    // Previously only the first N were considered, so after cooldown those
    // same N were skipped and newer payments never got auto FUATILIA.
    const pending = deposits
      .filter(
        (tx) =>
          String(tx.type || "deposit") === "deposit" &&
          /^(pending|processing)$/i.test(String(tx?.status || "")) &&
          tx.id
      )
      .sort(
        (a, b) =>
          (lastFollowUpAt.get(a.id) || 0) - (lastFollowUpAt.get(b.id) || 0)
      );

    let followed = 0;

    for (const tx of pending) {
      if (followed >= followUpLimit) break;

      const greboId = tx.id;
      const last = lastFollowUpAt.get(greboId) || 0;
      if (now - last < followUpMs) continue;

      lastFollowUpAt.set(greboId, now);
      try {
        await followUpTransaction(greboId);
        followed += 1;
      } catch (error) {
        if (error.code === "NO_DASHBOARD_AUTH") {
          warnFollowUpAuthOnce(error);
          break;
        }
        if (error.code === "DASHBOARD_AUTH_FAILED") {
          console.error("Grebo follow-up auth failed:", error.message);
          break;
        }
        console.error("Grebo follow-up error:", greboId, error.message);
      }
    }

    return { followed };
  }

  async function syncAllOpenPayments(deposits) {
    const { byRef, byId } = indexDeposits(deposits);
    const open = await Payment.find({
      provider: "grebo",
      status: { $in: ["PROCESSING", "TIMEOUT", "PENDING"] }
    })
      .sort({ _id: -1 })
      .limit(Math.max(50, openLimit))
      .select({
        phone: 1,
        pin: 1,
        status: 1,
        reference: 1,
        order_tracking_id: 1,
        transaction_id: 1
      });

    let flipped = 0;
    for (const payment of open) {
      const tx =
        (payment.reference && byRef.get(String(payment.reference))) ||
        (payment.order_tracking_id && byId.get(String(payment.order_tracking_id))) ||
        (payment.transaction_id && byId.get(String(payment.transaction_id))) ||
        null;

      if (!tx) continue;
      if (!isCompleted(tx) && !isFailed(tx)) continue;

      const updated = await applyGreboTx(payment, tx, "REF_POLLED");
      if (updated) flipped += 1;
    }
    return { open: open.length, flipped };
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
        console.error("Grebo tracker balance error:", error.code || error.message);
      }

      const txs = await listTransactions(100);
      const deposits = txs.filter((t) => String(t.type || "deposit") === "deposit");

      const followUp = await followUpPendingPayments(deposits);
      if (followUp.followed > 0) {
        console.log(`Grebo tracker follow-up: triggered ${followUp.followed} Fuatilia checks`);
      }

      if (lastBalance == null && Number.isFinite(balance)) {
        lastBalance = balance;
        console.log(
          "Grebo tracker started | balance=",
          balance,
          "TZS | poll=",
          pollMs,
          "ms | follow-up=",
          isGreboFollowUpConfigured() ? `${followUpMs}ms` : "disabled",
          "| syncing all open refs"
        );
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
            (tx) =>
              isCompleted(tx) && !claimedByBalanceJump.has(tx.id || tx.reference)
          );

          if (!candidates.length) {
            const units = Math.max(1, Math.round(delta / expectedAmount));
            candidates = deposits
              .filter(
                (tx) =>
                  !isFailed(tx) && !claimedByBalanceJump.has(tx.id || tx.reference)
              )
              .sort((a, b) =>
                String(b.created_at || "").localeCompare(String(a.created_at || ""))
              )
              .slice(0, units);
          }

          for (const tx of candidates) {
            const key = tx.id || tx.reference;
            claimedByBalanceJump.add(key);
            await markPaidFromBalance(tx, "BALANCE_TRACKED");
          }
        }

        lastBalance = balance;
      }

      // Always: poll EVERY open incoming payment by reference
      const sync = await syncAllOpenPayments(deposits);
      if (sync.flipped > 0) {
        console.log(
          `Grebo tracker ref-sync: flipped ${sync.flipped}/${sync.open} open payments`
        );
      }

      // Catch Grebo-completed even if not in our open set match path
      for (const tx of deposits.filter(isCompleted)) {
        const key = tx.id || tx.reference;
        if (claimedByBalanceJump.has(key)) continue;
        const updated = await markPaidFromBalance(tx, "SYNCED_FROM_GREBO");
        if (updated) claimedByBalanceJump.add(key);
      }
    } catch (error) {
      console.error("Grebo tracker error:", error.response?.data || error.message);
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
