function o(n) {
  return Number(Number(n).toFixed(2));
}

function group(id, name, sels) {
  return { id, name, sels };
}

function footballMarkets(shift) {
  const s = shift || 0;
  return [
    group("1x2", "Match result", [
      { key: "1", label: "1", odd: o(1.88 + s) },
      { key: "x", label: "X", odd: o(3.35 - s / 2) },
      { key: "2", label: "2", odd: o(4.10 - s) }
    ]),
    group("dc", "Double chance", [
      { key: "1x", label: "1X", odd: o(1.22) },
      { key: "12", label: "12", odd: o(1.18) },
      { key: "x2", label: "X2", odd: o(1.72) }
    ]),
    group("dnb", "Draw no bet", [
      { key: "dnb1", label: "Home", odd: o(1.42) },
      { key: "dnb2", label: "Away", odd: o(2.75) }
    ]),
    group("btts", "Both teams to score", [
      { key: "btts_y", label: "Yes", odd: o(1.78) },
      { key: "btts_n", label: "No", odd: o(1.95) }
    ]),
    group("next", "Next goal", [
      { key: "ng1", label: "Home", odd: o(2.10) },
      { key: "ng0", label: "None", odd: o(3.40) },
      { key: "ng2", label: "Away", odd: o(2.55) }
    ]),
    group("tg", "Total goals", [
      { key: "over15", label: "Over 1.5", odd: o(1.28) },
      { key: "under15", label: "Under 1.5", odd: o(3.55) },
      { key: "over25", label: "Over 2.5", odd: o(1.82) },
      { key: "under25", label: "Under 2.5", odd: o(1.95) },
      { key: "over35", label: "Over 3.5", odd: o(2.85) },
      { key: "under35", label: "Under 3.5", odd: o(1.40) }
    ]),
    group("ah", "Asian handicap", [
      { key: "ah_h", label: "Home -0.5", odd: o(2.05) },
      { key: "ah_a", label: "Away +0.5", odd: o(1.75) }
    ]),
    group("ht", "Half-time result", [
      { key: "ht1", label: "1", odd: o(2.40) },
      { key: "htx", label: "X", odd: o(2.15) },
      { key: "ht2", label: "2", odd: o(3.60) }
    ]),
    group("corners", "Total corners", [
      { key: "c_over", label: "Over 9.5", odd: o(1.85) },
      { key: "c_under", label: "Under 9.5", odd: o(1.90) }
    ]),
    group("corner1x2", "Corners 1X2", [
      { key: "c1", label: "1", odd: o(1.70) },
      { key: "cx", label: "X", odd: o(3.80) },
      { key: "c2", label: "2", odd: o(4.40) }
    ]),
    group("cards", "Total cards", [
      { key: "cards_o", label: "Over 3.5", odd: o(1.80) },
      { key: "cards_u", label: "Under 3.5", odd: o(1.95) }
    ]),
    group("oe", "Goals odd/even", [
      { key: "odd", label: "Odd", odd: o(1.90) },
      { key: "even", label: "Even", odd: o(1.90) }
    ]),
    group("cs", "Correct score", [
      { key: "cs11", label: "1-1", odd: o(6.50) },
      { key: "cs21", label: "2-1", odd: o(8.00) },
      { key: "cs12", label: "1-2", odd: o(11.0) },
      { key: "cs22", label: "2-2", odd: o(12.0) },
      { key: "cs10", label: "1-0", odd: o(7.50) },
      { key: "cs01", label: "0-1", odd: o(9.50) }
    ])
  ];
}

function twoWayMarkets(homeOdd, awayOdd) {
  return [
    group("1x2", "Winner", [
      { key: "1", label: "1", odd: o(homeOdd) },
      { key: "2", label: "2", odd: o(awayOdd) }
    ]),
    group("tg", "Total", [
      { key: "over25", label: "Over", odd: o(1.80) },
      { key: "under25", label: "Under", odd: o(1.95) }
    ]),
    group("ah", "Handicap", [
      { key: "ah_h", label: "Home", odd: o(1.85) },
      { key: "ah_a", label: "Away", odd: o(1.90) }
    ]),
    group("next", "Next point / game", [
      { key: "ng1", label: "Home", odd: o(1.83) },
      { key: "ng2", label: "Away", odd: o(1.83) }
    ]),
    group("oe", "Odd/even", [
      { key: "odd", label: "Odd", odd: o(1.90) },
      { key: "even", label: "Even", odd: o(1.90) }
    ])
  ];
}

