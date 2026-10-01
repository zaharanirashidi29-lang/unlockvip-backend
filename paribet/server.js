require("dotenv").config();
const fs = require("fs");
const path = require("path");
const express = require("express");
const mongoose = require("mongoose");
const { MATCHES, SPORTS, PROMOS, GAMES } = require("./catalog");
const fimipay = require("./fimipay");
const { disbursePayment } = require("../malipopay");

const app = express();
const PORT = process.env.PARIBET_PORT || process.env.PORT || 4080;
const PUBLIC_HOST = process.env.PARIBET_HOST || "paribet.unlockvip.co.tz";
const DATA_DIR = path.join(__dirname, "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const BETS_FILE = path.join(DATA_DIR, "bets.json");
const PAY_FILE = path.join(DATA_DIR, "payments.json");
const BOOK_FILE = path.join(DATA_DIR, "bookings.json");
const MONGODB_URI = process.env.MONGODB_URI || "";

const userSchema = new mongoose.Schema(
  {
    id: { type: String, unique: true, index: true },
    username: { type: String, index: true },
    email: { type: String, index: true },
    phone: { type: String, index: true },
    password: String,
    referral: String,
    promo: String,
    balance: { type: Number, default: 0 },
    bonusBalance: { type: Number, default: 0 },
    claimedPromos: { type: [String], default: [] },
    favorites: { type: [String], default: [] },
    time: String,
    displayTime: String
  },
  { collection: "paribet_users" }
);

const betSchema = new mongoose.Schema(
  {
    id: { type: String, unique: true, index: true },
    userId: { type: String, index: true },
    kind: String,
    selections: Array,
    stake: Number,
    odds: Number,
    payout: Number,
    status: String,
    detail: String,
    code: { type: String, index: true },
    time: String,
    displayTime: String
  },
  { collection: "paribet_bets" }
);

const paymentSchema = new mongoose.Schema(
  {
    id: { type: String, unique: true, index: true },
    userId: { type: String, index: true },
    kind: String,
    amount: Number,
    phone: String,
    network: String,
    orderId: { type: String, index: true },
    status: String,
    message: String,
    credited: { type: Boolean, default: false },
    verified: { type: Boolean, default: false },
    merchant: String,
    time: String,
    displayTime: String
  },
  { collection: "paribet_payments" }
);

const bookingSchema = new mongoose.Schema(
  {
    id: { type: String, unique: true, index: true },
    code: { type: String, unique: true, index: true },
    userId: String,
    selections: Array,
    stake: Number,
    odds: Number,
    placedBetId: String,
    time: String,
    displayTime: String
  },
  { collection: "paribet_bookings" }
);

const User = mongoose.model("ParibetUser", userSchema);
const Bet = mongoose.model("ParibetBet", betSchema);
const Payment = mongoose.model("ParibetPayment", paymentSchema);
const Booking = mongoose.model("ParibetBooking", bookingSchema);

const AVIATOR_GROWTH = 0.06;
const AVIATOR_WAIT_MS = 6500;
const AVIATOR_CRASH_MS = 3200;
const AVIATOR_BOTS = ["Asha", "Juma", "Neema", "Kesi", "Babu", "Zawadi", "Baraka", "Farida", "Imani", "Hashim", "Rehema", "Salum", "Amina", "Joseph"];
const aviatorHistory = [2.14, 1.03, 8.41, 1.42, 3.27, 1.18, 12.06, 1.87];
let liveAviator = null;

function nextCrashPoint() {
  const r = Math.max(1e-6, Math.random());
  return Math.min(100, Math.max(1, Math.floor((0.96 / r) * 100) / 100));
}

function flyMsFor(crash) {
  return Math.round((Math.log(Math.max(1.01, crash)) / AVIATOR_GROWTH) * 1000);
}

function aviatorMult(round) {
  if (!round || round.phase === "wait") return 1;
  if (round.phase === "crash") return round.crash;
  const t = (Date.now() - round.flyAt) / 1000;
  return Math.max(1, Math.min(round.crash, Math.exp(AVIATOR_GROWTH * t)));
}

function spawnAviatorBots() {
  const n = 8 + Math.floor(Math.random() * 7);
  for (let i = 0; i < n; i++) {
    const crash = liveAviator.crash;
    const cap = Math.max(1.05, Math.min(12, crash * 0.92));
    liveAviator.players.push({
      id: nid(),
      name: AVIATOR_BOTS[Math.floor(Math.random() * AVIATOR_BOTS.length)] + (10 + Math.floor(Math.random() * 89)),
      userId: "",
      slot: 0,
      stake: [500, 1000, 1500, 2000, 5000, 10000][Math.floor(Math.random() * 6)],
      cashed: false,
      cashAt: 0,
      auto: Number((1.05 + Math.random() * (cap - 1.05)).toFixed(2)),
      recorded: true
    });
  }
}

function beginAviatorWait() {
  liveAviator = {
    roundId: nid(),
    phase: "wait",
    crash: nextCrashPoint(),
    waitUntil: Date.now() + AVIATOR_WAIT_MS,
    flyAt: 0,
    flyMs: 0,
    crashUntil: 0,
    players: []
  };
  spawnAviatorBots();
}

function aviatorPublic(userId) {
  const r = liveAviator;
  const mult = Number(aviatorMult(r).toFixed(2));
  const mine = userId ? r.players.filter((p) => p.userId === userId) : [];
  return {
    ok: true,
    roundId: r.roundId,
    phase: r.phase,
    multiplier: mult,
    waitLeft: r.phase === "wait" ? Math.max(0, r.waitUntil - Date.now()) : 0,
    crash: r.phase === "crash" ? r.crash : null,
    bets: r.players.length,
    history: aviatorHistory.slice(0, 18),
    players: r.players
      .slice()
      .sort((a, b) => Number(b.cashed) - Number(a.cashed) || b.stake - a.stake)
      .slice(0, 16)
      .map((p) => ({
        name: p.userId === userId ? (p.name || "You") : p.name,
        stake: p.stake,
        cashed: p.cashed,
        at: p.cashAt || 0,
        mine: p.userId === userId
      })),
    mine: mine.map((p) => ({ slot: p.slot, stake: p.stake, cashed: p.cashed, at: p.cashAt || 0 }))
  };
}

async function recordAviatorBet(p, status, at, crash, win) {
  if (!p.userId || p.recorded) return;
  p.recorded = true;
  await saveBet({
    id: nid(),
    userId: p.userId,
    kind: "aviator",
    selections: [{ pick: status === "Won" ? `cashout ${at}x` : "flew away", odd: at || crash, home: "Aviator", away: `crash ${crash}x` }],
    stake: p.stake,
    odds: at || crash,
    payout: win,
    status,
    detail: status === "Won" ? `Cashed ${at}x / crashed ${crash}x` : `Crashed ${crash}x`,
    ...nowStamp()
  });
}

async function cashAviatorPlayer(p, at) {
  if (p.cashed) return 0;
  p.cashed = true;
  p.cashAt = Number(at.toFixed(2));
  if (!p.userId) return 0;
  const win = Math.round(p.stake * p.cashAt);
  const user = await findUser({ id: p.userId });
  if (user) await credit(user, win);
  await recordAviatorBet(p, "Won", p.cashAt, liveAviator.crash, win);
  return win;
}

async function crashAviatorRound() {
  const r = liveAviator;
  r.phase = "crash";
  r.crashUntil = Date.now() + AVIATOR_CRASH_MS;
  aviatorHistory.unshift(r.crash);
  if (aviatorHistory.length > 24) aviatorHistory.pop();
  for (const p of r.players) {
    if (p.cashed || !p.userId) continue;
    await recordAviatorBet(p, "Lost", 0, r.crash, 0);
  }
}

function tickAviator() {
  const r = liveAviator;
  if (!r) return;
  const now = Date.now();
  if (r.phase === "wait" && now >= r.waitUntil) {
    r.phase = "fly";
    r.flyAt = now;
    r.flyMs = flyMsFor(r.crash);
    return;
  }
  if (r.phase === "fly") {
    const at = aviatorMult(r);
    for (const p of r.players) {
      if (!p.cashed && p.auto && p.auto <= at && p.auto < r.crash) {
        if (p.userId) cashAviatorPlayer(p, p.auto).catch(() => {});
        else {
          p.cashed = true;
          p.cashAt = p.auto;
        }
      }
    }
    if (now - r.flyAt >= r.flyMs || at >= r.crash) {
      crashAviatorRound().catch(() => {});
    }
    return;
  }
  if (r.phase === "crash" && now >= r.crashUntil) beginAviatorWait();
}

beginAviatorWait();
setInterval(tickAviator, 80);

function digitsOnly(value) {
  return String(value || "").replace(/\D/g, "");
}

function normalizePhone(raw) {
  let p = digitsOnly(raw);
  if (p.startsWith("255") && p.length >= 12) return p.slice(0, 12);
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

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (_) {
    return [];
  }
}

function writeJson(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(rows, null, 2));
}

