// Deterministic, rule-based news scoring -- implements the SPECIAL NEWS
// LOGIC table literally (OPEC cut/increase, inventory draw/build, war/
// peace, pipeline/refinery, dollar strength, cold/warm winter, LNG exports,
// storage vs prior period) as keyword matching against headline+summary
// text, rather than an LLM classification call per article. This matches
// the rest of this app's own design philosophy (established across Best
// Call, AI Verify Pro, etc.): a deterministic engine decides the score,
// Workers AI is only ever used afterward to write a plain-English summary
// of what the engine already concluded -- never to invent the score itself,
// which would make the same headline score differently on every request.

export type AffectedMarket = "CRUDE" | "NG" | "BOTH";
export type ExpectedMove = "very_strong_bullish" | "bullish" | "neutral" | "bearish" | "very_strong_bearish";
export type TimeImpact = "15m" | "30m" | "1h" | "4h" | "1d" | "1w";

export interface RawNewsArticle {
  headline: string;
  summary: string;
  source: string;
  publishedAt: string;
  url: string;
}

export interface ScoredNewsArticle extends RawNewsArticle {
  affectedMarket: AffectedMarket;
  importance: number; // 0-100
  bullishScore: number; // 0-100
  bearishScore: number; // 0-100
  confidence: number; // 0-100
  expectedMove: ExpectedMove;
  timeImpact: TimeImpact;
  matchedRules: string[];
}

interface Rule {
  key: string;
  patterns: RegExp[];
  market: AffectedMarket;
  bullish: number; // -100..100, positive = bullish, negative = bearish
  importance: number;
  timeImpact: TimeImpact;
}

const TIME_ORDER: Record<TimeImpact, number> = { "15m": 0, "30m": 1, "1h": 2, "4h": 3, "1d": 4, "1w": 5 };

const RULES: Rule[] = [
  // Deliberately requires "production"/"output" near the cut/increase verb
  // (either word order) rather than matching "cut"/"increase" alone right
  // after "OPEC" -- otherwise "OPEC cuts demand forecast" (a very different,
  // NOT bullish story) would false-positive as a production cut.
  {
    key: "opecCut",
    patterns: [/opec\+?.{0,20}(production|output).{0,15}\bcuts?\b/i, /opec\+?.{0,20}\bcuts?\b.{0,15}(production|output)/i, /opec\+?.{0,20}reduc.{0,15}(production|output)/i],
    market: "CRUDE",
    bullish: 70,
    importance: 85,
    timeImpact: "4h",
  },
  {
    key: "opecIncrease",
    patterns: [/opec\+?.{0,20}(production|output).{0,15}increas/i, /opec\+?.{0,20}increas.{0,15}(production|output)/i, /opec\+?.{0,20}(rais|boost|hik).{0,15}output/i],
    market: "CRUDE",
    bullish: -60,
    importance: 80,
    timeImpact: "4h",
  },
  { key: "inventoryDraw", patterns: [/inventor(y|ies).{0,25}draw/i, /crude stock.{0,20}(fall|drop|declin)/i], market: "CRUDE", bullish: 55, importance: 75, timeImpact: "1h" },
  { key: "inventoryBuild", patterns: [/inventor(y|ies).{0,25}build/i, /crude stock.{0,20}(ris|increas|climb)/i], market: "CRUDE", bullish: -55, importance: 75, timeImpact: "1h" },
  { key: "war", patterns: [/\bwar\b/i, /\battack(s|ed)?\b.{0,25}(oil|energy|refiner|tanker|pipeline)/i, /military conflict/i], market: "CRUDE", bullish: 60, importance: 80, timeImpact: "30m" },
  { key: "peace", patterns: [/peace (deal|agreement|talks)/i, /ceasefire/i, /truce/i], market: "CRUDE", bullish: -50, importance: 70, timeImpact: "1h" },
  { key: "pipelineExplosion", patterns: [/pipeline.{0,20}(explosion|blast|fire|attack|sabotage)/i], market: "BOTH", bullish: 65, importance: 85, timeImpact: "15m" },
  { key: "refineryShutdown", patterns: [/refiner(y|ies).{0,20}(shutdown|shut down|outage|fire|halt)/i], market: "CRUDE", bullish: -35, importance: 60, timeImpact: "4h" },
  { key: "dollarStrong", patterns: [/dollar.{0,20}(strength|strong|rally|surg)/i, /\bdxy\b.{0,20}(ris|climb|jump)/i], market: "BOTH", bullish: -30, importance: 50, timeImpact: "1d" },
  { key: "dollarWeak", patterns: [/dollar.{0,20}(weak|fall|declin|slump)/i, /\bdxy\b.{0,20}(fall|drop|declin)/i], market: "BOTH", bullish: 30, importance: 50, timeImpact: "1d" },
  { key: "coldWinter", patterns: [/cold (snap|weather|blast)/i, /polar vortex/i, /arctic (blast|cold)/i], market: "NG", bullish: 55, importance: 70, timeImpact: "1d" },
  { key: "warmWinter", patterns: [/warm(er)? (winter|weather)/i, /mild winter/i], market: "NG", bullish: -50, importance: 65, timeImpact: "1d" },
  { key: "lngExportIncrease", patterns: [/lng export.{0,20}(ris|increas|record|surg)/i, /freeport lng.{0,20}(restart|resum|ramp)/i], market: "NG", bullish: 45, importance: 65, timeImpact: "1d" },
  { key: "pipelineOutageNg", patterns: [/(gas )?pipeline.{0,20}(shutdown|shut down|outage)/i], market: "NG", bullish: 40, importance: 60, timeImpact: "4h" },
  { key: "storageBuild", patterns: [/(gas |ng )?storage.{0,25}(build|injection)/i, /storage.{0,20}(above|higher than).{0,20}expect/i], market: "NG", bullish: -45, importance: 65, timeImpact: "1h" },
  { key: "storageDraw", patterns: [/(gas |ng )?storage.{0,25}(draw|withdrawal)/i, /storage.{0,20}(below|lower than).{0,20}expect/i], market: "NG", bullish: 45, importance: 65, timeImpact: "1h" },
  { key: "hormuz", patterns: [/strait of hormuz/i, /\bhormuz\b/i], market: "CRUDE", bullish: 55, importance: 75, timeImpact: "30m" },
  { key: "redSea", patterns: [/red sea/i, /houthi/i], market: "CRUDE", bullish: 45, importance: 65, timeImpact: "1h" },
  { key: "hurricane", patterns: [/hurricane/i, /tropical storm/i], market: "BOTH", bullish: 40, importance: 60, timeImpact: "1d" },
  { key: "sanctions", patterns: [/sanction/i], market: "CRUDE", bullish: 40, importance: 60, timeImpact: "4h" },
  { key: "fedRateHike", patterns: [/fed.{0,15}(rate hike|raises? rate|hikes? rate)/i, /fomc.{0,15}hike/i], market: "BOTH", bullish: -25, importance: 55, timeImpact: "1d" },
  { key: "fedRateCut", patterns: [/fed.{0,15}(rate cut|cuts? rate|lowers? rate)/i, /fomc.{0,15}cut/i], market: "BOTH", bullish: 25, importance: 55, timeImpact: "1d" },
];