function flatten(markets) {
  const odds = {};
  for (const g of markets) {
    for (const sel of g.sels) odds[sel.key] = sel.odd;
  }
  if (!odds.x) odds.x = 0;
  if (!odds.over) odds.over = odds.over25 || 0;
  if (!odds.under) odds.under = odds.under25 || 0;
  if (!odds.ah1) odds.ah1 = odds.ah_h || 0;
  if (!odds.ah2) odds.ah2 = odds.ah_a || 0;
  return odds;
}

function extraCount(markets) {
  return Math.max(0, markets.reduce((n, g) => n + g.sels.length, 0) - 7);
}

function pack(row, markets) {
  return { ...row, markets, odds: flatten(markets), extra: extraCount(markets) };
}

function blankStats() {
  return { possession: [0, 0], shots: [0, 0], corners: [0, 0] };
}

function fb(row, shift) {
  return pack({
    sport: "football",
    live: false,
    period: "pre",
    score: "",
    stats: blankStats(),
    ...row
  }, footballMarkets(shift));
}

function tw(row, homeOdd, awayOdd) {
  return pack({
    live: false,
    period: "pre",
    score: "",
    stats: blankStats(),
    ...row
  }, twoWayMarkets(homeOdd, awayOdd));
}

const MATCHES = [
  fb({ id: "m1", league: "Friendly", time: "FT", period: "ft", home: "Argentina", away: "Bolivia", score: "4-0" }, -0.45),
  fb({ id: "m2", league: "UEFA Conference League", time: "FT", period: "ft", home: "Trabzonspor", away: "Drogheda United", score: "0-0" }, -0.35),
  fb({ id: "m3", league: "Friendly", time: "Today 15:00", home: "Maldives", away: "Lebanon" }, 0.12),
  fb({ id: "m4", league: "NM Cup", time: "Today 17:00", home: "Rana", away: "Bodø/Glimt" }, 0.55),
  fb({ id: "m5", league: "NM Cup", time: "Today 17:00", home: "Bærum", away: "Lillestrøm" }, 0.42),
  fb({ id: "m6", league: "NM Cup", time: "Today 17:00", home: "Madla", away: "Viking" }, 0.5),
  fb({ id: "m7", league: "QSL Cup", time: "Today 17:15", home: "Al-Gharafa", away: "Al-Mesaimeer" }, -0.28),
  fb({ id: "m8", league: "UEFA U21 Qualifying", time: "Today 18:00", home: "Greece U21", away: "Latvia U21" }, -0.32),
  fb({ id: "m9", league: "UEFA Nations League", time: "Today 19:00", home: "Azerbaijan", away: "Liechtenstein" }, -0.5),
  fb({ id: "m10", league: "AFCON Qualifiers", time: "Today 19:00", home: "Guinea", away: "Kenya" }, -0.18),
  fb({ id: "m11", league: "UEFA U21 Qualifying", time: "Today 19:00", home: "North Macedonia U21", away: "Montenegro U21" }, -0.05),
  fb({ id: "m12", league: "UEFA U21 Qualifying", time: "Today 19:30", home: "Armenia U21", away: "Italy U21" }, 0.48),
  fb({ id: "m13", league: "UEFA Women's Champions League", time: "Today 19:45", home: "Austria Wien Women", away: "Inter Women" }, 0.28),
  fb({ id: "m14", league: "UEFA Women's Champions League", time: "Today 19:45", home: "HB Køge Women", away: "Servette Women" }, 0.08),
  fb({ id: "m15", league: "Championnat National", time: "Today 19:45", home: "Bastia", away: "Orléans" }, -0.12),
  fb({ id: "m16", league: "UEFA U21 Qualifying", time: "Today 20:00", home: "Hungary U21", away: "Lithuania U21" }, -0.22),
  fb({ id: "m17", league: "UEFA U21 Qualifying", time: "Today 21:15", home: "San Marino U21", away: "Spain U21" }, 0.7),
  fb({ id: "m18", league: "UEFA Nations League", time: "Today 21:45", home: "Germany", away: "Serbia" }, -0.22),
  fb({ id: "m19", league: "UEFA Nations League", time: "Today 21:45", home: "Greece", away: "Netherlands" }, 0.12),
  fb({ id: "m20", league: "UEFA Nations League", time: "Today 21:45", home: "Denmark", away: "Portugal" }, 0.18),
  fb({ id: "m21", league: "UEFA Nations League", time: "Today 21:45", home: "Wales", away: "Norway" }, 0.2),
  fb({ id: "m22", league: "UEFA Nations League", time: "Today 21:45", home: "Israel", away: "Kosovo" }, -0.1),
  fb({ id: "m23", league: "UEFA Nations League", time: "Today 21:45", home: "Republic of Ireland", away: "Austria" }, 0.04),
  fb({ id: "m24", league: "UEFA Nations League", time: "Today 21:45", home: "Malta", away: "Gibraltar" }, -0.4),
  fb({ id: "m25", league: "UEFA U21 Qualifying", time: "Today 21:45", home: "Northern Ireland U21", away: "Georgia U21" }, 0.06),
  fb({ id: "m26", league: "UEFA Women's Champions League", time: "Today 22:00", home: "Manchester City Women", away: "Real Madrid Women" }, -0.14),
  fb({ id: "m27", league: "UEFA Women's Champions League", time: "Today 22:00", home: "PSG Women", away: "OH Leuven Women" }, -0.3),
  fb({ id: "m28", league: "CONCACAF Nations League", time: "Today 22:00", home: "British Virgin Islands", away: "Montserrat" }, 0.1),
  fb({ id: "m29", league: "CONCACAF Nations League", time: "Today 23:00", home: "US Virgin Islands", away: "Saint Martin" }, -0.02),
  fb({ id: "m30", league: "CONCACAF Nations League", time: "Tonight 00:00", home: "Dominica", away: "Guyana" }, 0.22),
  fb({ id: "m31", league: "CONCACAF Nations League", time: "Tonight 01:00", home: "Curaçao", away: "Trinidad and Tobago" }, -0.08),
  fb({ id: "m32", league: "CONCACAF Nations League", time: "Tonight 02:00", home: "Anguilla", away: "Antigua and Barbuda" }, 0.35),
  fb({ id: "m33", league: "Friendly U20", time: "Today 19:00", home: "Brazil U20", away: "United States U20" }, -0.16),
  fb({ id: "m34", league: "Friendly U23", time: "Today 19:00", home: "Morocco U23", away: "Mali U23" }, -0.12),
  tw({ id: "m35", sport: "basketball", league: "NBL", time: "Today 12:30", home: "Tasmania JackJumpers", away: "Melbourne United" }, 2.05, 1.78),
  tw({ id: "m36", sport: "basketball", league: "BBL", time: "Today 19:00", home: "Science City Jena", away: "SC Rasta Vechta" }, 1.95, 1.85),
  tw({ id: "m37", sport: "basketball", league: "EuroLeague", time: "Today 20:00", home: "Hapoel Tel Aviv", away: "Real Madrid" }, 2.20, 1.68),
  tw({ id: "m38", sport: "basketball", league: "EuroLeague", time: "Today 21:00", home: "Crvena Zvezda", away: "Anadolu Efes" }, 1.88, 1.92),
  tw({ id: "m39", sport: "basketball", league: "EuroLeague", time: "Today 21:30", home: "Virtus Bologna", away: "Olympiacos" }, 2.10, 1.75),
  tw({ id: "m40", sport: "basketball", league: "EuroLeague", time: "Today 21:45", home: "Paris Basketball", away: "Zalgiris Kaunas" }, 1.82, 1.98),
  tw({ id: "m41", sport: "hockey", league: "NHL", time: "Tonight 02:00", home: "New Jersey Devils", away: "Philadelphia Flyers" }, 1.85, 1.95),
  tw({ id: "m42", sport: "hockey", league: "NHL", time: "Tonight 02:00", home: "New York Rangers", away: "Tampa Bay Lightning" }, 2.05, 1.78),
  tw({ id: "m43", sport: "hockey", league: "NHL", time: "Tonight 02:00", home: "Columbus Blue Jackets", away: "Buffalo Sabres" }, 2.15, 1.72),
  tw({ id: "m44", sport: "hockey", league: "NHL", time: "Tonight 03:00", home: "Nashville Predators", away: "Minnesota Wild" }, 2.08, 1.76),
  tw({ id: "m45", sport: "hockey", league: "NHL", time: "Tonight 05:00", home: "Vancouver Canucks", away: "Edmonton Oilers" }, 2.25, 1.65),
  tw({ id: "m46", sport: "tennis", league: "ATP Tokyo", time: "FT", period: "ft", home: "Jaume Munar", away: "Taylor Fritz" }, 2.40, 1.55),
  tw({ id: "m47", sport: "tennis", league: "ATP Tokyo", time: "FT", period: "ft", home: "Luciano Darderi", away: "Casper Ruud", score: "7-6 6-3" }, 2.55, 1.50),
  tw({ id: "m48", sport: "tennis", league: "ATP Tokyo", time: "FT", period: "ft", home: "Kyrian Jacquet", away: "Holger Rune", score: "6-3 6-1" }, 3.10, 1.36)
];