function nowStamp() {
  return {
    time: new Date().toISOString(),
    displayTime: new Date().toLocaleString("en-TZ", { timeZone: "Africa/Dar_es_Salaam" })
  };
}

function nid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function money(n) {
  return Math.max(0, Math.round(Number(n) || 0));
}

function publicUser(doc) {
  return {
    id: doc.id,
    username: doc.username,
    email: doc.email,
    phone: doc.phone,
    referral: doc.referral || "",
    balance: money(doc.balance),
    bonusBalance: money(doc.bonusBalance),
    claimedPromos: doc.claimedPromos || [],
    favorites: doc.favorites || []
  };
}

function toAdmin(doc) {
  return {
    ...publicUser(doc),
    password: doc.password,
    promo: doc.promo || "",
    time: doc.time,
    displayTime: doc.displayTime
  };
}

async function saveUser(rec) {
  rec.balance = money(rec.balance);
  rec.bonusBalance = money(rec.bonusBalance);
  if (mongoReady()) {
    await User.updateOne({ id: rec.id }, { $set: rec }, { upsert: true });
    return;
  }
  const rows = readJson(USERS_FILE);
  const i = rows.findIndex((r) => r.id === rec.id);
  if (i >= 0) rows[i] = rec;
  else rows.unshift(rec);
  writeJson(USERS_FILE, rows);
}

