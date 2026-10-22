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
      ["0-0", 9.5], ["1-0", 7.5], ["0-1", 9.5], ["1-1", 6.5], ["2-0", 10], ["0-2", 13],
      ["2-1", 8], ["1-2", 11], ["2-2", 12], ["3-0", 17], ["0-3", 21], ["3-1", 15],
      ["1-3", 19], ["3-2", 21], ["2-3", 26], ["3-3", 41]
    ].map(([label, odd]) => ({ key: "cs" + label.replace("-", ""), label, odd: o(odd) }))),
    group("exact", "Exact goals", [
      { key: "eg0", label: "0", odd: o(8.5) },
      { key: "eg1", label: "1", odd: o(4.2) },
      { key: "eg2", label: "2", odd: o(3.4) },
      { key: "eg3", label: "3", odd: o(4.6) },
      { key: "eg4", label: "4+", odd: o(5.5) }
    ]),
    group("totals_more", "Total goals lines", [
      { key: "over05", label: "Over 0.5", odd: o(1.08) },
      { key: "under05", label: "Under 0.5", odd: o(7.5) },
      { key: "over45", label: "Over 4.5", odd: o(6.2) },
      { key: "under45", label: "Under 4.5", odd: o(1.12) },
      { key: "over55", label: "Over 5.5", odd: o(11) },
      { key: "under55", label: "Under 5.5", odd: o(1.05) }
    ]),
    group("team_goals", "Team totals", [
      { key: "th15", label: "Home over 1.5", odd: o(2.35) },
      { key: "ta15", label: "Away over 1.5", odd: o(3.10) },
      { key: "th05", label: "Home over 0.5", odd: o(1.35) },
      { key: "ta05", label: "Away over 0.5", odd: o(1.62) }
    ]),
    group("wtn", "Win to nil", [
      { key: "wtn1", label: "Home", odd: o(3.4) },
      { key: "wtn2", label: "Away", odd: o(5.2) }
    ]),
    group("csheet", "Clean sheet", [
      { key: "csy1", label: "Home yes", odd: o(2.6) },
      { key: "csy2", label: "Away yes", odd: o(3.8) }
    ]),
    group("hcap", "Handicap", [
      { key: "h15h", label: "Home -1.5", odd: o(3.2) },
      { key: "h15a", label: "Away +1.5", odd: o(1.32) },
      { key: "h25h", label: "Home -2.5", odd: o(6.4) },
      { key: "h25a", label: "Away +2.5", odd: o(1.10) }
    ]),
    group("htft", "Half-time / full-time", [
      { key: "hf11", label: "1/1", odd: o(3.1) },
      { key: "hfx1", label: "X/1", odd: o(5.4) },
      { key: "hf21", label: "2/1", odd: o(21) },
      { key: "hf1x", label: "1/X", odd: o(15) },
      { key: "hfxx", label: "X/X", odd: o(6.2) },
      { key: "hf2x", label: "2/X", odd: o(16) },
      { key: "hf12", label: "1/2", odd: o(26) },
      { key: "hfx2", label: "X/2", odd: o(7.5) },
      { key: "hf22", label: "2/2", odd: o(5.8) }
    ]),
    group("htg", "First-half goals", [
      { key: "ht_o05", label: "Over 0.5", odd: o(1.45) },
      { key: "ht_u05", label: "Under 0.5", odd: o(2.55) },
      { key: "ht_o15", label: "Over 1.5", odd: o(2.9) },
      { key: "ht_u15", label: "Under 1.5", odd: o(1.38) }
    ]),
    group("btts_half", "Both teams to score in 1st half", [
      { key: "btts1h", label: "Yes", odd: o(4.4) },
      { key: "btts1h_n", label: "No", odd: o(1.18) }
    ]),
    group("result_btts", "Result and both teams score", [
      { key: "1_gg", label: "Home & yes", odd: o(3.6) },
      { key: "x_gg", label: "Draw & yes", odd: o(4.8) },
      { key: "2_gg", label: "Away & yes", odd: o(6.5) }
    ]),
    group("result_ou", "Result and over 2.5", [
      { key: "1_o25", label: "Home & over", odd: o(3.3) },
      { key: "x_o25", label: "Draw & over", odd: o(5.1) },
      { key: "2_o25", label: "Away & over", odd: o(6.8) }
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

function withPrice(markets, key, odd) {
  const label = key.startsWith("cs") && key.length === 4 ? key[2] + "-" + key[3] : key;
  return markets.map((g) => {
    const has = g.sels.some((s) => s.key === key);
    if (!has && g.id !== "cs") return g;
    const sels = has
      ? g.sels.map((s) => (s.key === key ? { ...s, odd: o(odd) } : s))
      : [...g.sels, { key, label, odd: o(odd) }];
    return { ...g, sels };
  });
}

function demoMatch(row, key, odd) {
  const body = {
    source: "demo",
    sport: "football",
    live: false,
    period: "pre",
    score: "",
    stats: blankStats(),
    day: "2026-10-14",
    time: "16:00",
    kickMin: 16 * 60,
    ...row
  };
  body.kickLabel = body.time;
  return pack(body, withPrice(footballMarkets(0), key, odd));
}

const DEMO_MATCHES = [
  demoMatch({
    id: "demo-cf-city",
    league: "",
    home: "CF City",
    away: "Atlético Heroes",
    script: { home: 1, away: 0, htHome: 1, htAway: 0, times: [{ min: 5, side: "home" }] }
  }, "cs10", 10.97),
  demoMatch({
    id: "demo-rc-wanderers",
    league: "Liga Primera",
    home: "RC Wanderers",
    away: "RC Athletic",
    script: {
      home: 3,
      away: 1,
      htHome: 3,
      htAway: 1,
      times: [
        { min: 3, side: "home" },
        { min: 6, side: "home" },
        { min: 11, side: "away" },
        { min: 14, side: "home" }
      ]
    }
  }, "cs31", 22.07),
  demoMatch({
    id: "demo-drino-contum",
    league: "Elite Star League",
    home: "Drino Contum",
    away: "Latrivia",
    time: "22:45",
    kickMin: 22 * 60 + 45,
    script: {
      home: 5,
      away: 2,
      htHome: 3,
      htAway: 1,
      times: [
        { min: 7, side: "home" },
        { min: 18, side: "away" },
        { min: 33, side: "home" },
        { min: 44, side: "home" },
        { min: 58, side: "home" },
        { min: 71, side: "away" },
        { min: 84, side: "home" }
      ]
    }
  }, "cs52", 18),
  demoMatch({
    id: "demo-asec-philipe",
    league: "Elite Star League",
    home: "Asec Philipe",
    away: "Mamec SC",
    day: "2026-10-15",
    time: "16:00",
    kickMin: 16 * 60,
    script: {
      home: 4,
      away: 2,
      htHome: 2,
      htAway: 1,
      times: [
        { min: 9, side: "home" },
        { min: 24, side: "away" },
        { min: 41, side: "home" },
        { min: 58, side: "home" },
        { min: 74, side: "away" },
        { min: 88, side: "home" }
      ]
    }
  }, "cs42", 117),
  demoMatch({
    id: "demo-black-rock",
    league: "Elite Star League",
    home: "Black Rock",
    away: "Saint SC SC",
    day: "2026-10-15",
    time: "22:45",
    kickMin: 22 * 60 + 45,
    script: {
      home: 4,
      away: 3,
      htHome: 2,
      htAway: 2,
      times: [
        { min: 8, side: "home" },
        { min: 18, side: "away" },
        { min: 34, side: "home" },
        { min: 43, side: "away" },
        { min: 59, side: "home" },
        { min: 72, side: "away" },
        { min: 85, side: "home" }
      ]
    }
  }, "cs43", 117),
  demoMatch({
    id: "demo-flavian-bay",
    league: "Elite Star League",
    home: "Flavian Bay",
    away: "Jupiler SC",
    day: "2026-10-16",
    time: "16:00",
    kickMin: 16 * 60,
    script: {
      home: 2,
      away: 3,
      htHome: 1,
      htAway: 2,
      times: [
        { min: 11, side: "home" },
        { min: 24, side: "away" },
        { min: 39, side: "away" },
        { min: 62, side: "home" },
        { min: 78, side: "away" }
      ]
    }
  }, "cs23", 137),
  demoMatch({
    id: "demo-viper-united",
    league: "Elite Star League",
    home: "Viper United",
    away: "Shangai Fox SC",
    day: "2026-10-16",
    time: "22:45",
    kickMin: 22 * 60 + 45,
    script: {
      home: 2,
      away: 6,
      htHome: 1,
      htAway: 3,
      times: [
        { min: 11, side: "home" },
        { min: 22, side: "away" },
        { min: 33, side: "away" },
        { min: 44, side: "away" },
        { min: 58, side: "home" },
        { min: 66, side: "away" },
        { min: 77, side: "away" },
        { min: 88, side: "away" }
      ]
    }
  }, "cs26", 90),
  demoMatch({
    id: "demo-castle-fc",
    league: "Elite Star League",
    home: "Castle FC",
    away: "Albert SEC",
    day: "2026-10-17",
    time: "22:45",
    kickMin: 22 * 60 + 45,
    script: {
      home: 1,
      away: 5,
      htHome: 1,
      htAway: 2,
      times: [
        { min: 8, side: "home" },
        { min: 21, side: "away" },
        { min: 36, side: "away" },
        { min: 57, side: "away" },
        { min: 73, side: "away" },
        { min: 86, side: "away" }
      ]
    }
  }, "cs15", 10),
  demoMatch({
    id: "demo-viper-fc",
    league: "Elite Star League",
    home: "Viper FC",
    away: "Relay FC SC",
    day: "2026-10-17",
    time: "22:45",
    kickMin: 22 * 60 + 45,
    script: {
      home: 4,
      away: 4,
      htHome: 2,
      htAway: 2,
      times: [
        { min: 9, side: "home" },
        { min: 18, side: "away" },
        { min: 31, side: "home" },
        { min: 43, side: "away" },
        { min: 59, side: "home" },
        { min: 68, side: "away" },
        { min: 77, side: "home" },
        { min: 89, side: "away" }
      ]
    }
  }, "cs44", 15),
  demoMatch({
    id: "demo-picfar-fc",
    league: "Elite Star League",
    home: "Picfar FC",
    away: "Vosco SEC",
    day: "2026-10-18",
    time: "16:00",
    kickMin: 16 * 60,
    script: {
      home: 2,
      away: 4,
      htHome: 1,
      htAway: 2,
      times: [
        { min: 7, side: "home" },
        { min: 19, side: "away" },
        { min: 34, side: "away" },
        { min: 58, side: "home" },
        { min: 71, side: "away" },
        { min: 84, side: "away" }
      ]
    }
  }, "cs24", 10),
  demoMatch({
    id: "demo-dama-fc",
    league: "Elite Star League",
    home: "Dama FC",
    away: "Pajo Ray SC",
    day: "2026-10-18",
    time: "16:00",
    kickMin: 16 * 60,
    script: {
      home: 4,
      away: 5,
      htHome: 2,
      htAway: 2,
      times: [
        { min: 6, side: "home" },
        { min: 14, side: "away" },
        { min: 28, side: "home" },
        { min: 41, side: "away" },
        { min: 55, side: "home" },
        { min: 63, side: "away" },
        { min: 72, side: "home" },
        { min: 81, side: "away" },
        { min: 88, side: "away" }
      ]
    }
  }, "cs45", 14),
  demoMatch({
    id: "demo-alkaid-diy",
    league: "Elite Star League",
    home: "Alkaid DIY",
    away: "Frey United",
    day: "2026-10-18",
    time: "22:45",
    kickMin: 22 * 60 + 45,
    script: {
      home: 6,
      away: 4,
      htHome: 3,
      htAway: 2,
      times: [
        { min: 7, side: "home" },
        { min: 14, side: "away" },
        { min: 22, side: "home" },
        { min: 31, side: "away" },
        { min: 41, side: "home" },
        { min: 55, side: "home" },
        { min: 66, side: "away" },
        { min: 74, side: "home" },
        { min: 83, side: "away" },
        { min: 89, side: "home" }
      ]
    }
  }, "cs64", 8),
  demoMatch({
    id: "demo-hijan-fc",
    league: "Elite Star League",
    home: "Hijan FC",
    away: "Duma FC SC",
    day: "2026-10-18",
    time: "22:45",
    kickMin: 22 * 60 + 45,
    script: {
      home: 4,
      away: 1,
      htHome: 2,
      htAway: 1,
      times: [
        { min: 8, side: "home" },
        { min: 19, side: "away" },
        { min: 36, side: "home" },
        { min: 58, side: "home" },
        { min: 79, side: "home" }
      ]
    }
  }, "cs41", 13),
  demoMatch({
    id: "demo-papay",
    league: "Elite Star League",
    home: "Papay",
    away: "Kisty",
    day: "2026-10-19",
    time: "16:00",
    kickMin: 16 * 60,
    script: {
      home: 5,
      away: 1,
      htHome: 2,
      htAway: 1,
      times: [
        { min: 8, side: "home" },
        { min: 18, side: "away" },
        { min: 33, side: "home" },
        { min: 56, side: "home" },
        { min: 71, side: "home" },
        { min: 86, side: "home" }
      ]
    }
  }, "cs51", 10),
  demoMatch({
    id: "demo-frondfc",
    league: "Elite Star League",
    home: "Frondfc",
    away: "Vewry FC SC",
    day: "2026-10-19",
    time: "16:00",
    kickMin: 16 * 60,
    script: {
      home: 6,
      away: 4,
      htHome: 3,
      htAway: 2,
      times: [
        { min: 7, side: "home" },
        { min: 15, side: "away" },
        { min: 24, side: "home" },
        { min: 35, side: "away" },
        { min: 42, side: "home" },
        { min: 55, side: "home" },
        { min: 64, side: "away" },
        { min: 73, side: "home" },
        { min: 82, side: "away" },
        { min: 88, side: "home" }
      ]
    }
  }, "cs64", 12.7),
  demoMatch({
    id: "demo-yustey-fc",
    league: "Elite Star League",
    home: "Yustey FC",
    away: "Filbert Bay",
    day: "2026-10-19",
    time: "22:45",
    kickMin: 22 * 60 + 45,
    script: {
      home: 4,
      away: 5,
      htHome: 2,
      htAway: 2,
      times: [
        { min: 8, side: "home" },
        { min: 16, side: "away" },
        { min: 29, side: "home" },
        { min: 41, side: "away" },
        { min: 56, side: "home" },
        { min: 67, side: "away" },
        { min: 74, side: "home" },
        { min: 83, side: "away" },
        { min: 89, side: "away" }
      ]
    }
  }, "cs45", 10),
  demoMatch({
    id: "demo-frezee",
    league: "Elite Star League",
    home: "Frezee",
    away: "Banca FC SC",
    day: "2026-10-19",
    time: "22:45",
    kickMin: 22 * 60 + 45,
    script: {
      home: 3,
      away: 1,
      htHome: 2,
      htAway: 1,
      times: [
        { min: 7, side: "home" },
        { min: 19, side: "away" },
        { min: 38, side: "home" },
        { min: 71, side: "home" }
      ]
    }
  }, "cs31", 17),
  demoMatch({
    id: "demo-atletico-athetic",
    league: "Crown Football League",
    home: "Atletico Athetic",
    away: "Santa Eadles",
    day: "2026-10-20",
    time: "16:00",
    kickMin: 16 * 60,
    script: {
      home: 6,
      away: 1,
      htHome: 3,
      htAway: 1,
      times: [
        { min: 8, side: "home" },
        { min: 18, side: "away" },
        { min: 29, side: "home" },
        { min: 41, side: "home" },
        { min: 56, side: "home" },
        { min: 72, side: "home" },
        { min: 86, side: "home" }
      ]
    }
  }, "cs61", 10),
  demoMatch({
    id: "demo-millbrook",
    league: "Crown Football League",
    home: "Millbrook",
    away: "Eastvale Town SC",
    day: "2026-10-20",
    time: "16:00",
    kickMin: 16 * 60,
    script: {
      home: 4,
      away: 4,
      htHome: 2,
      htAway: 2,
      times: [
        { min: 7, side: "home" },
        { min: 16, side: "away" },
        { min: 31, side: "home" },
        { min: 43, side: "away" },
        { min: 58, side: "home" },
        { min: 67, side: "away" },
        { min: 76, side: "home" },
        { min: 88, side: "away" }
      ]
    }
  }, "cs44", 23),
  demoMatch({
    id: "demo-emerald-fc",
    league: "Frontier Football League",
    home: "Emerald FC",
    away: "Eastvale Hawks",
    day: "2026-10-20",
    time: "22:45",
    kickMin: 22 * 60 + 45,
    script: {
      home: 2,
      away: 4,
      htHome: 1,
      htAway: 2,
      times: [
        { min: 9, side: "home" },
        { min: 18, side: "away" },
        { min: 34, side: "away" },
        { min: 58, side: "home" },
        { min: 71, side: "away" },
        { min: 84, side: "away" }
      ]
    }
  }, "cs24", 10),
  demoMatch({
    id: "demo-greenfield-hawks",
    league: "Frontier Football League",
    home: "Greenfield Hawks",
    away: "Whitecrest Athletic SC",
    day: "2026-10-20",
    time: "22:45",
    kickMin: 22 * 60 + 45,
    script: {
      home: 3,
      away: 7,
      htHome: 2,
      htAway: 3,
      times: [
        { min: 7, side: "home" },
        { min: 15, side: "away" },
        { min: 26, side: "home" },
        { min: 37, side: "away" },
        { min: 44, side: "away" },
        { min: 55, side: "home" },
        { min: 63, side: "away" },
        { min: 72, side: "away" },
        { min: 81, side: "away" },
        { min: 88, side: "away" }
      ]
    }
  }, "cs37", 13),
  demoMatch({
    id: "demo-lazio-city",
    league: "Liga Primera Football League",
    home: "Lazio City",
    away: "Lazio Nuova",
    day: "2026-10-21",
    time: "16:00",
    kickMin: 16 * 60,
    script: {
      home: 3,
      away: 4,
      htHome: 2,
      htAway: 2,
      times: [
        { min: 8, side: "home" },
        { min: 16, side: "away" },
        { min: 29, side: "home" },
        { min: 41, side: "away" },
        { min: 58, side: "home" },
        { min: 71, side: "away" },
        { min: 84, side: "away" }
      ]
    }
  }, "cs34", 10),
  demoMatch({
    id: "demo-real-lions",
    league: "Liga Primera Football League",
    home: "Real Lions",
    away: "Sporting Athletic",
    day: "2026-10-21",
    time: "16:00",
    kickMin: 16 * 60,
    script: {
      home: 2,
      away: 5,
      htHome: 1,
      htAway: 3,
      times: [
        { min: 7, side: "home" },
        { min: 15, side: "away" },
        { min: 28, side: "away" },
        { min: 42, side: "away" },
        { min: 56, side: "home" },
        { min: 67, side: "away" },
        { min: 81, side: "away" }
      ]
    }
  }, "cs25", 16),
  demoMatch({
    id: "demo-lus-eagles",
    league: "Liga Primera Football League",
    home: "Lus Eagles",
    away: "US Royals",
    day: "2026-10-21",
    time: "22:45",
    kickMin: 22 * 60 + 45,
    script: {
      home: 5,
      away: 3,
      htHome: 2,
      htAway: 2,
      times: [
        { min: 8, side: "home" },
        { min: 16, side: "away" },
        { min: 29, side: "home" },
        { min: 41, side: "away" },
        { min: 55, side: "home" },
        { min: 67, side: "home" },
        { min: 78, side: "away" },
        { min: 88, side: "home" }
      ]
    }
  }, "cs53", 10),
  demoMatch({
    id: "demo-serie-ouro",
    league: "Liga Primera Football League",
    home: "Serie Ouro",
    away: "Palmeras Titans",
    day: "2026-10-21",
    time: "22:45",
    kickMin: 22 * 60 + 45,
    script: {
      home: 4,
      away: 1,
      htHome: 2,
      htAway: 1,
      times: [
        { min: 7, side: "home" },
        { min: 19, side: "away" },
        { min: 36, side: "home" },
        { min: 58, side: "home" },
        { min: 74, side: "home" }
      ]
    }
  }, "cs41", 11.6),
  demoMatch({
    id: "demo-vfb-eagles",
    league: "Kaiser Championship Football League",
    home: "VFB Eagles",
    away: "US SC Stars",
    day: "2026-10-22",
    time: "16:45",
    kickMin: 16 * 60 + 45,
    script: {
      home: 3,
      away: 1,
      htHome: 2,
      htAway: 1,
      times: [
        { min: 8, side: "home" },
        { min: 19, side: "away" },
        { min: 34, side: "home" },
        { min: 61, side: "home" }
      ]
    }
  }, "cs31", 10),
  demoMatch({
    id: "demo-gremio-titans",
    league: "Kaiser Championship Football League",
    home: "Gremio Titans",
    away: "Olympic SC",
    day: "2026-10-22",
    time: "16:45",
    kickMin: 16 * 60 + 45,
    script: {
      home: 6,
      away: 2,
      htHome: 3,
      htAway: 1,
      times: [
        { min: 7, side: "home" },
        { min: 15, side: "away" },
        { min: 26, side: "home" },
        { min: 40, side: "home" },
        { min: 55, side: "home" },
        { min: 66, side: "home" },
        { min: 78, side: "away" },
        { min: 86, side: "home" }
      ]
    }
  }, "cs62", 12),
  demoMatch({
    id: "demo-pingin",
    league: "Brasielra Championship Football League",
    home: "Pingin",
    away: "US Memisa",
    day: "2026-10-22",
    time: "22:45",
    kickMin: 22 * 60 + 45,
    script: {
      home: 4, away: 3, htHome: 2, htAway: 2,
      times: [
        { min: 8, side: "home" }, { min: 16, side: "away" }, { min: 29, side: "home" },
        { min: 41, side: "away" }, { min: 58, side: "home" }, { min: 71, side: "away" },
        { min: 84, side: "home" }
      ]
    }
  }, "cs43", 10),
  demoMatch({
    id: "demo-vesca-city",
    league: "Brasielra Championship Football League",
    home: "Vesca City",
    away: "Fendi SC",
    day: "2026-10-22",
    time: "22:45",
    kickMin: 22 * 60 + 45,
    script: {
      home: 3, away: 1, htHome: 2, htAway: 1,
      times: [
        { min: 7, side: "home" }, { min: 18, side: "away" },
        { min: 35, side: "home" }, { min: 62, side: "home" }
      ]
    }
  }, "cs31", 13),
  demoMatch({
    id: "demo-vegas",
    league: "Brasielra Championship Football League",
    home: "Vegas",
    away: "Pawapaw SC",
    day: "2026-10-23",
    time: "16:00",
    kickMin: 16 * 60,
    script: {
      home: 3, away: 6, htHome: 1, htAway: 3,
      times: [
        { min: 8, side: "home" }, { min: 14, side: "away" }, { min: 25, side: "away" },
        { min: 39, side: "away" }, { min: 55, side: "home" }, { min: 64, side: "away" },
        { min: 73, side: "home" }, { min: 82, side: "away" }, { min: 88, side: "away" }
      ]
    }
  }, "cs36", 10),
  demoMatch({
    id: "demo-city-sk",
    league: "Brasielra Championship Football League",
    home: "City SK",
    away: "Cent Sky",
    day: "2026-10-23",
    time: "16:00",
    kickMin: 16 * 60,
    script: {
      home: 2, away: 1, htHome: 1, htAway: 1,
      times: [
        { min: 11, side: "home" }, { min: 33, side: "away" }, { min: 68, side: "home" }
      ]
    }
  }, "cs21", 10),
  demoMatch({
    id: "demo-eagles",
    league: "Brasielra Championship Football League",
    home: "Eagles",
    away: "Sky Hero",
    day: "2026-10-23",
    time: "22:45",
    kickMin: 22 * 60 + 45,
    script: {
      home: 3, away: 1, htHome: 1, htAway: 1,
      times: [
        { min: 9, side: "home" }, { min: 27, side: "away" },
        { min: 58, side: "home" }, { min: 77, side: "home" }
      ]
    }
  }, "cs31", 10),
  demoMatch({
    id: "demo-zesc",
    league: "Brasielra Championship Football League",
    home: "Zesc",
    away: "Palmay",
    day: "2026-10-23",
    time: "22:45",
    kickMin: 22 * 60 + 45,
    script: {
      home: 2, away: 4, htHome: 1, htAway: 2,
      times: [
        { min: 7, side: "home" }, { min: 16, side: "away" }, { min: 38, side: "away" },
        { min: 61, side: "home" }, { min: 74, side: "away" }, { min: 86, side: "away" }
      ]
    }
  }, "cs24", 10),
  demoMatch({
    id: "demo-kili",
    league: "Brasielra Championship Football League",
    home: "Kili",
    away: "Frend",
    day: "2026-10-24",
    time: "16:00",
    kickMin: 16 * 60,
    script: {
      home: 2, away: 1, htHome: 1, htAway: 1,
      times: [
        { min: 10, side: "home" }, { min: 29, side: "away" }, { min: 64, side: "home" }
      ]
    }
  }, "cs21", 10),
  demoMatch({
    id: "demo-ipsky",
    league: "Brasielra Championship Football League",
    home: "Ipsky",
    away: "Zeco United",
    day: "2026-10-24",
    time: "16:00",
    kickMin: 16 * 60,
    script: {
      home: 4, away: 1, htHome: 2, htAway: 1,
      times: [
        { min: 8, side: "home" }, { min: 21, side: "away" },
        { min: 36, side: "home" }, { min: 59, side: "home" }, { min: 80, side: "home" }
      ]
    }
  }, "cs41", 10)
];

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
  { id: "welcome", title: "First wallet top-up", detail: "Deposit TZS 60,000+ with Harak Pay and get TZS 2,000 extra once.", bonus: 2000, minDeposit: 60000 },
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

function overlayRealOdds(match, real) {
  if (!match || match.source === "demo" || !real || !match.markets) return match;
  const markets = applyRealOdds(match.markets, real);
  return {
    ...match,
    priced: true,
    markets,
    odds: flatten(markets),
    extra: extraCount(markets)
  };
}

function fact(n) {
  let x = 1;
  for (let i = 2; i <= n; i += 1) x *= i;
  return x;
}

function pois(k, lambda) {
  if (!(lambda >= 0)) return 0;
  return (Math.exp(-lambda) * Math.pow(lambda, k)) / fact(k);
}

function fairProbs(home, draw, away) {
  const inv = [1 / home, 1 / draw, 1 / away];
  const sum = inv[0] + inv[1] + inv[2];
  return { p1: inv[0] / sum, px: inv[1] / sum, p2: inv[2] / sum };
}

function fitLambdas(p1, px, p2) {
  let best = { lh: 1.2, la: 1.1 };
  let bestErr = Infinity;
  for (let total = 16; total <= 34; total += 1) {
    for (let share = 15; share <= 85; share += 2) {
      const lh = (total / 10) * (share / 100);
      const la = total / 10 - lh;
      let h = 0;
      let d = 0;
      let a = 0;
      for (let i = 0; i <= 7; i += 1) {
        for (let j = 0; j <= 7; j += 1) {
          const p = pois(i, lh) * pois(j, la);
          if (i > j) h += p;
          else if (i === j) d += p;
          else a += p;
        }
      }
      const err = (h - p1) ** 2 + (d - px) ** 2 + (a - p2) ** 2;
      if (err < bestErr) {
        bestErr = err;
        best = { lh, la };
      }
    }
  }
  return best;
}

function priceOf(prob) {
  if (!(prob > 0.004)) return 51;
  const n = (1 / prob) * 0.93;
  if (!Number.isFinite(n)) return 51;
  return o(Math.min(51, Math.max(1.02, n)));
}

function goalMatrix(lh, la) {
  const rows = [];
  for (let i = 0; i <= 7; i += 1) {
    rows[i] = [];
    for (let j = 0; j <= 7; j += 1) rows[i][j] = pois(i, lh) * pois(j, la);
  }
  return rows;
}

function sumGoals(rows, pred) {
  let n = 0;
  for (let i = 0; i < rows.length; i += 1) {
    for (let j = 0; j < rows[i].length; j += 1) {
      if (pred(i, j)) n += rows[i][j];
    }
  }
  return n;
}

function halfTimeFullTime(lh, la) {
  const buckets = { 11: 0, x1: 0, 21: 0, "1x": 0, xx: 0, "2x": 0, 12: 0, x2: 0, 22: 0 };
  const lh1 = lh * 0.45;
  const la1 = la * 0.45;
  const lh2 = lh * 0.55;
  const la2 = la * 0.55;
  for (let htH = 0; htH <= 4; htH += 1) {
    for (let htA = 0; htA <= 4; htA += 1) {
      for (let sh = 0; sh <= 5; sh += 1) {
        for (let sa = 0; sa <= 5; sa += 1) {
          const p = pois(htH, lh1) * pois(htA, la1) * pois(sh, lh2) * pois(sa, la2);
          const ftH = htH + sh;
          const ftA = htA + sa;
          const ht = htH > htA ? "1" : htH === htA ? "x" : "2";
          const ft = ftH > ftA ? "1" : ftH === ftA ? "x" : "2";
          const key = ht + ft;
          buckets[key] += p;
        }
      }
    }
  }
  return buckets;
}

function coherentMarkets(real) {
  const home = Number(real.home);
  const draw = Number(real.draw);
  const away = Number(real.away);
  const markets = footballMarkets(0);
  if (!(home > 1 && draw > 1 && away > 1)) return markets;
  const { p1, px, p2 } = fairProbs(home, draw, away);
  const { lh, la } = fitLambdas(p1, px, p2);
  const rows = goalMatrix(lh, la);
  const half = goalMatrix(lh * 0.45, la * 0.45);
  const both = sumGoals(rows, (i, j) => i > 0 && j > 0);
  const htft = halfTimeFullTime(lh, la);
  const goal = lh + la + 0.45;
  const prices = {
    1: home,
    x: draw,
    2: away,
    "1x": priceOf(p1 + px),
    12: priceOf(p1 + p2),
    x2: priceOf(px + p2),
    dnb1: priceOf(p1 / (p1 + p2)),
    dnb2: priceOf(p2 / (p1 + p2)),
    btts_y: priceOf(both),
    btts_n: priceOf(1 - both),
    ng1: priceOf(lh / goal),
    ng0: priceOf(0.45 / goal),
    ng2: priceOf(la / goal),
    over05: priceOf(sumGoals(rows, (i, j) => i + j >= 1)),
    under05: priceOf(sumGoals(rows, (i, j) => i + j === 0)),
    over15: priceOf(sumGoals(rows, (i, j) => i + j >= 2)),
    under15: priceOf(sumGoals(rows, (i, j) => i + j <= 1)),
    over25: real.over > 1 ? o(real.over) : priceOf(sumGoals(rows, (i, j) => i + j >= 3)),
    under25: real.under > 1 ? o(real.under) : priceOf(sumGoals(rows, (i, j) => i + j <= 2)),
    over35: priceOf(sumGoals(rows, (i, j) => i + j >= 4)),
    under35: priceOf(sumGoals(rows, (i, j) => i + j <= 3)),
    over45: priceOf(sumGoals(rows, (i, j) => i + j >= 5)),
    under45: priceOf(sumGoals(rows, (i, j) => i + j <= 4)),
    over55: priceOf(sumGoals(rows, (i, j) => i + j >= 6)),
    under55: priceOf(sumGoals(rows, (i, j) => i + j <= 5)),
    ah_h: o(home),
    ah_a: priceOf(px + p2),
    ht1: priceOf(sumGoals(half, (i, j) => i > j)),
    htx: priceOf(sumGoals(half, (i, j) => i === j)),
    ht2: priceOf(sumGoals(half, (i, j) => j > i)),
    eg0: priceOf(sumGoals(rows, (i, j) => i + j === 0)),
    eg1: priceOf(sumGoals(rows, (i, j) => i + j === 1)),
    eg2: priceOf(sumGoals(rows, (i, j) => i + j === 2)),
    eg3: priceOf(sumGoals(rows, (i, j) => i + j === 3)),
    eg4: priceOf(sumGoals(rows, (i, j) => i + j >= 4)),
    th15: priceOf(sumGoals(rows, (i) => i >= 2)),
    ta15: priceOf(sumGoals(rows, (i, j) => j >= 2)),
    th05: priceOf(sumGoals(rows, (i) => i >= 1)),
    ta05: priceOf(sumGoals(rows, (i, j) => j >= 1)),
    wtn1: priceOf(sumGoals(rows, (i, j) => i > 0 && j === 0)),
    wtn2: priceOf(sumGoals(rows, (i, j) => j > 0 && i === 0)),
    csy1: priceOf(sumGoals(rows, (i, j) => j === 0)),
    csy2: priceOf(sumGoals(rows, (i) => i === 0)),
    h15h: priceOf(sumGoals(rows, (i, j) => i >= j + 2)),
    h15a: priceOf(1 - sumGoals(rows, (i, j) => i >= j + 2)),
    h25h: priceOf(sumGoals(rows, (i, j) => i >= j + 3)),
    h25a: priceOf(1 - sumGoals(rows, (i, j) => i >= j + 3)),
    hf11: priceOf(htft["11"]),
    hfx1: priceOf(htft.x1),
    hf21: priceOf(htft["21"]),
    hf1x: priceOf(htft["1x"]),
    hfxx: priceOf(htft.xx),
    hf2x: priceOf(htft["2x"]),
    hf12: priceOf(htft["12"]),
    hfx2: priceOf(htft.x2),
    hf22: priceOf(htft["22"]),
    ht_o05: priceOf(sumGoals(half, (i, j) => i + j >= 1)),
    ht_u05: priceOf(sumGoals(half, (i, j) => i + j === 0)),
    ht_o15: priceOf(sumGoals(half, (i, j) => i + j >= 2)),
    ht_u15: priceOf(sumGoals(half, (i, j) => i + j <= 1)),
    btts1h: priceOf(sumGoals(half, (i, j) => i > 0 && j > 0)),
    btts1h_n: priceOf(1 - sumGoals(half, (i, j) => i > 0 && j > 0)),
    "1_gg": priceOf(sumGoals(rows, (i, j) => i > j && j > 0)),
    x_gg: priceOf(sumGoals(rows, (i, j) => i === j && i > 0)),
    "2_gg": priceOf(sumGoals(rows, (i, j) => j > i && i > 0)),
    "1_o25": priceOf(sumGoals(rows, (i, j) => i > j && i + j >= 3)),
    x_o25: priceOf(sumGoals(rows, (i, j) => i === j && i + j >= 3)),
    "2_o25": priceOf(sumGoals(rows, (i, j) => j > i && i + j >= 3))
  };
  for (const [label] of [
    ["0-0"], ["1-0"], ["0-1"], ["1-1"], ["2-0"], ["0-2"], ["2-1"], ["1-2"],
    ["2-2"], ["3-0"], ["0-3"], ["3-1"], ["1-3"], ["3-2"], ["2-3"], ["3-3"]
  ]) {
    const [homeGoals, awayGoals] = label.split("-").map(Number);
    prices["cs" + label.replace("-", "")] = priceOf(rows[homeGoals] && rows[homeGoals][awayGoals] ? rows[homeGoals][awayGoals] : 0);
  }
  return markets.map((g) => ({
    ...g,
    sels: g.sels.map((s) => (prices[s.key] > 1 ? { ...s, odd: o(prices[s.key]) } : s))
  }));
}

function overlayCoherentOdds(match, real) {
  if (!match || match.source === "demo" || !real) return match;
  const markets = coherentMarkets(real);
  return {
    ...match,
    priced: true,
    markets,
    odds: flatten(markets),
    extra: extraCount(markets)
  };
}

module.exports = {
  MATCHES,
  DEMO_MATCHES,
  SPORTS,
  SPORT_DEFS,
  PROMOS,
  GAMES,
  sportsFrom,
  buildMatch,
  footballMarkets,
  twoWayMarkets,
  pack,
  flatten,
  overlayRealOdds,
  overlayCoherentOdds
};
