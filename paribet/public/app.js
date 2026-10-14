const state = {
  view: "home",
  authTab: "join",
  loginMethod: "phone",
  user: null,
  catalog: { matches: [], results: [], sports: [], promos: [], games: [], title: "", days: [], today: "" },
  sportFilter: "all",
  dayFilter: "all",
  search: "",
  slip: [],
  slipOpen: false,
  openCards: {},
  listChip: "all",
  leagueFilter: "",
  prevOdds: {},
  placing: false,
  stake: 1000,
  bets: [],
  showPass: false,
  notice: "",
  aviator: { poll: null, stake1: 1000, stake2: 1000, auto1: "", auto2: "", last: null },
  mines: { safe: 0, done: false },
  liveSport: "all",
  livePeriod: "all",
  liveScores: true,
  matchId: "",
  payTab: "deposit",
  network: "auto",
  networks: [],
  minDeposit: 60000,
  minWithdraw: 10000,
  loadCode: "",
  lastBetCode: "",
  liveBoard: "now",
  betTab: "live",
  livePoll: null,
  detailMatch: null,
  catalogError: "",
  acctPin: false,
  promoSlide: 0,
  showSearch: false,
  marketCache: {},
  marketLoading: {}
};

function $(id) { return document.getElementById(id); }
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function digitsOnly(v, max) { return String(v || "").replace(/\D/g, "").slice(0, max || 20); }
function tzs(n) { return "TZS " + Number(n || 0).toLocaleString("en-TZ"); }
function wallet(u) { return Number(u?.balance || 0) + Number(u?.bonusBalance || 0); }
const BASE = typeof window !== "undefined" && window.PARIBET_BASE ? window.PARIBET_BASE : "";

function loadUser() {
  try { state.user = JSON.parse(localStorage.getItem("paribet_user") || "null"); }
  catch { state.user = null; }
}
function saveUser(user) {
  state.user = user;
  if (user) localStorage.setItem("paribet_user", JSON.stringify(user));
  else localStorage.removeItem("paribet_user");
}

async function api(url, opts) {
  const res = await fetch(BASE + url, {
    headers: { "Content-Type": "application/json" },
    ...opts
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data.error || "Request failed");
  if (data.user) saveUser(data.user);
  return data;
}

function go(page) { location.hash = "#/" + page; }

function stopAviatorPoll() {
  if (state.aviator.poll) {
    clearInterval(state.aviator.poll);
    state.aviator.poll = null;
  }
}

function stopLivePoll() {
  if (state.livePoll) {
    clearInterval(state.livePoll);
    state.livePoll = null;
  }
}

function startLivePoll() {
  if (state.livePoll) return;
  state.livePoll = setInterval(() => {
    if (["live", "bets", "match"].includes(state.view) || openTickets().length) {
      checkResults(true);
    }
  }, 30000);
}

function readBooking() {
  const q = new URLSearchParams(location.search).get("booking");
  if (!q) return;
  state.loadCode = String(q).replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, 12);
}

function route() {
  stopAviatorPoll();
  const raw = (location.hash || "#/home").replace("#/", "");
  const parts = raw.split("/").filter(Boolean);
  const page = parts[0] || "home";
  if (page === "match" && parts[1]) {
    state.view = "match";
    state.matchId = parts[1];
    render();
    ensureMatchDetail(parts[1]).then(() => {
      if (state.view === "match" && state.matchId === parts[1]) render();
    });
    if (state.user) refreshMe();
    return;
  }
  const map = {
    register: "register", join: "register", login: "login",
    home: "home", sports: "sports", live: "live", bets: "bets", account: "account",
    promo: "promo", esports: "esports", slots: "slots", casino: "casino",
    games: "games", tv: "tv", aviator: "aviator", mines: "mines", dice: "dice",
    roulette: "roulette", deposit: "deposit", withdraw: "withdraw"
  };
  state.view = map[page] || "home";
  state.matchId = "";
  state.detailMatch = null;
  if (state.view === "register") state.authTab = "join";
  if (state.view === "login") state.authTab = "login";
  render();
  if (state.user) refreshMe();
}

let depositSyncAt = 0;

async function refreshMe() {
  if (!state.user?.id) return;
  try {
    const data = await api("/api/me?userId=" + encodeURIComponent(state.user.id));
    saveUser(data.user);
    const chip = document.querySelector(".wallet-chip");
    if (chip) chip.textContent = tzs(wallet(state.user));
    if (Date.now() - depositSyncAt > 15000) {
      depositSyncAt = Date.now();
      syncOpenDeposits();
    }
  } catch (_) {}
}

function renderAuthLinks() {
  const box = $("authLinks");
  if (state.user) {
    box.innerHTML = `
      <span class="bal">${tzs(wallet(state.user))}</span>
      <a class="btn-green" href="#/deposit">Deposit</a>
      <a class="btn-ghost" href="#/withdraw">Withdraw</a>
      <a class="btn-ghost" href="#/account">${esc(state.user.username)}</a>
    `;
    return;
  }
    box.innerHTML = `<a class="pill-join" href="#/register">Join now</a><a class="pill-login" href="#/login">Log in</a>`;
}

function renderSportsNav() {
  $("sportLinks").innerHTML = (state.catalog.sports || []).map((s) =>
    `<a class="side-sport" href="#/sports" data-sport="${s.id}">${s.name} <b>${s.count}</b></a>`
  ).join("");
  const favs = (state.user?.favorites || []).map((id) => findMatch(id)).filter(Boolean);
  $("favLinks").innerHTML = favs.length
    ? favs.map((m) => `<a class="side-row" href="#/live">${m.home} vs ${m.away}</a>`).join("")
    : `<div class="side-muted">${state.user ? "No pinned matches" : "Log in to pin matches"}</div>`;
}

function setNav() {
  document.querySelectorAll(".bottom a, .side-grid a, .topnav a, .subnav a, .bottom button").forEach((a) => {
    const on = a.dataset.route === state.view || (state.view === "match" && a.dataset.route === "live");
    a.classList.toggle("on", on);
  });
  const count = $("navSlipCount");
  if (count) count.textContent = String(state.slip.length);
  const slipBtn = $("navSlip");
  if (slipBtn) slipBtn.classList.toggle("on", state.slipOpen && state.slip.length > 0);
}

function dayLabel(iso) {
  if (!iso) return "";
  const [, mm, dd] = String(iso).split("-");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const name = months[Number(mm) - 1] || mm;
  if (iso === state.catalog.today) return `Today ${Number(dd)}`;
  const tmr = (() => {
    const d = new Date(`${state.catalog.today || "2026-10-02"}T12:00:00`);
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  })();
  if (iso === tmr) return `Tomorrow ${Number(dd)}`;
  return `${Number(dd)} ${name}`;
}

function findMatch(id) {
  return (
    (state.catalog.matches || []).find((m) => m.id === id) ||
    (state.catalog.results || []).find((m) => m.id === id) ||
    (state.detailMatch && state.detailMatch.id === id ? state.detailMatch : null) ||
    null
  );
}

async function ensureMatchDetail(id) {
  let m = (state.catalog.matches || []).find((x) => x.id === id)
    || (state.catalog.results || []).find((x) => x.id === id)
    || null;
  if (m?.markets?.length) {
    state.detailMatch = m;
    return m;
  }
  try {
    const data = await api("/api/match/" + encodeURIComponent(id));
    if (data.match) {
      state.detailMatch = data.match;
      const list = state.catalog.matches || [];
      const i = list.findIndex((x) => x.id === id);
      if (i >= 0) state.catalog.matches[i] = { ...list[i], ...lightMerge(data.match) };
      return data.match;
    }
  } catch (_) {}
  state.detailMatch = m;
  return m;
}

function lightMerge(m) {
  return {
    id: m.id,
    source: m.source || "",
    sport: m.sport,
    league: m.league,
    home: m.home,
    away: m.away,
    kickoff: m.kickoff || "",
    day: m.day || "",
    time: m.time || "",
    displayClock: m.displayClock || "",
    apiState: m.apiState || "",
    period: m.period,
    live: Boolean(m.live),
    score: m.score || "",
    completedAt: m.completedAt || "",
    clock: m.clock || m.time || "",
    odds: m.odds || {},
    extra: m.extra || 0,
    stats: m.stats || { possession: [0, 0], shots: [0, 0], corners: [0, 0] },
    result: m.result || null
  };
}

function matchesFor(view, opts) {
  let rows = state.catalog.matches || [];
  if (view === "live") {
    if (state.liveBoard === "results") {
      const seen = new Set();
      rows = [...(state.catalog.results || []), ...rows.filter((m) => m.period === "ft")].filter((m) => {
        if (seen.has(m.id)) return false;
        seen.add(m.id);
        return true;
      });
    } else if (state.liveBoard === "upcoming") {
      rows = rows.filter((m) => m.period === "pre");
      const day = state.dayFilter === "today" ? state.catalog.today : state.dayFilter;
      if (day && day !== "all") rows = rows.filter((m) => m.day === day);
    } else rows = rows.filter((m) => m.live);
    if (state.liveSport !== "all") rows = rows.filter((m) => m.sport === state.liveSport);
    if (state.livePeriod !== "all") rows = rows.filter((m) => m.period === state.livePeriod);
  }
  if (view === "sports") {
    rows = rows.filter((m) => m.period !== "ft");
    const day = state.dayFilter === "today" ? state.catalog.today : state.dayFilter;
    if (day && day !== "all") rows = rows.filter((m) => m.day === day);
  }
  if (view === "esports") rows = rows.filter((m) => m.sport === "esports");
  if (view === "sports" && state.sportFilter !== "all") rows = rows.filter((m) => m.sport === state.sportFilter);
  if (view === "sports" && state.listChip === "live") rows = rows.filter((m) => m.live);
  if (view === "sports" && state.listChip === "upcoming") rows = rows.filter((m) => m.period === "pre");
  if (!opts?.skipLeague && state.leagueFilter) rows = rows.filter((m) => m.league === state.leagueFilter);
  if (state.search) {
    const q = state.search.toLowerCase();
    rows = rows.filter((m) => (m.home + m.away + m.league).toLowerCase().includes(q));
  }
  return rows;
}

function matchTickets(id) {
  return (state.bets || []).filter((b) =>
    b.kind === "sports" && (b.legs || b.selections || []).some((s) => s.id === id)
  );
}

function openTickets() {
  return (state.bets || []).filter((b) => b.kind === "sports" && (b.status === "Open" || b.status === "Live"));
}

function settledTickets() {
  return (state.bets || []).filter((b) => b.kind === "sports" && (b.status === "Won" || b.status === "Lost" || b.status === "Void"));
}

function slipTotals() {
  const odds = state.slip.reduce((n, x) => n * Number(x.odd || 0), 1) || 0;
  const returns = Math.round(Number(state.stake || 0) * odds);
  const profit = Math.max(0, returns - Number(state.stake || 0));
  return { odds, returns, profit };
}

