const axios = require("axios");
const { overlayRealOdds } = require("./catalog");

const BASE = "https://guest.api.arcadia.pinnacle.com/0.1";
const GUEST_KEY = process.env.PINNACLE_GUEST_KEY || "CmX2KcMrXuFmNg6YFbmTxE0y9CIrOi0R";
const PHRASES = [
  "europa league",
  "conference league",
  "champions league",
  "premier league",
  "league one",
  "league two",
  "la liga",
  "serie a",
  "ligue 1",
  "liga mx",
  "pro league",
  "j1 league",
  "fa cup",
  "primeira liga",
  "bundesliga",
  "eredivisie",
  "saudi"
];

function americanToDec(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n === 0) return 0;
  return n > 0 ? Number((1 + n / 100).toFixed(2)) : Number((1 + 100 / Math.abs(n)).toFixed(2));
}

function fold(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(fc|cf|sc|ac|afc|fk|sk|nk|tsg|vfb|rcd|rc|cd|ud|sv|ssc|bc|if|bk)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(value) {
  return fold(value)
    .split(" ")
    .filter((token) => token.length >= 4);
}

function tokenClose(a, b) {
  if (a === b) return true;
  if (a.length >= 5 && b.length >= 5 && (a.includes(b) || b.includes(a))) return true;
  return a.length >= 5 && b.length >= 5 && a.slice(0, 4) === b.slice(0, 4) && Math.abs(a.length - b.length) <= 2;
}

function sideMatch(a, b) {
  if (fold(a) === fold(b)) return true;
  const left = tokens(a);
  const right = tokens(b);
  if (!left.length || !right.length) return false;
  const shorter = left.length <= right.length ? left : right;
  const longer = left.length <= right.length ? right : left;
  return shorter.every((token) => longer.some((other) => tokenClose(token, other)));
}

function headers() {
  return {
    Accept: "application/json",
    Referer: "https://www.pinnacle.com/",
    "X-API-Key": GUEST_KEY,
    "User-Agent": "Paribet/1.0"
  };
}

async function getJson(url) {
  const res = await axios.get(url, {
    headers: headers(),
    timeout: 12000,
    validateStatus: () => true
  });
  if (res.status >= 400 || res.data == null) return null;
  return res.data;
}

async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      try {
        out[index] = await fn(items[index]);
      } catch (err) {
        out[index] = null;
      }
    }
  }
  const workers = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workers }, () => run()));
  return out;
}

function leagueWanted(name, catalogLeagues) {
  const book = fold(name);
  for (const raw of catalogLeagues) {
    const catalog = fold(raw);
    if (!catalog || !book) continue;
    for (const phrase of PHRASES) {
      if (catalog.includes(phrase) && book.includes(phrase)) return true;
    }
    const ignore = new Set(["league", "liga", "cup", "women", "mens"]);
    const left = catalog.split(" ").filter((token) => token.length > 3 && !ignore.has(token));
    const right = book.split(" ").filter((token) => token.length > 3 && !ignore.has(token));
    const shared = left.filter((token) => right.includes(token));
    if (shared.length >= 2) return true;
    if (shared.some((token) => token.length >= 7)) return true;
  }
  return false;
}

function moneylineOf(markets) {
  const rows = (markets || []).filter(
    (row) => row && row.type === "moneyline" && row.period === 0 && !row.isAlternate && row.status !== "closed"
  );
  const row = rows.find((item) => item.key === "s;0;m") || rows[0];
  if (!row) return null;
  const price = {};
  for (const side of row.prices || []) price[side.designation] = americanToDec(side.price);
  if (!(price.home > 1 && price.away > 1 && price.draw > 1)) return null;
  return { home: price.home, away: price.away, draw: price.draw };
}

function totalOf(markets) {
  const rows = (markets || []).filter(
    (row) => row && row.type === "total" && row.period === 0 && !row.isAlternate && row.status !== "closed"
  );
  const row = rows.find((item) => (item.prices || []).some((side) => Number(side.points) === 2.5));
  if (!row) return null;
  const price = {};
  for (const side of row.prices || []) {
    if (Number(side.points) === 2.5) price[side.designation] = americanToDec(side.price);
  }
  if (!(price.over > 1 || price.under > 1)) return null;
  return { over: price.over || 0, under: price.under || 0 };
}

function gamesFrom(matchups, markets, leagueName) {
  const byMatch = new Map();
  for (const row of markets || []) {
    if (!row?.matchupId) continue;
    if (!byMatch.has(row.matchupId)) byMatch.set(row.matchupId, []);
    byMatch.get(row.matchupId).push(row);
  }
  const games = [];
  for (const matchup of matchups || []) {
    if (matchup?.type !== "matchup" || matchup.parentId) continue;
    const parts = {};
    for (const part of matchup.participants || []) parts[part.alignment] = part.name;
    if (!parts.home || !parts.away) continue;
    const prices = moneylineOf(byMatch.get(matchup.id));
    if (!prices) continue;
    const total = totalOf(byMatch.get(matchup.id));
    games.push({
      home: parts.home,
      away: parts.away,
      start: Date.parse(matchup.startTime || "") || 0,
      league: leagueName,
      odds: { ...prices, ...(total || {}) }
    });
  }
  return games;
}

async function loadLeague(league) {
  const [matchups, markets] = await Promise.all([
    getJson(`${BASE}/leagues/${league.id}/matchups?brandId=0`),
    getJson(`${BASE}/leagues/${league.id}/markets/straight`)
  ]);
  return gamesFrom(matchups, markets, league.name);
}

function kickoffMs(match) {
  const parsed = Date.parse(match?.kickoff || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function pickGame(match, games) {
  const when = kickoffMs(match);
  let best = null;
  let bestScore = Infinity;
  for (const game of games) {
    if (!sideMatch(match.home, game.home) || !sideMatch(match.away, game.away)) continue;
    const gap = when && game.start ? Math.abs(when - game.start) : 0;
    if (gap > 36 * 60 * 60 * 1000) continue;
    if (gap < bestScore) {
      best = game;
      bestScore = gap;
    }
  }
  return best;
}

async function applyBookOdds(matches) {
  const pending = (matches || []).filter((match) => match && match.source !== "demo" && match.sport === "football" && !match.priced);
  if (!pending.length) return matches;
  const catalogLeagues = [...new Set(pending.map((match) => match.league).filter(Boolean))];
  const leagues = await getJson(`${BASE}/sports/29/leagues?brandId=0`);
  const chosen = (Array.isArray(leagues) ? leagues : []).filter(
    (league) => league?.id && (league.matchupCount || 0) > 0 && leagueWanted(league.name, catalogLeagues)
  );
  if (!chosen.length) return matches;
  const packs = await pool(chosen, 10, loadLeague);
  const games = packs.flat().filter(Boolean);
  let filled = 0;
  const next = matches.map((match) => {
    if (!match || match.source === "demo" || match.priced || match.sport !== "football") return match;
    const game = pickGame(match, games);
    if (!game) return match;
    filled += 1;
    return overlayRealOdds(match, game.odds);
  });
  if (filled) console.log("book odds", filled, "from", games.length, "prices");
  return next;
}

module.exports = { applyBookOdds, sideMatch, fold };
