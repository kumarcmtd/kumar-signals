// GPT News -- Energy & Geopolitical Intelligence.
//
// A self-contained engine for the GPT News page. It deliberately does NOT
// modify newsScoring.ts or aiFlashEngine.ts: those already power News AI and
// AI Flash, and GPT News is meant to be a new page that can be changed on its
// own without disturbing either. What it does instead is READ their output --
// the server already clusters syndicated copies of one wire story into a
// single NewsEvent (spec section 21) and scores it bullish/bearish -- and layer
// the GPT News-specific reads on top: priority level, source verification,
// category routing, geopolitical/chokepoint monitors, and the two commodity
// bias panels.
//
// House rules this file obeys literally, from the specification:
//   * Never invent a headline, a source, a price or a timestamp. Everything
//     here is derived from feed items that actually arrived; when nothing
//     arrived the answer is "no reports", never a made-up reading.
//   * "Do not make simplistic conclusions from one keyword. Combine multiple
//     signals before assigning VERY HIGH impact." -- see strengthFor().
//   * Never present an interpretation or an estimate as a fact. Every output
//     below is tagged fact / interpretation / estimate where it is displayed.

import type { NewsEvent, ScoredNewsArticle, AffectedMarket } from "./newsScoring";
import { ageMinutes, formatAge, formatStamp } from "./aiFlashEngine";

export type GptCategory = "crude" | "gas" | "war" | "opec" | "lng" | "weather";
export type PriorityLevel = 1 | 2 | 3 | 4 | 5;
export type Verification = "confirmed" | "developing" | "unconfirmed";
export type Horizon = "minutes" | "intraday" | "1-3 days" | "1-2 weeks";
export type Strength = "very_low" | "low" | "medium" | "high" | "very_high";
export type Bias = "bullish" | "bearish" | "neutral";
export type Confidence = "low" | "medium" | "high";
export type RiskLevel = "low" | "medium" | "high" | "extreme";

export const PRIORITY_LABEL: Record<PriorityLevel, string> = {
  5: "Market Shock",
  4: "High Impact",
  3: "Moderate",
  2: "Low",
  1: "Informational",
};

export const PRIORITY_NOTE: Record<PriorityLevel, string> = {
  5: "Could cause a very large price move.",
  4: "Likely a meaningful move.",
  3: "Possible short-term impact.",
  2: "Background information.",
  1: "Context only.",
};

export const STRENGTH_LABEL: Record<Strength, string> = {
  very_high: "VERY HIGH",
  high: "HIGH",
  medium: "MEDIUM",
  low: "LOW",
  very_low: "VERY LOW",
};

/** How many "+" or "-" marks to draw for an impact strength. */
export const STRENGTH_MARKS: Record<Strength, number> = { very_high: 5, high: 4, medium: 3, low: 2, very_low: 1 };

// ---- Category routing (spec sections 4 and 3's tab row) ----
// Deliberately additive to newsScoring's CRUDE/NG relevance lists: those decide
// WHICH COMMODITY a story affects, these decide WHICH TAB it appears under.
const CATEGORY_PATTERNS: Record<Exclude<GptCategory, "crude" | "gas">, RegExp[]> = {
  war: [
    /\bwar\b/i, /\bstrike(s)?\b/i, /missile/i, /drone attack/i, /\battack(s|ed)?\b/i, /military/i, /ceasefire/i, /truce/i,
    /\biran\b/i, /israel/i, /houthi/i, /red sea/i, /bab el[- ]mandeb/i, /strait of hormuz/i, /\bhormuz\b/i,
    /sanction/i, /geopolit/i, /conflict/i, /\bnavy\b|naval/i, /tanker seiz/i,
  ],
  opec: [/opec\+?/i, /\bopec\b/i, /saudi aramco/i, /production quota/i, /output (cut|target|policy)/i, /jmmc/i],
  lng: [/\blng\b/i, /freeport lng/i, /sabine pass/i, /cove point/i, /corpus christi/i, /liquefaction/i, /lng (cargo|terminal|export|facility)/i, /\bttf\b/i, /qatar ?energy|qatargas/i],
  weather: [/weather/i, /cold (snap|blast|front)/i, /polar vortex/i, /heat ?wave/i, /hurricane/i, /tropical storm/i, /\bnoaa\b/i, /heating degree|cooling degree|\bhdd\b|\bcdd\b/i, /forecast.{0,20}(temperature|cold|warm)/i, /mild winter|warm winter/i],
};

export function categoriesFor(text: string, market: AffectedMarket): GptCategory[] {
  const out = new Set<GptCategory>();
  if (market === "CRUDE" || market === "BOTH") out.add("crude");
  if (market === "NG" || market === "BOTH") out.add("gas");
  for (const [cat, patterns] of Object.entries(CATEGORY_PATTERNS)) {
    if (patterns.some((p) => p.test(text))) out.add(cat as GptCategory);
  }
  return Array.from(out);
}

// ---- Time horizon (spec section 5's "time horizon" output) ----
// Keyed off the rule newsScoring already matched, so the horizon and the
// direction always come from the same piece of evidence.
const RULE_HORIZON: Record<string, Horizon> = {
  pipelineExplosion: "minutes",
  war: "minutes",
  hormuz: "minutes",
  redSea: "intraday",
  inventoryDraw: "intraday",
  inventoryBuild: "intraday",
  storageBuild: "intraday",
  storageDraw: "intraday",
  peace: "intraday",
  opecCut: "1-3 days",
  opecIncrease: "1-3 days",
  sanctions: "1-3 days",
  refineryShutdown: "1-3 days",
  pipelineOutageNg: "1-3 days",
  lngExportIncrease: "1-3 days",
  hurricane: "1-3 days",
  coldWinter: "1-3 days",
  warmWinter: "1-3 days",
  dollarStrong: "1-2 weeks",
  dollarWeak: "1-2 weeks",
  fedRateHike: "1-2 weeks",
  fedRateCut: "1-2 weeks",
};

const HORIZON_ORDER: Horizon[] = ["minutes", "intraday", "1-3 days", "1-2 weeks"];

export function horizonFor(matchedRules: string[]): Horizon {
  const hits = matchedRules.map((r) => RULE_HORIZON[r]).filter((h): h is Horizon => Boolean(h));
  if (hits.length === 0) return "1-3 days";
  // The fastest-acting matched rule wins -- a pipeline explosion that also
  // trips "sanctions" still moves the tape in minutes, not days.
  return hits.reduce((fastest, h) => (HORIZON_ORDER.indexOf(h) < HORIZON_ORDER.indexOf(fastest) ? h : fastest), hits[0]);
}

// ---- Source verification (spec section 20) ----
// "Do not repeat rumors as facts." A story is only CONFIRMED when either an
// official/primary source carried it, or two independent outlets did. One
// second-tier outlet on its own is DEVELOPING. Anything weaker is UNCONFIRMED
// and is labelled "awaiting independent confirmation" in the UI.
export function verificationFor(bestTier: number, sourceCount: number): Verification {
  if (bestTier === 1) return "confirmed";
  if (bestTier === 2 && sourceCount >= 2) return "confirmed";
  if (bestTier <= 2) return "developing";
  if (bestTier === 3 && sourceCount >= 2) return "developing";
  return "unconfirmed";
}

export const VERIFICATION_LABEL: Record<Verification, string> = {
  confirmed: "CONFIRMED",
  developing: "DEVELOPING",
  unconfirmed: "UNCONFIRMED",
};

export const VERIFICATION_NOTE: Record<Verification, string> = {
  confirmed: "Carried by an official source or corroborated by two independent outlets.",
  developing: "Reported by one outlet so far — still awaiting independent corroboration.",
  unconfirmed: "Unconfirmed — awaiting independent confirmation. Do not trade this on its own.",
};