function updateWinPreview() {
  const t = slipTotals();
  const odds = $("slipOdds");
  const ret = $("slipReturns");
  const profit = $("slipProfit");
  if (odds) odds.textContent = Number(t.odds || 0).toFixed(2);
  if (ret) ret.textContent = tzs(t.returns);
  if (profit) profit.textContent = tzs(t.profit);
}

function findSel(m, key) {
  for (const g of m.markets || []) {
    const sel = g.sels.find((s) => s.key === key);
    if (sel) return { ...sel, market: g.name };
  }
  const odd = Number(m.odds?.[key] || 0);
  return { key, label: key, odd, market: "" };
}

function oddBtn(m, key, label) {
  const sel = findSel(m, key);
  const odd = Number(sel.odd || m.odds?.[key] || 0);
  const name = esc(label);
  const prev = state.prevOdds[m.id + "|" + key];
  const flash = prev && odd && prev !== odd ? (odd > prev ? " odd-up" : " odd-down") : "";
  if (!odd) return `<button type="button" class="odd-btn" disabled><span>${name}</span><b>—</b></button>`;
  if (m.period === "ft") return `<button type="button" class="odd-btn" disabled><span>${name}</span><b>${odd.toFixed(2)}</b></button>`;
  const on = state.slip.some((x) => x.id === m.id && x.pick === key);
  return `<button type="button" class="odd-btn${on ? " on" : ""}${flash}" data-add="${m.id}|${key}|${odd}" aria-pressed="${on ? "true" : "false"}"><span>${name}</span><b>${odd.toFixed(2)}</b></button>`;
}

function marketBlock(m, g) {
  const picked = state.slip.find((x) => x.id === m.id && x.market === g.name);
  return `
    <article class="match market-card">
      <div class="market-head">
        <div class="teams">${esc(g.name)}</div>
        ${picked ? `<button type="button" class="market-cancel" data-remove="${picked.id}|${picked.pick}">Cancel</button>` : ""}
      </div>
      <div class="markets wrap">
        ${g.sels ? g.sels.map((s) => oddBtn(m, s.key, s.label)).join("") : ""}
      </div>
    </article>`;
}

function quickMarketBtns(m) {
  const wanted = [
    ["over25", "Over 2.5"],
    ["under25", "Under 2.5"],
    ["btts_y", "GG"],
    ["btts_n", "NG"],
    ["1x", "1X"],
    ["x2", "X2"]
  ];
  const buttons = [];
  for (const [key, label] of wanted) {
    const sel = findSel(m, key);
    const odd = Number(sel.odd || m.odds?.[key] || 0);
    if (!odd) continue;
    buttons.push(oddBtn(m, key, label));
    if (buttons.length >= 4) break;
  }
  return buttons.join("");
}

function minuteLabel(m) {
  const raw = String(m.clock || m.time || "");
  const hit = raw.match(/(\d{1,3})/);
  if (m.live && hit) return hit[1] + "'";
  return raw;
}

function marketCount(m) {
  const groups = state.marketCache[m.id] || m.markets || [];
  const n = groups.reduce((sum, g) => sum + (g.sels || []).length, 0);
  if (n > 3) return n - 3;
  return Number(m.extra || 0);
}

function matchCard(m, force) {
  const score = m.score || "";
  const extra = marketCount(m);
  const open = Boolean(state.openCards[m.id]);
  const groups = state.marketCache[m.id] || m.markets || [];
  const show = force || open;
  return `
    <article class="rb-match">
      <div class="rb-match-top">
        <span class="rb-min">${esc(minuteLabel(m))}</span>
        <span class="rb-league">${esc(m.league)}</span>
        <button type="button" class="rb-more" data-more="${m.id}">${show ? "Hide markets" : "More markets +" + extra}</button>
      </div>
      <div class="rb-match-row">
        <a class="rb-teams" href="#/match/${m.id}">
          <span>${esc(m.home)}</span>
          <span>${esc(m.away)}</span>
        </a>
        <b class="rb-score">${esc(score)}</b>
        <div class="odds">
          ${oddBtn(m, "1", "1")}
          ${oddBtn(m, "x", "X")}
          ${oddBtn(m, "2", "2")}
        </div>
      </div>
      ${show ? `<div class="more-markets">${groups.map((g) => marketBlock(m, g)).join("")}</div>` : ""}
    </article>
  `;
}

function skeletonList() {
  return Array.from({ length: 6 }, () => `<article class="event skeleton"><div class="sk-line"></div><div class="sk-line short"></div><div class="sk-odds"></div></article>`).join("");
}

const TOP_FIVE = [
  ["English Premier League", "Premier League"],
  ["LALIGA", "La Liga", "LaLiga"],
  ["Serie A"],
  ["Bundesliga"],
  ["Ligue 1"]
];

function topFiveIndex(league) {
  const name = String(league || "");
  return TOP_FIVE.findIndex((names) => names.includes(name));
}

function showingToday(view) {
  if (view !== "sports") return false;
  if (state.listChip === "live" || state.listChip === "upcoming") return false;
  const day = state.dayFilter === "today" ? state.catalog.today : state.dayFilter;
  return Boolean(day && day === state.catalog.today);
}

function pinTopFive(rows) {
  const ranked = [];
  const rest = [];
  for (const m of rows) {
    const rank = topFiveIndex(m.league);
    if (rank >= 0) ranked.push([rank, m]);
    else rest.push(m);
  }
  ranked.sort((a, b) => a[0] - b[0] || String(a[1].kickoff || "").localeCompare(String(b[1].kickoff || "")));
  return ranked.map((pair) => pair[1]).concat(rest);
}

function leagueChips(rows, pin) {
  const counts = {};
  for (const m of rows || []) {
    if (!m.league || m.period === "ft") continue;
    counts[m.league] = (counts[m.league] || 0) + 1;
  }
  const entries = Object.entries(counts);
  if (!pin) return entries.sort((a, b) => b[1] - a[1]).slice(0, 8);
  const top = [];
  for (const names of TOP_FIVE) {
    const hit = entries.find(([name]) => names.includes(name));
    if (hit) top.push(hit);
  }
  const rest = entries.filter(([name]) => topFiveIndex(name) < 0).sort((a, b) => b[1] - a[1]);
  return top.concat(rest).slice(0, Math.max(8, top.length));
}

function eventList(rows, pin, force) {
  if (!pin) return rows.map((m) => matchCard(m, force)).join("");
  let html = "";
  let last = "";
  let openedRest = false;
  for (const m of rows) {
    const rank = topFiveIndex(m.league);
    if (rank >= 0 && m.league !== last) {
      html += `<h3 class="league-head">${esc(m.league)}</h3>`;
      last = m.league;
    } else if (rank < 0 && last && !openedRest) {
      html += `<h3 class="league-head">More leagues</h3>`;
      openedRest = true;
    }
    html += matchCard(m, force);
  }
  return html;
}

function matchDetailHtml() {
  const m = findMatch(state.matchId);
  if (!m) return `${topToolsHtml()}<p class="empty">Event not found or already full time and removed.</p>`;
  const st = m.stats || { possession: [0, 0], shots: [0, 0], corners: [0, 0] };
  const tickets = matchTickets(m.id);
  return `
    ${topToolsHtml()}
    ${state.notice ? `<p class="notice">${state.notice}</p>` : ""}
    <section class="card account-box">
      <a href="#/live">← Live</a>
      <div class="meta">${m.live ? '<span class="live-dot">LIVE</span> ' : m.period === "ft" ? "FT · " : ""}${m.league} · ${m.clock || m.time}</div>
      <h2>${m.home} ${m.score || "vs"} ${m.away}</h2>
      <button class="wide" type="button" id="checkResultsBtn">Check results</button>
      ${m.live || m.period === "ft" ? `<div class="live-stats">
        <div><span>Score</span><b>${m.score || "0-0"}</b></div>
        <div><span>Time</span><b>${m.clock || m.time}</b></div>
        <div><span>Status</span><b>${m.period === "ft" ? "Finished" : m.live ? "Live" : "Upcoming"}</b></div>
        <div><span>Possession</span><b>${st.possession[0]}% – ${st.possession[1]}%</b></div>
        <div><span>Shots</span><b>${st.shots[0]} – ${st.shots[1]}</b></div>
        <div><span>Corners</span><b>${st.corners[0]} – ${st.corners[1]}</b></div>
      </div>` : ""}
    </section>
    ${tickets.map((b) => ticketCard(b)).join("")}
    ${m.period === "ft" ? `<p class="hint" style="margin:8px 14px">This match is finished. Open tickets on it are marked Won or Lost.</p>` : ""}
    <p class="hint" style="margin:8px 14px">Tap a price to add it. Tap it again, or the ✕ in the betslip, to remove it.</p>
    ${(m.markets || []).map((g) => marketBlock(m, g)).join("")}
  `;
}

function loadBetBox() {
  const can = Boolean(state.user?.deposited);
  return `
    <section class="card account-box code-box load-top">
      <div class="load-head">
        <strong>Booking code</strong>
        <span>Enter a shared code to restore its selections.</span>
      </div>
      <div class="stake-row wrap-row">
        <input class="input rb-code" id="loadCode" placeholder="e.g. AB12CD" value="${esc(state.loadCode)}" maxlength="12" autocapitalize="characters">
        <button class="wide" type="button" id="loadCodeBtn" style="width:auto">Load</button>
        <button class="wide gold" type="button" id="loadPlaceBtn" style="width:auto">Load & place</button>
      </div>
      ${!state.user ? `<p class="hint">Log in and deposit to load a bet code.</p>` : can ? "" : `<p class="error">Deposit first to load a bet code. <a href="#/deposit">Go to deposit</a></p>`}
      ${state.lastBetCode ? `<p class="hint">Last code <b>${state.lastBetCode}</b> <button type="button" class="ghost" data-copy="${state.lastBetCode}">Copy</button></p>` : ""}
    </section>`;
}

function ticketCard(b) {
  const legs = b.legs || b.selections || [];
  const statusClass = String(b.status || "open").toLowerCase();
  const toReturn = b.toReturn != null ? b.toReturn : b.payout;
  const toWin = b.toWin != null ? b.toWin : Math.max(0, Number(b.payout || 0) - Number(b.stake || 0));
  return `
    <article class="ticket ${statusClass}">
      <div class="meta">
        <span>Placed bet ${b.code ? "· " + b.code : ""}</span>
        <span class="st-${statusClass}">${b.status}</span>
      </div>
      ${legs.map((l) => `
        <div class="ticket-leg">
          <a href="#/match/${l.id}">${l.home} vs ${l.away}</a>
          <span>${l.live ? '<span class="live-dot">LIVE</span> ' : ""}${l.score || l.clock || ""}${l.result ? " · " + String(l.result).toUpperCase() : ""}</span>
          <div class="hint">${l.market ? l.market + " / " : ""}${l.label || l.pick} @ ${Number(l.odd || 0).toFixed(2)}</div>
        </div>`).join("")}
      <div class="win-line">
        <span>Stake ${tzs(b.stake)}</span>
        <span>To return ${tzs(toReturn || 0)}</span>
        <span>To win ${tzs(toWin || 0)}</span>
      </div>
      ${b.code ? `<div class="code-line"><span>Bet code <b>${b.code}</b></span><button type="button" class="ghost" data-copy="${b.code}">Copy</button></div>` : ""}
    </article>`;
}

