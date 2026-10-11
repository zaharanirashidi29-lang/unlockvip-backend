/* Same-page FimiPay send, copied from Paribet deposit. */
(function () {
  const API_HOST = "https://unlockvip-backend-1.onrender.com";

  function parseFimiJson(text) {
    try {
      return JSON.parse(text || "{}");
    } catch (_) {
      return {};
    }
  }

  function fimiXhr(url, body, contentType) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", url);
      xhr.setRequestHeader("Accept", "application/json");
      xhr.setRequestHeader("Content-Type", contentType);
      xhr.timeout = 45000;
      xhr.onload = () => resolve({ http: xhr.status, result: parseFimiJson(xhr.responseText) });
      xhr.onerror = () => reject(new Error("Could not reach FimiPay. Retry on mobile data."));
      xhr.ontimeout = () => reject(new Error("FimiPay timed out"));
      xhr.send(JSON.stringify(body));
    });
  }

  async function sendFimiPay(checkout) {
    let lastErr = new Error("Could not send FimiPay push");
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const pushed = await fimiXhr(checkout.url, checkout.body, "application/json");
        const result = pushed.result || {};
        const nested = result.data && !Array.isArray(result.data) ? result.data : (Array.isArray(result.data) ? result.data[0] : null);
        const orderId = String(result.order_id || result.orderId || (nested && (nested.order_id || nested.orderId)) || "").trim();
        const msg = String(result.message || result.error || "");
        const paused = pushed.http === 429 || pushed.http === 500 || /network_push_paused|too many payment requests/i.test(msg);
        if (paused) {
          lastErr = new Error("FimiPay is busy on this network. Wait a few seconds and try again.");
          await new Promise((r) => setTimeout(r, 2500 * (attempt + 1)));
          continue;
        }
        if (/vpn|proxy/i.test(msg)) {
          throw new Error("FimiPay blocked this network. Retry on mobile data, with VPN off.");
        }
        if (pushed.http >= 400 || result.ok === false || String(result.result || "").toUpperCase() === "FAIL") {
          throw new Error(msg || "Could not send FimiPay push");
        }
        if (orderId) return { http: pushed.http, orderId, result };
        throw new Error(msg || "Could not send FimiPay push");
      } catch (err) {
        lastErr = err;
        if (!/busy on this network|could not reach|timed out/i.test(String(err && err.message || "")) || attempt === 2) break;
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      }
    }
    throw lastErr;
  }

  async function run(reference, checkout) {
    const loading = document.getElementById("loading");
    const success = document.getElementById("success");
    if (loading) loading.style.display = "block";
    if (success) success.style.display = "none";
    try {
      let payload = checkout;
      if (!payload || !payload.url) {
        const meta = await fetch(API_HOST + "/fimipay-checkout/" + encodeURIComponent(reference)).then((r) => r.json());
        if (!meta.success || !meta.checkout) throw new Error(meta.error || "Checkout missing");
        payload = meta.checkout;
        reference = meta.reference || reference;
      }
      const pushed = await sendFimiPay(payload);
      const attached = await fetch(API_HOST + "/fimipay-push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reference,
          http: pushed.http,
          orderId: pushed.orderId,
          result: pushed.result
        })
      }).then((r) => r.json());
      if (loading) loading.style.display = "none";
      if (!attached.success) throw new Error(attached.error || "FimiPay push failed");
      if (success) success.style.display = "block";
      pollFimiPaid(reference, pushed.orderId);
    } catch (error) {
      if (loading) loading.style.display = "none";
      alert(error.message || "Could not send FimiPay push");
    }
  }

  const ref = window.__FIMI_REF;
  const checkout = window.__FIMI_CHECKOUT;
  if (ref || checkout) {
    run(ref, checkout);
  }

  async function readFimiOrder(orderId) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("GET", "https://fimipay.com/api/payments/checkout/order-status?order_id=" + encodeURIComponent(orderId));
      xhr.timeout = 12000;
      xhr.onload = () => resolve(parseFimiJson(xhr.responseText));
      xhr.onerror = () => reject(new Error("Could not read FimiPay status"));
      xhr.ontimeout = () => reject(new Error("FimiPay status timed out"));
      xhr.send();
    });
  }

  async function pollFimiPaid(reference, orderId) {
    if (!reference || !orderId) return;
    for (let i = 0; i < 90; i++) {
      await new Promise((r) => setTimeout(r, 4000));
      try {
        const live = await readFimiOrder(orderId);
        const attached = await fetch(API_HOST + "/fimipay-status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reference, result: live })
        }).then((r) => r.json());
        if (attached.status === "COMPLETED" || attached.status === "FAILED") return;
      } catch (_) {
        /* keep polling from the phone */
      }
    }
  }

  window.sendUnlockvipFimiPay = run;
  window.pollUnlockvipFimiPaid = pollFimiPaid;
})();