export function scoreArticle(article: RawNewsArticle): ScoredNewsArticle {
  const text = `${article.headline} ${article.summary}`;
  const matched = RULES.filter((rule) => rule.patterns.some((p) => p.test(text)));

  if (matched.length === 0) {
    return { ...article, affectedMarket: "BOTH", importance: 20, bullishScore: 0, bearishScore: 0, confidence: 15, expectedMove: "neutral", timeImpact: "1d", matchedRules: [] };
  }

  // Net direction weighted by each matched rule's own importance -- a minor
  // rule shouldn't cancel out a major one 1-for-1.
  const totalWeight = matched.reduce((s, r) => s + r.importance, 0);
  const netBullish = matched.reduce((s, r) => s + r.bullish * r.importance, 0) / totalWeight;
  const importance = Math.min(100, Math.max(...matched.map((r) => r.importance)) + (matched.length - 1) * 5);
  const timeImpact = matched.reduce((fastest, r) => (TIME_ORDER[r.timeImpact] < TIME_ORDER[fastest] ? r.timeImpact : fastest), matched[0].timeImpact);
  const markets = new Set(matched.map((r) => r.market));
  const affectedMarket: AffectedMarket = markets.size > 1 || markets.has("BOTH") ? "BOTH" : matched[0].market;

  return {
    ...article,
    affectedMarket,
    importance,
    bullishScore: Math.round(Math.max(0, netBullish)),
    bearishScore: Math.round(Math.max(0, -netBullish)),
    confidence: Math.min(95, 40 + matched.length * 15),
    expectedMove: classifyExpectedMove(netBullish),
    timeImpact,
    matchedRules: matched.map((r) => r.key),
  };
}

function classifyExpectedMove(net: number): ExpectedMove {
  if (net >= 50) return "very_strong_bullish";
  if (net >= 15) return "bullish";
  if (net <= -50) return "very_strong_bearish";
  if (net <= -15) return "bearish";
  return "neutral";
}

export function scoreArticles(articles: RawNewsArticle[]): ScoredNewsArticle[] {
  return articles.map(scoreArticle).sort((a, b) => b.importance - a.importance);
}

// ---- EIA numeric data (real government figures, not headline text) ----
// A separate, more reliable read than trying to keyword-match a build/draw
// out of a headline: uses the actual reported change value from the EIA API.
// Magnitude scaling below is a heuristic (this app has no historical
// distribution of weekly inventory changes to calibrate a precise "how big
// is big" threshold against), documented as such rather than presented as a
// calibrated statistic.
export interface EiaScoreResult {
  market: "CRUDE" | "NG";
  label: string;
  direction: "draw" | "build";
  changeValue: number;
  bullishScore: number;
  bearishScore: number;
  importance: number;
}

export function scoreEiaChange(series: "crude_inventory" | "ng_storage", changeValue: number): EiaScoreResult {
  const market = series === "crude_inventory" ? "CRUDE" : "NG";
  const draw = changeValue < 0;
  // Rough scaling: crude inventory moves are typically measured in
  // thousands of barrels (a multi-million-barrel weekly swing is a big
  // week), NG storage in Bcf (a ~20+ Bcf weekly swing is a big week).
  const typicalBigMove = series === "crude_inventory" ? 5_000_000 : 40;
  const magnitude = Math.min(60, (Math.abs(changeValue) / typicalBigMove) * 60);
  return {
    market,
    label: `${series === "crude_inventory" ? "Crude Inventory" : "NG Storage"} ${draw ? "Draw" : "Build"} of ${Math.abs(changeValue).toLocaleString()}`,
    direction: draw ? "draw" : "build",
    changeValue,
    bullishScore: draw ? Math.round(35 + magnitude) : 0,
    bearishScore: draw ? 0 : Math.round(35 + magnitude),
    importance: Math.round(55 + magnitude * 0.4),
  };
}