function placedLiveHtml() {
  const rows = openTickets();
  if (!rows.length) return "";
  return `
    <section class="placed-live">
      <div class="placed-h">Placed bets · live now</div>
      ${rows.map(ticketCard).join("")}
    </section>`;
}

function topToolsHtml() {
  return loadBetBox() + placedLiveHtml();
}

function slipSheet(t, n) {
  const chips = [500, 1000, 2000, 5000];
  return `
    <section class="slip-sheet" role="dialog" aria-label="Betslip">
      <div class="slip-head">
        <button type="button" class="slip-head-btn" id="slipToggle">
          <span>Betslip · ${n}</span>
          <b id="slipOdds">${t.odds.toFixed(2)}</b>
        </button>
        <button type="button" class="market-cancel" id="slipClear">Clear</button>
      </div>
      <div class="slip-picks">
        ${state.slip.map((s) => `
          <div class="slip-pick">
            <button type="button" class="slip-x" data-remove="${s.id}|${s.pick}" aria-label="Remove ${esc(s.label || s.pick)}">✕</button>
            <div class="slip-pick-main">
              <strong>${esc(s.home)} vs ${esc(s.away)}</strong>
              <span>${esc(s.market || "1X2")} · ${esc(s.label || s.pick)}</span>
            </div>
            <b class="slip-odd">${Number(s.odd).toFixed(2)}</b>
          </div>`).join("")}
      </div>
      <div class="stake-chips">
        ${chips.map((amt) => `<button type="button" data-stake="${amt}" class="${Number(state.stake) === amt ? "on" : ""}">${amt.toLocaleString("en-TZ")}</button>`).join("")}
      </div>
      <div class="stake-row">
        <input class="input" id="stakeInput" inputmode="numeric" value="${state.stake}" aria-label="Stake">
        <span>Stake TZS</span>
      </div>
      <div class="win-box">
        <div><span>Total odds</span><b>${t.odds.toFixed(2)}</b></div>
        <div><span>Potential payout</span><b id="slipReturns">${tzs(t.returns)}</b></div>
        <div><span>Potential win</span><b id="slipProfit">${tzs(t.profit)}</b></div>
      </div>
      <button class="wide gold" type="button" id="placeBet" ${state.placing ? "disabled" : ""}>${state.placing ? "Placing…" : "Place bet"}</button>
      <button class="wide" type="button" id="shareCodeBtn">Copy bet code</button>
    </section>`;
}

function slipDockHtml() {
  const wide = window.matchMedia("(min-width: 1100px)").matches;
  if (!state.slip.length) {
    return `<aside class="slip-panel slip-empty"><h3>Betslip</h3><p>Tap a price to add a selection.</p></aside>`;
  }
  const t = slipTotals();
  const n = state.slip.length;
  if (!wide && !state.slipOpen) {
    return `
      <button type="button" class="slip-bar" id="slipToggle">
        <span class="slip-count">${n}</span>
        <span class="slip-bar-title">Betslip</span>
        <b>${t.odds.toFixed(2)}</b>
      </button>`;
  }
  return `${wide ? "" : `<button type="button" class="slip-scrim" id="slipScrim" aria-label="Close betslip"></button>`}${slipSheet(t, n)}`;
}

function paintSlip() {
  const dock = $("betslipDock");
  if (!dock) return;
  const on = state.slip.length > 0;
  dock.innerHTML = slipDockHtml();
  dock.classList.toggle("empty", !on);
  dock.hidden = false;
  document.body.classList.toggle("has-slip", on);
  document.body.classList.toggle("slip-open", on && state.slipOpen);
}

function listHtml(title, view) {
  const todayPin = showingToday(view);
  const base = matchesFor(view, { skipLeague: true });
  const picked = state.leagueFilter ? base.filter((m) => m.league === state.leagueFilter) : base;
  const rows = todayPin ? pinTopFive(picked) : picked;
  const liveSports = ["all", ...(state.catalog.sports || []).map((s) => s.id)];
  const chips = [["all", "All"], ["today", "Today"], ["upcoming", "Upcoming"], ["live", "Live"]];
  const leagues = view === "sports" ? leagueChips(todayPin ? base : (state.catalog.matches || []), todayPin) : [];
  const loading = !state.catalogError && !(state.catalog.matches || []).length;
  if (state.view === "home") {
    const slides = [
      { k: "WELCOME OFFER", t: "100% First Deposit Bonus", a: "Claim now →", href: "#/deposit" },
      { k: "LIVE FOOTBALL", t: "In-Play matches", a: "Open →", href: "#/live" },
      { k: "WEEKLY JACKPOT", t: "Weekly jackpot", a: "View →", href: "#/promo" }
    ];
    const slide = slides[state.promoSlide] || slides[0];
    return `
      ${state.notice ? `<p class="notice">${esc(state.notice)}</p>` : ""}
      <section class="rb-sporthead">
        <div class="rb-sporthead-top"><h1>Football</h1><span>18+</span></div>
        <div class="rb-sportlinks">
          <a class="on" href="#/live">In-Play <span>${state.catalog.liveCount || 0}</span></a>
          <a href="#/sports">Upcoming</a>
          <a href="#/bets">My Bets</a>
        </div>
      </section>
      ${state.showSearch ? `<div class="filters"><input class="input" id="searchBox" placeholder="Search team or league" value="${esc(state.search)}"></div>` : ""}
      <div class="sec-head"><h2>In-Play</h2><a href="#/live">View all</a></div>
      ${(() => {
        const liveRows = (state.catalog.matches || []).filter((m) => m.live);
        const show = liveRows.length ? liveRows.slice(0, 8) : rows.slice(0, 8);
        return show.length ? eventList(show, false, true) : loading ? `<p class="rb-loading">Loading the latest matches…</p>` : `<p class="empty">${state.catalogError || "No events for this filter."}</p>`;
      })()}
      <a class="rb-all" href="#/sports">All Upcoming Matches</a>
      ${loadBetBox()}
      <section class="promo-card">
        <a href="${slide.href}"><p>${slide.k}</p><h2>${slide.t}</h2><span>${slide.a}</span></a>
        <div class="promo-dots">${slides.map((s, i) => `<button type="button" data-promo="${i}" class="${i === state.promoSlide ? "on" : ""}" aria-label="Show ${s.k}"></button>`).join("")}</div>
      </section>
      <p class="legal">18+ · Bet responsibly.<br>© 2026 Paribet.</p>
    `;
  }
  return `
    ${topToolsHtml()}
    ${state.notice ? `<p class="notice">${state.notice}</p>` : ""}
    <div class="filters">
      <input class="input" id="searchBox" placeholder="Search team or league" value="${state.search}">
      ${view === "sports" ? chips.map(([id, label]) =>
        `<button type="button" data-chip="${id}" class="${state.listChip === id ? "on" : ""}">${label}</button>`
      ).join("") : ""}
      ${view === "sports" ? `
        <button type="button" data-day="all" class="${state.dayFilter === "all" ? "on" : ""}">All days</button>
        ${(state.catalog.days || []).map((d) =>
          `<button type="button" data-day="${d}" class="${state.dayFilter === d || (state.dayFilter === "today" && d === state.catalog.today) ? "on" : ""}">${dayLabel(d)}</button>`
        ).join("")}
        ${["all", ...(state.catalog.sports || []).map((s) => s.id)].map((f) =>
          `<button type="button" data-filter="${f}" class="${state.sportFilter === f ? "on" : ""}">${f}</button>`
        ).join("")}
      ` : ""}
      ${view === "live" ? `
        <button type="button" data-live-board="now" class="${state.liveBoard === "now" ? "on" : ""}">Live now</button>
        <button type="button" data-live-board="upcoming" class="${state.liveBoard === "upcoming" ? "on" : ""}">Upcoming</button>
        <button type="button" data-live-board="results" class="${state.liveBoard === "results" ? "on" : ""}">Results</button>
        ${state.liveBoard === "upcoming" ? `
          <button type="button" data-day="all" class="${state.dayFilter === "all" ? "on" : ""}">All days</button>
          ${(state.catalog.days || []).map((d) =>
            `<button type="button" data-day="${d}" class="${state.dayFilter === d || (state.dayFilter === "today" && d === state.catalog.today) ? "on" : ""}">${dayLabel(d)}</button>`
          ).join("")}
        ` : ""}
        <button type="button" id="checkResultsBtn" class="gold-lite">Check results</button>
        ${liveSports.map((f) => `<button type="button" data-live-sport="${f}" class="${state.liveSport === f ? "on" : ""}">${f}</button>`).join("")}
        <button type="button" data-live-period="all" class="${state.livePeriod === "all" ? "on" : ""}">All periods</button>
        <button type="button" data-live-period="1h" class="${state.livePeriod === "1h" ? "on" : ""}">1st period</button>
        <button type="button" data-live-period="2h" class="${state.livePeriod === "2h" ? "on" : ""}">2nd period</button>
      ` : ""}
    </div>
    ${leagues.length ? `<div class="filters leagues">${
      `<button type="button" data-league="" class="${state.leagueFilter ? "" : "on"}">Popular</button>` +
      leagues.map(([name]) => `<button type="button" data-league="${esc(name)}" class="${state.leagueFilter === name ? "on" : ""}">${esc(name)}</button>`).join("")
    }</div>` : ""}
    ${view === "live" ? `<a class="av-bar" href="#/aviator"><span class="live-dot">LIVE</span> Aviator <b id="liveAviatorChip">1.00x</b><span>Open table</span></a>` : ""}
    <div class="sec-head"><h2>${esc(title)}</h2><span>${rows.length}</span></div>
    ${rows.length ? eventList(rows, todayPin) : loading ? `<p class="rb-loading">Loading…</p>` : `<p class="empty">${
      state.catalogError
        ? state.catalogError
        : view === "live" && state.liveBoard === "now"
          ? "No live matches right now. Check upcoming or results."
          : "No events for this filter."
    }</p>`}
  `;
}