// ---- Impact strength (spec section 5) ----
// The specification is explicit that VERY HIGH must never come from a single
// keyword. Four independent signals have to line up: a big rule-based impact,
// a high-quality source, corroboration (or a primary source), and news that is
// still fresh. Missing any one of them caps the reading at HIGH.
export function strengthFor(args: { absImpact: number; sourceQualityPct: number; sourceCount: number; bestTier: number; recencyPct: number }): Strength {
  const { absImpact, sourceQualityPct, sourceCount, bestTier, recencyPct } = args;
  const corroborated = sourceCount >= 2 || bestTier === 1;
  if (absImpact >= 4 && sourceQualityPct >= 80 && corroborated && recencyPct >= 50) return "very_high";
  if (absImpact >= 3 && sourceQualityPct >= 55) return "high";
  if (absImpact >= 2) return "medium";
  if (absImpact >= 1) return "low";
  return "very_low";
}

export function confidenceBand(pct: number): Confidence {
  if (pct >= 70) return "high";
  if (pct >= 45) return "medium";
  return "low";
}

// ---- Priority level (spec section 17: sort by market importance, not time) ----
export function priorityFor(args: { strength: Strength; verification: Verification; ageMin: number; direction: Bias }): PriorityLevel {
  const { strength, verification, ageMin, direction } = args;
  if (direction === "neutral" && strength !== "very_high") {
    // A neutral story can still be worth reading, but it is never a shock.
    return strength === "high" ? 2 : 1;
  }
  let level: number = STRENGTH_MARKS[strength]; // 1..5
  // An unconfirmed report cannot be a Level 5 market shock on its own.
  if (verification === "unconfirmed") level = Math.min(level, 3);
  else if (verification === "developing") level = Math.min(level, 4);
  // Something from yesterday is no longer "breaking" whatever it said.
  if (ageMin > 720) level = Math.min(level, 2);
  else if (ageMin > 240) level = Math.min(level, 3);
  return Math.max(1, Math.min(5, level)) as PriorityLevel;
}

// ---- The unified news item this whole page renders ----
export interface GptNewsItem {
  id: string;
  headline: string;
  summary: string;
  /** Every outlet that carried this one event (spec section 21). */
  sources: string[];
  primarySource: string;
  url: string;
  publishedAt: string;
  ageMin: number;
  ageLabel: string;
  /** Absolute wall-clock stamp in the reader's timezone. */
  stamp: string;
  /** "NEW" for the Fast Mode highlight (spec section 18). */
  isNew: boolean;
  asset: AffectedMarket | "NONE";
  categories: GptCategory[];
  direction: Bias;
  strength: Strength;
  /** -5..+5, signed. Bullish positive. */
  impactScale: number;
  crudeMarks: number;
  gasMarks: number;
  geopoliticalRisk: RiskLevel;
  confidencePct: number;
  confidence: Confidence;
  verification: Verification;
  priority: PriorityLevel;
  horizon: Horizon;
  whyItMatters: string;
  expectedEffect: string;
  matchedRules: string[];
  sourceCount: number;
  bestTier: number;
  /** How much this item counts toward a bias panel (0-1). */
  weight: number;
}

const GEO_RULES = new Set(["war", "hormuz", "redSea", "sanctions", "peace", "pipelineExplosion"]);

function geoRiskFor(item: { matchedRules: string[]; strength: Strength; text: string }): RiskLevel {
  const geoHits = item.matchedRules.filter((r) => GEO_RULES.has(r)).length;
  if (geoHits === 0 && !CATEGORY_PATTERNS.war.some((p) => p.test(item.text))) return "low";
  if (geoHits >= 2 && item.strength === "very_high") return "extreme";
  if (geoHits >= 1 && (item.strength === "very_high" || item.strength === "high")) return "high";
  if (geoHits >= 1) return "medium";
  return "low";
}

/** Marks awarded to one commodity by an event, 0-5. BOTH-market events count fully for both. */
function marksFor(item: { asset: AffectedMarket | "NONE"; absImpact: number }, market: "CRUDE" | "NG"): number {
  if (item.asset === "NONE") return 0;
  if (item.asset === market || item.asset === "BOTH") return Math.round(item.absImpact);
  return 0;
}

/**
 * Turns the server's clustered events into GPT News items.
 * `articles` is used only to recover each event's summary text -- the event
 * itself carries the scoring, so no article is ever re-scored here.
 */
export function buildGptNewsItems(events: NewsEvent[], articles: ScoredNewsArticle[], now: number = Date.now()): GptNewsItem[] {
  const byUrl = new Map(articles.map((a) => [a.url, a]));
  const byHeadline = new Map(articles.map((a) => [a.headline, a]));

  return events
    .map((evt) => {
      const article = byUrl.get(evt.primaryUrl) ?? byHeadline.get(evt.title);
      const summary = article?.summary?.trim() ?? "";
      const text = `${evt.title} ${summary}`;
      const ageMin = ageMinutes(evt.publishedAt, now);
      const absImpact = Math.abs(evt.impactScale);
      const bestTier = article?.sourceTier ?? (evt.sourceQualityPct >= 100 ? 1 : evt.sourceQualityPct >= 80 ? 2 : evt.sourceQualityPct >= 55 ? 3 : 4);
      const strength = strengthFor({
        absImpact,
        sourceQualityPct: evt.sourceQualityPct,
        sourceCount: evt.sources.length,
        bestTier,
        recencyPct: evt.recencyPct,
      });
      const direction: Bias = evt.impactScale >= 1 ? "bullish" : evt.impactScale <= -1 ? "bearish" : "neutral";
      const verification = verificationFor(bestTier, evt.sources.length);
      const asset: AffectedMarket | "NONE" = evt.relevancePct <= 0 ? "NONE" : evt.affectedMarket;
      const item: GptNewsItem = {
        id: evt.id,
        headline: evt.title,
        summary,
        sources: evt.sources,
        primarySource: evt.primarySource,
        url: evt.primaryUrl,
        publishedAt: evt.publishedAt,
        ageMin,
        ageLabel: ageMin < 1 ? "NEW" : formatAge(ageMin),
        stamp: formatStamp(evt.publishedAt),
        isNew: ageMin <= 5,
        asset,
        categories: categoriesFor(text, evt.affectedMarket),
        direction,
        strength,
        impactScale: evt.impactScale,
        crudeMarks: marksFor({ asset, absImpact }, "CRUDE"),
        gasMarks: marksFor({ asset, absImpact }, "NG"),
        geopoliticalRisk: geoRiskFor({ matchedRules: evt.matchedRules, strength, text }),
        confidencePct: evt.confidencePct,
        confidence: confidenceBand(evt.confidencePct),
        verification,
        priority: priorityFor({ strength, verification, ageMin, direction }),
        horizon: horizonFor(evt.matchedRules),
        whyItMatters: evt.whyItMatters,
        expectedEffect: evt.expectedEffect,
        matchedRules: evt.matchedRules,
        sourceCount: evt.sources.length,
        bestTier,
        // Evidence mass: fresh, well-sourced, on-topic, high-impact stories
        // count most. Used by the bias panels below.
        weight: (evt.recencyPct / 100) * (evt.sourceQualityPct / 100) * Math.min(1, 0.4 + evt.relevancePct / 100),
      };
      return item;
    })
    // Spec section 17: importance first, recency as the tie-break. (The feed's
    // own "newest first" view re-sorts this -- see sortItems.)
    .sort((a, b) => b.priority - a.priority || a.ageMin - b.ageMin);
}

export function sortItems(items: GptNewsItem[], mode: "importance" | "newest"): GptNewsItem[] {
  const copy = [...items];
  if (mode === "newest") return copy.sort((a, b) => a.ageMin - b.ageMin || b.priority - a.priority);
  return copy.sort((a, b) => b.priority - a.priority || a.ageMin - b.ageMin);
}

