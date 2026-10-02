const axios = require("axios");
const { buildMatch } = require("./catalog");

const TZ = "Africa/Dar_es_Salaam";
const AHEAD_DAYS = 5;
const ESPN = "https://site.api.espn.com/apis/site/v2/sports";

function safeDate(value) {
  const d = value instanceof Date ? value : new Date(value || Date.now());
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

function eatParts(date = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false
  });
  const out = {};
  for (const p of fmt.formatToParts(safeDate(date))) {
    if (p.type !== "literal") out[p.type] = p.value;
  }
  return out;
}

function ymd(date) {
  const p = eatParts(date);
  return `${p.year}-${p.month}-${p.day}`;
}

function ymdCompact(date) {
  return ymd(date).replace(/-/g, "");
}

function daysFromToday(date = new Date()) {
  const days = [];
  const start = safeDate(date);
  const p = eatParts(start);
  const noon = new Date(`${p.year}-${p.month}-${p.day}T12:00:00+03:00`);
  for (let i = 0; i <= AHEAD_DAYS; i++) {
    const d = new Date(noon.getTime() + i * 86400000);
    days.push({ iso: ymd(d), compact: ymdCompact(d), offset: i });
  }
  return days;
}

function americanToDec(raw) {
  if (raw == null || raw === "") return 0;
  const n = Number(String(raw).replace(/^\+/, ""));
  if (!Number.isFinite(n) || n === 0) return 0;
  return n > 0 ? Number((1 + n / 100).toFixed(2)) : Number((1 + 100 / Math.abs(n)).toFixed(2));
}

function pickOdds(comp) {
  const row = (comp?.odds || [])[0] || {};
  const ml = row.moneyline || {};
  const total = row.total || {};
  return {
    home: americanToDec(ml.home?.close?.odds || ml.home?.open?.odds),
    away: americanToDec(ml.away?.close?.odds || ml.away?.open?.odds),
    draw: americanToDec(ml.draw?.close?.odds || ml.draw?.open?.odds || row.drawOdds?.moneyLine),
    over: americanToDec(total.over?.close?.odds || total.over?.open?.odds),
    under: americanToDec(total.under?.close?.odds || total.under?.open?.odds)
  };
}

function competitorName(c) {
  return (
    c?.team?.displayName ||
    c?.athlete?.displayName ||
    c?.athlete?.shortName ||
    c?.athlete?.fullName ||
    ""
  );
}

function leagueName(event, comp, sportLabel) {
  const note = String(comp?.altGameNote || "").split(",")[0].trim();
  if (note) return note;
  if (comp?.group?.name && !/^Group /i.test(comp.group.name)) return comp.group.name;
  return sportLabel;
}

function mapState(status) {
  const type = status?.type || {};
  const state = String(type.state || "").toLowerCase();
  if (type.completed || state === "post") return "post";
  if (state === "in") return "in";
  return "pre";
}

function periodFrom(status, sport) {
  const state = mapState(status);
  if (state === "post") return "ft";
  if (state === "in") {
    const clock = String(status?.displayClock || status?.type?.shortDetail || "");
    if (/ht|half/i.test(clock)) return "ht";
    if (/2nd|2h|q3|q4/i.test(clock)) return "2h";
    return "1h";
  }
  return "pre";
}

function kickoffLabel(iso) {
  if (!iso) return "";
  const p = eatParts(new Date(iso));
  const today = eatParts();
  const t = `${p.hour}:${p.minute}`;
  if (`${p.year}-${p.month}-${p.day}` === `${today.year}-${today.month}-${today.day}`) return `Today ${t}`;
  const tomorrow = eatParts(new Date(Date.now() + 86400000));
  if (`${p.year}-${p.month}-${p.day}` === `${tomorrow.year}-${tomorrow.month}-${tomorrow.day}`) return `Tomorrow ${t}`;
  return `${p.day} ${monthName(p.month)} ${t}`;
}

function monthName(mm) {
  return ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(mm) - 1] || mm;
}

function scoreOf(home, away, sport, state) {
  if (state === "pre") return "";
  if (sport === "tennis") return `${home.score || 0}-${away.score || 0}`;
  return `${Number(home.score || 0)}-${Number(away.score || 0)}`;
}