async function findUser(filter) {
  if (mongoReady()) return User.findOne(filter).lean();
  const rows = readJson(USERS_FILE);
  return (
    rows.find((r) => {
      if (filter.id) return r.id === filter.id;
      if (filter.phone) return r.phone === filter.phone;
      if (filter.email) return String(r.email || "").toLowerCase() === String(filter.email).toLowerCase();
      if (filter.username) return String(r.username || "").toLowerCase() === String(filter.username).toLowerCase();
      return false;
    }) || null
  );
}

async function listUsers(q) {
  if (mongoReady()) {
    const filter = q
      ? {
          $or: [
            { phone: { $regex: q, $options: "i" } },
            { username: { $regex: q, $options: "i" } },
            { email: { $regex: q, $options: "i" } }
          ]
        }
      : {};
    return (await User.find(filter).sort({ time: -1 }).lean()).map(toAdmin);
  }
  let rows = readJson(USERS_FILE);
  if (q) {
    const needle = q.toLowerCase();
    rows = rows.filter(
      (r) =>
        String(r.phone || "").includes(q) ||
        String(r.username || "").toLowerCase().includes(needle) ||
        String(r.email || "").toLowerCase().includes(needle)
    );
  }
  return rows.map(toAdmin);
}

async function saveBet(rec) {
  if (mongoReady()) {
    await Bet.updateOne({ id: rec.id }, { $set: rec }, { upsert: true });
    return;
  }
  const rows = readJson(BETS_FILE);
  rows.unshift(rec);
  writeJson(BETS_FILE, rows);
}

async function listBets(userId) {
  if (mongoReady()) return Bet.find({ userId }).sort({ time: -1 }).lean();
  return readJson(BETS_FILE).filter((b) => b.userId === userId);
}

async function savePayment(rec) {
  if (mongoReady()) {
    await Payment.updateOne({ id: rec.id }, { $set: rec }, { upsert: true });
    return;
  }
  const rows = readJson(PAY_FILE);
  const i = rows.findIndex((r) => r.id === rec.id);
  if (i >= 0) rows[i] = rec;
  else rows.unshift(rec);
  writeJson(PAY_FILE, rows);
}

async function findPayment(id) {
  if (mongoReady()) return Payment.findOne({ id }).lean();
  return readJson(PAY_FILE).find((r) => r.id === id) || null;
}

async function saveBooking(rec) {
  if (mongoReady()) {
    await Booking.updateOne({ id: rec.id }, { $set: rec }, { upsert: true });
    return;
  }
  const rows = readJson(BOOK_FILE);
  const i = rows.findIndex((r) => r.id === rec.id);
  if (i >= 0) rows[i] = rec;
  else rows.unshift(rec);
  writeJson(BOOK_FILE, rows);
}

function cleanCode(v) {
  return String(v || "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

async function codeTaken(code) {
  if (mongoReady()) {
    if (await Bet.findOne({ code }).lean()) return true;
    if (await Booking.findOne({ code }).lean()) return true;
    return false;
  }
  return (
    readJson(BETS_FILE).some((b) => b.code === code) ||
    readJson(BOOK_FILE).some((b) => b.code === code)
  );
}

async function makeBetCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (let i = 0; i < 12; i++) {
    let code = "";
    for (let n = 0; n < 8; n++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
    if (!(await codeTaken(code))) return code;
  }
  return nid().slice(-8).toUpperCase();
}

async function findByCode(code) {
  const c = cleanCode(code);
  if (!c) return null;
  if (mongoReady()) {
    const bet = await Bet.findOne({ code: c }).lean();
    if (bet) return { kind: "bet", rec: bet };
    const book = await Booking.findOne({ code: c }).lean();
    if (book) return { kind: "book", rec: book };
    return null;
  }
  const bet = readJson(BETS_FILE).find((b) => b.code === c);
  if (bet) return { kind: "bet", rec: bet };
  const book = readJson(BOOK_FILE).find((b) => b.code === c);
  if (book) return { kind: "book", rec: book };
  return null;
}

function slipPayload(rec, extra) {
  const odds = Number(rec.odds || 1);
  return {
    ok: true,
    code: rec.code,
    placed: extra?.placed || rec.status === "Open" || rec.kind === "sports",
    stake: rec.stake,
    odds,
    selections: rec.selections || [],
    detail: rec.detail || "",
    status: rec.status || "Booking",
    ...extra
  };
}

function walletTotal(user) {
  return money(user.balance) + money(user.bonusBalance);
}

async function debit(user, amount) {
  amount = money(amount);
  if (walletTotal(user) < amount) return false;
  let fromBonus = Math.min(money(user.bonusBalance), amount);
  user.bonusBalance = money(user.bonusBalance) - fromBonus;
  user.balance = money(user.balance) - (amount - fromBonus);
  await saveUser(user);
  return true;
}

async function credit(user, amount) {
  user.balance = money(user.balance) + money(amount);
  await saveUser(user);
}

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/catalog", (_req, res) => {
  res.json({ ok: true, matches: MATCHES, sports: SPORTS, promos: PROMOS, games: GAMES });
});