/**
 * Breaking news (spec section 6): "only genuinely market-moving stories".
 * Level 4+, still fresh, and never something unconfirmed on a single weak
 * source -- that would be exactly the "rumor shown as fact" the spec forbids.
 */
export const BREAKING_MAX_AGE_MIN = 180;

export function breakingItems(items: GptNewsItem[], limit = 3): GptNewsItem[] {
  return items.filter((i) => i.priority >= 4 && i.ageMin <= BREAKING_MAX_AGE_MIN && i.verification !== "unconfirmed").slice(0, limit);
}

// ---- Filters and search (spec sections 27 and 28) ----
export type TimeFilter = "all" | "15m" | "1h" | "4h" | "today";
export type AssetFilter = "all" | "CRUDE" | "NG" | "BOTH";
export type ImpactFilter = "all" | "very_high" | "high" | "medium" | "low";

const TIME_FILTER_MIN: Record<Exclude<TimeFilter, "all" | "today">, number> = { "15m": 15, "1h": 60, "4h": 240 };
const STRENGTH_RANK: Record<Strength, number> = { very_low: 1, low: 2, medium: 3, high: 4, very_high: 5 };

export interface FilterState {
  category: GptCategory | "all";
  time: TimeFilter;
  asset: AssetFilter;
  impact: ImpactFilter;
  source: string; // "all" or a lowercase substring to match against source names
  query: string;
}

export const EMPTY_FILTERS: FilterState = { category: "all", time: "all", asset: "all", impact: "all", source: "all", query: "" };

/** Minutes since midnight IST, used by the "Today" filter and the session helpers. */
function istMinutesOfDay(now: number): number {
  const ist = new Date(now + 5.5 * 60 * 60 * 1000);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes();
}

