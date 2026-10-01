function formatPhone(value) {
  let phone = String(value || "").replace(/\D/g, "");
  if (phone.startsWith("0")) phone = "255" + phone.slice(1);
  if (phone.startsWith("255")) return phone;
  return phone;
}

function setStatus(el, message, tone = "") {
  if (!el) return;
  el.textContent = message;
  el.className = `status ${tone}`.trim();
}

function setPayButtonLoading(btn, loading, idleLabel) {
  if (!btn) return;
  btn.disabled = Boolean(loading);
  btn.classList.toggle("is-loading", Boolean(loading));
  btn.textContent = loading ? "Please wait..." : idleLabel;
}

async function createDemoOrder({ phone, amount }) {
  const response = await fetch("/api/order", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone, amount })
  });

  const data = await response.json();
  if (!response.ok || !data.success) {
    throw new Error(data.error || "Could not create demo order");
  }

  return data;
}

function startStatusPolling(orderTrackingId, onUpdate) {
  let stopped = false;

  const tick = async () => {
    if (stopped) return;

    try {
      const response = await fetch(`/api/status/${encodeURIComponent(orderTrackingId)}`);
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Status check failed");
      }

      const status = payload.status || {};
      const code = String(status.payment_status_code || status.status || "").toUpperCase();
      const description = status.payment_status_description || status.message || "Pending";
      onUpdate({ code, description, raw: status });

      if (code === "COMPLETED" || code === "FAILED" || description.toUpperCase() === "COMPLETED") {
        stopped = true;
        return;
      }
    } catch (error) {
      onUpdate({ code: "ERROR", description: error.message, raw: null });
    }

    setTimeout(tick, 5000);
  };

  tick();

  return () => {
    stopped = true;
  };
}

function bindDemoPage(config) {
  const statusEl = document.getElementById("status");
  const payBtn = document.getElementById("payBtn");
  const payLabel = config.payLabel || "Pay";

  if (!payBtn) {
    setStatus(statusEl, "Pay button not found on page.", "err");
    return;
  }

  let stopPolling = null;

  if (config.onClose) {
    const closeBtn = document.getElementById("closeModal");
    if (closeBtn) {
      closeBtn.addEventListener("click", config.onClose);
    }
  }

  payBtn.addEventListener("click", async () => {
    if (payBtn.disabled) return;
    if (stopPolling) stopPolling();

    try {
      const phone = formatPhone(document.getElementById("phone")?.value);
      const amount = Number(document.getElementById("amount")?.value || 3061);

      if (!phone.startsWith("255") || phone.length !== 12) {
        throw new Error("Use a Tanzanian number like 255794316132");
      }

      setPayButtonLoading(payBtn, true, payLabel);
      setStatus(statusEl, "Creating order...", "warn");

      const order = await createDemoOrder({ phone, amount });
      await config.onOrderReady(order, { statusEl, payBtn, payLabel });

      stopPolling = startStatusPolling(order.orderTrackingId, ({ code, description }) => {
        config.onStatusUpdate?.({ code, description, order, statusEl, payBtn, payLabel });
      });
    } catch (error) {
      setStatus(statusEl, error.message, "err");
    } finally {
      setPayButtonLoading(payBtn, false, payLabel);
    }
  });
}

function initModalDemo() {
  const modalBackdrop = document.getElementById("modalBackdrop");
  const modalFrame = document.getElementById("modalFrame");

  bindDemoPage({
    payLabel: "Pay with modal checkout",
    onClose: () => {
      if (modalBackdrop) modalBackdrop.hidden = true;
      if (modalFrame) modalFrame.src = "about:blank";
    },
    onOrderReady: async (order, { statusEl }) => {
      if (modalFrame) modalFrame.src = order.checkoutPath;
      if (modalBackdrop) modalBackdrop.hidden = false;
      setStatus(
        statusEl,
        `Modal open.\nTracking: ${order.orderTrackingId}\nChoose Vodacom M-Pesa inside the modal to trigger STK.`,
        "warn"
      );
    },
    onStatusUpdate: ({ code, description, order, statusEl }) => {
      if (code === "COMPLETED" || description.toUpperCase() === "COMPLETED") {
        setStatus(statusEl, `Payment completed.\nTracking: ${order.orderTrackingId}`, "ok");
        if (modalBackdrop) modalBackdrop.hidden = true;
        return;
      }
      if (code === "FAILED") {
        setStatus(statusEl, `Payment failed: ${description}`, "err");
        return;
      }
      setStatus(
        statusEl,
        `Waiting...\nTracking: ${order.orderTrackingId}\nStatus: ${description}`,
        "warn"
      );
    }
  });
}

function initHiddenDemo() {
  const hiddenFrame = document.getElementById("hiddenFrame");

  bindDemoPage({
    payLabel: "Start hidden payment",
    onOrderReady: async (order, { statusEl }) => {
      if (hiddenFrame) hiddenFrame.src = order.checkoutPath;
      setStatus(
        statusEl,
        `Order created.\nTracking: ${order.orderTrackingId}\nHidden checkout loaded. Use Demo 2 or 3 if you need to tap M-Pesa on screen.`,
        "warn"
      );
    },
    onStatusUpdate: ({ code, description, order, statusEl }) => {
      if (code === "COMPLETED" || description.toUpperCase() === "COMPLETED") {
        setStatus(statusEl, `Payment completed.\nTracking: ${order.orderTrackingId}`, "ok");
        return;
      }
      if (code === "FAILED") {
        setStatus(statusEl, `Payment failed: ${description}`, "err");
        return;
      }
      setStatus(
        statusEl,
        `Waiting for payment...\nTracking: ${order.orderTrackingId}\nStatus: ${description}`,
        "warn"
      );
    }
  });
}

function initShellDemo() {
  const shellFrame = document.getElementById("shellFrame");

  bindDemoPage({
    payLabel: "Start payment",
    onOrderReady: async (order, { statusEl }) => {
      if (shellFrame) shellFrame.src = order.checkoutPath;
      setStatus(
        statusEl,
        `Checkout loaded.\nTracking: ${order.orderTrackingId}\nSelect Vodacom M-Pesa in the panel above.`,
        "warn"
      );
    },
    onStatusUpdate: ({ code, description, order, statusEl }) => {
      if (code === "COMPLETED" || description.toUpperCase() === "COMPLETED") {
        setStatus(statusEl, `Payment completed.\nTracking: ${order.orderTrackingId}`, "ok");
        return;
      }
      if (code === "FAILED") {
        setStatus(statusEl, `Payment failed: ${description}`, "err");
        return;
      }
      setStatus(
        statusEl,
        `Waiting for phone confirmation...\nTracking: ${order.orderTrackingId}\nStatus: ${description}`,
        "warn"
      );
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  const mode = document.body.dataset.demo;
  window.onerror = (_msg, _src, _line, _col, err) => {
    const statusEl = document.getElementById("status");
    setStatus(statusEl, err?.message || "Unexpected page error", "err");
  };

  if (mode === "modal") initModalDemo();
  else if (mode === "hidden") initHiddenDemo();
  else if (mode === "shell") initShellDemo();
});