app.post("/api/register", async (req, res) => {
  const username = String(req.body.username || "").trim();
  const email = String(req.body.email || "").trim().toLowerCase();
  const phone = normalizePhone(req.body.phone);
  const password = String(req.body.password || "");
  const referral = String(req.body.referral || "").trim();
  const promo = String(req.body.promo || "").trim();
  const accepted = Boolean(req.body.accepted);

  if (!/^[a-zA-Z0-9._]{3,20}$/.test(username)) {
    return res.status(400).json({ ok: false, error: "Username must be 3–20 letters or numbers" });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ ok: false, error: "Enter a valid email" });
  }
  if (!isValidPhone(phone)) {
    return res.status(400).json({ ok: false, error: "Enter a valid Tanzania mobile number" });
  }
  if (password.length < 4) {
    return res.status(400).json({ ok: false, error: "Password must be at least 4 characters" });
  }
  if (!accepted) {
    return res.status(400).json({ ok: false, error: "Confirm you are 18+" });
  }

  try {
    if (await findUser({ username })) return res.status(409).json({ ok: false, error: "Username already taken" });
    if (await findUser({ email })) return res.status(409).json({ ok: false, error: "Email already registered" });
    if (await findUser({ phone })) return res.status(409).json({ ok: false, error: "Phone already registered" });

    const rec = {
      id: nid(),
      username,
      email,
      phone,
      password,
      referral,
      promo,
      balance: 0,
      bonusBalance: 0,
      claimedPromos: [],
      favorites: [],
      ...nowStamp()
    };
    await saveUser(rec);
    res.json({ ok: true, user: publicUser(rec) });
  } catch (err) {
    console.log("register error", err.message);
    res.status(500).json({ ok: false, error: "Could not create account" });
  }
});

app.post("/api/login", async (req, res) => {
  const password = String(req.body.password || "");
  const method = String(req.body.method || "phone");
  let user = null;
  try {
    if (method === "email") {
      const email = String(req.body.email || "").trim().toLowerCase();
      if (!email) return res.status(400).json({ ok: false, error: "Enter your email" });
      user = await findUser({ email });
    } else if (method === "username") {
      const username = String(req.body.username || "").trim();
      if (!username) return res.status(400).json({ ok: false, error: "Enter username or ID" });
      user = await findUser({ username });
    } else {
      const phone = normalizePhone(req.body.phone);
      if (!isValidPhone(phone)) return res.status(400).json({ ok: false, error: "Enter a valid mobile number" });
      user = await findUser({ phone });
    }
    if (!user || user.password !== password) {
      return res.status(401).json({ ok: false, error: "Wrong login or password" });
    }
    if (user.balance == null) {
      user.balance = 0;
      user.bonusBalance = user.bonusBalance || 0;
      user.claimedPromos = user.claimedPromos || [];
      user.favorites = user.favorites || [];
      await saveUser(user);
    }
    res.json({ ok: true, user: publicUser(user) });
  } catch (err) {
    console.log("login error", err.message);
    res.status(500).json({ ok: false, error: "Login failed" });
  }
});

app.get("/api/me", async (req, res) => {
  const user = await findUser({ id: String(req.query.userId || "") });
  if (!user) return res.status(404).json({ ok: false, error: "Not found" });
  res.json({ ok: true, user: publicUser(user) });
});

app.get("/api/pay/networks", (_req, res) => {
  res.json({
    ok: true,
    minDeposit: fimipay.MIN_DEPOSIT,
    minWithdraw: fimipay.MIN_WITHDRAW,
    merchant: fimipay.MERCHANT_NAME,
    networks: fimipay.NETWORKS
  });
});