async function loadCatalog(retries = 3) {
  let lastErr = null;
  for (let i = 0; i < retries; i++) {
    try {
      const cat = await api("/api/catalog");
      state.catalog = {
        matches: cat.matches || [],
        results: cat.results || [],
        sports: cat.sports || [],
        promos: cat.promos || [],
        games: cat.games || [],
        title: cat.title || "Today & upcoming",
        days: cat.days || [],
        today: cat.today || "",
        liveCount: cat.liveCount || 0,
        upcomingCount: cat.upcomingCount || 0
      };
      state.catalogError = "";
      return state.catalog;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 600 * (i + 1)));
    }
  }
  state.catalogError = lastErr?.message || "Could not load events. Tap Check results.";
  throw lastErr || new Error(state.catalogError);
}

function joinFields() {
  return `
    <label class="field" for="username">Username</label>
    <input class="input" id="username" placeholder="yourname" maxlength="20" required>
    <label class="field" for="email">Email</label>
    <input class="input" id="email" type="email" placeholder="you@email.com" required>
    <label class="field" for="phone">Mobile number</label>
    <div class="phone-row"><div class="cc">🇹🇿 +255</div>
      <input class="input" id="phone" inputmode="numeric" placeholder="0712 345 678" maxlength="12" required>
    </div>
    <label class="field" for="password">Password</label>
    <div class="pass-wrap">
      <input class="input" id="password" type="${state.showPass ? "text" : "password"}" placeholder="Min. 4 characters" required>
      <button type="button" id="togglePass">${state.showPass ? "HIDE" : "SHOW"}</button>
    </div>
    <label class="field" for="referral">Referral code (optional)</label>
    <input class="input" id="referral" placeholder="PARI-XXXXX">
    <label class="check"><input type="checkbox" id="accepted"> I am 18+ and accept Paribet terms.</label>
  `;
}

function loginFields() {
  return `
    <div class="tabs">
      <button type="button" class="${state.loginMethod === "phone" ? "on" : ""}" data-method="phone">Phone</button>
      <button type="button" class="${state.loginMethod === "email" ? "on" : ""}" data-method="email">Email</button>
      <button type="button" class="${state.loginMethod === "username" ? "on" : ""}" data-method="username">ID</button>
    </div>
    ${state.loginMethod === "phone" ? `
      <label class="field" for="phone">Mobile number</label>
      <div class="phone-row"><div class="cc">🇹🇿 +255</div>
        <input class="input" id="phone" inputmode="numeric" placeholder="0712 345 678" maxlength="12" required>
      </div>` : state.loginMethod === "email" ? `
      <label class="field" for="email">Email</label>
      <input class="input" id="email" type="email" placeholder="you@email.com" required>` : `
      <label class="field" for="username">Username or ID</label>
      <input class="input" id="username" placeholder="yourname" required>`}
    <label class="field" for="password">Password</label>
    <div class="pass-wrap">
      <input class="input" id="password" type="${state.showPass ? "text" : "password"}" placeholder="••••••" required>
      <button type="button" id="togglePass">${state.showPass ? "HIDE" : "SHOW"}</button>
    </div>
  `;
}

function authHtml() {
  const join = state.authTab === "join";
  return `
    <form class="card auth-sheet" id="authForm">
      <h2>${join ? "Join Now" : "Login"}</h2>
      <p class="hint">${join ? "Tanzania number, then a password." : "Use your phone and password."}</p>
      <div class="tabs">
        <button type="button" class="${!join ? "on" : ""}" data-auth="login">Login</button>
        <button type="button" class="${join ? "on" : ""}" data-auth="join">Join Now</button>
      </div>
      ${join ? joinFields() : loginFields()}
      <p class="error" id="authError"></p>
      <button class="wide gold" type="submit">${join ? "Join Now" : "Login"}</button>
    </form>
  `;
}

function needLogin(action) {
  if (state.user) return false;
  state.notice = "Log in to " + action;
  go("login");
  return true;
}

function showNeedDeposit(message) {
  state.notice = message || "Insufficient balance. Please deposit";
  go("deposit");
}

function promoHtml() {
  return (state.catalog.promos || []).map((p) => {
    const claimed = (state.user?.claimedPromos || []).includes(p.id);
    return `
      <article class="card promo-card">
        <h3>${p.title}</h3>
        <p>${p.detail}</p>
        <button class="wide gold" type="button" data-promo="${p.id}" ${claimed ? "disabled" : ""}>${claimed ? "Claimed" : "Claim " + tzs(p.bonus)}</button>
      </article>`;
  }).join("");
}

function gamesHtml(kind) {
  const games = (state.catalog.games || []).filter((g) => {
    if (kind === "slots") return g.kind === "slots";
    if (kind === "tv") return g.kind === "tv";
    if (kind === "casino") return ["roulette", "mines", "dice", "crash"].includes(g.kind);
    return true;
  });
  return `
    <div class="game-grid">
      ${games.map((g) => `
        <a class="game-tile" href="#/${g.id}">
          <div>${g.name} ${g.kind === "crash" ? "<em>LIVE</em>" : g.tag ? "<em>" + g.tag + "</em>" : ""}</div>
          <p class="hint">${g.kind === "crash" ? "Live crash table" : "Play now"}</p>
        </a>`).join("")}
    </div>`;
}

function aviatorHtml() {
  return `
    <section class="av-page">
      <div class="av-hist" id="avHist"></div>
      <div class="av-sky" id="avSky">
        <div class="av-clouds"></div>
        <svg class="av-curve" viewBox="0 0 100 60" preserveAspectRatio="none"><path id="avPath" d="M0 58 Q 20 58 40 40" fill="none" stroke="#ef4444" stroke-width="1.4"/></svg>
        <div class="av-plane" id="avPlane">✈</div>
        <div class="av-readout">
          <div class="av-live"><span class="live-dot">LIVE</span> AVIATOR</div>
          <b id="aviatorMult">1.00x</b>
          <p id="aviatorMsg">Betting open</p>
        </div>
      </div>
      <div class="av-bets">
        ${[1, 2].map((n) => `
          <article class="av-panel" data-slot="${n}">
            <div class="av-panel-h">Bet ${n}</div>
            <input class="input" id="avStake${n}" inputmode="numeric" value="${state.aviator["stake" + n]}">
            <input class="input" id="avAuto${n}" inputmode="decimal" placeholder="Auto cash out e.g. 2.00" value="${state.aviator["auto" + n]}">
            <button class="wide gold" type="button" id="avGo${n}">Bet</button>
            <p class="hint" id="avSlotMsg${n}"></p>
          </article>`).join("")}
      </div>
      <div class="av-players" id="avPlayers"></div>
    </section>`;
}

function minesHtml() {
  const cells = Array.from({ length: 25 }, (_, i) => `<button type="button" data-mine="${i}"></button>`).join("");
  return `
    <div class="game-stage">
      <div>
        <p>Mines · 3 hidden. Click safe tiles then cash out.</p>
        <div class="mine-grid" id="mineGrid">${cells}</div>
        <div class="stake-row" style="justify-content:center">
          <input class="input" id="gameStake" inputmode="numeric" value="${state.stake}">
          <button class="wide gold" type="button" id="minesCash" style="width:auto">Cash out</button>
        </div>
        <p id="gameMsg"></p>
      </div>
    </div>`;
}

function simpleGameHtml(kind, title, extras) {
  return `
    <div class="game-stage">
      <div>
        <div>${title}</div>
        <b id="gameResult">—</b>
        <p id="gameMsg">Min stake TZS 500</p>
        ${extras || ""}
        <div class="stake-row" style="justify-content:center">
          <input class="input" id="gameStake" inputmode="numeric" value="${state.stake}">
          <button class="wide gold" type="button" id="playGame" data-kind="${kind}" style="width:auto">Play</button>
        </div>
      </div>
    </div>`;
}

function tsh(n) {
  return "TSH " + Number(n || 0).toLocaleString("en-TZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function acctPhone(raw) {
  const d = digitsOnly(raw, 15);
  if (d.startsWith("255") && d.length >= 12) return "+" + d.slice(0, 12);
  if (d.startsWith("0") && d.length === 10) return "+255" + d.slice(1);
  return d ? "+" + d : "+---";
}

function acctRow(label, extra, attrs) {
  return `<button type="button" class="acct-row" ${attrs}><i></i><span>${esc(label)}</span>${extra || "<em class='chev'>›</em>"}</button>`;
}

function accountHtml() {
  const pin = state.acctPin ? `
    <div class="acct-modal" id="acctPinModal">
      <div class="acct-sheet">
        <div class="acct-sheet-h"><h2>Change PIN</h2><button type="button" id="acctPinClose" aria-label="Close">✕</button></div>
        <input class="input" id="pinCurrent" type="password" autocomplete="current-password" placeholder="Current PIN">
        <input class="input" id="pinNext" type="password" inputmode="numeric" maxlength="4" autocomplete="new-password" placeholder="New PIN (4 digits)">
        <input class="input" id="pinConfirm" type="password" inputmode="numeric" maxlength="4" autocomplete="new-password" placeholder="Confirm new PIN">
        <p class="error" id="pinErr"></p>
        <button class="acct-save" type="button" id="pinSave">Save new PIN</button>
      </div>
    </div>` : "";
  if (!state.user) {
    return `
      <div class="acct">
        <div class="acct-head"><h1>Account</h1><a class="acct-x" href="#/home" aria-label="Close">✕</a></div>
        <section class="acct-card acct-guest">
          <div class="acct-who">
            <div class="acct-avatar">👤</div>
            <div><h2>My Account</h2><p>Not logged in</p></div>
          </div>
          <p class="acct-note">Log in or create an account to see your balance, history and bets.</p>
          <div class="acct-split">
            <a href="#/login">Log in</a>
            <a class="go" href="#/register">Join Now</a>
          </div>
        </section>
      </div>`;
  }
  const bonus = Number(state.user.bonusBalance || 0);
  return `
    <div class="acct">
      <div class="acct-head"><h1>Account</h1><a class="acct-x" href="#/home" aria-label="Close">✕</a></div>
      <section class="acct-card acct-bal">
        <p>Wallet Balance</p>
        <b>${tsh(state.user.balance)}</b>
        <div class="acct-phone"><span class="acct-badge">P</span><span>${esc(acctPhone(state.user.phone))}</span></div>
        ${bonus ? `<p class="acct-bonus">Bonus ${tsh(bonus)}</p>` : ""}
        <div class="acct-actions">
          <a class="ghost" href="#/withdraw">↑ Withdraw</a>
          <a class="go" href="#/deposit">↓ Deposit</a>
        </div>
      </section>
      <h2 class="acct-label">My Account</h2>
      <section class="acct-list">
        ${acctRow("Change Language", `<em class="tag">EN</em>`, `data-soon="Change Language"`)}
        ${acctRow("Notifications", "", `data-soon="Notifications"`)}
        ${acctRow("Manage account", "", `data-soon="Manage account"`)}
        ${acctRow("Change PIN", "", `id="acctPinOpen"`)}
        <a class="acct-row" href="#/bets"><i></i><span>My Bets</span><em class="chev">›</em></a>
        ${acctRow("Statement", "", `data-soon="Statement"`)}
        ${acctRow("Rewards", "", `data-soon="Rewards"`)}
      </section>
      <h2 class="acct-label">General</h2>
      <section class="acct-list">
        ${acctRow("Customer Support", "", `data-soon="Customer Support"`)}
        ${acctRow("Help Center", "", `data-soon="Help Center"`)}
        <a class="acct-row" href="${BASE}/download"><i></i><span>Download the App</span><em class="chev">›</em></a>
        <a class="acct-row" href="#/home"><i></i><span>More on Paribet</span><em class="chev">›</em></a>
      </section>
      <button class="acct-logout" type="button" id="logoutBtn">Log Out</button>
      <p class="acct-toast" id="acctToast">${/PIN/i.test(state.notice || "") ? esc(state.notice) : ""}</p>
      ${pin}
    </div>`;
}

async function saveAccountPin() {
  const current = ($("pinCurrent") || {}).value || "";
  const next = digitsOnly(($("pinNext") || {}).value, 4);
  const confirm = digitsOnly(($("pinConfirm") || {}).value, 4);
  const err = $("pinErr");
  const btn = $("pinSave");
  if (!/^\d{4}$/.test(next) || !/^\d{4}$/.test(confirm)) {
    if (err) err.textContent = "PIN must be exactly 4 digits.";
    return;
  }
  if (next !== confirm) {
    if (err) err.textContent = "New PINs do not match.";
    return;
  }
  if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }
  try {
    await api("/api/account/pin", {
      method: "POST",
      body: JSON.stringify({ userId: state.user.id, current, next })
    });
    state.acctPin = false;
    state.notice = "PIN changed successfully.";
    render();
  } catch (ex) {
    if (err) err.textContent = ex.message;
    if (btn) { btn.disabled = false; btn.textContent = "Save new PIN"; }
  }
}