export function applyFilters(items: GptNewsItem[], f: FilterState, now: number = Date.now()): GptNewsItem[] {
  const q = f.query.trim().toLowerCase();
  const todayCutoff = istMinutesOfDay(now);
  return items.filter((i) => {
    if (f.category !== "all" && !i.categories.includes(f.category)) return false;
    if (f.time === "today") {
      if (i.ageMin > todayCutoff) return false;
    } else if (f.time !== "all" && i.ageMin > TIME_FILTER_MIN[f.time]) return false;
    if (f.asset !== "all" && i.asset !== f.asset) return false;
    if (f.impact !== "all" && STRENGTH_RANK[i.strength] < STRENGTH_RANK[f.impact]) return false;
    if (f.source !== "all" && !i.sources.some((s) => s.toLowerCase().includes(f.source))) return false;
    if (q && !`${i.headline} ${i.summary} ${i.sources.join(" ")}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

// ---- Global energy risk monitor (spec section 11) ----
export interface CountryRisk {
  key: string;
  name: string;
  flag: string;
  risk: RiskLevel;
  /** The most important headline actually mentioning this country, or null. */
  latest: GptNewsItem | null;
  mentions: number;
  crudeEffect: Bias;
  gasEffect: Bias;
  /** Honest text when nothing has come through -- never a made-up "all clear". */
  note: string;
}

const COUNTRIES: { key: string; name: string; flag: string; patterns: RegExp[] }[] = [
  { key: "iran", name: "Iran", flag: "🇮🇷", patterns: [/\biran(ian)?\b/i, /tehran/i, /irgc/i] },
  { key: "israel", name: "Israel", flag: "🇮🇱", patterns: [/\bisrael(i)?\b/i, /tel aviv/i, /\bidf\b/i] },
  { key: "usa", name: "United States", flag: "🇺🇸", patterns: [/\bunited states\b/i, /\bu\.?s\.?\b/i, /washington/i, /white house/i, /pentagon/i] },
  { key: "saudi", name: "Saudi Arabia", flag: "🇸🇦", patterns: [/saudi/i, /aramco/i, /riyadh/i] },
  { key: "iraq", name: "Iraq", flag: "🇮🇶", patterns: [/\biraq(i)?\b/i, /baghdad/i, /kirkuk/i, /basra/i] },
  { key: "houthi", name: "Houthis / Yemen", flag: "🇾🇪", patterns: [/houthi/i, /\byemen(i)?\b/i] },
  { key: "qatar", name: "Qatar", flag: "🇶🇦", patterns: [/\bqatar(i)?\b/i, /qatarenergy/i, /qatargas/i, /ras laffan/i] },
  { key: "russia", name: "Russia", flag: "🇷🇺", patterns: [/\brussia(n)?\b/i, /moscow/i, /kremlin/i, /gazprom/i, /rosneft/i, /urals/i] },
  { key: "china", name: "China", flag: "🇨🇳", patterns: [/\bchina\b|chinese/i, /beijing/i, /sinopec/i, /\bcnpc\b/i] },
];

function riskFromItems(items: GptNewsItem[]): RiskLevel {
  if (items.length === 0) return "low";
  const top = Math.max(...items.map((i) => STRENGTH_MARKS[i.strength]));
  const geo = items.filter((i) => i.geopoliticalRisk === "high" || i.geopoliticalRisk === "extreme").length;
  if (items.some((i) => i.geopoliticalRisk === "extreme")) return "extreme";
  if (top >= 4 && geo >= 1) return "high";
  if (top >= 3 || geo >= 1) return "medium";
  return "low";
}

function netEffect(items: GptNewsItem[], market: "CRUDE" | "NG"): Bias {
  const relevant = items.filter((i) => i.asset === market || i.asset === "BOTH");
  if (relevant.length === 0) return "neutral";
  const mass = relevant.reduce((s, i) => s + i.weight, 0);
  if (mass <= 0) return "neutral";
  const net = relevant.reduce((s, i) => s + i.weight * i.impactScale, 0) / mass;
  return net >= 0.75 ? "bullish" : net <= -0.75 ? "bearish" : "neutral";
}

export function countryRisks(items: GptNewsItem[]): CountryRisk[] {
  return COUNTRIES.map((c) => {
    const hits = items.filter((i) => c.patterns.some((p) => p.test(`${i.headline} ${i.summary}`)));
    const sorted = [...hits].sort((a, b) => b.priority - a.priority || a.ageMin - b.ageMin);
    return {
      key: c.key,
      name: c.name,
      flag: c.flag,
      risk: riskFromItems(hits),
      latest: sorted[0] ?? null,
      mentions: hits.length,
      crudeEffect: netEffect(hits, "CRUDE"),
      gasEffect: netEffect(hits, "NG"),
      note:
        hits.length === 0
          ? "No reports in the connected feeds in the last 48 hours. That is an absence of news, not an all-clear."
          : `${hits.length} ${hits.length === 1 ? "story" : "stories"} in the feed.`,
    };
  }).sort((a, b) => ({ extreme: 3, high: 2, medium: 1, low: 0 })[b.risk] - ({ extreme: 3, high: 2, medium: 1, low: 0 })[a.risk] || b.mentions - a.mentions);
}

// ---- Chokepoint monitors (spec sections 12 and 13) ----
export type ChokepointStatus = "normal" | "disrupted" | "high_risk" | "blocked";

export const CHOKEPOINT_STATUS_LABEL: Record<ChokepointStatus, string> = {
  normal: "NORMAL",
  disrupted: "DISRUPTED",
  high_risk: "HIGH RISK",
  blocked: "BLOCKED",
};

/** 0-3, for the NORMAL —— HIGH RISK —— BLOCKED gauge. */
export const CHOKEPOINT_GAUGE: Record<ChokepointStatus, number> = { normal: 0, disrupted: 1, high_risk: 2, blocked: 3 };

export interface ChokepointRead {
  key: "hormuz" | "redsea";
  name: string;
  subtitle: string;
  status: ChokepointStatus;
  items: GptNewsItem[];
  /** Short evidence lines, each taken from a real headline. */
  signals: { label: string; detail: string }[];
  crudeEffect: Bias;
  gasEffect: Bias;
  lastUpdate: string | null;
  note: string;
}

// "closes"/"closing" have to be in here explicitly: \bclos(e|ed|ure)\b cannot
// match the plural, and "Iran closes the Strait of Hormuz" is exactly the
// headline this monitor exists for. Both word orders are covered.
const BLOCKED_PATTERNS = [
  /\bclos(e|es|ed|ing|ure)\b.{0,30}(strait|shipping|route|canal|traffic|transit)/i,
  /(strait|shipping lane|canal|route).{0,30}\b(clos(e|es|ed|ing|ure)|shut( down)?)\b/i,
  /blockad/i,
  /\bshuts?\b.{0,25}(strait|route|canal)/i,
  /halt(s|ed)? all (shipping|traffic|transit)/i,
];
const HIGH_RISK_PATTERNS = [/attack/i, /missile|drone/i, /seiz(e|ed|ure)/i, /\bstrike(s)?\b/i, /threat(en|ened|ens)?/i, /\bmine(s|d)?\b/i, /warn(s|ed|ing)/i, /escalat/i];
const DISRUPTED_PATTERNS = [/disrupt/i, /divert|reroute|re-route/i, /suspend/i, /delay/i, /avoid(ing)? the/i, /insurance (premium|cost).{0,20}(ris|surg|jump)/i];

function chokepointStatus(items: GptNewsItem[]): ChokepointStatus {
  const text = items.map((i) => `${i.headline} ${i.summary}`).join(" ");
  if (items.length === 0) return "normal";
  if (BLOCKED_PATTERNS.some((p) => p.test(text))) return "blocked";
  if (HIGH_RISK_PATTERNS.some((p) => p.test(text))) return "high_risk";
  if (DISRUPTED_PATTERNS.some((p) => p.test(text))) return "disrupted";
  return "normal";
}

function chokepointSignals(items: GptNewsItem[], rows: { label: string; patterns: RegExp[] }[]): { label: string; detail: string }[] {
  return rows.map((row) => {
    const hit = items.find((i) => row.patterns.some((p) => p.test(`${i.headline} ${i.summary}`)));
    return { label: row.label, detail: hit ? hit.headline : "Nothing reported in the feed." };
  });
}

const HORMUZ_PATTERNS = [/strait of hormuz/i, /\bhormuz\b/i];
const REDSEA_PATTERNS = [/red sea/i, /bab el[- ]?mandeb/i, /houthi/i, /suez/i, /gulf of aden/i];

export function chokepointReads(items: GptNewsItem[]): ChokepointRead[] {
  const build = (
    key: "hormuz" | "redsea",
    name: string,
    subtitle: string,
    patterns: RegExp[],
    rows: { label: string; patterns: RegExp[] }[],
    quietNote: string
  ): ChokepointRead => {
    const hits = items.filter((i) => patterns.some((p) => p.test(`${i.headline} ${i.summary}`)));
    const sorted = [...hits].sort((a, b) => a.ageMin - b.ageMin);
    const status = chokepointStatus(hits);
    return {
      key,
      name,
      subtitle,
      status,
      items: sorted,
      signals: chokepointSignals(sorted, rows),
      crudeEffect: netEffect(hits, "CRUDE"),
      gasEffect: netEffect(hits, "NG"),
      lastUpdate: sorted[0]?.publishedAt ?? null,
      note: hits.length === 0 ? quietNote : `Status read from ${hits.length} ${hits.length === 1 ? "headline" : "headlines"} in the last 48 hours.`,
    };
  };

  return [
    build(
      "hormuz",
      "Strait of Hormuz",
      "~20% of world oil and a large share of LNG transits here",
      HORMUZ_PATTERNS,
      [
        { label: "Shipping status", patterns: [...BLOCKED_PATTERNS, ...DISRUPTED_PATTERNS, /shipping/i, /transit/i] },
        { label: "Tanker movement", patterns: [/tanker/i, /vessel/i, /cargo/i, /\bvlcc\b/i] },
        { label: "Military activity", patterns: [/military|navy|naval|missile|drone|irgc|escort|warship/i] },
        { label: "Diplomatic developments", patterns: [/talks|negotiat|deal|diplomat|sanction|agreement|nuclear/i] },
        { label: "Oil supply risk", patterns: [/oil|crude|barrel|supply|export/i] },
        { label: "LNG supply risk", patterns: [/lng|gas|qatar/i] },
      ],
      "No Hormuz headlines in the last 48 hours. Shown as NORMAL because nothing has been reported — this is not a live shipping-authority feed."
    ),
    build(
      "redsea",
      "Red Sea / Bab el-Mandeb",
      "Suez routing for crude and LNG between Asia and Europe",
      REDSEA_PATTERNS,
      [
        { label: "Shipping risk", patterns: [...BLOCKED_PATTERNS, ...DISRUPTED_PATTERNS, /shipping|transit|convoy/i] },
        { label: "Houthi activity", patterns: [/houthi|yemen/i] },
        { label: "Tanker attacks", patterns: [/tanker|vessel|ship.{0,15}(attack|hit|struck)/i] },
        { label: "LNG / oil route impact", patterns: [/lng|crude|oil|cape of good hope|reroute|divert/i] },
      ],
      "No Red Sea headlines in the last 48 hours. Shown as NORMAL because nothing has been reported — this is not a live shipping-authority feed."
    ),
  ];
}

// ---- Natural gas weather read (spec section 14) ----
// HONESTY NOTE, and it is displayed on the card itself: this app has no NOAA
// or weather-API connection. Wiring one would be a new upstream dependency and
// a new key. What this does instead is read the weather-related ENERGY
// headlines that already arrive in the feed. It therefore reports what has
// been REPORTED about weather, and says so -- it never prints an HDD/CDD number
// or a 7-day temperature outlook it does not have.
export interface WeatherRead {
  bias: Bias;
  label: string;
  headlineCount: number;
  bullishSignals: string[];
  bearishSignals: string[];
  regions: { name: string; mentioned: boolean }[];
  degreeDayMentions: string[];
  note: string;
}

const WEATHER_BULLISH = [/cold (snap|blast|front|weather)/i, /polar vortex/i, /arctic (blast|air|cold)/i, /below[- ]normal temperature/i, /heating demand.{0,20}(ris|surg|jump|strong)/i, /heat ?wave/i, /cooling demand.{0,20}(ris|surg|jump|strong)/i, /freeze[- ]?off/i];
const WEATHER_BEARISH = [/mild(er)? (weather|winter|temperature)/i, /warm(er)? (than normal|winter|weather)/i, /above[- ]normal temperature/i, /demand.{0,20}(fall|drop|weaken|ease)/i, /moderat(e|ing) (temperature|weather)/i];
const WEATHER_REGIONS = [
  { name: "Texas", patterns: [/texas|ercot|permian|waha/i] },
  { name: "Midwest", patterns: [/midwest|chicago|great lakes/i] },
  { name: "Northeast", patterns: [/northeast|new england|new york|algonquin|appalachia/i] },
  { name: "South", patterns: [/\bsouth\b|gulf coast|louisiana|southeast/i] },
  { name: "West", patterns: [/\bwest\b|california|rockies|pacific northwest/i] },
];
const DEGREE_DAY = [/\bhdd\b|heating degree day/i, /\bcdd\b|cooling degree day/i];

export function weatherRead(items: GptNewsItem[]): WeatherRead {
  const weatherItems = items.filter((i) => i.categories.includes("weather") || (i.asset !== "CRUDE" && /weather|temperature|degree day/i.test(`${i.headline} ${i.summary}`)));
  const bullishSignals = weatherItems.filter((i) => WEATHER_BULLISH.some((p) => p.test(`${i.headline} ${i.summary}`))).map((i) => i.headline);
  const bearishSignals = weatherItems.filter((i) => WEATHER_BEARISH.some((p) => p.test(`${i.headline} ${i.summary}`))).map((i) => i.headline);
  const bias: Bias = bullishSignals.length > bearishSignals.length ? "bullish" : bearishSignals.length > bullishSignals.length ? "bearish" : "neutral";
  return {
    bias,
    label: bias === "bullish" ? "Weather leaning BULLISH for gas" : bias === "bearish" ? "Weather leaning BEARISH for gas" : "Weather NEUTRAL / no clear signal",
    headlineCount: weatherItems.length,
    bullishSignals: bullishSignals.slice(0, 3),
    bearishSignals: bearishSignals.slice(0, 3),
    regions: WEATHER_REGIONS.map((r) => ({ name: r.name, mentioned: weatherItems.some((i) => r.patterns.some((p) => p.test(`${i.headline} ${i.summary}`))) })),
    degreeDayMentions: weatherItems.filter((i) => DEGREE_DAY.some((p) => p.test(`${i.headline} ${i.summary}`))).map((i) => i.headline).slice(0, 2),
    note:
      weatherItems.length === 0
        ? "No weather-related gas headlines in the feed right now."
        : "Read from weather headlines in the news feed. No NOAA/weather API is connected, so there is no 7-day outlook or HDD/CDD figure here — only what has actually been reported.",
  };
}

// ---- Commodity bias panels (spec sections 9 and 10) ----
export interface BiasComponent {
  label: string;
  reading: Bias | RiskLevel;
  kind: "bias" | "risk";
  detail: string;
}

export interface CommodityPanel {
  market: "CRUDE" | "NG";
  title: string;
  bias: Bias;
  biasLabel: string;
  /** 0-100. Confidence in the READ, not a probability of a price move. */
  confidencePct: number;
  /** 0-100, 50 = balanced. */
  score: number;
  components: BiasComponent[];
  /** 3-5 real headlines driving the current read. */
  drivers: { headline: string; source: string; ageLabel: string; direction: Bias }[];
  /** What would flip it. Interpretation, clearly labelled as such in the UI. */
  counterRisks: string[];
  itemCount: number;
  quiet: boolean;
}

const SUPPLY_RULES = new Set(["opecCut", "opecIncrease", "war", "pipelineExplosion", "sanctions", "hormuz", "redSea", "hurricane", "peace", "inventoryDraw", "inventoryBuild"]);
const DEMAND_RULES = new Set(["fedRateHike", "fedRateCut", "dollarStrong", "dollarWeak", "refineryShutdown"]);

// Each bullish driver has a specific, named thing that would undo it. These are
// the spec's own examples (diplomatic breakthrough, Hormuz reopening,
// production normalization) generalised per rule -- interpretation, not fact.
const COUNTER_RISK: Record<string, string> = {
  opecCut: "OPEC+ walking back or under-delivering the cut",
  war: "A ceasefire, de-escalation or a diplomatic breakthrough",
  hormuz: "Hormuz transit returning to normal and the risk premium unwinding",
  redSea: "Red Sea routing normalising and freight/insurance costs falling back",
  sanctions: "Sanctions relief, waivers, or the barrels simply finding another buyer",
  pipelineExplosion: "The line being repaired and flows restored faster than expected",
  hurricane: "The storm track shifting away from production and refining",
  inventoryDraw: "The next weekly report printing a build instead",
  storageDraw: "The next storage report printing a bigger injection",
  coldWinter: "Forecasts moderating back toward normal temperatures",
  lngExportIncrease: "An LNG terminal outage pulling export demand back out",
  dollarWeak: "The dollar recovering and squeezing commodity buyers again",
  fedRateCut: "Rate-cut expectations being priced back out",
  opecIncrease: "OPEC+ pausing or reversing the output increase",
  peace: "The ceasefire breaking down and the risk premium returning",
  inventoryBuild: "The next weekly report printing a draw instead",
  storageBuild: "A colder forecast turning injections into withdrawals",
  warmWinter: "A cold front arriving and lifting heating demand",
  dollarStrong: "The dollar rolling over",
  fedRateHike: "A softer inflation print pushing hikes back off the table",
  refineryShutdown: "The refinery restarting and crude runs recovering",
  pipelineOutageNg: "The pipeline returning to service",
};

function biasFromScore(score: number): Bias {
  if (score >= 58) return "bullish";
  if (score <= 42) return "bearish";
  return "neutral";
}

function biasLabelFor(score: number): string {
  if (score >= 70) return "STRONGLY BULLISH";
  if (score >= 58) return "BULLISH";
  if (score > 52) return "NEUTRAL / SLIGHTLY BULLISH";
  if (score >= 48) return "NEUTRAL";
  if (score >= 43) return "NEUTRAL / SLIGHTLY BEARISH";
  if (score > 30) return "BEARISH";
  return "STRONGLY BEARISH";
}

function subsetBias(items: GptNewsItem[], rules: Set<string>): { bias: Bias; count: number } {
  const hits = items.filter((i) => i.matchedRules.some((r) => rules.has(r)));
  return { bias: netEffect(hits, hits[0]?.asset === "NG" ? "NG" : "CRUDE"), count: hits.length };
}

function riskLevelFromItems(items: GptNewsItem[]): RiskLevel {
  return riskFromItems(items);
}

/** Evidence mass at which the panel may use its full range; below it the score is pulled toward 50. */
const FULL_CONVICTION_MASS = 2.5;

function panelCore(items: GptNewsItem[], market: "CRUDE" | "NG") {
  const relevant = items.filter((i) => i.asset === market || i.asset === "BOTH");
  const scoring = relevant.filter((i) => i.weight > 0);
  const mass = scoring.reduce((s, i) => s + i.weight, 0);
  if (mass <= 0) return { relevant, scoring, score: 50, confidencePct: 0, quiet: true };
  const net = scoring.reduce((s, i) => s + i.weight * i.impactScale, 0) / mass; // -5..5
  const conviction = Math.min(1, mass / FULL_CONVICTION_MASS);
  const score = Math.max(0, Math.min(100, Math.round(50 + (net / 5) * 50 * conviction)));
  const bestQuality = Math.max(...scoring.map((i) => (i.bestTier === 1 ? 100 : i.bestTier === 2 ? 80 : i.bestTier === 3 ? 55 : 25)));
  const confidencePct = Math.max(0, Math.min(95, Math.round(conviction * 50 + (bestQuality / 100) * 30 + (Math.min(scoring.length, 8) / 8) * 20)));
  return { relevant, scoring, score, confidencePct, quiet: scoring.every((i) => i.ageMin > 720) };
}

function driversOf(items: GptNewsItem[], limit = 5) {
  return [...items]
    .filter((i) => i.direction !== "neutral")
    .sort((a, b) => Math.abs(b.impactScale) * b.weight - Math.abs(a.impactScale) * a.weight)
    .slice(0, limit)
    .map((i) => ({ headline: i.headline, source: i.primarySource, ageLabel: i.ageLabel, direction: i.direction }));
}

function counterRisksOf(items: GptNewsItem[], bias: Bias, limit = 3): string[] {
  const rules = Array.from(new Set(items.filter((i) => i.direction === bias).flatMap((i) => i.matchedRules)));
  const out = rules.map((r) => COUNTER_RISK[r]).filter((t): t is string => Boolean(t));
  if (out.length === 0) {
    return bias === "neutral"
      ? ["Any Level 4+ headline landing would break the current balance in either direction."]
      : ["No specific counter-driver is identifiable from the headlines currently in the feed."];
  }
  return Array.from(new Set(out)).slice(0, limit);
}

export function crudePanel(items: GptNewsItem[], eiaCrudeBias?: Bias): CommodityPanel {
  const { relevant, score, confidencePct, quiet } = panelCore(items, "CRUDE");
  const geoItems = relevant.filter((i) => i.geopoliticalRisk !== "low");
  const supply = subsetBias(relevant, SUPPLY_RULES);
  const demand = subsetBias(relevant, DEMAND_RULES);
  const bias = biasFromScore(score);
  const components: BiasComponent[] = [
    { label: "Geopolitical risk", reading: riskLevelFromItems(geoItems), kind: "risk", detail: geoItems.length ? `${geoItems.length} geopolitical ${geoItems.length === 1 ? "story" : "stories"} in the feed.` : "No geopolitical stories in the feed." },
    { label: "Supply risk", reading: supply.count ? riskLevelFromItems(relevant.filter((i) => i.matchedRules.some((r) => SUPPLY_RULES.has(r)))) : "low", kind: "risk", detail: supply.count ? `${supply.count} supply-side ${supply.count === 1 ? "story" : "stories"}.` : "Nothing supply-side reported." },
    { label: "Demand read", reading: demand.count ? demand.bias : "neutral", kind: "bias", detail: demand.count ? `${demand.count} demand/macro ${demand.count === 1 ? "story" : "stories"}.` : "Nothing demand-side reported." },
    { label: "News momentum", reading: bias, kind: "bias", detail: `${relevant.length} crude ${relevant.length === 1 ? "story" : "stories"} weighted by freshness and source.` },
  ];
  if (eiaCrudeBias) {
    components.push({ label: "EIA inventories", reading: eiaCrudeBias, kind: "bias", detail: "From the EIA's own reported weekly change (official figure, not a headline)." });
  }
  return {
    market: "CRUDE",
    title: "Crude Oil",
    bias,
    biasLabel: biasLabelFor(score),
    confidencePct,
    score,
    components,
    drivers: driversOf(relevant),
    counterRisks: counterRisksOf(relevant, bias),
    itemCount: relevant.length,
    quiet: quiet || relevant.length === 0,
  };
}

const NG_STORAGE_RULES = new Set(["storageBuild", "storageDraw"]);
const NG_PRODUCTION_RULES = new Set(["pipelineOutageNg", "pipelineExplosion", "hurricane"]);

export function ngPanel(items: GptNewsItem[], weather: WeatherRead, eiaStorageBias?: Bias): CommodityPanel {
  const { relevant, score, confidencePct, quiet } = panelCore(items, "NG");
  const storage = subsetBias(relevant, NG_STORAGE_RULES);
  const lng = relevant.filter((i) => i.categories.includes("lng"));
  const production = subsetBias(relevant, NG_PRODUCTION_RULES);
  const bias = biasFromScore(score);
  const components: BiasComponent[] = [
    { label: "Storage", reading: eiaStorageBias ?? (storage.count ? storage.bias : "neutral"), kind: "bias", detail: eiaStorageBias ? "From the EIA's own reported weekly storage change." : storage.count ? `${storage.count} storage ${storage.count === 1 ? "story" : "stories"} in the feed.` : "Nothing on storage in the feed." },
    { label: "Weather", reading: weather.bias, kind: "bias", detail: weather.headlineCount ? `${weather.headlineCount} weather ${weather.headlineCount === 1 ? "headline" : "headlines"}. No weather API connected.` : "No weather headlines. No weather API connected." },
    { label: "LNG", reading: lng.length ? netEffect(lng, "NG") : "neutral", kind: "bias", detail: lng.length ? `${lng.length} LNG ${lng.length === 1 ? "story" : "stories"}.` : "Nothing on LNG in the feed." },
    { label: "Production", reading: production.count ? production.bias : "neutral", kind: "bias", detail: production.count ? `${production.count} production/pipeline ${production.count === 1 ? "story" : "stories"}.` : "Nothing on production in the feed." },
    { label: "News momentum", reading: bias, kind: "bias", detail: `${relevant.length} gas ${relevant.length === 1 ? "story" : "stories"} weighted by freshness and source.` },
  ];
  return {
    market: "NG",
    title: "Natural Gas",
    bias,
    biasLabel: biasLabelFor(score),
    confidencePct,
    score,
    components,
    drivers: driversOf(relevant),
    counterRisks: counterRisksOf(relevant, bias),
    itemCount: relevant.length,
    quiet: quiet || relevant.length === 0,
  };
}

// ---- GPT Market Intelligence summary (spec section 35) ----
// Explicitly split into FACT / INTERPRETATION / ESTIMATE, because the spec
// forbids presenting an interpretation as a certainty.
export interface IntelligenceBlock {
  market: "CRUDE" | "NG";
  headline: string;
  /** Things that were actually reported. */
  facts: string[];
  /** What the engine reads into them. */
  interpretation: string;
  /** What would change the read. */
  counterRisks: string[];
  conclusion: string;
}

export function intelligenceFor(panel: CommodityPanel): IntelligenceBlock {
  const name = panel.market === "CRUDE" ? "CRUDE" : "NATURAL GAS";
  const facts = panel.drivers.map((d) => `${d.headline} — ${d.source}, ${d.ageLabel}`);
  const strongest = panel.components.find((c) => c.kind === "risk" && (c.reading === "high" || c.reading === "extreme"));
  const interpretation = panel.quiet
    ? "Nothing recent enough to drive a view. The balanced reading below reflects an absence of news, not a considered neutral call."
    : strongest
      ? `${strongest.label} is the dominant factor right now (${String(strongest.reading).toUpperCase()}), which is what tilts the overall read.`
      : `The read is driven by ${panel.itemCount} ${panel.itemCount === 1 ? "story" : "stories"} weighted by how fresh and how well-sourced each one is.`;
  return {
    market: panel.market,
    headline: `${name} BIAS: ${panel.biasLabel}`,
    facts: facts.length ? facts : ["No directional headlines in the feed for this commodity in the last 48 hours."],
    interpretation,
    counterRisks: panel.counterRisks,
    conclusion: panel.quiet
      ? "No tradeable news bias at the moment — the chart is the only thing talking."
      : `Current bias is ${panel.biasLabel.toLowerCase()} on news flow, confidence ${panel.confidencePct}%. This is a read on news pressure, not a forecast and not a guaranteed direction.`,
  };
}

// ---- MCX session helpers (spec sections 24 and 25) ----
export interface SessionInfo {
  isOpen: boolean;
  /** True on a Saturday/Sunday in IST. */
  isWeekend: boolean;
  /** e.g. "Monday 9:00 AM IST" -- computed, never guessed. */
  nextSessionLabel: string;
  minutesToOpen: number | null;
}

const MCX_OPEN_MIN = 9 * 60;
const MCX_CLOSE_MIN = 23 * 60 + 30;
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function sessionInfo(now: number = Date.now()): SessionInfo {
  const ist = new Date(now + 5.5 * 60 * 60 * 1000);
  const day = ist.getUTCDay();
  const minutes = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  const isWeekday = day >= 1 && day <= 5;
  const isOpen = isWeekday && minutes >= MCX_OPEN_MIN && minutes < MCX_CLOSE_MIN;
  const isWeekend = day === 0 || day === 6;

  // Walk forward to the next weekday 9:00 AM IST.
  let addDays = 0;
  if (isWeekday && minutes < MCX_OPEN_MIN) addDays = 0;
  else {
    addDays = 1;
    while (((day + addDays) % 7) === 0 || ((day + addDays) % 7) === 6) addDays++;
  }
  const targetDay = (day + addDays) % 7;
  const minutesToOpen = addDays * 1440 + MCX_OPEN_MIN - minutes;
  return {
    isOpen,
    isWeekend,
    nextSessionLabel: `${addDays === 0 ? "Today" : addDays === 1 ? "Tomorrow" : DAY_NAMES[targetDay]} 9:00 AM IST`,
    minutesToOpen: isOpen ? null : minutesToOpen,
  };
}

/**
 * Opening bias (spec section 24). This is an ESTIMATE and is labelled as one
 * everywhere it appears -- it is the direction the overseas benchmarks have
 * moved since MCX last traded, nothing more. It is NOT a predicted opening
 * price, and the function refuses to produce a reading with no live quote
 * rather than defaulting to "neutral".
 */
export interface OpeningBiasEstimate {
  available: boolean;
  bias: Bias;
  label: string;
  detail: string;
  drivers: { name: string; changePct: number }[];
}

export function openingBiasEstimate(quotes: { name: string; tracksMCX: string; changePercent: number | null }[], market: "CRUDEOIL" | "NATURALGAS"): OpeningBiasEstimate {
  const relevant = quotes.filter((q) => q.tracksMCX === market && typeof q.changePercent === "number");
  if (relevant.length === 0) {
    return { available: false, bias: "neutral", label: "Not available", detail: "No overseas benchmark quote is available, so no opening bias can be estimated.", drivers: [] };
  }
  const drivers = relevant.map((q) => ({ name: q.name, changePct: q.changePercent as number }));
  const avg = drivers.reduce((s, d) => s + d.changePct, 0) / drivers.length;
  const bias: Bias = avg >= 0.4 ? "bullish" : avg <= -0.4 ? "bearish" : "neutral";
  return {
    available: true,
    bias,
    label: bias === "bullish" ? "Gap-up bias" : bias === "bearish" ? "Gap-down bias" : "Neutral",
    detail: `${market === "CRUDEOIL" ? "WTI/Brent" : "Henry Hub"} ${avg >= 0 ? "up" : "down"} ${Math.abs(avg).toFixed(2)}% since the last MCX session. An estimate of direction only — not a predicted opening price.`,
    drivers,
  };
}

// ---- Upcoming events (spec section 26) ----
// The EIA publishes both of these on a fixed standing weekly schedule, so the
// NEXT date is arithmetic, not a forecast. Everything else on the spec's wish
// list (FOMC, CPI, NFP, OPEC meetings) needs a real calendar feed; those come
// from the FRED release calendar when a key is configured, and are simply
// absent otherwise rather than invented.
export interface UpcomingEvent {
  name: string;
  whenIso: string;
  whenLabel: string;
  importance: "HIGH" | "MEDIUM" | "LOW";
  affects: "CRUDE" | "NG" | "BOTH";
  source: string;
}

/** Next occurrence of a given UTC weekday+time, strictly in the future. */
function nextWeekdayUtc(now: number, weekday: number, utcHour: number, utcMinute: number): Date {
  const d = new Date(now);
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), utcHour, utcMinute, 0));
  let delta = (weekday - target.getUTCDay() + 7) % 7;
  if (delta === 0 && target.getTime() <= now) delta = 7;
  target.setUTCDate(target.getUTCDate() + delta);
  return target;
}

export function formatIst(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return `${d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "Asia/Kolkata" })} · ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" })} IST`;
}

export function eiaScheduleEvents(now: number = Date.now()): UpcomingEvent[] {
  // EIA Weekly Petroleum Status Report: Wednesdays 10:30 ET. EIA Weekly
  // Natural Gas Storage Report: Thursdays 10:30 ET. 10:30 ET = 15:30 UTC
  // during US daylight time; both shift by a US public holiday, which is why
  // the UI labels these "standing schedule".
  const crude = nextWeekdayUtc(now, 3, 15, 30);
  const storage = nextWeekdayUtc(now, 4, 15, 30);
  return [
    { name: "EIA Weekly Crude Inventories", whenIso: crude.toISOString(), whenLabel: formatIst(crude.toISOString()), importance: "HIGH", affects: "CRUDE", source: "EIA standing weekly schedule" },
    { name: "EIA Weekly Natural Gas Storage", whenIso: storage.toISOString(), whenLabel: formatIst(storage.toISOString()), importance: "HIGH", affects: "NG", source: "EIA standing weekly schedule" },
  ];
}

export function upcomingEvents(calendar: { name: string; date: string; affects: AffectedMarket; impact: "HIGH" | "MEDIUM" | "LOW" }[], now: number = Date.now()): UpcomingEvent[] {
  const fromCalendar: UpcomingEvent[] = calendar
    .filter((e) => new Date(`${e.date}T00:00:00Z`).getTime() >= now - 86_400_000)
    .map((e) => ({
      name: e.name,
      whenIso: `${e.date}T00:00:00Z`,
      // Date only -- FRED's release calendar gives the day, not the minute, so
      // printing a time here would be inventing precision.
      whenLabel: new Date(`${e.date}T00:00:00Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }),
      importance: e.impact,
      affects: e.affects === "BOTH" ? "BOTH" : e.affects === "CRUDE" ? "CRUDE" : "NG",
      source: "FRED release calendar",
    }));
  return [...eiaScheduleEvents(now), ...fromCalendar].sort((a, b) => a.whenIso.localeCompare(b.whenIso));
}

// ---- Positions (spec sections 8, 36, 37) ----
export interface PositionInput {
  id: string;
  symbol: "CRUDEOIL" | "NATURALGAS";
  strike: number;
  optSide: "CE" | "PE";
  expiry: string; // ISO date
  lots: number;
  avgPremium: number;
  /** User-defined monitoring levels on the UNDERLYING. Never presented as targets. */
  levels: { price: number; label: string }[];
}

export interface PositionRead {
  input: PositionInput;
  lotSize: number;
  underlying: number | null;
  premium: number | null;
  /** Rupees, across all lots. Null when there is no live premium. */
  pnlRs: number | null;
  breakeven: number;
  distanceToStrike: number | null;
  distanceToBreakeven: number | null;
  daysToExpiry: number | null;
  intrinsic: number | null;
  timeValue: number | null;
  /** True when expiry is close enough that time decay dominates. */
  expiryWarning: boolean;
  newsBias: Bias;
  newsNote: string;
}

export const LOT_SIZE: Record<"CRUDEOIL" | "NATURALGAS", number> = { CRUDEOIL: 100, NATURALGAS: 1250 };

export function readPosition(input: PositionInput, underlying: number | null, premium: number | null, panel: CommodityPanel | null, now: number = Date.now()): PositionRead {
  const lotSize = LOT_SIZE[input.symbol];
  const sign = input.optSide === "CE" ? 1 : -1;
  const breakeven = input.optSide === "CE" ? input.strike + input.avgPremium : input.strike - input.avgPremium;
  const expiryMs = new Date(`${input.expiry}T23:59:59+05:30`).getTime();
  const daysToExpiry = Number.isFinite(expiryMs) ? Math.max(0, Math.ceil((expiryMs - now) / 86_400_000)) : null;
  const intrinsic = underlying === null ? null : Math.max(0, sign * (underlying - input.strike));
  return {
    input,
    lotSize,
    underlying,
    premium,
    // Options here are always LONG the premium, so P&L is simply the premium
    // change times lot size times lots.
    pnlRs: premium === null ? null : Math.round((premium - input.avgPremium) * lotSize * input.lots),
    breakeven,
    distanceToStrike: underlying === null ? null : underlying - input.strike,
    distanceToBreakeven: underlying === null ? null : underlying - breakeven,
    daysToExpiry,
    intrinsic,
    timeValue: premium === null || intrinsic === null ? null : Math.max(0, premium - intrinsic),
    expiryWarning: daysToExpiry !== null && daysToExpiry <= 5,
    newsBias: panel?.bias ?? "neutral",
    newsNote: panel
      ? panel.quiet
        ? "No recent news pressure either way."
        : `News flow is ${panel.biasLabel.toLowerCase()} for ${panel.title.toLowerCase()} — ${input.optSide === "CE" ? "helpful" : "a headwind"} for a ${input.optSide}, if it holds.`
      : "News read unavailable.",
  };
}

/** The spec's default positions -- editable, and stored only in the browser. */
export const DEFAULT_POSITIONS: PositionInput[] = [
  {
    id: "crude-default",
    symbol: "CRUDEOIL",
    strike: 9450,
    optSide: "CE",
    expiry: "2026-09-17",
    lots: 1,
    avgPremium: 387.9,
    levels: [
      { price: 9500, label: "Warning" },
      { price: 9650, label: "Support" },
      { price: 9750, label: "Key level" },
      { price: 9900, label: "Breakout" },
      { price: 10000, label: "Psychological" },
      { price: 10200, label: "Strong bullish" },
    ],
  },
  {
    id: "ng-default",
    symbol: "NATURALGAS",
    strike: 270,
    optSide: "CE",
    expiry: "2026-09-23",
    lots: 2,
    avgPremium: 10.25,
    levels: [
      { price: 265, label: "Danger" },
      { price: 268, label: "Warning" },
      { price: 272, label: "Recovery" },
      { price: 275, label: "Bullish" },
      { price: 278, label: "Strong recovery" },
      { price: 280, label: "Strong bullish" },
    ],
  },
];

// ---- Alerts (spec section 19) ----
export interface AlertRule {
  id: string;
  kind: "price" | "percent" | "news";
  symbol: "CRUDEOIL" | "NATURALGAS" | "WTI" | "HENRYHUB";
  /** Price level, or percent move, or a keyword for news alerts. */
  value: number | string;
  label: string;
}

export interface FiredAlert {
  id: string;
  label: string;
  detail: string;
  severity: "info" | "warn" | "critical";
  /**
   * Identity of the OCCURRENCE, not of the rule. A percent rule stays true all
   * day while the number ticks, so keying on the text would re-notify on every
   * poll; keying on the rule alone would mean a level crossed twice only ever
   * alerts once. Each kind gets the key that makes it fire exactly as often as
   * something actually happened.
   */
  dedupeKey: string;
}

export const DEFAULT_ALERT_RULES: AlertRule[] = [
  { id: "wti-1", kind: "percent", symbol: "WTI", value: 1, label: "WTI moves ±1%" },
  { id: "wti-2", kind: "percent", symbol: "WTI", value: 2, label: "WTI moves ±2%" },
  { id: "hh-2", kind: "percent", symbol: "HENRYHUB", value: 2, label: "Henry Hub moves ±2%" },
  { id: "crude-9500", kind: "price", symbol: "CRUDEOIL", value: 9500, label: "MCX Crude crosses ₹9,500" },
  { id: "crude-9650", kind: "price", symbol: "CRUDEOIL", value: 9650, label: "MCX Crude crosses ₹9,650" },
  { id: "crude-9750", kind: "price", symbol: "CRUDEOIL", value: 9750, label: "MCX Crude crosses ₹9,750" },
  { id: "crude-9900", kind: "price", symbol: "CRUDEOIL", value: 9900, label: "MCX Crude crosses ₹9,900" },
  { id: "crude-10000", kind: "price", symbol: "CRUDEOIL", value: 10000, label: "MCX Crude crosses ₹10,000" },
  { id: "ng-265", kind: "price", symbol: "NATURALGAS", value: 265, label: "MCX Natural Gas crosses ₹265" },
  { id: "ng-268", kind: "price", symbol: "NATURALGAS", value: 268, label: "MCX Natural Gas crosses ₹268" },
  { id: "ng-272", kind: "price", symbol: "NATURALGAS", value: 272, label: "MCX Natural Gas crosses ₹272" },
  { id: "ng-275", kind: "price", symbol: "NATURALGAS", value: 275, label: "MCX Natural Gas crosses ₹275" },
  { id: "ng-278", kind: "price", symbol: "NATURALGAS", value: 278, label: "MCX Natural Gas crosses ₹278" },
  { id: "ng-280", kind: "price", symbol: "NATURALGAS", value: 280, label: "MCX Natural Gas crosses ₹280" },
  { id: "news-iran", kind: "news", symbol: "CRUDEOIL", value: "iran", label: "Major Iran news" },
  { id: "news-hormuz", kind: "news", symbol: "CRUDEOIL", value: "hormuz", label: "Hormuz news" },
  { id: "news-saudi", kind: "news", symbol: "CRUDEOIL", value: "saudi", label: "Saudi pipeline / production news" },
  { id: "news-houthi", kind: "news", symbol: "CRUDEOIL", value: "houthi", label: "Houthi attack" },
  { id: "news-opec", kind: "news", symbol: "CRUDEOIL", value: "opec", label: "OPEC surprise" },
  { id: "news-tanker", kind: "news", symbol: "CRUDEOIL", value: "tanker", label: "Tanker attack" },
  { id: "news-lng", kind: "news", symbol: "NATURALGAS", value: "lng", label: "Major LNG outage" },
  { id: "news-storage", kind: "news", symbol: "NATURALGAS", value: "storage", label: "EIA storage surprise" },
  { id: "news-weather", kind: "news", symbol: "NATURALGAS", value: "weather", label: "Major weather change" },
];

export interface AlertInputs {
  /** Live prices keyed by the alert symbols. Missing keys simply never fire. */
  prices: Partial<Record<AlertRule["symbol"], number | null>>;
  changePcts: Partial<Record<AlertRule["symbol"], number | null>>;
  items: GptNewsItem[];
  /** Prices at the previous evaluation, so a "crosses" rule fires on the cross, not on every tick. */
  previousPrices: Partial<Record<AlertRule["symbol"], number | null>>;
}

/**
 * Evaluates the enabled rules. A price rule fires only on an actual CROSS
 * between two observations -- firing on "price is above 9500" would re-alert on
 * every single poll, which is noise, not an alert.
 */
export function evaluateAlerts(rules: AlertRule[], enabled: Set<string>, input: AlertInputs): FiredAlert[] {
  const out: FiredAlert[] = [];
  for (const rule of rules) {
    if (!enabled.has(rule.id)) continue;
    if (rule.kind === "price") {
      const now = input.prices[rule.symbol];
      const before = input.previousPrices[rule.symbol];
      const level = rule.value as number;
      if (typeof now !== "number" || typeof before !== "number") continue;
      if ((before < level && now >= level) || (before > level && now <= level)) {
        const way = now >= level ? "up" : "down";
        out.push({
          id: rule.id,
          label: rule.label,
          detail: `Now ${now.toLocaleString("en-IN")} (was ${before.toLocaleString("en-IN")}).`,
          severity: "warn",
          // Direction is part of the key, so crossing back and forth alerts each way.
          dedupeKey: `${rule.id}|${way}`,
        });
      }
    } else if (rule.kind === "percent") {
      const pct = input.changePcts[rule.symbol];
      if (typeof pct !== "number") continue;
      if (Math.abs(pct) >= (rule.value as number)) {
        out.push({
          id: rule.id,
          label: rule.label,
          detail: `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}% on the day.`,
          severity: Math.abs(pct) >= 2 ? "critical" : "warn",
          // Once per rule per side: the threshold being breached is the event,
          // not each decimal it moves afterwards.
          dedupeKey: `${rule.id}|${pct >= 0 ? "up" : "down"}`,
        });
      }
    } else {
      const needle = String(rule.value).toLowerCase();
      const hit = input.items.find((i) => i.priority >= 4 && i.ageMin <= 60 && `${i.headline} ${i.summary}`.toLowerCase().includes(needle));
      // Keyed on the story, so a second Iran headline is a second alert.
      if (hit) out.push({ id: rule.id, label: rule.label, detail: hit.headline, severity: hit.priority === 5 ? "critical" : "warn", dedupeKey: `${rule.id}|${hit.id}` });
    }
  }
  return out;
}