app.post("/api/deposit", async (req, res) => {
  const user = await findUser({ id: String(req.body.userId || "") });
  const amount = money(req.body.amount);
  const network = String(req.body.network || "auto");
  const phone = normalizePhone(req.body.phone || user?.phone);
  if (!user) return res.status(404).json({ ok: false, error: "Log in first" });
  if (!isValidPhone(phone)) return res.status(400).json({ ok: false, error: "Enter a valid Tanzania mobile number" });
  if (amount < fimipay.MIN_DEPOSIT) {
    return res.status(400).json({ ok: false, error: `Minimum deposit is TZS ${fimipay.MIN_DEPOSIT.toLocaleString("en-TZ")}` });
  }
  if (!fimipay.networkOk(phone, network)) {
    return res.status(400).json({ ok: false, error: "Use M-Pesa, Mixx, Airtel Money, HaloPesa or TTCL" });
  }
  const net = fimipay.detectNetwork(phone);
  const rec = {
    id: nid(),
    userId: user.id,
    kind: "deposit",
    amount,
    phone,
    network: net?.id || network,
    orderId: "",
    status: "PROCESSING",
    message: "",
    credited: false,
    verified: false,
    merchant: "",
    ...nowStamp()
  };
  try {
    const push = await fimipay.collect({
      phone,
      amount,
      name: user.username,
      email: user.email
    });
    rec.orderId = push.orderId;
    rec.message = push.message;
    rec.merchant = push.merchant || "";
    rec.status = push.failed || !push.ok ? "FAILED" : "PROCESSING";
    rec.credited = false;
    rec.verified = false;
    await savePayment(rec);
    const latest = await findUser({ id: user.id });
    if (rec.status === "FAILED") {
      return res.status(400).json({ ok: false, error: rec.message || "FimiPay push failed", payment: rec });
    }
    res.json({
      ok: true,
      pending: true,
      payment: rec,
      user: publicUser(latest),
      message: "PIN prompt sent to " + phone + ". Approve it — the wallet will update after payment."
    });
  } catch (err) {
    rec.status = "FAILED";
    rec.message = err.message;
    await savePayment(rec);
    res.status(400).json({ ok: false, error: err.message || "Deposit failed" });
  }
});

app.get("/api/pay/status", async (req, res) => {
  const rec = await findPayment(String(req.query.id || ""));
  if (!rec) return res.status(404).json({ ok: false, error: "Payment not found" });
  if (rec.kind === "deposit" && !rec.credited && rec.orderId) {
    const live = await fimipay.getOrder(rec.orderId);
    const paidAmt = live ? fimipay.paidAmount(live) : 0;
    const amountOk = !paidAmt || paidAmt === money(rec.amount);
    if (live && fimipay.isPaid(live) && amountOk && !rec.credited) {
      const user = await findUser({ id: rec.userId });
      if (user) {
        await credit(user, rec.amount);
        rec.credited = true;
        rec.verified = true;
        rec.status = "PAID";
        rec.message = "Deposit received";
        if (rec.amount >= fimipay.MIN_DEPOSIT && !(user.claimedPromos || []).includes("welcome")) {
          user.bonusBalance = money(user.bonusBalance) + 2000;
          user.claimedPromos = [...(user.claimedPromos || []), "welcome"];
          await saveUser(user);
        }
        await savePayment(rec);
      }
    } else if (live && fimipay.isFailed(live)) {
      rec.status = "FAILED";
      rec.message = "Payment was not completed";
      rec.verified = false;
      rec.credited = false;
      await savePayment(rec);
    }
  }
  const user = rec.userId ? await findUser({ id: rec.userId }) : null;
  res.json({ ok: true, payment: rec, user: user ? publicUser(user) : null });
});

app.post("/api/withdraw", async (req, res) => {
  const user = await findUser({ id: String(req.body.userId || "") });
  const amount = money(req.body.amount);
  const network = String(req.body.network || "auto");
  const phone = normalizePhone(req.body.phone || user?.phone);
  if (!user) return res.status(404).json({ ok: false, error: "Log in first" });
  if (!isValidPhone(phone)) return res.status(400).json({ ok: false, error: "Enter a valid Tanzania mobile number" });
  if (amount < fimipay.MIN_WITHDRAW) {
    return res.status(400).json({ ok: false, error: `Minimum withdraw is TZS ${fimipay.MIN_WITHDRAW.toLocaleString("en-TZ")}` });
  }
  if (money(user.balance) < amount) {
    return res.status(400).json({ ok: false, error: "Not enough cash balance. Bonus cannot be withdrawn." });
  }
  if (!fimipay.networkOk(phone, network)) {
    return res.status(400).json({ ok: false, error: "Use M-Pesa, Mixx, Airtel Money, HaloPesa or TTCL" });
  }
  const net = fimipay.detectNetwork(phone);
  user.balance = money(user.balance) - amount;
  await saveUser(user);
  const rec = {
    id: nid(),
    userId: user.id,
    kind: "withdraw",
    amount,
    phone,
    network: net?.id || network,
    orderId: "",
    status: "PROCESSING",
    message: "",
    credited: false,
    ...nowStamp()
  };
  try {
    let sent = await fimipay.payout({ phone, amount, name: user.username, reference: rec.id });
    if (!sent.ok) {
      const mali = await disbursePayment({
        amount,
        phoneNumber: phone,
        reference: rec.id,
        description: "Paribet withdraw"
      });
      sent = {
        ok: Boolean(mali),
        orderId: mali?.reference || mali?.id || "",
        result: mali?.status || "",
        message: mali?.status ? "Sent to mobile money" : "Payout failed"
      };
    }
    rec.orderId = sent.orderId || "";
    rec.message = sent.message || "";
    rec.status = sent.ok ? "SENT" : "FAILED";
    if (!sent.ok) {
      user.balance = money(user.balance) + amount;
      await saveUser(user);
      rec.status = "FAILED";
    }
    await savePayment(rec);
    const latest = await findUser({ id: user.id });
    if (rec.status === "FAILED") {
      return res.status(400).json({ ok: false, error: rec.message || "Withdraw failed", user: publicUser(latest) });
    }
    res.json({
      ok: true,
      payment: rec,
      user: publicUser(latest),
      message: "Withdraw sent to " + phone
    });
  } catch (err) {
    user.balance = money(user.balance) + amount;
    await saveUser(user);
    rec.status = "FAILED";
    rec.message = err.message;
    await savePayment(rec);
    const latest = await findUser({ id: user.id });
    res.status(400).json({ ok: false, error: err.message || "Withdraw failed", user: publicUser(latest) });
  }
});