function toMatch(event, comp, sport, sportLabel) {
  const competitors = comp?.competitors || [];
  const home = competitors.find((c) => c.homeAway === "home") || competitors[0] || {};
  const away = competitors.find((c) => c.homeAway === "away") || competitors[1] || {};
  const homeName = competitorName(home);
  const awayName = competitorName(away);
  if (!homeName || !awayName) return null;
  const status = comp.status || event.status || {};
  const apiState = mapState(status);
  const kickoff = comp.startDate || event.date;
  const id = `e${comp.id || event.id}`;
  const realOdds = pickOdds(comp);
  return buildMatch(
    {
      id,
      source: "espn",
      sport,
      league: leagueName(event, comp, sportLabel),
      home: homeName,
      away: awayName,
      kickoff,
      day: ymd(safeDate(kickoff)),
      time: apiState === "post" ? "FT" : apiState === "in" ? status.displayClock || "LIVE" : kickoffLabel(kickoff),
      displayClock: status.displayClock || "",
      apiState,
      period: periodFrom(status, sport),
      live: apiState === "in",
      score: scoreOf(home, away, sport, apiState),
      completedAt: apiState === "post" ? new Date().toISOString() : ""
    },
    realOdds
  );
}

function flattenTennis(event, sportLabel) {
  const rows = [];
  for (const group of event.groupings || []) {
    for (const comp of group.competitions || []) {
      const row = toMatch(event, comp, "tennis", group.grouping?.displayName || sportLabel);
      if (row) rows.push(row);
    }
  }
  return rows;
}

async function espnScoreboard(path, dates) {
  const url = `${ESPN}/${path}/scoreboard`;
  const res = await axios.get(url, {
    params: { dates, limit: 400 },
    timeout: 20000,
    headers: { Accept: "application/json", "User-Agent": "Paribet/1.0" },
    validateStatus: () => true
  });
  if (res.status >= 400 || !res.data) return [];
  return res.data.events || [];
}

const FEEDS = [
  { path: "soccer/all", sport: "football", label: "Football" },
  { path: "basketball/nba", sport: "basketball", label: "NBA" },
  { path: "basketball/wnba", sport: "basketball", label: "WNBA" },
  { path: "basketball/mens-college-basketball", sport: "basketball", label: "NCAA" },
  { path: "hockey/nhl", sport: "hockey", label: "NHL" },
  { path: "tennis/atp", sport: "tennis", label: "ATP" },
  { path: "tennis/wta", sport: "tennis", label: "WTA" }
];

async function fetchDay(compact) {
  const packs = await Promise.all(
    FEEDS.map(async (feed) => {
      try {
        const events = await espnScoreboard(feed.path, compact);
        const rows = [];
        for (const event of events) {
          if (feed.sport === "tennis" && event.groupings) {
            try {
              rows.push(...flattenTennis(event, feed.label));
            } catch (err) {
              console.log("fixture skip tennis", err.message);
            }
            continue;
          }
          for (const comp of event.competitions || []) {
            try {
              const row = toMatch(event, comp, feed.sport, feed.label);
              if (row) rows.push(row);
            } catch (err) {
              console.log("fixture skip", feed.path, err.message);
            }
          }
        }
        return rows;
      } catch (err) {
        console.log("fixture feed", feed.path, compact, err.message);
        return [];
      }
    })
  );
  return packs.flat();
}

function titleFor(matches) {
  const today = ymd();
  const days = [...new Set(matches.map((m) => m.day).filter(Boolean))].sort();
  if (!days.length) return "Today";
  const first = days[0];
  const last = days[days.length - 1];
  if (first === last && first === today) return `Today ${Number(first.slice(8))} ${monthName(first.slice(5, 7))}`;
  return `${Number(first.slice(8))} ${monthName(first.slice(5, 7))} – ${Number(last.slice(8))} ${monthName(last.slice(5, 7))}`;
}

async function loadFixtures() {
  const days = daysFromToday();
  const byId = new Map();
  for (const d of days) {
    const rows = await fetchDay(d.compact);
    for (const row of rows) {
      if (row?.id) byId.set(row.id, row);
    }
  }
  const allowed = new Set(days.map((d) => d.iso));
  const matches = [...byId.values()]
    .filter((m) => allowed.has(m.day))
    .sort((a, b) => String(a.kickoff || "").localeCompare(String(b.kickoff || "")));
  return {
    matches,
    title: titleFor(matches),
    days: days.map((d) => d.iso),
    fetchedAt: new Date().toISOString()
  };
}

module.exports = { loadFixtures, eatParts, ymd, kickoffLabel, titleFor, AHEAD_DAYS };
