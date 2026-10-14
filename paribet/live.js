const { MATCHES } = require("./catalog");

function eatParts(date = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Dar_es_Salaam",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
  const out = {};
  for (const p of fmt.formatToParts(date)) {
    if (p.type !== "literal") out[p.type] = p.value;
  }
  return out;
}

function fixtureDayIso() {
  const p = eatParts();
  return `${p.year}-${p.month}-${p.day}`;
}

function eatMinutesNow() {
  const p = eatParts();
  const nowDay = Date.parse(`${p.year}-${p.month}-${p.day}T00:00:00+03:00`);
  const fixtureDay = Date.parse(`${fixtureDayIso()}T00:00:00+03:00`);
  const days = Math.round((nowDay - fixtureDay) / 86400000);
  return days * 1440 + Number(p.hour) * 60 + Number(p.minute);
}

function hash(id) {
  let h = 2166136261;
  for (const c of String(id)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

function kickoffMinutes(m) {
  if (/^FT$/i.test(String(m.time || "").trim()) || m.period === "ft" && m.score) return -10000;
  const mm = String(m.time || "").match(/(\d{1,2}):(\d{2})/);
  if (!mm) return 9000;
  let h = Number(mm[1]);
  const min = Number(mm[2]);
  let day = 0;
  if (/Tonight/i.test(m.time) && h < 12) day = 1;
  return day * 1440 + h * 60 + min;
}

function durationOf(sport) {
  if (sport === "basketball") return 90;
  if (sport === "hockey") return 75;
  if (sport === "tennis") return 110;
  return 110;
}

function parseListedScore(m) {
  if (m.sport === "tennis") {
    const sets = String(m.score || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((s) => s.split(/[-–]/).map((n) => Number(n) || 0));
    let home = 0;
    let away = 0;
    for (const pair of sets) {
      if ((pair[0] || 0) > (pair[1] || 0)) home += 1;
      else if ((pair[1] || 0) > (pair[0] || 0)) away += 1;
    }
    return {
      home,
      away,
      total: home + away,
      htHome: home,
      htAway: away,
      cornersHome: 0,
      cornersAway: 0,
      cardsHome: 0,
      cardsAway: 0,
      sets
    };
  }
  const bits = String(m.score || "0-0").split(/[-–]/).map((n) => Number(n) || 0);
  const home = bits[0] || 0;
  const away = bits[1] || 0;
  return {
    home,
    away,
    total: home + away,
    htHome: home,
    htAway: away,
    cornersHome: Number(m.stats?.corners?.[0] || 0),
    cornersAway: Number(m.stats?.corners?.[1] || 0),
    cardsHome: 0,
    cardsAway: 0,
    sets: []
  };
}

function planFor(m) {
  const seed = hash(m.id);
  if (m.script && (m.sport === "football" || !m.sport)) {
    const script = m.script;
    return {
      home: script.home,
      away: script.away,
      htHome: script.htHome || 0,
      htAway: script.htAway || 0,
      cornersHome: 5,
      cornersAway: 4,
      cardsHome: 1,
      cardsAway: 2,
      times: script.times || [],
      kind: "football"
    };
  }
  if (m.sport === "football") {
    const home = seed % 4;
    const away = (seed >>> 3) % 3;
    const htHome = Math.min(home, seed % 3);
    const htAway = Math.min(away, (seed >>> 5) % 2);
    const cornersHome = 3 + (seed % 7);
    const cornersAway = 2 + ((seed >>> 8) % 7);
    const cardsHome = 1 + (seed % 4);
    const cardsAway = (seed >>> 4) % 4;
    const times = [];
    let x = seed;
    for (let i = 0; i < home + away; i++) {
      x = (x * 1103515245 + 12345) >>> 0;
      times.push({ min: 1 + (x % 90), side: i < home ? "home" : "away" });
    }
    times.sort((a, b) => a.min - b.min);
    return { home, away, htHome, htAway, cornersHome, cornersAway, cardsHome, cardsAway, times, kind: "football" };
  }
  if (m.sport === "tennis") {
    const homeSets = seed % 2;
    const awaySets = 2;
    const sets = homeSets > awaySets
      ? [[7, 6], [3, 6], [6, 4]]
      : [[6, 7], [6, 3], [1, 6]];
    return { home: homeSets > awaySets ? 2 : 1, away: homeSets > awaySets ? 1 : 2, sets, kind: "tennis" };
  }
  const home = 70 + (seed % 40);
  const away = 68 + ((seed >>> 5) % 40);
  return { home, away, kind: m.sport || "points" };
}

function footballAt(plan, playMin, finished) {
  let home = 0;
  let away = 0;
  for (const g of plan.times) {
    if (g.min <= playMin) {
      if (g.side === "home") home += 1;
      else away += 1;
    }
  }
  if (finished) {
    home = plan.home;
    away = plan.away;
  }
  const htDone = playMin >= 45 || finished;
  const frac = Math.min(1, playMin / 90);
  return {
    home,
    away,
    total: home + away,
    htHome: htDone ? plan.htHome : Math.min(home, plan.htHome),
    htAway: htDone ? plan.htAway : Math.min(away, plan.htAway),
    cornersHome: Math.round(plan.cornersHome * frac),
    cornersAway: Math.round(plan.cornersAway * frac),
    cardsHome: Math.round(plan.cardsHome * frac),
    cardsAway: Math.round(plan.cardsAway * frac),
    sets: []
  };
}

function pointsAt(plan, frac, finished) {
  const f = finished ? 1 : Math.max(0, Math.min(1, frac));
  const home = Math.round(plan.home * f);
  const away = Math.round(plan.away * f);
  return {
    home,
    away,
    total: home + away,
    htHome: Math.round(home / 2),
    htAway: Math.round(away / 2),
    cornersHome: 0,
    cornersAway: 0,
    cardsHome: 0,
    cardsAway: 0,
    sets: plan.sets || []
  };
}

function formatScore(sport, result) {
  if (sport === "tennis" && result.sets && result.sets.length) {
    return result.sets.map((s) => s.join("-")).join(" ");
  }
  return `${result.home}-${result.away}`;
}

function footballClock(elapsed) {
  if (elapsed < 45) return { period: "1h", minute: elapsed, label: `${elapsed}'` };
  if (elapsed < 60) return { period: "ht", minute: 45, label: "HT" };
  if (elapsed < 105) return { period: "2h", minute: 45 + (elapsed - 60), label: `${45 + (elapsed - 60)}'` };
  return { period: "ft", minute: 90, label: "FT" };
}

function emptyResult() {
  return { home: 0, away: 0, total: 0, htHome: 0, htAway: 0, cornersHome: 0, cornersAway: 0, cardsHome: 0, cardsAway: 0, sets: [] };
}

function isOfficial(m) {
  return m?.source === "espn" || Boolean(m?.apiState) || /^\d{4}-\d{2}-\d{2}T/.test(String(m?.kickoff || ""));
}

function applyOfficial(m) {
  const row = {
    ...m,
    stats: {
      possession: [...(m.stats?.possession || [50, 50])],
      shots: [...(m.stats?.shots || [0, 0])],
      corners: [...(m.stats?.corners || [0, 0])]
    }
  };
  const state = String(row.apiState || "").toLowerCase();
  const finished = state === "post" || row.period === "ft" || /^FT$/i.test(String(row.time || ""));
  const liveNow = !finished && (state === "in" || row.live);
  if (finished) {
    row.live = false;
    row.period = "ft";
    row.time = "FT";
    row.clock = "FT";
    row.completedAt = row.completedAt || new Date().toISOString();
    row.result = row.score ? parseListedScore(row) : emptyResult();
    return row;
  }
  if (liveNow) {
    row.live = true;
    row.period = row.period && row.period !== "pre" && row.period !== "ft" ? row.period : "1h";
    row.clock = row.displayClock || row.time || "LIVE";
    row.time = row.clock;
    row.result = parseListedScore(row.score ? row : { ...row, score: "0-0" });
    return row;
  }
  row.live = false;
  row.period = "pre";
  row.score = "";
  row.result = emptyResult();
  row.clock = row.time;
  return row;
}

function applyDemo(m, now) {
  const row = {
    ...m,
    stats: {
      possession: [...(m.stats?.possession || [50, 50])],
      shots: [...(m.stats?.shots || [0, 0])],
      corners: [...(m.stats?.corners || [0, 0])]
    }
  };
  const p = eatParts(now || new Date());
  const today = `${p.year}-${p.month}-${p.day}`;
  const nowMin = Number(p.hour) * 60 + Number(p.minute);
  const kick = Number(row.kickMin ?? (11 * 60 + 35));
  let elapsed = nowMin - kick;
  if (row.day && row.day < today) elapsed = 200;
  if (row.day && row.day > today) elapsed = -60;
  if (elapsed < 0) {
    row.live = false;
    row.period = "pre";
    row.score = "";
    row.result = emptyResult();
    row.clock = row.time || "11:35";
    row.time = row.clock;
    row.minute = 0;
    return row;
  }
  const finished = elapsed >= 105;
  const clock = footballClock(Math.min(elapsed, 120));
  row.period = finished ? "ft" : clock.period;
  row.time = finished ? "FT" : clock.label;
  row.clock = row.time;
  row.minute = finished ? 90 : clock.minute;
  row.live = !finished;
  row.result = footballAt(planFor(row), finished ? 90 : clock.minute, finished);
  row.score = formatScore("football", row.result);
  row.stats = {
    possession: [54, 46],
    shots: [row.result.home + 3, row.result.away + 2],
    corners: [row.result.cornersHome || 0, row.result.cornersAway || 0]
  };
  if (finished) row.completedAt = row.completedAt || new Date(now || Date.now()).toISOString();
  return row;
}

function applyLive(m, when) {
  const at = when instanceof Date ? when : new Date();
  if (m?.source === "demo") return applyDemo(m, at);
  if (isOfficial(m)) return applyOfficial(m);
  const row = {
    ...m,
    stats: {
      possession: [...(m.stats?.possession || [50, 50])],
      shots: [...(m.stats?.shots || [0, 0])],
      corners: [...(m.stats?.corners || [0, 0])]
    }
  };
  if ((row.period === "ft" || /^FT$/i.test(String(row.time || ""))) && row.score) {
    row.live = false;
    row.period = "ft";
    row.time = "FT";
    row.result = parseListedScore(row);
    row.clock = "FT";
    return row;
  }
  const kick = kickoffMinutes(row);
  const now = eatMinutesNow();
  const elapsed = now - kick;
  const plan = planFor(row);
  const dur = durationOf(row.sport);

  if (elapsed < 0) {
    row.live = false;
    row.period = "pre";
    row.score = "";
    row.result = { home: 0, away: 0, total: 0, htHome: 0, htAway: 0, cornersHome: 0, cornersAway: 0, cardsHome: 0, cardsAway: 0, sets: [] };
    row.clock = row.time;
    return row;
  }

  const finished = elapsed >= dur || (row.sport === "football" && elapsed >= 105);
  let playMin = 0;
  if (row.sport === "football") {
    const clock = footballClock(elapsed);
    row.period = finished ? "ft" : clock.period;
    row.time = finished ? "FT" : clock.label;
    row.clock = row.time;
    row.minute = clock.minute;
    playMin = finished ? 90 : clock.minute;
    row.result = footballAt(plan, playMin, finished);
  } else {
    const frac = Math.min(1, elapsed / dur);
    row.result = pointsAt(plan, frac, finished);
    if (finished) {
      row.period = "ft";
      row.time = "FT";
      row.clock = "FT";
    } else {
      row.live = true;
      row.period = frac < 0.5 ? "1h" : "2h";
      row.minute = Math.round(frac * (row.sport === "tennis" ? 110 : 48));
      row.time = row.period === "1h" ? "1st" : "2nd";
      row.clock = row.time;
    }
  }

  row.live = !finished && elapsed >= 0;
  if (finished) {
    row.live = false;
    row.period = "ft";
    row.time = "FT";
    row.clock = "FT";
  }
  row.score = row.live || finished ? formatScore(row.sport, row.result) : "";
  const r = row.result;
  const possHome = 42 + (hash(row.id) % 17);
  row.stats = {
    possession: [possHome, 100 - possHome],
    shots: [r.home + 3 + (hash(row.id) % 5), r.away + 2 + ((hash(row.id) >>> 2) % 5)],
    corners: [r.cornersHome || 0, r.cornersAway || 0]
  };
  return row;
}

function liveMatches(list) {
  return (list || MATCHES).map(applyLive);
}

function matchById(id, matches) {
  return (matches || liveMatches()).find((m) => m.id === id) || null;
}

function decided(status) {
  return status === "won" || status === "lost" || status === "void";
}

function evalPick(match, pick, finished) {
  const r = match?.result;
  if (!match || !r) return "pending";
  const key = String(pick || "");
  const home = r.home || 0;
  const away = r.away || 0;
  const total = home + away;
  const corners = (r.cornersHome || 0) + (r.cornersAway || 0);
  const cards = (r.cardsHome || 0) + (r.cardsAway || 0);
  const htHome = r.htHome || 0;
  const htAway = r.htAway || 0;

  const win1 = home > away;
  const winX = home === away;
  const win2 = away > home;

  if (key === "1") return finished ? (win1 ? "won" : "lost") : "pending";
  if (key === "x") return finished ? (winX ? "won" : "lost") : "pending";
  if (key === "2") return finished ? (win2 ? "won" : "lost") : "pending";
  if (key === "1x") return finished ? (win1 || winX ? "won" : "lost") : "pending";
  if (key === "12") return finished ? (win1 || win2 ? "won" : "lost") : "pending";
  if (key === "x2") return finished ? (winX || win2 ? "won" : "lost") : "pending";
  if (key === "dnb1") {
    if (winX && finished) return "void";
    if (win1 && finished) return "won";
    if (win2 && finished) return "lost";
    return "pending";
  }
  if (key === "dnb2") {
    if (winX && finished) return "void";
    if (win2 && finished) return "won";
    if (win1 && finished) return "lost";
    return "pending";
  }
  if (key === "btts_y") {
    if (home > 0 && away > 0) return "won";
    return finished ? "lost" : "pending";
  }
  if (key === "btts_n") {
    if (home > 0 && away > 0) return "lost";
    return finished ? "won" : "pending";
  }
  if (key === "over15" || key === "over") {
    if (total > 1.5) return "won";
    return finished ? "lost" : "pending";
  }
  if (key === "under15") {
    if (total > 1.5) return "lost";
    return finished ? "won" : "pending";
  }
  if (key === "over25") {
    if (total > 2.5) return "won";
    return finished ? "lost" : "pending";
  }
  if (key === "under25" || key === "under") {
    if (total > 2.5) return "lost";
    return finished ? "won" : "pending";
  }
  if (key === "over35") {
    if (total > 3.5) return "won";
    return finished ? "lost" : "pending";
  }
  if (key === "under35") {
    if (total > 3.5) return "lost";
    return finished ? "won" : "pending";
  }
  if (key === "ah_h" || key === "ah1") return finished ? (home - 0.5 > away ? "won" : "lost") : "pending";
  if (key === "ah_a" || key === "ah2") return finished ? (away + 0.5 > home ? "won" : "lost") : "pending";
  if (key === "ht1") return finished || match.period === "2h" || match.period === "ht" ? (htHome > htAway ? "won" : "lost") : "pending";
  if (key === "htx") return finished || match.period === "2h" || match.period === "ht" ? (htHome === htAway ? "won" : "lost") : "pending";
  if (key === "ht2") return finished || match.period === "2h" || match.period === "ht" ? (htAway > htHome ? "won" : "lost") : "pending";
  if (key === "c_over") {
    if (corners > 9.5) return "won";
    return finished ? "lost" : "pending";
  }
  if (key === "c_under") {
    if (corners > 9.5) return "lost";
    return finished ? "won" : "pending";
  }
  if (key === "c1") return finished ? (r.cornersHome > r.cornersAway ? "won" : "lost") : "pending";
  if (key === "cx") return finished ? (r.cornersHome === r.cornersAway ? "won" : "lost") : "pending";
  if (key === "c2") return finished ? (r.cornersAway > r.cornersHome ? "won" : "lost") : "pending";
  if (key === "cards_o") {
    if (cards > 3.5) return "won";
    return finished ? "lost" : "pending";
  }
  if (key === "cards_u") {
    if (cards > 3.5) return "lost";
    return finished ? "won" : "pending";
  }
  if (key === "odd") return finished ? (total % 2 === 1 ? "won" : "lost") : "pending";
  if (key === "even") return finished ? (total % 2 === 0 ? "won" : "lost") : "pending";
  if (/^cs\d\d$/.test(key)) {
    if (!finished) return "pending";
    const want = key.replace("cs", "");
    const hs = Number(want[0]);
    const as = Number(want[1]);
    return home === hs && away === as ? "won" : "lost";
  }
  const linePick = key.match(/^(over|under)(\d)(\d)$/);
  if (linePick) {
    const line = Number(linePick[2] + "." + linePick[3]);
    const over = linePick[1] === "over";
    if (over) return total > line ? "won" : finished ? "lost" : "pending";
    return total > line ? "lost" : finished ? "won" : "pending";
  }
  if (key === "eg0" || key === "eg1" || key === "eg2" || key === "eg3") {
    const want = Number(key.slice(2));
    return finished ? (total === want ? "won" : "lost") : "pending";
  }
  if (key === "eg4") return finished ? (total >= 4 ? "won" : "lost") : "pending";
  if (key === "th15") return home > 1.5 ? "won" : finished ? "lost" : "pending";
  if (key === "ta15") return away > 1.5 ? "won" : finished ? "lost" : "pending";
  if (key === "th05") return home > 0.5 ? "won" : finished ? "lost" : "pending";
  if (key === "ta05") return away > 0.5 ? "won" : finished ? "lost" : "pending";
  if (key === "wtn1") return finished ? (home > away && away === 0 ? "won" : "lost") : "pending";
  if (key === "wtn2") return finished ? (away > home && home === 0 ? "won" : "lost") : "pending";
  if (key === "csy1") return finished ? (away === 0 ? "won" : "lost") : "pending";
  if (key === "csy2") return finished ? (home === 0 ? "won" : "lost") : "pending";
  if (key === "h15h") return finished ? (home - 1.5 > away ? "won" : "lost") : "pending";
  if (key === "h15a") return finished ? (away + 1.5 > home ? "won" : "lost") : "pending";
  if (key === "h25h") return finished ? (home - 2.5 > away ? "won" : "lost") : "pending";
  if (key === "h25a") return finished ? (away + 2.5 > home ? "won" : "lost") : "pending";
  if (key.startsWith("hf") && key.length === 4) {
    if (!finished) return "pending";
    const ht = htHome > htAway ? "1" : htHome === htAway ? "x" : "2";
    const ft = home > away ? "1" : home === away ? "x" : "2";
    return key.slice(2) === ht + ft ? "won" : "lost";
  }
  const htTotal = htHome + htAway;
  if (key === "ht_o05") return htTotal > 0.5 ? "won" : finished || match.period === "2h" ? "lost" : "pending";
  if (key === "ht_u05") return htTotal > 0.5 ? "lost" : finished || match.period === "2h" ? "won" : "pending";
  if (key === "ht_o15") return htTotal > 1.5 ? "won" : finished || match.period === "2h" ? "lost" : "pending";
  if (key === "ht_u15") return htTotal > 1.5 ? "lost" : finished || match.period === "2h" ? "won" : "pending";
  if (key === "btts1h") return htHome > 0 && htAway > 0 ? "won" : finished || match.period === "2h" ? "lost" : "pending";
  if (key === "btts1h_n") return htHome > 0 && htAway > 0 ? "lost" : finished || match.period === "2h" ? "won" : "pending";
  if (key === "1_gg") return finished ? (win1 && home > 0 && away > 0 ? "won" : "lost") : "pending";
  if (key === "x_gg") return finished ? (winX && home > 0 && away > 0 ? "won" : "lost") : "pending";
  if (key === "2_gg") return finished ? (win2 && home > 0 && away > 0 ? "won" : "lost") : "pending";
  if (key === "1_o25") return finished ? (win1 && total > 2.5 ? "won" : "lost") : "pending";
  if (key === "x_o25") return finished ? (winX && total > 2.5 ? "won" : "lost") : "pending";
  if (key === "2_o25") return finished ? (win2 && total > 2.5 ? "won" : "lost") : "pending";
  if (key === "ng1" || key === "ng2" || key === "ng0") {
    if (!finished && total === 0 && key !== "ng0") return "pending";
    if (key === "ng0") return finished && total === 0 ? "won" : total > 0 ? "lost" : "pending";
    const first = (planFor(match).times || [])[0];
    if (!first) return finished ? "void" : "pending";
    if (!finished && playMinute(match) < first.min) return "pending";
    if (key === "ng1") return first.side === "home" ? "won" : "lost";
    if (key === "ng2") return first.side === "away" ? "won" : "lost";
  }
  return finished ? "void" : "pending";
}

function playMinute(match) {
  return Number(match.minute || 0);
}

function decorateLegs(rec, matches) {
  return (rec.selections || []).map((s) => {
    const match = matchById(s.id, matches);
    const finished = match?.period === "ft";
    const result = evalPick(match, s.pick, finished);
    return {
      ...s,
      result,
      live: Boolean(match?.live),
      period: match?.period || "pre",
      clock: match?.clock || match?.time || "",
      score: match?.score || "",
      home: s.home || match?.home,
      away: s.away || match?.away
    };
  });
}

function settleBet(rec, matches) {
  const legs = decorateLegs(rec, matches);
  const lost = legs.some((l) => l.result === "lost");
  const pending = legs.some((l) => l.result === "pending");
  const wonLegs = legs.filter((l) => l.result === "won");
  const voidLegs = legs.filter((l) => l.result === "void");
  const next = { ...rec, legs };
  if (lost) {
    next.status = "Lost";
    next.payout = 0;
    next.detail = legs.map((l) => `${l.home} vs ${l.away} · ${l.label || l.pick} · ${l.result.toUpperCase()}`).join(" / ");
    return next;
  }
  if (pending) {
    next.status = legs.some((l) => l.live) ? "Live" : "Open";
    next.detail = legs.map((l) => `${l.home} vs ${l.away} · ${l.label || l.pick}${l.score ? " · " + l.score : ""}`).join(" / ");
    return next;
  }
  if (wonLegs.length === 0 && voidLegs.length === legs.length) {
    next.status = "Void";
    next.payout = rec.stake;
    next.detail = "All picks void · stake returned";
    return next;
  }
  const odds = wonLegs.reduce((n, s) => n * Number(s.odd || 0), 1) || 1;
  next.odds = Number(odds.toFixed(2));
  next.payout = Math.round(Number(rec.stake || 0) * odds);
  next.status = "Won";
  next.detail = legs.map((l) => `${l.home} vs ${l.away} · ${l.label || l.pick} · ${l.result.toUpperCase()}`).join(" / ");
  return next;
}

function decorateBet(rec, matches) {
  const legs = rec.legs || decorateLegs(rec, matches);
  const closed = rec.status === "Won" || rec.status === "Lost" || rec.status === "Void" || rec.status === "Cashout";
  const live = legs.some((l) => l.live) && !closed;
  const cashout = offerCashout(rec, matches);
  return {
    ...rec,
    legs,
    live,
    cashout,
    toReturn: rec.status === "Lost" ? 0 : rec.payout,
    toWin: rec.status === "Lost" ? 0 : Math.max(0, Number(rec.payout || 0) - Number(rec.stake || 0))
  };
}

function minuteOf(match) {
  const n = Number(match?.minute || 0);
  if (n > 0) return n;
  const hit = String(match?.clock || match?.time || "").match(/(\d{1,3})/);
  if (hit) return Number(hit[1]);
  if (match?.period === "ht") return 45;
  if (match?.period === "2h") return 70;
  return match?.live ? 15 : 0;
}

function correctScoreLive(match, pick) {
  const key = String(pick || "");
  if (!/^cs\d\d$/.test(key)) return null;
  const hs = Number(key[2]);
  const as = Number(key[3]);
  const home = Number(match?.result?.home || 0);
  const away = Number(match?.result?.away || 0);
  if (match?.period === "ft") return home === hs && away === as ? "won" : "lost";
  if (home > hs || away > as) return "lost";
  if (home === hs && away === as) return "hitting";
  return "open";
}

function goalsStillNeeded(match, pick) {
  const key = String(pick || "");
  if (!/^cs\d\d$/.test(key)) return 1;
  const home = Number(match?.result?.home || 0);
  const away = Number(match?.result?.away || 0);
  return Math.max(0, Number(key[2]) - home) + Math.max(0, Number(key[3]) - away);
}

function selectionState(match, pick) {
  if (!match) return "lost";
  const cs = correctScoreLive(match, pick);
  if (cs) return cs === "won" ? "won" : cs;
  if (match.period === "ft") {
    const st = evalPick(match, pick, true);
    if (st === "void") return "void";
    return st === "won" ? "won" : "lost";
  }
  const now = evalPick(match, pick, false);
  if (now === "lost") return "lost";
  if (now === "won") return "won";
  return "open";
}

function offerCashout(rec, matches) {
  if (!rec || (rec.kind && rec.kind !== "sports")) return null;
  if (["Won", "Lost", "Void", "Cashout"].includes(rec.status) || rec.paidOut) return null;
  const legs = rec.selections || [];
  if (!legs.length) return null;
  const stake = Number(rec.stake || 0);
  if (stake <= 0) return null;
  let booked = 1;
  let current = 1;
  let anyLive = false;
  for (const s of legs) {
    const match = matchById(s.id, matches);
    const base = Math.max(1.01, Number(s.bookedOdd || s.odd || 1));
    if (!match) return 0;
    if (match.live) anyLive = true;
    const st = selectionState(match, s.pick);
    if (st === "lost") return match.live || match.period === "ft" || anyLive ? 0 : null;
    if (st === "void") continue;
    booked *= base;
    if (st === "won" || match.period === "ft") current *= 1;
    else if (match.live) current *= liveOdd(base, match, s.pick);
    else current *= base;
  }
  if (!anyLive) return null;
  const raw = stake * (booked / Math.max(current, 1.01)) * 0.9;
  const cap = stake * booked * 0.97;
  return Math.max(0, Math.round(Math.min(raw, cap)));
}

function liveOdd(booked, match, pick) {
  const base = Math.max(1.01, Number(booked) || 1.5);
  if (!match || !match.live || match.period === "ft") return Math.round(base * 100) / 100;
  const progress = Math.max(0, Math.min(1, minuteOf(match) / 90));
  const cs = correctScoreLive(match, pick);
  if (cs === "lost") return Math.round(Math.min(80, base * (1 + progress * 3.2)) * 100) / 100;
  if (cs === "hitting") {
    const next = 1 + Math.max(0.01, base - 1) * (1 - progress * 0.7);
    return Math.round(Math.min(80, Math.max(1.01, next)) * 100) / 100;
  }
  if (cs === "open") {
    const need = goalsStillNeeded(match, pick);
    const next = base * (1 + progress * (0.25 + need * 0.55));
    return Math.round(Math.min(80, Math.max(1.01, next)) * 100) / 100;
  }
  const status = evalPick(match, pick, true);
  let next = base;
  if (status === "won") next = 1 + Math.max(0.01, base - 1) * (1 - progress * 0.82);
  else if (status === "lost") next = base * (1 + progress * 2.4);
  else next = base * (1 + progress * 0.08);
  return Math.round(Math.min(80, Math.max(1.01, next)) * 100) / 100;
}

function closedMatchError(selections, matches) {
  for (const s of selections || []) {
    const m = matchById(s.id, matches);
    if (!m) return "A selected match was not found";
    if (m.period === "ft") return `${m.home} vs ${m.away} has finished`;
  }
  return "";
}

module.exports = {
  liveMatches,
  applyLive,
  settleBet,
  decorateBet,
  decorateLegs,
  closedMatchError,
  evalPick,
  liveOdd,
  offerCashout
};