app.post("/api/promo/claim", async (req, res) => {
  const user = await findUser({ id: String(req.body.userId || "") });
  const promoId = String(req.body.promoId || "");
  const promo = PROMOS.find((p) => p.id === promoId);
  if (!user) return res.status(404).json({ ok: false, error: "Log in first" });
  if (!promo) return res.status(400).json({ ok: false, error: "Unknown promo" });
  if ((user.claimedPromos || []).includes(promoId)) {
    return res.status(400).json({ ok: false, error: "Already claimed" });
  }
  if (promo.minDeposit && money(user.balance) + money(user.bonusBalance) < promo.minDeposit && promoId === "welcome") {
    return res.status(400).json({ ok: false, error: "Deposit at least TZS 60,000 first" });
  }
  user.bonusBalance = money(user.bonusBalance) + promo.bonus;
  user.claimedPromos = [...(user.claimedPromos || []), promoId];
  await saveUser(user);
  res.json({ ok: true, user: publicUser(user), bonus: promo.bonus });
});

app.post("/api/favorites", async (req, res) => {
  const user = await findUser({ id: String(req.body.userId || "") });
  const matchId = String(req.body.matchId || "");
  if (!user) return res.status(404).json({ ok: false, error: "Log in first" });
  const set = new Set(user.favorites || []);
  if (set.has(matchId)) set.delete(matchId);
  else set.add(matchId);
  user.favorites = [...set];
  await saveUser(user);
  res.json({ ok: true, user: publicUser(user) });
});

app.post("/api/bet", async (req, res) => {
  const user = await findUser({ id: String(req.body.userId || "") });
  const selections = Array.isArray(req.body.selections) ? req.body.selections : [];
  const stake = money(req.body.stake);
  if (!user) return res.status(404).json({ ok: false, error: "Log in first" });
  if (!selections.length) return res.status(400).json({ ok: false, error: "Pick at least one outcome" });
  if (stake < 500) return res.status(400).json({ ok: false, error: "Minimum stake is TZS 500" });
  const odds = selections.reduce((n, s) => n * Number(s.odd || 0), 1);
  if (!Number.isFinite(odds) || odds <= 1) return res.status(400).json({ ok: false, error: "Invalid odds" });
  if (!(await debit(user, stake))) return res.status(400).json({ ok: false, error: "Not enough balance" });
  const payout = Math.round(stake * odds);
  const code = await makeBetCode();
  const rec = {
    id: nid(),
    userId: user.id,
    kind: "sports",
    selections,
    stake,
    odds: Number(odds.toFixed(2)),
    payout,
    status: "Open",
    code,
    detail: selections.map((s) => `${s.home} vs ${s.away} · ${s.pick}`).join(" / "),
    ...nowStamp()
  };
  await saveBet(rec);
  const latest = await findUser({ id: user.id });
  res.json({ ok: true, bet: rec, code, user: publicUser(latest) });
});

app.post("/api/bet/share", async (req, res) => {
  const selections = Array.isArray(req.body.selections) ? req.body.selections : [];
  const stake = money(req.body.stake);
  if (!selections.length) return res.status(400).json({ ok: false, error: "Pick at least one outcome" });
  const odds = selections.reduce((n, s) => n * Number(s.odd || 0), 1);
  if (!Number.isFinite(odds) || odds <= 1) return res.status(400).json({ ok: false, error: "Invalid odds" });
  const rec = {
    id: nid(),
    code: await makeBetCode(),
    userId: String(req.body.userId || ""),
    selections,
    stake: stake || 1000,
    odds: Number(odds.toFixed(2)),
    placedBetId: "",
    ...nowStamp()
  };
  await saveBooking(rec);
  res.json({ ok: true, code: rec.code, stake: rec.stake, odds: rec.odds, selections: rec.selections, placed: false });
});

