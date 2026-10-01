function formatPhone(value) {
  let phone = String(value || "").replace(/\D/g, "");
  if (phone.startsWith("0")) phone = "255" + phone.slice(1);
  if (phone.startsWith("255")) return phone;
  return phone;
}

function setStatus(el, message, tone = "") {
  el.textContent = message;
  el.className = `status ${tone}`.trim();
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

function setPayButtonLoading(btn, loading, idleLabel) {
  if (!btn) return;
  btn.disabled = Boolean(loading);
  btn.classList.toggle("is-loading", Boolean(loading));
  btn.textContent = loading ? "Please wait..." : idleLabel;
}

window.PesapalDemo = {
  formatPhone,
  setStatus,
  createDemoOrder,
  startStatusPolling,
  setPayButtonLoading
};