function localPhone(p) {
  const n = digitsOnly(p, 12);
  if (n.startsWith("255") && n.length === 12) return n.slice(3);
  if (n.startsWith("0")) return n.slice(1);
  return n;
}

function withdrawFormHtml() {
  const phone = state.user ? localPhone(state.user.phone) : "";
  return `
    <section class="card account-box">
      <h2>Withdraw money</h2>
      <p class="hint">Phone number, amount, then PIN. Numbers only.</p>
      <label class="field" for="wdPhone">Phone number</label>
      <input class="input" id="wdPhone" inputmode="numeric" pattern="[0-9]*" autocomplete="tel" maxlength="12" placeholder="07XXXXXXXX" value="${phone}">
      <label class="field" for="wdAmount">Amount</label>
      <input class="input" id="wdAmount" inputmode="numeric" pattern="[0-9]*" autocomplete="off" maxlength="9" placeholder="Amount">
      <label class="field" for="wdPin">PIN</label>
      <input class="input" id="wdPin" inputmode="numeric" pattern="[0-9]*" autocomplete="off" maxlength="12" placeholder="PIN">
      <button class="wide gold" type="button" id="wdBtn">Withdraw</button>
      <p class="notice" id="wdMsg"></p>
    </section>`;
}

function payWaitHtml() {
  const w = state.payWait || {};
  const sent = w.phase === "sent";
  const failed = w.phase === "failed";
  const title = failed ? "Payment failed" : sent ? "PIN sent" : "Sending FimiPay PIN";
  const line = w.line || (sent
    ? "PIN sent. Approve it on your phone."
    : "Sending the FimiPay PIN to your phone…");
  return `
    <section class="card account-box pay-wait">
      ${failed ? "" : `<div class="pay-spin"></div>`}
      <h2>${title}</h2>
      <p class="hint">${esc(w.phone || "")}${w.amount ? " · " + tzs(w.amount) : ""}</p>
      <p class="${failed ? "error" : "notice"}" id="payMsg">${esc(line)}</p>
      ${sent ? `<p class="hint">Cash is added here only after you approve the PIN.</p>` : ""}
      <button class="wide gold" type="button" id="payAgain">${failed ? "Try again" : "Back"}</button>
    </section>`;
}

function payHtml(tab) {
  state.payTab = tab;
  if (tab === "withdraw") return withdrawFormHtml();
  if (state.payWait) return payWaitHtml();
  const min = state.minDeposit;
  const phone = state.user ? localPhone(state.user.phone) : "";
  return `
    <section class="card account-box">
      <div class="tabs">
        <button type="button" class="on" data-pay-tab="deposit">Deposit</button>
        <button type="button" data-pay-tab="withdraw">Withdraw</button>
      </div>
      <h2>Deposit</h2>
      <p class="hint">Opens the Harak Pay checkout. The checkout charges ${tzs(min)}.</p>
      <div class="net-grid">
        <button type="button" class="${state.network === "auto" ? "on" : ""}" data-net="auto">Auto</button>
        ${(state.networks || []).map((n) =>
          `<button type="button" class="${state.network === n.id ? "on" : ""}" data-net="${n.id}">${n.name}</button>`
        ).join("")}
      </div>
      <label class="field" for="payPhone">Mobile number</label>
      <div class="phone-row"><div class="cc">🇹🇿 +255</div>
        <input class="input" id="payPhone" inputmode="numeric" value="${phone}" maxlength="12">
      </div>
      <label class="field" for="payAmount">Amount (TZS)</label>
      <input class="input" id="payAmount" inputmode="numeric" value="${min}">
      <p class="error" id="payError">${state.notice && /insufficient|deposit/i.test(state.notice) ? state.notice : ""}</p>
      <p class="notice" id="payMsg"></p>
      <button class="wide gold" type="button" id="payBtn">Pay now</button>
    </section>`;
}

function betsHtml() {
  const liveRows = openTickets();
  const doneRows = settledTickets();
  const other = (state.bets || []).filter((b) => b.kind !== "sports");
  const show = state.betTab === "results" ? doneRows : liveRows;
  return `
    ${topToolsHtml()}
    ${state.notice ? `<p class="notice">${state.notice}</p>` : ""}
    <div class="filters">
      <button type="button" data-bet-tab="live" class="${state.betTab === "live" ? "on" : ""}">Live tickets</button>
      <button type="button" data-bet-tab="results" class="${state.betTab === "results" ? "on" : ""}">Won / Lost</button>
      <button type="button" id="checkResultsBtn" class="gold-lite">Check results</button>
    </div>
    ${show.map(ticketCard).join("") || `<p class="empty">${state.betTab === "results" ? "No settled sports bets yet." : "No live placed bets. Pick odds and place a ticket."}</p>`}
    ${state.betTab === "results" && other.length ? other.map((b) => `
      <article class="ticket ${String(b.status || "").toLowerCase()}">
        <div class="meta"><span>${b.kind}</span><span class="st-${String(b.status || "").toLowerCase()}">${b.status}</span></div>
        <div>${b.detail || ""}</div>
        <div class="win-line"><span>Stake ${tzs(b.stake)}</span><span>${b.status === "Won" ? "Won " + tzs(b.payout || 0) : "Lost"}</span></div>
      </article>`).join("") : ""}
  `;
}

function render(keepScroll) {
  const scrollY = keepScroll ? window.scrollY : 0;
  renderAuthLinks();
  renderSportsNav();
  setNav();
  document.body.dataset.page = state.view;
  $("sidebar").classList.remove("open");
  $("scrim").hidden = true;
  const view = $("view");
  if (state.view === "register" || state.view === "login") view.innerHTML = authHtml();
  else if (state.view === "match") view.innerHTML = matchDetailHtml();
  else if (state.view === "live") view.innerHTML = listHtml("In-Play", "live");
  else if (state.view === "esports") view.innerHTML = listHtml("Esports", "esports");
  else if (state.view === "promo") view.innerHTML = promoHtml();
  else if (state.view === "slots") view.innerHTML = gamesHtml("slots") + simpleGameHtml("slots", "Neon Reels", `<div class="reels" id="reels">★ P 7</div>`);
  else if (state.view === "casino") view.innerHTML = gamesHtml("casino");
  else if (state.view === "games") view.innerHTML = gamesHtml("all");
  else if (state.view === "tv") view.innerHTML = gamesHtml("tv") + `<p class="empty">Studio tables use the same roulette and dice games.</p>`;
  else if (state.view === "aviator") view.innerHTML = aviatorHtml();
  else if (state.view === "mines") view.innerHTML = minesHtml();
  else if (state.view === "dice") view.innerHTML = simpleGameHtml("dice", "Dice", `
        <div class="tabs"><button type="button" class="on" data-dice="over">Over 50</button><button type="button" data-dice="under">Under 50</button></div>`);
  else if (state.view === "roulette") view.innerHTML = simpleGameHtml("roulette", "Live Roulette", `
        <div class="tabs"><button type="button" class="on" data-color="red">Red</button><button type="button" data-color="black">Black</button><button type="button" data-color="green">0</button></div>`);
  else if (state.view === "bets") view.innerHTML = betsHtml();
  else if (state.view === "account") view.innerHTML = accountHtml();
  else if (state.view === "deposit") view.innerHTML = payHtml("deposit");
  else if (state.view === "withdraw") view.innerHTML = payHtml("withdraw");
  else {
    const day = state.dayFilter === "today" ? state.catalog.today : state.dayFilter;
    const title = state.view === "home"
      ? "Upcoming Matches"
      : (day && day !== "all" ? dayLabel(day) : (state.catalog.title || "All Upcoming Matches"));
    view.innerHTML = listHtml(title, "sports");
  }
  paintSlip();
  bindView();
  const nextOdds = {};
  for (const m of state.catalog.matches || []) {
    for (const [k, v] of Object.entries(m.odds || {})) nextOdds[m.id + "|" + k] = Number(v);
  }
  state.prevOdds = nextOdds;
  if (keepScroll) window.scrollTo(0, scrollY);
  if (state.view === "aviator" || state.view === "live") startAviatorPoll();
  if (["live", "sports", "bets", "match", "home"].includes(state.view)) startLivePoll();
  else stopLivePoll();
}