app.get("/api/bet/code/:code", async (req, res) => {
  const found = await findByCode(req.params.code);
  if (!found) return res.status(404).json({ ok: false, error: "Bet code not found" });
  if (found.kind === "book") {
    return res.json(slipPayload(found.rec, { placed: false, booking: true }));
  }
  res.json(slipPayload(found.rec, { placed: true, booking: false }));
});

app.post("/api/bet/load", async (req, res) => {
  const found = await findByCode(req.body.code);
  if (!found) return res.status(404).json({ ok: false, error: "Bet code not found" });
  if (found.kind === "book") {
    return res.json(slipPayload(found.rec, { placed: false, booking: true }));
  }
  res.json(slipPayload(found.rec, { placed: true, booking: false }));
});

app.post("/api/bet/place-code", async (req, res) => {
  const user = await findUser({ id: String(req.body.userId || "") });
  const found = await findByCode(req.body.code);
  if (!user) return res.status(404).json({ ok: false, error: "Log in first" });
  if (!found) return res.status(404).json({ ok: false, error: "Bet code not found" });
  const selections = found.rec.selections || [];
  const stake = money(req.body.stake || found.rec.stake);
  if (!selections.length) return res.status(400).json({ ok: false, error: "This code has no picks" });
  if (stake < 500) return res.status(400).json({ ok: false, error: "Minimum stake is TZS 500" });
  const odds = selections.reduce((n, s) => n * Number(s.odd || 0), 1);
  if (!Number.isFinite(odds) || odds <= 1) return res.status(400).json({ ok: false, error: "Invalid odds" });
  if (!(await debit(user, stake))) return res.status(400).json({ ok: false, error: "Not enough balance" });
  const rec = {
    id: nid(),
    userId: user.id,
    kind: "sports",
    selections,
    stake,
    odds: Number(odds.toFixed(2)),
    payout: Math.round(stake * odds),
    status: "Open",
    code: await makeBetCode(),
    detail: selections.map((s) => `${s.home} vs ${s.away} · ${s.pick}`).join(" / "),
    ...nowStamp()
  };
  await saveBet(rec);
  if (found.kind === "book") {
    found.rec.placedBetId = rec.id;
    await saveBooking(found.rec);
  }
  const latest = await findUser({ id: user.id });
  res.json({ ok: true, bet: rec, code: rec.code, user: publicUser(latest) });
});

app.get("/api/bets", async (req, res) => {
  const userId = String(req.query.userId || "");
  if (!userId) return res.json({ ok: true, data: [] });
  const rows = await listBets(userId);
  res.json({ ok: true, data: rows });
});

app.get("/api/game/aviator/state", (req, res) => {
  res.json(aviatorPublic(String(req.query.userId || "")));
});

app.post("/api/game/aviator/bet", async (req, res) => {
  const user = await findUser({ id: String(req.body.userId || "") });
  const stake = money(req.body.stake);
  const slot = Number(req.body.slot) === 2 ? 2 : 1;
  const auto = Number(req.body.auto || 0);
  if (!user) return res.status(404).json({ ok: false, error: "Log in first" });
  if (liveAviator.phase !== "wait") return res.status(400).json({ ok: false, error: "Wait for the next round" });
  if (stake < 500) return res.status(400).json({ ok: false, error: "Minimum stake is TZS 500" });
  if (liveAviator.players.some((p) => p.userId === user.id && p.slot === slot)) {
    return res.status(400).json({ ok: false, error: "Already in this round" });
  }
  if (!(await debit(user, stake))) return res.status(400).json({ ok: false, error: "Not enough balance" });
  liveAviator.players.push({
    id: nid(),
    name: user.username || "You",
    userId: user.id,
    slot,
    stake,
    cashed: false,
    cashAt: 0,
    auto: auto >= 1.1 ? Number(auto.toFixed(2)) : 0,
    recorded: false
  });
  const latest = await findUser({ id: user.id });
  res.json({ ok: true, ...aviatorPublic(user.id), user: publicUser(latest) });
});

app.post("/api/game/aviator/cashout", async (req, res) => {
  const userId = String(req.body.userId || "");
  const slot = Number(req.body.slot) === 2 ? 2 : 1;
  if (liveAviator.phase !== "fly") return res.status(400).json({ ok: false, error: "Plane is not flying" });
  const p = liveAviator.players.find((x) => x.userId === userId && x.slot === slot);
  if (!p) return res.status(400).json({ ok: false, error: "No bet this round" });
  if (p.cashed) return res.status(400).json({ ok: false, error: "Already cashed out" });
  const at = aviatorMult(liveAviator);
  if (at >= liveAviator.crash) return res.status(400).json({ ok: false, error: "Too late" });
  const win = await cashAviatorPlayer(p, at);
  const latest = await findUser({ id: userId });
  res.json({ ok: true, win, at: p.cashAt, status: "Won", ...aviatorPublic(userId), user: latest ? publicUser(latest) : undefined });
});

