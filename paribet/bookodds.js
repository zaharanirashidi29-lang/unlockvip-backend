const axios = require("axios");
const { overlayRealOdds, overlayCoherentOdds } = require("./catalog");

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

const CAF_SNAPSHOT = [
  ["CFFA", "Young Africans", 15.18, 6.29, 1.13],
  ["African Stars", "Orlando Pirates", 5.62, 3.54, 1.54],
  ["TP Mazembe", "Club Africain", 1.39, 3.66, 8.65],
  ["San Pédro", "FC Nouadhibou", 1.68, 3.29, 4.73],
  ["Star Sport Academy", "RSB Berkane", 15.6, 5.81, 1.13],
  ["Scottland Mabvuku", "Petro de Luanda", 4.04, 2.91, 1.93],
  ["Teungueth", "Colombe Sportiv Du Dja Et Lobo", 2.04, 2.87, 3.7],
  ["Maghreb As De Fès", "ASEC Mimosas", 1.46, 3.62, 6.73],
  ["Rangers International", "MC Alger", 4.4, 3.4, 1.75],
  ["Sidama Coffee", "Al Hilal Omdurman", 4.6, 3.35, 1.72],
  ["Wiliete SC", "Mamelodi Sundowns", 8.4, 4.7, 1.35],
  ["Horoya", "Al-Merrikh", 2.7, 3.05, 2.55],
  ["Asswehly SC", "Esperance Sportive de Tunis", 6.4, 4, 1.48],
  ["15 de Agosto", "Simba SC", 6.8, 4.2, 1.45],
  ["Young Africans", "CFFA", 1.11, 7.8, 14.5],
  ["Petro de Luanda", "Scottland Mabvuku", 1.62, 3.55, 5.2],
  ["Orlando Pirates", "African Stars", 1.3, 4.8, 8.2],
  ["Mamelodi Sundowns", "Wiliete SC", 1.16, 6.8, 13],
  ["MC Alger", "Rangers International", 1.48, 4, 6.4],
  ["Esperance Sportive de Tunis", "Asswehly SC", 1.24, 5.6, 10],
  ["Al-Merrikh", "Horoya", 1.72, 3.35, 4.6],
  ["Pyramids FC", "El Merriekh Bentiu", 1.05, 10, 19],
  ["Zamalek", "APR FC", 1.42, 4.1, 6.8],
  ["RSB Berkane", "Star Sport Academy", 1.07, 9.5, 17],
  ["Simba SC", "15 de Agosto", 1.22, 5.8, 10.5],
  ["Colombe Sportiv Du Dja Et Lobo", "Teungueth", 2.2, 3.15, 3.2],
  ["Al Hilal Omdurman", "Sidama Coffee", 1.5, 3.9, 5.8],
  ["ASEC Mimosas", "Maghreb As De Fès", 2.55, 3.15, 2.65],
  ["Club Africain", "TP Mazembe", 2.7, 3.1, 2.55],
  ["FC Nouadhibou", "San Pédro", 2.45, 3.1, 2.8]
];

function looseSide(a, b) {
  if (sideMatch(a, b)) return true;
  const fa = fold(a).replace(/ /g, "");
  const fb = fold(b).replace(/ /g, "");
  if (fa && fb && fa.slice(0, 3) === fb.slice(0, 3) && Math.min(fa.length, fb.length) <= 5 && Math.min(fa.length, fb.length) >= 3) {
    return true;
  }
  const left = fold(a).split(" ").filter((token) => token.length >= 5);
  const right = fold(b).split(" ").filter((token) => token.length >= 5);
  return left.some((token) =>
    right.some((other) => token === other || (token.slice(0, 4) === other.slice(0, 4) && Math.abs(token.length - other.length) <= 2))
  );
}

function isCafChampions(league) {
  const name = fold(league);
  return name.includes("caf") && name.includes("champion");
}