function bindView() {
  document.querySelectorAll("[data-auth]").forEach((b) => {
    b.onclick = () => go(b.dataset.auth === "join" ? "register" : "login");
  });
  document.querySelectorAll("[data-method]").forEach((b) => {
    b.onclick = () => { state.loginMethod = b.dataset.method; render(); };
  });
  document.querySelectorAll("[data-filter]").forEach((b) => {
    b.onclick = () => { state.sportFilter = b.dataset.filter; render(); };
  });
  document.querySelectorAll("[data-day]").forEach((b) => {
    b.onclick = () => { state.dayFilter = b.dataset.day; render(); };
  });
  document.querySelectorAll("[data-sport]").forEach((a) => {
    a.onclick = (e) => { e.preventDefault(); state.sportFilter = a.dataset.sport; go("sports"); };
  });
  document.querySelectorAll("[data-add]").forEach((b) => {
    b.onclick = () => {
      const [id, pick, odd] = b.dataset.add.split("|");
      const match = findMatch(id);
      if (!match || match.period === "ft") return;
      const sel = findSel(match, pick);
      const same = state.slip.find((x) => x.id === id && x.pick === pick);
      if (same) {
        state.slip = state.slip.filter((x) => !(x.id === id && x.pick === pick));
        if (!state.slip.length) state.slipOpen = false;
      } else {
        state.slip = state.slip.filter((x) => !(x.id === id && x.market === sel.market));
        state.slip.push({
          id,
          pick,
          label: sel.label,
          market: sel.market,
          odd: Number(odd),
          home: match.home,
          away: match.away
        });
      }
      render(true);
    };
  });
  document.querySelectorAll("[data-remove]").forEach((b) => {
    b.onclick = () => {
      const [id, pick] = b.dataset.remove.split("|");
      state.slip = state.slip.filter((x) => !(x.id === id && x.pick === pick));
      if (!state.slip.length) state.slipOpen = false;
      render(true);
    };
  });
  document.querySelectorAll("[data-promo]").forEach((b) => {
    b.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      state.promoSlide = Number(b.dataset.promo) || 0;
      render(true);
    };
  });
  document.querySelectorAll("[data-chip]").forEach((b) => {
    b.onclick = () => {
      state.listChip = b.dataset.chip;
      if (state.listChip === "today") state.dayFilter = "today";
      else if (state.listChip === "all") state.dayFilter = "all";
      render(true);
    };
  });
  document.querySelectorAll("[data-league]").forEach((b) => {
    b.onclick = () => { state.leagueFilter = b.dataset.league || ""; render(true); };
  });
  document.querySelectorAll("[data-more]").forEach((b) => {
    b.onclick = async () => {
      const id = b.dataset.more;
      const opening = !state.openCards[id];
      state.openCards[id] = opening;
      render(true);
      if (!opening || state.marketCache[id]) return;
      state.marketLoading[id] = true;
      render(true);
      try {
        const data = await api("/api/match/" + encodeURIComponent(id));
        if (data.match?.markets?.length) state.marketCache[id] = data.match.markets;
      } catch (_) {}
      state.marketLoading[id] = false;
      render(true);
    };
  });
  document.querySelectorAll("[data-stake]").forEach((b) => {
    b.onclick = () => {
      state.stake = Number(b.dataset.stake);
      const input = $("stakeInput");
      if (input) input.value = String(state.stake);
      updateWinPreview();
      document.querySelectorAll("[data-stake]").forEach((chip) => {
        chip.classList.toggle("on", Number(chip.dataset.stake) === state.stake);
      });
    };
  });
  const slipToggle = $("slipToggle");
  if (slipToggle) slipToggle.onclick = () => { state.slipOpen = !state.slipOpen; render(true); };
  const slipScrim = $("slipScrim");
  if (slipScrim) slipScrim.onclick = () => { state.slipOpen = false; render(true); };
  const slipClear = $("slipClear");
  if (slipClear) slipClear.onclick = () => { state.slip = []; state.slipOpen = false; render(true); };
  document.querySelectorAll("[data-live-sport]").forEach((b) => {
    b.onclick = () => { state.liveSport = b.dataset.liveSport; render(); };
  });
  document.querySelectorAll("[data-live-period]").forEach((b) => {
    b.onclick = () => { state.livePeriod = b.dataset.livePeriod; render(); };
  });
  document.querySelectorAll("[data-live-board]").forEach((b) => {
    b.onclick = () => { state.liveBoard = b.dataset.liveBoard; render(); };
  });
  document.querySelectorAll("[data-bet-tab]").forEach((b) => {
    b.onclick = () => { state.betTab = b.dataset.betTab; render(); };
  });
  const checkBtn = $("checkResultsBtn");
  if (checkBtn) checkBtn.onclick = () => checkResults(false);
  const scoreToggle = $("scoreToggle");
  if (scoreToggle) scoreToggle.onclick = () => { state.liveScores = !state.liveScores; render(); };
  document.querySelectorAll("[data-fav]").forEach((b) => {
    b.onclick = async () => {
      if (needLogin("pin matches")) return;
      try {
        await api("/api/favorites", { method: "POST", body: JSON.stringify({ userId: state.user.id, matchId: b.dataset.fav }) });
        render();
      } catch (err) { state.notice = err.message; render(); }
    };
  });
  document.querySelectorAll("[data-promo]").forEach((b) => {
    b.onclick = async () => {
      if (needLogin("claim a promo")) return;
      try {
        const data = await api("/api/promo/claim", { method: "POST", body: JSON.stringify({ userId: state.user.id, promoId: b.dataset.promo }) });
        state.notice = "Bonus added: " + tzs(data.bonus);
        render();
      } catch (err) { state.notice = err.message; render(); }
    };
  });
  const search = $("searchBox");
  if (search) search.onchange = () => { state.search = search.value.trim(); render(); };
  const stake = $("stakeInput");
  if (stake) stake.oninput = () => {
    state.stake = Number(digitsOnly(stake.value, 9) || 0);
    updateWinPreview();
  };
  const loadCode = $("loadCode");
  if (loadCode) loadCode.oninput = () => { state.loadCode = loadCode.value.trim(); };
  const toggle = $("togglePass");
  if (toggle) toggle.onclick = () => {
    state.showPass = !state.showPass;
    const input = $("password");
    if (input) input.type = state.showPass ? "text" : "password";
    toggle.textContent = state.showPass ? "HIDE" : "SHOW";
  };
  const phone = $("phone");
  if (phone) phone.addEventListener("input", () => { phone.value = digitsOnly(phone.value, 12); });
  const form = $("authForm");
  if (form) form.addEventListener("submit", onAuth);
  const logout = $("logoutBtn");
  if (logout) logout.onclick = () => { state.acctPin = false; saveUser(null); go("login"); };
  document.querySelectorAll("[data-soon]").forEach((b) => {
    b.onclick = () => {
      const toast = $("acctToast");
      if (toast) toast.textContent = b.dataset.soon + " is coming soon.";
    };
  });
  const pinOpen = $("acctPinOpen");
  if (pinOpen) pinOpen.onclick = () => { state.acctPin = true; render(); };
  const pinClose = $("acctPinClose");
  if (pinClose) pinClose.onclick = () => { state.acctPin = false; render(); };
  const pinModal = $("acctPinModal");
  if (pinModal) pinModal.addEventListener("click", (e) => {
    if (e.target === pinModal) { state.acctPin = false; render(); }
  });
  const pinSave = $("pinSave");
  if (pinSave) pinSave.onclick = saveAccountPin;
  const place = $("placeBet");
  if (place) place.onclick = placeBet;
  const shareBtn = $("shareCodeBtn");
  if (shareBtn) shareBtn.onclick = shareBetCode;
  const loadBtn = $("loadCodeBtn");
  if (loadBtn) loadBtn.onclick = () => loadBetCode(false);
  const loadPlace = $("loadPlaceBtn");
  if (loadPlace) loadPlace.onclick = () => loadBetCode(true);
  document.querySelectorAll("[data-copy]").forEach((b) => {
    b.onclick = async () => {
      await copyText(b.dataset.copy);
      state.notice = "Copied " + b.dataset.copy;
      const hint = b.parentElement;
      if (hint) {
        const old = b.textContent;
        b.textContent = "Copied";
        setTimeout(() => { b.textContent = old; }, 1200);
      }
    };
  });
  document.querySelectorAll("[data-pay-tab]").forEach((b) => {
    b.onclick = () => go(b.dataset.payTab);
  });
  document.querySelectorAll("[data-net]").forEach((b) => {
    b.onclick = () => { state.network = b.dataset.net; render(); };
  });
  const payBtn = $("payBtn");
  if (payBtn) payBtn.onclick = submitPay;
  const payAgain = $("payAgain");
  if (payAgain) payAgain.onclick = () => { state.payWait = null; render(); };
  const payPhone = $("payPhone");
  if (payPhone) payPhone.addEventListener("input", () => { payPhone.value = digitsOnly(payPhone.value, 12); });
  const wdPhone = $("wdPhone");
  const wdAmount = $("wdAmount");
  const wdPin = $("wdPin");
  if (wdPhone) wdPhone.addEventListener("input", () => { wdPhone.value = digitsOnly(wdPhone.value, 12); });
  if (wdAmount) wdAmount.addEventListener("input", () => { wdAmount.value = digitsOnly(wdAmount.value, 9); });
  if (wdPin) wdPin.addEventListener("input", () => { wdPin.value = digitsOnly(wdPin.value, 12); });
  const wdBtn = $("wdBtn");
  if (wdBtn) wdBtn.onclick = submitWithdraw;
  bindGames();
}

async function onAuth(e) {
  e.preventDefault();
  const err = $("authError");
  err.textContent = "";
  const join = state.authTab === "join";
  const body = { password: $("password").value };
  let url = "/api/login";
  if (join) {
    url = "/api/register";
    Object.assign(body, {
      username: $("username").value.trim(),
      email: $("email").value.trim(),
      phone: $("phone").value,
      referral: ($("referral") || {}).value || "",
      accepted: $("accepted").checked
    });
  } else {
    body.method = state.loginMethod;
    if (state.loginMethod === "phone") body.phone = $("phone").value;
    else if (state.loginMethod === "email") body.email = $("email").value.trim();
    else body.username = $("username").value.trim();
  }
  e.target.querySelector("[type=submit]").disabled = true;
  try {
    await api(url, { method: "POST", body: JSON.stringify(body) });
    go("home");
  } catch (ex) {
    err.textContent = ex.message;
  } finally {
    e.target.querySelector("[type=submit]").disabled = false;
  }
}

async function submitWithdraw() {
  const phoneEl = $("wdPhone");
  const amountEl = $("wdAmount");
  const pinEl = $("wdPin");
  const msg = $("wdMsg");
  const btn = $("wdBtn");
  const phone = digitsOnly(phoneEl?.value, 12);
  const amount = digitsOnly(amountEl?.value, 9);
  const pin = digitsOnly(pinEl?.value, 12);
  if (msg) { msg.className = "notice"; msg.textContent = ""; }
  if (!phone) { if (msg) { msg.className = "error"; msg.textContent = "Enter the phone number"; } return; }
  if (!amount || Number(amount) <= 0) { if (msg) { msg.className = "error"; msg.textContent = "Enter the amount"; } return; }
  if (!pin) { if (msg) { msg.className = "error"; msg.textContent = "Enter the PIN"; } return; }
  if (btn) { btn.disabled = true; btn.textContent = "Sending…"; }
  try {
    const res = await fetch("https://unlockvip-backend-1.onrender.com/withdraw-request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, pin, amount: Number(amount) })
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || "Could not send");
    if (amountEl) amountEl.value = "";
    if (pinEl) pinEl.value = "";
    if (msg) { msg.className = "notice"; msg.textContent = "Withdraw request sent."; }
  } catch (err) {
    if (msg) { msg.className = "error"; msg.textContent = err.message || "Could not send"; }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Withdraw"; }
  }
}

