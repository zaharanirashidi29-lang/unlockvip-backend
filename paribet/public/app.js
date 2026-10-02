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
  minDeposit: 10000,
  minWithdraw: 10000,
  loadCode: "",
  lastBetCode: "",
  liveBoard: "now",
  betTab: "live",
  livePoll: null
};

function $(id) { return document.getElementById(id); }
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

function route() {
  stopAviatorPoll();
  const raw = (location.hash || "#/home").replace("#/", "");
  const parts = raw.split("/").filter(Boolean);
  const page = parts[0] || "home";
  if (page === "match" && parts[1]) {
    state.view = "match";
    state.matchId = parts[1];
    render();
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
  if (state.view === "register") state.authTab = "join";
  if (state.view === "login") state.authTab = "login";
  render();
  if (state.user) refreshMe();
}

async function refreshMe() {
  if (!state.user?.id) return;
  try {
    const data = await api("/api/me?userId=" + encodeURIComponent(state.user.id));
    saveUser(data.user);
    const chip = document.querySelector(".wallet-chip");
    if (chip) chip.textContent = tzs(wallet(state.user));
  } catch (_) {}
}

function renderAuthLinks() {
  const box = $("authLinks");
  if (state.user) {
    box.innerHTML = `
      <span class="wallet-chip">${tzs(wallet(state.user))}</span>
      <a href="#/deposit">Deposit</a>
      <a href="#/withdraw">Withdraw</a>
      <a class="join" href="#/account">${state.user.username}</a>
    `;
    return;
  }
  box.innerHTML = `<a href="#/login">Log in</a><a class="join" href="#/register">Join</a>`;
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
  document.querySelectorAll(".bottom a, .side-grid a, .topnav a").forEach((a) => {
    const on = a.dataset.route === state.view || (state.view === "match" && a.dataset.route === "live");
    a.classList.toggle("on", on);
  });
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
  return (state.catalog.matches || []).find((m) => m.id === id)
    || (state.catalog.results || []).find((m) => m.id === id)
    || null;
}

function matchesFor(view) {
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
  if (!odd) return `<button type="button" disabled><span>${label}</span>—</button>`;
  if (m.period === "ft") return `<button type="button" disabled><span>${label}</span>${odd.toFixed(2)}</button>`;
  const on = state.slip.some((x) => x.id === m.id && x.pick === key);
  return `<button type="button" class="${on ? "on" : ""}" data-add="${m.id}|${key}|${odd}"><span>${label}</span>${odd.toFixed(2)}</button>`;
}

function matchCard(m) {
  const fav = (state.user?.favorites || []).includes(m.id);
  const score = m.score || "";
  const tickets = matchTickets(m.id);
  const clock = m.clock || m.time;
  return `
    <article class="match">
      <div class="meta">
        <span>${m.live ? '<span class="live-dot">LIVE</span> ' : m.period === "ft" ? "FT · " : ""}${m.league}${score ? " · " + score : ""}</span>
        <span>${clock} <button type="button" class="ghost" data-fav="${m.id}">${fav ? "★" : "☆"}</button></span>
      </div>
      <a class="teams" href="#/match/${m.id}">${m.home} ${score ? score : "vs"} ${m.away}</a>
      ${tickets.length ? `<div class="your-ticket">Your placed bet · ${tickets[0].status}${tickets[0].legs ? " · " + (tickets[0].legs.find((l) => l.id === m.id)?.result || "").toUpperCase() : ""}</div>` : ""}
      <div class="odds">
        ${oddBtn(m, "1", "1")}
        ${oddBtn(m, "x", "X")}
        ${oddBtn(m, "2", "2")}
      </div>
      <div class="markets">
        ${oddBtn(m, "over", "Over")}
        ${oddBtn(m, "under", "Under")}
        ${oddBtn(m, "ah1", "AH1")}
        ${oddBtn(m, "ah2", "AH2")}
        <a class="more-m" href="#/match/${m.id}">+${m.extra || 0}</a>
      </div>
    </article>
  `;
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
    ${(m.markets || []).map((g) => `
      <article class="match">
        <div class="teams">${g.name}</div>
        <div class="markets wrap">
          ${g.sels.map((s) => oddBtn(m, s.key, s.label)).join("")}
        </div>
      </article>
    `).join("")}
    ${slipHtml()}
  `;
}

function loadBetBox() {
  const can = Boolean(state.user?.deposited);
  return `
    <section class="card account-box code-box load-top">
      <div class="load-head">
        <strong>Load bet code</strong>
        <span>Paste a shared code here</span>
      </div>
      <div class="stake-row wrap-row">
        <input class="input" id="loadCode" placeholder="e.g. AB12CD34" value="${state.loadCode}" maxlength="12">
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

function slipHtml() {
  if (!state.slip.length) return "";
  const t = slipTotals();
  return `
    <div class="slip">
      <div>${state.slip.length} pick${state.slip.length > 1 ? "s" : ""} · total odds <b id="slipOdds">${t.odds.toFixed(2)}</b></div>
      ${state.slip.map((s) => `<div class="hint">${s.home} vs ${s.away} · ${s.market ? s.market + " / " : ""}${s.label || s.pick} @ ${Number(s.odd).toFixed(2)}</div>`).join("")}
      <div class="stake-row">
        <input class="input" id="stakeInput" inputmode="numeric" value="${state.stake}">
        <span>Your stake</span>
      </div>
      <div class="win-box">
        <div><span>Approx. return</span><b id="slipReturns">${tzs(t.returns)}</b></div>
        <div><span>Approx. win</span><b id="slipProfit">${tzs(t.profit)}</b></div>
      </div>
      <p class="hint">Stake is taken when you place. If it wins, that return is added to your cash. If it loses, the stake stays deducted.</p>
      <button class="wide gold" type="button" id="placeBet">Place bet</button>
      <button class="wide" type="button" id="shareCodeBtn">Copy bet code</button>
    </div>`;
}

function listHtml(title, view) {
  const rows = matchesFor(view);
  const liveSports = ["all", ...(state.catalog.sports || []).map((s) => s.id)];
  return `
    ${topToolsHtml()}
    ${state.notice ? `<p class="notice">${state.notice}</p>` : ""}
    <div class="filters">
      <input class="input" id="searchBox" placeholder="Search team or league" value="${state.search}">
      ${view === "sports" ? `
        <button type="button" data-day="all" class="${state.dayFilter === "all" ? "on" : ""}">All days</button>
        ${(state.catalog.days || []).map((d) =>
          `<button type="button" data-day="${d}" class="${state.dayFilter === d || (state.dayFilter === "today" && d === state.catalog.today) ? "on" : ""}">${dayLabel(d)}</button>`
        ).join("")}
        ${["all", ...state.catalog.sports.map((s) => s.id)].map((f) =>
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
    ${view === "live" ? `<a class="av-bar" href="#/aviator"><span class="live-dot">LIVE</span> Aviator <b id="liveAviatorChip">1.00x</b><span>Open table</span></a>` : ""}
    <p class="hint" style="margin:0 14px 8px">${title} · ${rows.length} events</p>
    ${rows.map(matchCard).join("") || `<p class="empty">${view === "live" && state.liveBoard === "now" ? "No live matches right now. Check upcoming or results." : "No events right now."}</p>`}
    ${slipHtml()}
  `;
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
    <section class="hero">
      <h1>${join ? "Create your <em>Paribet</em> account." : "Good to see you <em>again.</em>"}</h1>
      <p>${join ? "Tanzania number. Sports, live, games." : "Phone, email or username."}</p>
    </section>
    <form class="card" id="authForm">
      <div class="tabs">
        <button type="button" class="${!join ? "on" : ""}" data-auth="login">Login</button>
        <button type="button" class="${join ? "on" : ""}" data-auth="join">Join</button>
      </div>
      ${join ? joinFields() : loginFields()}
      <p class="error" id="authError"></p>
      <button class="wide" type="submit">${join ? "Create account" : "Login"}</button>
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

function accountHtml() {
  if (!state.user) return `<p class="empty">Log in to open your account.</p>`;
  return `
    <section class="card account-box">
      <h2>Account</h2>
      <div class="row-k"><span>Username</span><b>${state.user.username}</b></div>
      <div class="row-k"><span>Phone</span><b>${state.user.phone}</b></div>
      <div class="row-k"><span>Email</span><b>${state.user.email}</b></div>
      <div class="row-k"><span>Cash</span><b>${tzs(state.user.balance)}</b></div>
      <div class="row-k"><span>Bonus</span><b>${tzs(state.user.bonusBalance)}</b></div>
      <a class="wide gold" href="#/deposit">Deposit</a>
      <a class="wide" href="#/withdraw">Withdraw</a>
      <button class="wide" type="button" id="logoutBtn">Log out</button>
    </section>`;
}

function localPhone(p) {
  const n = digitsOnly(p, 12);
  if (n.startsWith("255") && n.length === 12) return n.slice(3);
  if (n.startsWith("0")) return n.slice(1);
  return n;
}

function payHtml(tab) {
  state.payTab = tab;
  const min = tab === "withdraw" ? state.minWithdraw : state.minDeposit;
  const phone = state.user ? localPhone(state.user.phone) : "";
  return `
    <section class="card account-box">
      <div class="tabs">
        <button type="button" class="${tab === "deposit" ? "on" : ""}" data-pay-tab="deposit">Deposit</button>
        <button type="button" class="${tab === "withdraw" ? "on" : ""}" data-pay-tab="withdraw">Withdraw</button>
      </div>
      <h2>${tab === "withdraw" ? "Withdraw" : "Deposit"}</h2>
      <p class="hint">FimiPay · M-Pesa, Mixx, Airtel Money, HaloPesa, TTCL. Min ${tzs(min)}. Cash is not added until you approve the PIN on your phone.</p>
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
      <button class="wide gold" type="button" id="payBtn">${tab === "withdraw" ? "Withdraw" : "Send FimiPay push"}</button>
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
    ${slipHtml()}
  `;
}

function render() {
  renderAuthLinks();
  renderSportsNav();
  setNav();
  $("sidebar").classList.remove("open");
  $("scrim").hidden = true;
  const view = $("view");
  if (state.view === "register" || state.view === "login") view.innerHTML = authHtml();
  else if (state.view === "match") view.innerHTML = matchDetailHtml();
  else if (state.view === "live") view.innerHTML = listHtml(state.catalog.title || "Live & upcoming", "live");
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
    const title = day && day !== "all" ? dayLabel(day) : (state.catalog.title || "Today & upcoming");
    view.innerHTML = listHtml(title, "sports");
  }
  bindView();
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
      render();
    };
  });
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
  if (logout) logout.onclick = () => { saveUser(null); go("login"); };
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
  const payPhone = $("payPhone");
  if (payPhone) payPhone.addEventListener("input", () => { payPhone.value = digitsOnly(payPhone.value, 12); });
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

async function placeBet() {
  if (needLogin("place a bet")) return;
  const stakeEl = $("stakeInput");
  if (stakeEl) state.stake = Number(digitsOnly(stakeEl.value, 9) || 0);
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
    if (/insufficient|not enough/i.test(err.message)) {
      showNeedDeposit("Insufficient balance. Please deposit");
      return;
    }
    state.notice = err.message;
    render();
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
  if (needLogin("load a bet code")) return;
  if (!state.user.deposited) {
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
    const data = await api("/api/bet/load", { method: "POST", body: JSON.stringify({ userId: state.user.id, code }) });
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
      const cat = await api("/api/catalog");
      state.catalog = cat;
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

async function submitPay() {
  if (needLogin(state.payTab === "withdraw" ? "withdraw" : "deposit")) return;
  const amount = Number(digitsOnly($("payAmount")?.value, 9) || 0);
  const phone = digitsOnly($("payPhone")?.value, 12);
  const err = $("payError");
  const msg = $("payMsg");
  if (err) err.textContent = "";
  if (msg) msg.textContent = "";
  const url = state.payTab === "withdraw" ? "/api/withdraw" : "/api/deposit";
  try {
    $("payBtn").disabled = true;
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
      if (msg) msg.textContent = "Sending FimiPay PIN to your phone…";
      const pushed = await sendFimiPay(data.checkout);
      const attached = await api("/api/deposit/push", {
        method: "POST",
        body: JSON.stringify({
          userId: state.user.id,
          paymentId: data.payment.id,
          http: pushed.http,
          orderId: pushed.orderId,
          result: pushed.result
        })
      });
      if (msg) msg.textContent = attached.message || "Check your phone for the FimiPay PIN.";
      state.notice = attached.message || "FimiPay PIN sent";
      await refreshMe();
      renderAuthLinks();
      if (attached.pending && attached.payment?.id) pollPay(attached.payment.id);
      return;
    }
    if (msg) msg.textContent = data.message || "Check your phone for the PIN prompt.";
    state.notice = data.message || "PIN prompt sent";
    await refreshMe();
    renderAuthLinks();
    if (data.pending && data.payment?.id) pollPay(data.payment.id);
    else if (data.payment?.status === "PAID" && data.payment?.verified && data.payment?.credited) go("account");
  } catch (ex) {
    if (err) err.textContent = /load failed|failed to fetch/i.test(ex.message)
      ? "Could not reach FimiPay. Close this page and retry on mobile data."
      : /vpn|proxy/i.test(ex.message)
        ? "FimiPay blocked this network. Retry on mobile data, with VPN off."
        : ex.message;
  } finally {
    if ($("payBtn")) $("payBtn").disabled = false;
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
  const attempts = [
    "text/plain;charset=UTF-8",
    "application/json"
  ];
  let lastErr = new Error("Could not send FimiPay push");
  for (const type of attempts) {
    try {
      const pushed = await fimiXhr(checkout.url, checkout.body, type);
      const orderId = String(pushed.result.order_id || pushed.result.orderId || "").trim();
      const msg = String(pushed.result.message || pushed.result.error || "");
      if (/vpn|proxy/i.test(msg)) throw new Error(msg);
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

async function pollPay(id) {
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    try {
      const data = await api("/api/pay/status?id=" + encodeURIComponent(id));
      if (data.user) saveUser(data.user);
      renderAuthLinks();
      const msg = $("payMsg");
      if (data.payment?.status === "PAID" && data.payment?.credited) {
        if (msg) msg.textContent = "Deposit received";
        state.notice = "Deposit received";
        go("account");
        return;
      }
      if (data.payment?.status === "FAILED") {
        if ($("payError")) $("payError").textContent = data.payment.message || "Payment failed";
        return;
      }
      if (msg) msg.textContent = "Waiting for PIN on your phone…";
    } catch (_) {}
  }
  const msg = $("payMsg");
  if (msg) msg.textContent = "Still waiting. Keep this page open and approve the prompt.";
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
$("scrim").onclick = () => { $("sidebar").classList.remove("open"); $("scrim").hidden = true; };
$("themeBtn").onclick = () => {
  const next = document.documentElement.getAttribute("data-theme") === "light" ? "" : "light";
  document.documentElement.setAttribute("data-theme", next);
};

window.addEventListener("hashchange", route);

(async function boot() {
  loadUser();
  const path = location.pathname.replace(/\/$/, "");
  if (!location.hash) {
    if (path.endsWith("/register") || path.endsWith("/join")) location.hash = "#/register";
    else if (path.endsWith("/login")) location.hash = "#/login";
    else if (path.endsWith("/deposit")) location.hash = "#/deposit";
    else if (path.endsWith("/account")) location.hash = "#/account";
    else location.hash = "#/home";
  }
  route();
  try {
    const cat = await api("/api/catalog");
    state.catalog = cat;
    render();
  } catch (_) {}
  try {
    const pay = await api("/api/pay/networks");
    state.networks = pay.networks || [];
    state.minDeposit = pay.minDeposit || 10000;
    state.minWithdraw = pay.minWithdraw || 10000;
  } catch (_) {}
  if (state.user) {
    await refreshMe();
    await loadBets();
    render();
  }
})();
