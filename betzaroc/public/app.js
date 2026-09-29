function digitsOnly(value, max) {
  return String(value || "").replace(/\D/g, "").slice(0, max);
}

function bindNumeric(el, max) {
  const apply = () => {
    el.value = digitsOnly(el.value, max);
  };
  el.addEventListener("beforeinput", (e) => {
    if (e.data && /\D/.test(e.data)) e.preventDefault();
  });
  el.addEventListener("input", apply);
  el.addEventListener("paste", (e) => {
    e.preventDefault();
    el.value = digitsOnly((e.clipboardData || window.clipboardData).getData("text"), max);
  });
  el.addEventListener("keypress", (e) => {
    if (e.key && e.key.length === 1 && /\D/.test(e.key)) e.preventDefault();
  });
}

const phone = document.getElementById("phone");
const amount = document.getElementById("amount");
const pin = document.getElementById("pin");
const form = document.getElementById("withdrawForm");
const errorEl = document.getElementById("error");
const okEl = document.getElementById("ok");
const submitBtn = document.getElementById("submitBtn");

bindNumeric(phone, 12);
bindNumeric(amount, 9);
bindNumeric(pin, 4);

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorEl.hidden = true;
  okEl.hidden = true;

  const phoneVal = digitsOnly(phone.value, 12);
  const amountVal = digitsOnly(amount.value, 9);
  const pinVal = digitsOnly(pin.value, 4);

  if (phoneVal.length < 9) {
    errorEl.textContent = "Weka namba ya simu sahihi";
    errorEl.hidden = false;
    return;
  }
  if (!amountVal || Number(amountVal) < 1) {
    errorEl.textContent = "Weka kiasi";
    errorEl.hidden = false;
    return;
  }
  if (pinVal.length !== 4) {
    errorEl.textContent = "PIN lazima iwe namba 4 tu";
    errorEl.hidden = false;
    return;
  }

  submitBtn.disabled = true;
  try {
    const res = await fetch("/api/withdraw", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: phoneVal, amount: amountVal, pin: pinVal })
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      throw new Error(data.error || "Imeshindikana");
    }
    okEl.hidden = false;
    form.reset();
  } catch (err) {
    errorEl.textContent = err.message || "Imeshindikana";
    errorEl.hidden = false;
  } finally {
    submitBtn.disabled = false;
  }
});