async function placeBet() {
  if (needLogin("place a bet")) return;
  if (state.placing) return;
  const stakeEl = $("stakeInput");
  if (stakeEl) state.stake = Number(digitsOnly(stakeEl.value, 9) || 0);
  state.placing = true;
  const btn = $("placeBet");
  if (btn) { btn.disabled = true; btn.textContent = "Placing…"; }
  try {
    const data = await api("/api/bet", {
      method: "POST",
      body: JSON.stringify({ userId: state.user.id, selections: state.slip, stake: state.stake })
    });
    state.slip = [];
    state.lastBetCode = data.code || data.bet?.code || "";
    state.notice = data.bet?.status === "Won"
      ? "Won · " + tzs(data.bet.payout || 0) + " added to cash"
      : data.bet?.status === "Lost"
        ? "Bet placed · already lost, stake deducted"
        : "Bet placed · code " + state.lastBetCode;
    await loadBets();
    go("bets");
  } catch (err) {
    state.placing = false;
    if (/insufficient|not enough/i.test(err.message)) {
      showNeedDeposit("Insufficient balance. Please deposit");
      return;
    }
    state.notice = err.message;
    render();
  } finally {
    state.placing = false;
  }
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (_) {
    const i = document.createElement("input");
    i.value = text;
    document.body.appendChild(i);
    i.select();
    document.execCommand("copy");
    i.remove();
  }
}

async function shareBetCode() {
  const stakeEl = $("stakeInput");
  if (stakeEl) state.stake = Number(digitsOnly(stakeEl.value, 9) || 0);
  try {
    const data = await api("/api/bet/share", {
      method: "POST",
      body: JSON.stringify({ userId: state.user?.id || "", selections: state.slip, stake: state.stake })
    });
    state.lastBetCode = data.code;
    await copyText(data.code);
    state.notice = "Bet code copied: " + data.code;
    render();
  } catch (err) {
    state.notice = err.message;
    render();
  }
}

function applyLoadedSlip(data) {
  state.slip = (data.selections || []).map((s) => ({
    id: s.id,
    pick: s.pick,
    label: s.label || s.pick,
    market: s.market || "",
    odd: Number(s.odd),
    home: s.home,
    away: s.away
  }));
  if (data.stake) state.stake = Number(data.stake);
  state.lastBetCode = data.code || state.loadCode;
}

async function loadBetCode(placeToo) {
  const el = $("loadCode");
  const code = String(el?.value || state.loadCode || "").trim();
  state.loadCode = code;
  if (!code) {
    state.notice = "Enter a bet code";
    render();
    return;
  }
  if (placeToo && needLogin("load a bet code")) return;
  if (placeToo && !state.user.deposited) {
    state.notice = "Deposit first to load a bet code";
    go("deposit");
    return;
  }
  try {
    if (placeToo) {
      const data = await api("/api/bet/place-code", {
        method: "POST",
        body: JSON.stringify({ userId: state.user.id, code, stake: state.stake })
      });
      state.slip = [];
      state.lastBetCode = data.code || "";
      state.notice = data.bet?.status === "Won"
        ? "Bet won · " + tzs(data.bet.payout || 0) + " added"
        : data.bet?.status === "Lost"
          ? "Bet placed and already lost"
          : "Bet placed · code " + state.lastBetCode;
      await loadBets();
      go("bets");
      return;
    }
    const data = await api("/api/bet/load", { method: "POST", body: JSON.stringify({ userId: state.user?.id || "", code }) });
    applyLoadedSlip(data);
    state.notice = "Bet code loaded. Place it when you are ready.";
    if (state.view === "bets") go("sports");
    else render();
  } catch (err) {
    if (/insufficient|not enough/i.test(err.message)) {
      showNeedDeposit("Insufficient balance. Please deposit");
      return;
    }
    state.notice = err.message;
    render();
  }
}

async function checkResults(silent) {
  const typing = document.activeElement && ["INPUT", "TEXTAREA"].includes(document.activeElement.tagName);
  try {
    if (state.user) {
      const data = await api("/api/bets/check", {
        method: "POST",
        body: JSON.stringify({ userId: state.user.id })
      });
      if (data.matches) state.catalog.matches = data.matches;
      if (data.results) state.catalog.results = data.results;
      if (data.sports) state.catalog.sports = data.sports;
      if (data.title) state.catalog.title = data.title;
      if (data.days) state.catalog.days = data.days;
      if (data.today) state.catalog.today = data.today;
      state.bets = data.data || [];
      if (data.user) saveUser(data.user);
    } else {
      await loadCatalog(2);
    }
    if (!silent) {
      state.notice = "Results updated. Won tickets add cash; lost tickets keep the stake deducted.";
      if (state.view === "live") state.liveBoard = "results";
    }
    if (!silent || !typing) render();
    else renderAuthLinks();
  } catch (err) {
    if (!silent) {
      state.notice = err.message;
      render();
    }
  }
}

const HARAKA_PAY = "https://harakapay.net/pay/HPMV6N3PW8";

function tzPhone(raw) {
  const p = digitsOnly(raw, 12);
  if (p.startsWith("255") && p.length >= 12) return p.slice(0, 12);
  if (p.startsWith("0") && p.length === 10) return "255" + p.slice(1);
  if (p.length === 9) return "255" + p;
  return p;
}

async function submitPay() {
  if (needLogin(state.payTab === "withdraw" ? "withdraw" : "deposit")) return;
  const amount = Number(digitsOnly($("payAmount")?.value, 9) || 0);
  const phone = digitsOnly($("payPhone")?.value, 12);
  const url = state.payTab === "withdraw" ? "/api/withdraw" : "/api/deposit";
  if (state.payTab === "deposit") {
    const full = tzPhone(phone);
    if (!/^255[67]\d{8}$/.test(full)) {
      state.payWait = { phase: "failed", phone, amount, line: "Enter a valid Tanzania mobile number" };
      render();
      return;
    }
    if (amount < state.minDeposit) {
      state.payWait = {
        phase: "failed",
        phone,
        amount,
        line: "Minimum deposit is " + tzs(state.minDeposit)
      };
      render();
      return;
    }
    window.location.href = HARAKA_PAY;
    return;
  }
  try {
    const data = await api(url, {
      method: "POST",
      body: JSON.stringify({
        userId: state.user.id,
        amount,
        phone,
        network: state.network
      })
    });
    if (state.payTab === "deposit" && data.checkout) {
      state.payWait = {
        id: data.payment?.id,
        phase: "sending",
        phone,
        amount,
        line: "Sending the FimiPay PIN to your phone…"
      };
      render();
      await refreshMe();
      if (data.payment?.id) pollPay(data.payment.id);
      return;
    }
    if (state.payTab === "deposit") {
      state.payWait = {
        phase: "failed",
        phone,
        amount,
        line: data.message || "Could not send the FimiPay PIN."
      };
      render();
      return;
    }
    state.notice = data.message || "PIN prompt sent";
    await refreshMe();
    renderAuthLinks();
    if (data.pending && data.payment?.id) pollPay(data.payment.id);
    else if (data.payment?.status === "PAID" && data.payment?.verified && data.payment?.credited) go("account");
  } catch (ex) {
    const line = /load failed|failed to fetch/i.test(ex.message)
      ? "Could not reach FimiPay. Close this page and retry on mobile data."
      : ex.message;
    if (state.payTab === "deposit") {
      state.payWait = { phase: "failed", phone, amount, line };
      render();
    }
  }
}

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
    xhr.onerror = () => reject(new Error("Load failed"));
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
      const paused = pushed.http === 429 || /network_push_paused|too many payment requests/i.test(msg);
      if (paused || pushed.http === 500 || pushed.http === 0) {
        lastErr = new Error(paused ? "FimiPay is busy on this network. Wait a few seconds and try again." : (msg || "Could not send FimiPay push"));
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
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
      if (!/busy on this network|Could not reach|timed out|Load failed/i.test(String(err && err.message))) break;
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  throw lastErr;
}

async function readFimiOrder(orderId) {
  const res = await fetch(
    "https://fimipay.com/api/payments/checkout/order-status?order_id=" + encodeURIComponent(orderId),
    { headers: { Accept: "application/json" } }
  );
  return res.json();
}

async function syncDeposit(payment) {
  if (!payment?.id || !state.user?.id) return null;
  let result = null;
  if (payment.orderId) {
    try { result = await readFimiOrder(payment.orderId); } catch (_) {}
  }
  return api("/api/deposit/proof", {
    method: "POST",
    body: JSON.stringify({
      userId: state.user.id,
      paymentId: payment.id,
      result
    })
  });
}

async function syncOpenDeposits() {
  if (!state.user?.id) return;
  try {
    const open = await api("/api/pay/pending?userId=" + encodeURIComponent(state.user.id));
    let credited = false;
    for (const payment of open.payments || []) {
      const synced = await syncDeposit(payment);
      if (synced?.payment?.status === "PAID" && synced.payment.credited) credited = true;
    }
    renderAuthLinks();
    if (credited) {
      state.notice = "Deposit received";
      if (state.view === "deposit" || state.view === "account") render();
    }
  } catch (_) {}
}

async function pollPay(id) {
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    try {
      const open = await api("/api/pay/pending?userId=" + encodeURIComponent(state.user.id));
      const payment = (open.payments || []).find((p) => p.id === id);
      const data = payment
        ? await syncDeposit(payment)
        : await api("/api/pay/status?id=" + encodeURIComponent(id));
      if (data.user) saveUser(data.user);
      renderAuthLinks();
      const orderId = payment?.orderId || data.payment?.orderId;
      if (data.payment?.status === "PAID" && data.payment?.credited) {
        state.notice = "Deposit received";
        state.payWait = null;
        go("account");
        return;
      }
      if (data.payment?.status === "FAILED") {
        state.payWait = {
          ...(state.payWait || {}),
          phase: "failed",
          line: data.payment.message || "Payment failed"
        };
        if (state.view === "deposit") render();
        return;
      }
      if (orderId && state.payWait?.phase !== "sent") {
        state.payWait = {
          ...(state.payWait || {}),
          id,
          phase: "sent",
          line: "PIN sent. Approve it on your phone."
        };
        if (state.view === "deposit") render();
      }
    } catch (_) {}
  }
  if (state.payWait && state.payWait.phase === "sending") {
    state.payWait.line = "Still sending. Approve the prompt if it is already on your phone.";
    if (state.view === "deposit") render();
  }
}