function kickMins(m) {
  if (m.period === "ft") return 99999;
  const mm = String(m.time || "").match(/(\d{1,2}):(\d{2})/);
  if (!mm) return 9000;
  let h = Number(mm[1]);
  const min = Number(mm[2]);
  if (/Tonight/i.test(m.time) && h < 12) h += 24;
  return h * 60 + min;
}
MATCHES.sort((a, b) => kickMins(a) - kickMins(b));

const SPORT_DEFS = [
  { id: "football", name: "Football" },
  { id: "basketball", name: "Basketball" },
  { id: "hockey", name: "Ice Hockey" },
  { id: "tennis", name: "Tennis" },
  { id: "baseball", name: "Baseball" },
  { id: "mma", name: "MMA" }
];

function sportsFrom(matches) {
  return SPORT_DEFS.map((s) => ({
    ...s,
    count: (matches || []).filter((m) => m.sport === s.id).length
  }));
}

const SPORTS = sportsFrom(MATCHES);

const PROMOS = [
  { id: "welcome", title: "First wallet top-up", detail: "Deposit TZS 60,000+ with FimiPay and get TZS 2,000 extra once.", bonus: 2000, minDeposit: 60000 },
  { id: "live", title: "Live extra", detail: "Place a live bet of TZS 1,000+ and get TZS 500 bonus.", bonus: 500, minDeposit: 0 },
  { id: "casino", title: "Games pack", detail: "Claim TZS 1,000 to try Aviator, Mines, Dice or Slots.", bonus: 1000, minDeposit: 0 }
];