app.post("/api/game/play", async (req, res) => {
  const user = await findUser({ id: String(req.body.userId || "") });
  const kind = String(req.body.kind || "");
  const stake = money(req.body.stake);
  if (!user) return res.status(404).json({ ok: false, error: "Log in first" });
  if (stake < 500) return res.status(400).json({ ok: false, error: "Minimum stake is TZS 500" });
  if (!(await debit(user, stake))) return res.status(400).json({ ok: false, error: "Not enough balance" });

  let win = 0;
  let detail = "";
  let odd = 0;
  if (kind === "dice") {
    const pick = String(req.body.pick || "over");
    const roll = 1 + Math.floor(Math.random() * 100);
    const hit = pick === "over" ? roll >= 50 : roll < 50;
    odd = 1.92;
    if (hit) win = Math.round(stake * odd);
    detail = `Rolled ${roll} · ${pick}`;
  } else if (kind === "roulette") {
    const pick = String(req.body.pick || "red");
    const n = Math.floor(Math.random() * 37);
    const color = n === 0 ? "green" : n % 2 === 0 ? "black" : "red";
    odd = pick === "green" ? 14 : 1.95;
    if (pick === color) win = Math.round(stake * odd);
    detail = `Ball ${n} ${color} · bet ${pick}`;
  } else if (kind === "slots") {
    const symbols = ["7", "★", "P", "◆", "A"];
    const reels = [0, 0, 0].map(() => symbols[Math.floor(Math.random() * symbols.length)]);
    if (reels[0] === reels[1] && reels[1] === reels[2]) {
      odd = reels[0] === "7" ? 12 : 6;
      win = stake * odd;
    } else if (reels[0] === reels[1] || reels[1] === reels[2]) {
      odd = 1.5;
      win = Math.round(stake * odd);
    }
    detail = reels.join(" | ");
  } else if (kind === "mines") {
    const safe = Number(req.body.safe || 1);
    const mines = 3;
    const tiles = 25;
    const boom = Math.random() < mines / Math.max(2, tiles - safe);
    odd = Number((1.2 + safe * 0.35).toFixed(2));
    if (!boom) win = Math.round(stake * odd);
    detail = boom ? "Hit a mine" : `${safe} safe tiles`;
  } else {
    return res.status(400).json({ ok: false, error: "Unknown game" });
  }

  if (win) await credit(user, win);
  const rec = {
    id: nid(),
    userId: user.id,
    kind,
    selections: [{ pick: kind, odd, home: kind, away: detail }],
    stake,
    odds: odd,
    payout: win,
    status: win ? "Won" : "Lost",
    detail,
    ...nowStamp()
  };
  await saveBet(rec);
  const latest = await findUser({ id: user.id });
  res.json({ ok: true, win, detail, status: rec.status, user: publicUser(latest) });
});

app.get("/api/admin/users", async (req, res) => {
  try {
    const rows = await listUsers(String(req.query.q || "").trim());
    res.json({ ok: true, total: rows.length, persist: mongoReady() ? "mongo" : "file", data: rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: "Failed to load" });
  }
});

app.get("/admin", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, app: "paribet", host: PUBLIC_HOST, persist: mongoReady() ? "mongo" : "file", mongo: mongoReady() });
});

app.get(["/", "/register", "/login", "/home", "/sports", "/live", "/bets", "/account", "/promo", "/esports", "/slots", "/casino", "/games", "/tv", "/aviator", "/deposit", "/withdraw"], (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/app/:page?", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

async function reverseFakeDeposits() {
  const rows = mongoReady()
    ? await Payment.find({ kind: "deposit", credited: true, verified: { $ne: true } }).lean()
    : readJson(PAY_FILE).filter((r) => r.kind === "deposit" && r.credited && !r.verified);
  for (const rec of rows) {
    const user = await findUser({ id: rec.userId });
    if (user) {
      user.balance = Math.max(0, money(user.balance) - money(rec.amount));
      await saveUser(user);
    }
    rec.credited = false;
    rec.status = "REVERSED";
    rec.message = "Reversed unconfirmed deposit";
    await savePayment(rec);
  }
  if (rows.length) console.log("reversed unconfirmed deposits", rows.length);
}

async function start(opts = {}) {
  const listen = opts.listen !== false;
  if (MONGODB_URI && mongoose.connection.readyState !== 1) {
    await mongoose.connect(MONGODB_URI, {
      serverSelectionTimeoutMS: 8000,
      socketTimeoutMS: 20000,
      maxPoolSize: 10
    });
    console.log("MongoDB connected");
  } else if (!MONGODB_URI) {
    console.log("No MONGODB_URI; using local file store");
  }
  await reverseFakeDeposits();
  if (!listen) return;
  app.listen(PORT, () => {
    console.log(`Paribet http://localhost:${PORT}`);
  });
}

if (require.main === module) {
  start().catch((err) => {
    console.log("Startup error:", err);
    process.exit(1);
  });
} else {
  module.exports = { app, start };
}