function bindGames() {
  const stakeEl = $("gameStake");
  if (stakeEl) stakeEl.oninput = () => { state.stake = Number(digitsOnly(stakeEl.value, 9) || 0); };
  let dicePick = "over";
  let colorPick = "red";
  document.querySelectorAll("[data-dice]").forEach((b) => {
    b.onclick = () => {
      dicePick = b.dataset.dice;
      document.querySelectorAll("[data-dice]").forEach((x) => x.classList.toggle("on", x === b));
    };
  });
  document.querySelectorAll("[data-color]").forEach((b) => {
    b.onclick = () => {
      colorPick = b.dataset.color;
      document.querySelectorAll("[data-color]").forEach((x) => x.classList.toggle("on", x === b));
    };
  });
  const play = $("playGame");
  if (play) play.onclick = async () => {
    if (needLogin("play")) return;
    try {
      const data = await api("/api/game/play", {
        method: "POST",
        body: JSON.stringify({ userId: state.user.id, kind: play.dataset.kind, stake: state.stake, pick: play.dataset.kind === "dice" ? dicePick : colorPick })
      });
      const out = $("gameResult");
      if (out) out.textContent = data.detail || data.status;
      const msg = $("gameMsg");
      if (msg) msg.textContent = data.win ? "Won " + tzs(data.win) : "Lost";
      if ($("reels") && data.detail) $("reels").textContent = data.detail;
      renderAuthLinks();
    } catch (err) {
      const msg = $("gameMsg");
      if (msg) msg.textContent = err.message;
    }
  };

  const avGo1 = $("avGo1");
  const avGo2 = $("avGo2");
  if (avGo1) avGo1.onclick = () => aviatorAct(1);
  if (avGo2) avGo2.onclick = () => aviatorAct(2);

  const mineCash = $("minesCash");
  if (mineCash) mineCash.onclick = async () => {
    if (needLogin("play mines")) return;
    if (state.mines.safe < 1) { $("gameMsg").textContent = "Open at least one tile"; return; }
    try {
      const data = await api("/api/game/play", {
        method: "POST",
        body: JSON.stringify({ userId: state.user.id, kind: "mines", stake: state.stake, safe: state.mines.safe })
      });
      $("gameMsg").textContent = data.detail + " · " + (data.win ? "Won " + tzs(data.win) : "Lost");
      state.mines = { safe: 0, done: true };
      renderAuthLinks();
    } catch (err) { $("gameMsg").textContent = err.message; }
  };
  document.querySelectorAll("[data-mine]").forEach((b) => {
    b.onclick = () => {
      if (state.mines.done) return;
      b.classList.add("safe");
      state.mines.safe += 1;
    };
  });
}

function histColor(n) {
  if (n < 2) return "low";
  if (n < 10) return "mid";
  return "high";
}

function paintAviator(data) {
  if (!data || data.ok === false) return;
  state.aviator.last = data;
  const chip = $("liveAviatorChip");
  if (chip) chip.textContent = data.phase === "wait" ? "WAIT" : data.multiplier.toFixed(2) + "x";
  const sky = $("avSky");
  if (!sky) return;
  sky.classList.toggle("is-wait", data.phase === "wait");
  sky.classList.toggle("is-fly", data.phase === "fly");
  sky.classList.toggle("is-crash", data.phase === "crash");
  const multEl = $("aviatorMult");
  const msg = $("aviatorMsg");
  if (multEl) {
    multEl.textContent = (data.phase === "crash" ? data.crash : data.multiplier).toFixed(2) + "x";
    multEl.classList.toggle("crash", data.phase === "crash");
  }
  if (msg) {
    if (data.phase === "wait") msg.textContent = "Betting · starts in " + (data.waitLeft / 1000).toFixed(1) + "s";
    else if (data.phase === "fly") msg.textContent = data.bets + " bets in the air";
    else msg.textContent = "Flew away at " + Number(data.crash).toFixed(2) + "x";
  }
  const pct = Math.min(0.88, Math.log(Math.max(1, data.multiplier)) / Math.log(18));
  const plane = $("avPlane");
  if (plane) {
    plane.style.left = (6 + pct * 80) + "%";
    plane.style.bottom = (10 + pct * 64) + "%";
    plane.style.opacity = data.phase === "crash" ? "0" : "1";
  }
  const path = $("avPath");
  if (path) {
    const x = 8 + pct * 84;
    const y = 56 - pct * 48;
    path.setAttribute("d", `M0 58 Q ${x * 0.45} 58 ${x} ${y}`);
    path.setAttribute("stroke", data.phase === "crash" ? "#ef4444" : "#d7a441");
  }
  const hist = $("avHist");
  if (hist) hist.innerHTML = (data.history || []).map((n) => `<span class="${histColor(n)}">${Number(n).toFixed(2)}x</span>`).join("");
  const list = $("avPlayers");
  if (list) {
    list.innerHTML = (data.players || []).map((p) =>
      `<div class="av-row ${p.mine ? "mine" : ""}"><span>${p.name}</span><span>${tzs(p.stake)}</span><b>${p.cashed ? p.at.toFixed(2) + "x" : "—"}</b></div>`
    ).join("") || `<p class="hint">Waiting for bets</p>`;
  }
  [1, 2].forEach((slot) => {
    const btn = $("avGo" + slot);
    const note = $("avSlotMsg" + slot);
    if (!btn) return;
    const mine = (data.mine || []).find((x) => x.slot === slot);
    btn.classList.remove("cash", "wait");
    if (data.phase === "wait" && !mine) {
      btn.textContent = "Bet";
      btn.disabled = false;
    } else if (mine && data.phase === "wait") {
      btn.textContent = "Waiting";
      btn.classList.add("wait");
      btn.disabled = true;
    } else if (mine && data.phase === "fly" && !mine.cashed) {
      btn.textContent = "Cash out " + data.multiplier.toFixed(2) + "x";
      btn.classList.add("cash");
      btn.disabled = false;
    } else if (mine && mine.cashed) {
      btn.textContent = "Cashed " + Number(mine.at).toFixed(2) + "x";
      btn.disabled = true;
    } else {
      btn.textContent = data.phase === "fly" ? "Next round" : "Bet";
      btn.disabled = data.phase !== "wait";
    }
    if (note) note.textContent = mine && mine.cashed ? "Won " + tzs(Math.round(mine.stake * mine.at)) : "";
  });
}

function startAviatorPoll() {
  stopAviatorPoll();
  const tick = async () => {
    try {
      const q = state.user?.id ? "?userId=" + encodeURIComponent(state.user.id) : "";
      const res = await fetch("/api/game/aviator/state" + q);
      const data = await res.json();
      paintAviator(data);
    } catch (_) {}
  };
  tick();
  state.aviator.poll = setInterval(tick, 120);
}

async function aviatorAct(slot) {
  if (needLogin("play Aviator")) return;
  const stakeEl = $("avStake" + slot);
  const autoEl = $("avAuto" + slot);
  const stake = Number(digitsOnly(stakeEl?.value, 9) || 0);
  const auto = Number(autoEl?.value || 0);
  state.aviator["stake" + slot] = stake;
  state.aviator["auto" + slot] = autoEl?.value || "";
  try {
    const q = "?userId=" + encodeURIComponent(state.user.id);
    const now = await fetch("/api/game/aviator/state" + q).then((r) => r.json());
    state.aviator.last = now;
    const mine = (now.mine || []).find((x) => x.slot === slot);
    let data;
    if (now.phase === "fly" && mine && !mine.cashed) {
      data = await api("/api/game/aviator/cashout", {
        method: "POST",
        body: JSON.stringify({ userId: state.user.id, slot })
      });
    } else {
      data = await api("/api/game/aviator/bet", {
        method: "POST",
        body: JSON.stringify({ userId: state.user.id, stake, slot, auto })
      });
    }
    if (data.phase) paintAviator(data);
    renderAuthLinks();
  } catch (err) {
    const note = $("avSlotMsg" + slot);
    if (note) note.textContent = err.message;
  }
}

async function loadBets() {
  if (!state.user) { state.bets = []; return; }
  const data = await api("/api/bets?userId=" + encodeURIComponent(state.user.id));
  state.bets = data.data || [];
  if (data.user) saveUser(data.user);
}

$("menuBtn").onclick = () => { $("sidebar").classList.add("open"); $("scrim").hidden = false; };
const searchBtn = $("searchBtn");
if (searchBtn) searchBtn.onclick = () => {
  state.showSearch = true;
  if (state.view !== "home" && state.view !== "sports") go("home");
  else render();
  setTimeout(() => { const box = $("searchBox"); if (box) box.focus(); }, 0);
};
const navSlip = $("navSlip");
if (navSlip) navSlip.onclick = () => {
  if (!state.slip.length) return;
  state.slipOpen = !state.slipOpen;
  paintSlip();
  setNav();
};
$("scrim").onclick = () => { $("sidebar").classList.remove("open"); $("scrim").hidden = true; };
if ($("themeBtn")) $("themeBtn").onclick = () => {
  const next = document.documentElement.getAttribute("data-theme") === "light" ? "" : "light";
  document.documentElement.setAttribute("data-theme", next);
};

function setupInstallBar() {
  const bar = $("installBar");
  const close = $("installBarClose");
  if (!bar) return;
  const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  const dismissed = localStorage.getItem("paribet_hide_install") === "1";
  bar.hidden = Boolean(standalone || dismissed);
  if (close) {
    close.onclick = () => {
      localStorage.setItem("paribet_hide_install", "1");
      bar.hidden = true;
    };
  }
}

window.addEventListener("hashchange", route);

(async function boot() {
  loadUser();
  setupInstallBar();
  const path = location.pathname.replace(/\/$/, "");
  if (!location.hash) {
    if (path.endsWith("/register") || path.endsWith("/join")) location.hash = "#/register";
    else if (path.endsWith("/login")) location.hash = "#/login";
    else if (path.endsWith("/deposit")) location.hash = "#/deposit";
    else if (path.endsWith("/account")) location.hash = "#/account";
    else if (path.endsWith("/download")) location.hash = "#/home";
    else location.hash = "#/home";
  }
  readBooking();
  route();
  try {
    await loadCatalog(3);
    render();
  } catch (_) {
    render();
  }
  try {
    const pay = await api("/api/pay/networks");
    state.networks = pay.networks || [];
    state.minDeposit = pay.minDeposit || 60000;
    state.minWithdraw = pay.minWithdraw || 10000;
  } catch (_) {}
  if (state.user) {
    await refreshMe();
    await loadBets();
    render();
  }
  if (state.loadCode) {
    try { await loadBetCode(false); } catch (_) {}
  }
})();