const GAMES = [
  { id: "aviator", name: "Aviator", kind: "crash", tag: "live" },
  { id: "mines", name: "Mines", kind: "mines" },
  { id: "dice", name: "Dice", kind: "dice" },
  { id: "slots", name: "Neon Reels", kind: "slots" },
  { id: "roulette", name: "Live Roulette", kind: "roulette" },
  { id: "tv", name: "Studio games", kind: "tv" }
];

function applyRealOdds(markets, real) {
  if (!real) return markets;
  return markets.map((g) => {
    if (g.id === "1x2") {
      return {
        ...g,
        sels: g.sels.map((s) => {
          if (s.key === "1" && real.home) return { ...s, odd: o(real.home) };
          if (s.key === "x" && real.draw) return { ...s, odd: o(real.draw) };
          if (s.key === "2" && real.away) return { ...s, odd: o(real.away) };
          return s;
        })
      };
    }
    if (g.id === "tg" && (real.over || real.under)) {
      return {
        ...g,
        sels: g.sels.map((s) => {
          if ((s.key === "over25" || s.key === "over") && real.over) return { ...s, odd: o(real.over) };
          if ((s.key === "under25" || s.key === "under") && real.under) return { ...s, odd: o(real.under) };
          return s;
        })
      };
    }
    return g;
  });
}

function buildMatch(row, realOdds) {
  const sport = row.sport || "football";
  const shift = ((row.id || "").length % 9) / 20 - 0.2;
  const markets = applyRealOdds(
    sport === "football" ? footballMarkets(shift) : twoWayMarkets(realOdds?.home || 1.9, realOdds?.away || 1.9),
    realOdds
  );
  return pack(
    {
      live: false,
      period: "pre",
      score: "",
      stats: blankStats(),
      ...row
    },
    markets
  );
}

module.exports = {
  MATCHES,
  SPORTS,
  SPORT_DEFS,
  PROMOS,
  GAMES,
  sportsFrom,
  buildMatch,
  footballMarkets,
  twoWayMarkets,
  pack,
  flatten
};