function parseBetexplorer(html) {
  const games = [];
  const re = /<td class="table-main__datetime">[\s\S]*?<\/td>\s*<td class="h-text-left"><a href="[^"]+" class="in-match"><span>([^<]+)<\/span>\s*-\s*<span>([^<]+)<\/span><\/a>[\s\S]*?data-odd="([0-9.]+)"[\s\S]*?data-odd="([0-9.]+)"[\s\S]*?data-odd="([0-9.]+)"/g;
  let match;
  while ((match = re.exec(html))) {
    const home = Number(match[3]);
    const draw = Number(match[4]);
    const away = Number(match[5]);
    if (home > 1 && draw > 1 && away > 1) games.push({ home: match[1].trim(), away: match[2].trim(), odds: { home, draw, away } });
  }
  return games;
}

function parseOddsmath(html) {
  const games = [];
  const re = /africa-caf-champions-league-1056\/[^>]*>([^<]+)<\/a>[\s\S]{0,700}?africa-caf-champions-league-1056\/[^>]*>([^<]+)<\/a>[\s\S]{0,500}?class="odds"[^>]*>([0-9.]+)<\/td>\s*<td class="odds"[^>]*>([0-9.]+)<\/td>\s*<td class="odds"[^>]*>([0-9.]+)<\/td>/g;
  let match;
  while ((match = re.exec(html))) {
    const home = Number(match[3]);
    const draw = Number(match[4]);
    const away = Number(match[5]);
    if (home > 1 && draw > 1 && away > 1) games.push({ home: match[1].trim(), away: match[2].trim(), odds: { home, draw, away } });
  }
  return games;
}

async function getText(url) {
  const res = await axios.get(url, {
    headers: {
      Accept: "text/html",
      "Accept-Language": "en",
      "User-Agent": "Mozilla/5.0"
    },
    timeout: 12000,
    responseType: "text",
    validateStatus: () => true
  });
  if (res.status >= 400 || typeof res.data !== "string") return "";
  return res.data;
}

let cafCache = { at: 0, games: [] };

async function loadCafBoard() {
  if (cafCache.games.length && Date.now() - cafCache.at < 10 * 60 * 1000) return cafCache.games;
  const [board, alt] = await Promise.all([
    getText("https://www.betexplorer.com/football/africa/caf-champions-league/fixtures/"),
    getText("https://www.oddsmath.com/football/international/africa-caf-champions-league-1056/")
  ]);
  const games = parseBetexplorer(board);
  for (const game of parseOddsmath(alt)) {
    if (!games.some((row) => looseSide(row.home, game.home) && looseSide(row.away, game.away))) games.push(game);
  }
  if (games.length) cafCache = { at: Date.now(), games };
  return games.length ? games : cafCache.games;
}

function listedCafPrice(match, games) {
  if (match.priced && match.odds && match.odds["1"] > 1 && match.odds.x > 1 && match.odds["2"] > 1) {
    return { home: match.odds["1"], draw: match.odds.x, away: match.odds["2"], over: match.odds.over25, under: match.odds.under25 };
  }
  for (const game of games) {
    if (looseSide(match.home, game.home) && looseSide(match.away, game.away)) return game.odds;
  }
  for (const row of CAF_SNAPSHOT) {
    if (looseSide(match.home, row[0]) && looseSide(match.away, row[1])) {
      return { home: row[2], draw: row[3], away: row[4] };
    }
  }
  return null;
}

async function applyCafBoard(matches) {
  const targets = (matches || []).filter((match) => match && match.source !== "demo" && match.sport === "football" && isCafChampions(match.league));
  if (!targets.length) return matches;
  let games = [];
  try {
    games = await loadCafBoard();
  } catch (err) {
    console.log("caf board", err.message);
  }
  let filled = 0;
  const next = matches.map((match) => {
    if (!match || match.source === "demo" || match.sport !== "football" || !isCafChampions(match.league)) return match;
    const price = listedCafPrice(match, games);
    if (!price) return match;
    filled += 1;
    return overlayCoherentOdds(match, price);
  });
  if (filled) console.log("caf odds", filled, "board", games.length);
  return next;
}

async function applyPinnacleOdds(matches) {
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

async function applyBookOdds(matches) {
  let next = matches;
  try {
    next = await applyPinnacleOdds(matches);
  } catch (err) {
    console.log("book odds", err.message);
  }
  return applyCafBoard(next);
}

module.exports = { applyBookOdds, sideMatch, fold };
