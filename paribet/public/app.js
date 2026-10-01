const state = {
  view: "home",
  authTab: "join",
  loginMethod: "phone",
  user: null,
  catalog: { matches: [], sports: [], promos: [], games: [] },
  sportFilter: "all",
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
  minDeposit: 60000,
  minWithdraw: 10000,
  loadCode: "",
  lastBetCode: ""
};

function $(id) { return document.getElementById(id); }
function digitsOnly(v, max) { return String(v || "").replace(/\D/g, "").slice(0, max || 20); }
function tzs(n) { return "TZS " + Number(n || 0).toLocaleString("en-TZ"); }
function wallet(u) { return Number(u?.balance || 0) + Number(u?.bonusBalance || 0); }

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
  const res = await fetch(url, {
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
  const favs = (state.user?.favorites || []).map((id) => state.catalog.matches.find((m) => m.id === id)).filter(Boolean);
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

function matchesFor(view) {
  let rows = state.catalog.matches || [];
  if (view === "live") {
    rows = rows.filter((m) => m.period !== "ft");
    if (state.liveSport !== "all") rows = rows.filter((m) => m.sport === state.liveSport);
    if (state.livePeriod !== "all") rows = rows.filter((m) => m.period === state.livePeriod);
  }
  if (view === "esports") rows = rows.filter((m) => m.sport === "esports");
  if (view === "sports" && state.sportFilter !== "all") rows = rows.filter((m) => m.sport === state.sportFilter);
  if (state.search) {
    const q = state.search.toLowerCase();
    rows = rows.filter((m) => (m.home + m.away + m.league).toLowerCase().includes(q));
  }
  return rows;
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
  const on = state.slip.some((x) => x.id === m.id && x.pick === key);
  return `<button type="button" class="${on ? "on" : ""}" data-add="${m.id}|${key}|${odd}"><span>${label}</span>${odd.toFixed(2)}</button>`;
}

function matchCard(m) {
  const fav = (state.user?.favorites || []).includes(m.id);
  const score = state.liveScores || !m.live ? m.score : "";
  return `
    <article class="match">
      <div class="meta">
        <span>${m.live ? '<span class="live-dot">LIVE</span> ' : ""}${m.league}${score ? " · " + score : ""}</span>
        <span>${m.time} <button type="button" class="ghost" data-fav="${m.id}">${fav ? "★" : "☆"}</button></span>
      </div>
      <a class="teams" href="#/match/${m.id}">${m.home} vs ${m.away}</a>
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
  const m = (state.catalog.matches || []).find((x) => x.id === state.matchId);
  if (!m) return `<p class="empty">Event not found.</p>`;
  const st = m.stats || { possession: [0, 0], shots: [0, 0], corners: [0, 0] };
  return `
    ${state.notice ? `<p class="notice">${state.notice}</p>` : ""}
    <section class="card account-box">
      <a href="#/live">← Live</a>
      <div class="meta">${m.live ? '<span class="live-dot">LIVE</span> ' : ""}${m.league} · ${m.time}</div>
      <h2>${m.home} ${m.score || "vs"} ${m.away}</h2>
      ${m.live ? `<div class="live-stats">
        <div><span>Possession</span><b>${st.possession[0]}% – ${st.possession[1]}%</b></div>
        <div><span>Shots</span><b>${st.shots[0]} – ${st.shots[1]}</b></div>
        <div><span>Corners</span><b>${st.corners[0]} – ${st.corners[1]}</b></div>
      </div>` : ""}
    </section>
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
  return `
    <section class="card account-box code-box">
      <label class="field" for="loadCode">Load bet code</label>
      <div class="stake-row wrap-row">
        <input class="input" id="loadCode" placeholder="Paste code" value="${state.loadCode}" maxlength="12">
        <button class="wide" type="button" id="loadCodeBtn" style="width:auto">Load</button>
        <button class="wide gold" type="button" id="loadPlaceBtn" style="width:auto">Load & place</button>
      </div>
      ${state.lastBetCode ? `<p class="hint">Last code <b>${state.lastBetCode}</b> <button type="button" class="ghost" data-copy="${state.lastBetCode}">Copy</button></p>` : ""}
    </section>`;
}

function slipHtml() {
  if (!state.slip.length) return loadBetBox();
  const total = state.slip.reduce((n, x) => n * x.odd, 1);
  const ret = Math.round(state.stake * total);
  return `
    <div class="slip">
      <div>${state.slip.length} pick${state.slip.length > 1 ? "s" : ""} · odds ${total.toFixed(2)}</div>
      ${state.slip.map((s) => `<div class="hint">${s.home} vs ${s.away} · ${s.market ? s.market + " / " : ""}${s.label || s.pick} @ ${s.odd}</div>`).join("")}
      <div class="stake-row">
        <input class="input" id="stakeInput" inputmode="numeric" value="${state.stake}">
        <span>Returns ${tzs(ret)}</span>
      </div>
      <button class="wide gold" type="button" id="placeBet">Place bet</button>
      <button class="wide" type="button" id="shareCodeBtn">Copy bet code</button>
    </div>
    ${loadBetBox()}`;
}

function listHtml(title, view) {
  const rows = matchesFor(view);
  const liveSports = ["all", ...(state.catalog.sports || []).map((s) => s.id)];
  return `
    ${state.notice ? `<p class="notice">${state.notice}</p>` : ""}
    <div class="filters">
      <input class="input" id="searchBox" placeholder="Search team or league" value="${state.search}">
      ${view === "sports" ? ["all", ...state.catalog.sports.map((s) => s.id)].map((f) =>
        `<button type="button" data-filter="${f}" class="${state.sportFilter === f ? "on" : ""}">${f}</button>`
      ).join("") : ""}
      ${view === "live" ? `
        ${liveSports.map((f) => `<button type="button" data-live-sport="${f}" class="${state.liveSport === f ? "on" : ""}">${f}</button>`).join("")}
        <button type="button" data-live-period="all" class="${state.livePeriod === "all" ? "on" : ""}">All periods</button>
        <button type="button" data-live-period="1h" class="${state.livePeriod === "1h" ? "on" : ""}">1st period</button>
        <button type="button" data-live-period="2h" class="${state.livePeriod === "2h" ? "on" : ""}">2nd period</button>
        <button type="button" id="scoreToggle" class="${state.liveScores ? "on" : ""}">${state.liveScores ? "Scores on" : "Scores off"}</button>
      ` : ""}
    </div>
    ${view === "live" ? `<a class="av-bar" href="#/aviator"><span class="live-dot">LIVE</span> Aviator <b id="liveAviatorChip">1.00x</b><span>Open table</span></a>` : ""}
    <p class="hint" style="margin:0 14px 8px">${title} · ${rows.length} events</p>
    ${rows.map(matchCard).join("") || `<p class="empty">No events right now.</p>`}
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
      <p class="error" id="payError"></p>
      <p class="notice" id="payMsg"></p>
      <button class="wide gold" type="button" id="payBtn">${tab === "withdraw" ? "Withdraw" : "Send FimiPay push"}</button>
    </section>`;
}

function betsHtml() {
  const rows = (state.bets || []).map((b) => `
    <article class="match">
      <div class="meta"><span>${b.kind}</span><span>${b.status}</span></div>
      <div>${b.detail || ""}</div>
      <div class="hint">Stake ${tzs(b.stake)} · return ${tzs(b.payout || 0)}</div>
      ${b.code ? `<div class="code-line"><span>Bet code <b>${b.code}</b></span><button type="button" class="ghost" data-copy="${b.code}">Copy</button></div>` : ""}
    </article>`).join("");
  return loadBetBox() + (rows || `<p class="empty">No bets yet. Load a shared code above.</p>`);
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
  else if (state.view === "live") view.innerHTML = listHtml("Today 1 Oct", "live");
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
  else view.innerHTML = listHtml("Upcoming & live", "sports");
  bindView();
  if (state.view === "aviator" || state.view === "live") startAviatorPoll();
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
  document.querySelectorAll("[data-sport]").forEach((a) => {
    a.onclick = (e) => { e.preventDefault(); state.sportFilter = a.dataset.sport; go("sports"); };
  });
  document.querySelectorAll("[data-add]").forEach((b) => {
    b.onclick = () => {
      const [id, pick, odd] = b.dataset.add.split("|");
      const match = state.catalog.matches.find((m) => m.id === id);
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
  if (stake) stake.oninput = () => { state.stake = Number(digitsOnly(stake.value, 9) || 0); };
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
    state.notice = "Bet placed · code " + state.lastBetCode;
    await loadBets();
    go("bets");
  } catch (err) {
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
  try {
    if (placeToo) {
      if (needLogin("place this bet code")) return;
      const data = await api("/api/bet/place-code", {
        method: "POST",
        body: JSON.stringify({ userId: state.user.id, code, stake: state.stake })
      });
      state.slip = [];
      state.lastBetCode = data.code || "";
      state.notice = "Bet placed · code " + state.lastBetCode;
      await loadBets();
      go("bets");
      return;
    }
    const data = await api("/api/bet/load", { method: "POST", body: JSON.stringify({ code }) });
    applyLoadedSlip(data);
    state.notice = "Bet code loaded. Place it when you are ready.";
    if (state.view === "bets") go("sports");
    else render();
  } catch (err) {
    state.notice = err.message;
    render();
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
      if (msg) msg.textContent = "Sending PIN prompt to your phone…";
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
      if (msg) msg.textContent = attached.message || "Check your phone for the PIN prompt.";
      state.notice = attached.message || "PIN prompt sent";
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
    if (err) err.textContent = /vpn|proxy/i.test(ex.message)
      ? "FimiPay blocked a server IP. Retry on this phone using mobile data."
      : ex.message;
  } finally {
    if ($("payBtn")) $("payBtn").disabled = false;
  }
}

async function sendFimiPay(checkout) {
  const res = await fetch(checkout.url, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(checkout.body)
  });
  const result = await res.json().catch(() => ({}));
  const orderId = String(result.order_id || result.orderId || "").trim();
  if (!res.ok || result.ok === false || /vpn|proxy/i.test(String(result.message || result.error || ""))) {
    throw new Error(result.message || result.error || "Could not send FimiPay push");
  }
  if (!orderId) throw new Error(result.message || "Could not send FimiPay push");
  return { http: res.status, orderId, result };
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
    state.minDeposit = pay.minDeposit || 60000;
    state.minWithdraw = pay.minWithdraw || 10000;
  } catch (_) {}
  if (state.user) {
    await refreshMe();
    await loadBets();
    render();
  }
})();
