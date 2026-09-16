// Pullback vs Reversal -- the single engine behind the live dashboard AND the
// backtester.
//
// It answers one question: "price is falling now -- is this a pullback inside a
// bullish trend, or has the trend actually turned?" The whole design follows
// from that being a THREE-state question, not two. Forcing GREEN or RED when
// the evidence conflicts is how a signal system produces confident nonsense, so
// UNCERTAIN is a first-class answer here, not a failure to decide.
//
// Rules this file is built around:
//
//  * FALLING IS NOT BEARISH. A bullish 4H structure with support holding and
//    normal selling volume stays GREEN while price falls. Only a confirmed
//    structural break turns it RED.
//
//  * A CLOSE, NOT A WICK. Support is not "broken" because price traded through
//    it for a minute. It is broken when a candle CLOSES below it, and the
//    reversal case is much stronger when the retest then fails.
//
//  * THE SLOW TIMEFRAME OUTRANKS THE FAST ONE. A 5-minute dip cannot flip a
//    strongly bullish 4H read. Weights enforce that, and the 5M weight ships at
//    zero because this app deliberately removed 5M from every other engine for
//    being noise -- it is wired up and configurable, just off by default.
//
//  * NOTHING IS INVENTED. News, fundamentals and weather are OPTIONAL inputs.
//    When they are absent the engine says so, lowers data quality and caps
//    confidence, rather than scoring a zero as if it had checked and found
//    nothing. This is what lets the backtester run honestly without a news
//    archive: it simply passes no news, and the output admits it.
//
//  * PURE AND DETERMINISTIC. No fetching, no clock reads except the `now` you
//    pass in, no randomness. The same candles always produce the same answer,
//    which is the only way the live page and the backtest can be compared.

import type { Candle } from "../types";
import { emaLast, rsi, macd, adx, atr, superTrend, vwap, pivotPoints } from "./indicators";
import { findSwingPoints } from "./priceAction";

export type TfKey = "240" | "60" | "30" | "15" | "5";
export const TF_ORDER: TfKey[] = ["240", "60", "30", "15", "5"];
export const TF_LABEL: Record<TfKey, string> = { "240": "4H", "60": "1H", "30": "30M", "15": "15M", "5": "5M" };

export type PullbackState = "still_bullish" | "bearish" | "uncertain";
export type StructureHealth = "intact" | "weakening" | "broken" | "unknown";
export type Trend = "bullish" | "bearish" | "neutral";
export type FallKind = "none" | "normal_pullback" | "deep_pullback" | "possible_reversal" | "confirmed_reversal";
export type ZoneState = "holding" | "testing" | "rejected" | "broken" | "reclaimed" | "retesting" | "failed_retest" | "unknown";

/** Never claim more than this, ever (spec Part 25). */
export const MAX_CONFIDENCE = 94;
/** Below this many bars a timeframe is not scored at all. */
export const MIN_BARS_PER_TF = 30;

// ---- Configuration (spec Part 54: all of this must be changeable) ----

export interface PullbackWeights {
  /** Per-timeframe influence. Normalised over whichever timeframes actually have data. */
  timeframe: Record<TfKey, number>;
  /** Pillar mix. Must be read as relative, not absolute, for the same reason. */
  technical: number;
  momentum: number;
  news: number;
  dataQuality: number;
}

export interface PullbackConfig {
  weights: PullbackWeights;
  /** Zone width as a multiple of ATR (spec Part 11: zones, not exact numbers). */
  zoneAtrTolerance: number;
  /** Extra score a state must beat to flip, so noise cannot whipsaw it (Part 24). */
  hysteresis: number;
  /** Minutes a state must hold before it may flip again (Part 24). */
  cooldownMinutes: number;
  /** Net score needed to leave UNCERTAIN in either direction. */
  decisionThreshold: number;
  /** Minutes after which news stops counting as current (Part 17). */
  newsFreshMinutes: number;
}

export const DEFAULT_CONFIG: PullbackConfig = {
  weights: {
    // 4H sets the structure, 1H confirms it, 30M confirms the developing move,
    // 15M is timing. 5M ships at 0 -- see the header note.
    timeframe: { "240": 35, "60": 25, "30": 18, "15": 12, "5": 0 },
    technical: 50,
    momentum: 20,
    news: 20,
    dataQuality: 10,
  },
  zoneAtrTolerance: 0.5,
  hysteresis: 8,
  cooldownMinutes: 20,
  decisionThreshold: 12,
  newsFreshMinutes: 240,
};

// ---- Optional external evidence ----
// Every one of these is optional on purpose. `available: false` is materially
// different from `score: 0`, and the engine treats them differently.

export interface ExternalSignal {
  available: boolean;
  /** -100 (strongly bearish) .. +100 (strongly bullish). */
  score: number;
  /** How old the underlying data is, for the freshness decay in Part 17. */
  ageMinutes?: number;
  /** Shown to the user as the reason, never invented. */
  note?: string;
}

const ABSENT: ExternalSignal = { available: false, score: 0 };

export interface PullbackInput {
  commodity: "CRUDEOIL" | "NATURALGAS";
  /** Candles per timeframe, newest last. Missing timeframes are simply skipped. */
  timeframes: Partial<Record<TfKey, Candle[]>>;
  /** Daily candles, for the daily pivot in the zone builder. */
  dailyCandles?: Candle[];
  /** Live price. When null the engine still reads structure but says the price is unknown. */
  currentPrice?: number | null;
  news?: ExternalSignal;
  fundamentals?: ExternalSignal;
  /** Natural gas only; ignored for crude. */
  weather?: ExternalSignal;
  /** Previous state and when it was set, for whipsaw protection. */
  previousState?: PullbackState;
  previousStateAt?: number;
  now: number;
  config?: Partial<PullbackConfig>;
}

// ---- Output ----

export interface TfStructure {
  tf: TfKey;
  label: string;
  available: boolean;
  bars: number;
  trend: Trend;
  /** The most recent swing label: HH / HL / LH / LL. */
  swingLabel: "HH" | "HL" | "LH" | "LL" | null;
  health: StructureHealth;
  /** A close beyond the last swing extreme. */
  brokeStructure: boolean;
  /** A break AGAINST the prevailing trend -- the early reversal tell. */
  changeOfCharacter: boolean;
  lastSwingHigh: number | null;
  lastSwingLow: number | null;
  /** This timeframe's share of the final read, after normalising for missing data. */
  effectiveWeight: number;
}

export interface Zone {
  kind: "support" | "resistance";
  low: number;
  high: number;
  mid: number;
  /** What put this zone on the map -- swing low, daily pivot, VWAP, and so on. */
  sources: string[];
  /** How many independent things agree on it. */
  strength: number;
  distancePct: number | null;
  state: ZoneState;
}

export interface ScoreLine {
  label: string;
  points: number;
  detail: string;
}

export interface PullbackResult {
  commodity: "CRUDEOIL" | "NATURALGAS";
  timestamp: number;
  currentPrice: number | null;

  state: PullbackState;
  /** The headline, e.g. "STILL BULLISH". */
  stateLabel: string;
  /** The sub-line, e.g. "PULLBACK MAY BE POSSIBLE". */
  stateDetail: string;
  pullbackProbability: number;
  reversalProbability: number;
  /** MODEL CONFIDENCE. Never a probability of profit. */
  confidence: number;

  structures: Record<TfKey, TfStructure>;
  supportZones: Zone[];
  resistanceZones: Zone[];
  nearestSupport: Zone | null;
  majorSupport: Zone | null;
  nearestResistance: Zone | null;
  majorResistance: Zone | null;
  pullbackZone: Zone | null;

  fall: { kind: FallKind; label: string; detail: string; fromSwingHighPct: number | null; atrMultiple: number | null };

  bullishPullbackScore: number;
  bearishReversalScore: number;
  contributions: ScoreLine[];

  /** Price that would confirm the bullish case (Part 12). */
  bullishConfirmation: string;
  /** Price that would confirm the bearish case (Part 13). */
  bearishConfirmation: string;
  /** What would prove this call wrong (Part 27). */
  invalidation: string;

  conflictDetected: boolean;
  majorFundamentalShock: boolean;
  /** 0-10. Drives the confidence cap when data is missing or stale. */
  dataQuality: number;
  dataAgeMinutes: number | null;
  /** Green ticks on the card. */
  reasons: string[];
  /** Amber cautions on the card. */
  warnings: string[];
  /** True while whipsaw protection is deliberately holding the previous state. */
  heldByCooldown: boolean;
}

// ---- Small helpers ----

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const r2 = (n: number) => Math.round(n * 100) / 100;
const closes = (c: Candle[]) => c.map((x) => x.close);
const last = <T,>(a: T[]): T | undefined => a[a.length - 1];

function mergeConfig(partial?: Partial<PullbackConfig>): PullbackConfig {
  if (!partial) return DEFAULT_CONFIG;
  return {
    ...DEFAULT_CONFIG,
    ...partial,
    weights: {
      ...DEFAULT_CONFIG.weights,
      ...partial.weights,
      timeframe: { ...DEFAULT_CONFIG.weights.timeframe, ...partial.weights?.timeframe },
    },
  };
}

// ---- Part 7: trend structure per timeframe ----

/**
 * Reads HH/HL/LH/LL off the swing pivots and grades how healthy that structure
 * is. "Broken" deliberately requires a CLOSE beyond the last swing low, not a
 * wick -- the single most common cause of a false reversal call.
 */
export function readStructure(tf: TfKey, candles: Candle[] | undefined): TfStructure {
  const base: TfStructure = {
    tf, label: TF_LABEL[tf], available: false, bars: candles?.length ?? 0,
    trend: "neutral", swingLabel: null, health: "unknown", brokeStructure: false,
    changeOfCharacter: false, lastSwingHigh: null, lastSwingLow: null, effectiveWeight: 0,
  };
  if (!candles || candles.length < MIN_BARS_PER_TF) return base;

  const swings = findSwingPoints(candles);
  // findSwingPoints compares with <=, so a pivot whose neighbouring bar shares
  // the same high is emitted TWICE. Comparing the last two raw pivots then asks
  // "is 162.8 > 162.8", gets false, and reads a clean uptrend as lower highs --
  // the exact opposite of the truth. Collapsing equal-priced neighbours is what
  // makes the comparison mean what it says. (Left in place rather than fixed at
  // source: findSwingPoints is shared with engines that are already tuned
  // around its current behaviour.)
  const distinct = (type: "high" | "low") => {
    const out: number[] = [];
    for (const p of swings) {
      if (p.type !== type) continue;
      if (out.length && Math.abs(out[out.length - 1] - p.price) < 1e-9) out[out.length - 1] = p.price;
      else out.push(p.price);
    }
    return out;
  };
  const highs = distinct("high");
  const lows = distinct("low");
  const lastHigh = highs.length ? highs[highs.length - 1] : null;
  const lastLow = lows.length ? lows[lows.length - 1] : null;
  const priorHigh = highs.length >= 2 ? highs[highs.length - 2] : null;
  const priorLow = lows.length >= 2 ? lows[lows.length - 2] : null;
  const lastClose = last(candles)!.close;

  // Trend and label are derived here rather than taken from analyzeStructure,
  // for the same reason: this needs the de-duplicated pivots.
  let trend: Trend = "neutral";
  let swingLabel: TfStructure["swingLabel"] = null;
  if (lastHigh !== null && priorHigh !== null && lastLow !== null && priorLow !== null) {
    const risingHighs = lastHigh > priorHigh;
    const risingLows = lastLow > priorLow;
    if (risingHighs && risingLows) { trend = "bullish"; swingLabel = "HH"; }
    else if (!risingHighs && !risingLows) { trend = "bearish"; swingLabel = "LL"; }
    else swingLabel = risingHighs ? "LH" : "HL";
  }

  // A break of structure is a CLOSE beyond the last swing extreme, never a wick.
  const brokeUp = lastHigh !== null && lastClose > lastHigh;
  const brokeDown = lastLow !== null && lastClose < lastLow;
  const bos = brokeUp || brokeDown;
  const bosDirection: Trend = brokeUp ? "bullish" : brokeDown ? "bearish" : "neutral";
  const choch = bos && trend !== "neutral" && bosDirection !== trend;
  const s = { trend, label: swingLabel, bos, choch };

  // Health is about the LOWS in a bullish trend: higher lows mean the pullback
  // is being bought, a lower low means it is not.
  let health: StructureHealth = "unknown";
  if (s.trend === "bullish") {
    if (lastLow !== null && lastClose < lastLow) health = "broken";
    else if (s.choch || (priorLow !== null && lastLow !== null && lastLow <= priorLow)) health = "weakening";
    else health = "intact";
  } else if (s.trend === "bearish") {
    // For a bearish structure, "intact" means the downtrend is intact.
    health = lastHigh !== null && lastClose > lastHigh ? "broken" : s.choch ? "weakening" : "intact";
  } else {
    health = "weakening";
  }

  return {
    ...base,
    available: true,
    trend: s.trend,
    swingLabel: s.label,
    health,
    brokeStructure: s.bos,
    changeOfCharacter: s.choch,
    lastSwingHigh: lastHigh,
    lastSwingLow: lastLow,
  };
}

// ---- Part 11: dynamic support/resistance zones ----

interface RawLevel { price: number; source: string }

function collectLevels(input: PullbackInput): RawLevel[] {
  const out: RawLevel[] = [];
  const push = (price: number | null | undefined, source: string) => {
    if (typeof price === "number" && Number.isFinite(price) && price > 0) out.push({ price, source });
  };

  for (const tf of ["240", "60"] as TfKey[]) {
    const candles = input.timeframes[tf];
    if (!candles || candles.length < MIN_BARS_PER_TF) continue;
    const swings = findSwingPoints(candles);
    for (const p of swings.slice(-8)) push(p.price, `${TF_LABEL[tf]} swing ${p.type}`);
    push(Math.max(...candles.slice(-40).map((c) => c.high)), `${TF_LABEL[tf]} recent high`);
    push(Math.min(...candles.slice(-40).map((c) => c.low)), `${TF_LABEL[tf]} recent low`);
  }

  const hourly = input.timeframes["60"];
  if (hourly && hourly.length >= MIN_BARS_PER_TF) {
    push(vwap(hourly), "VWAP");
    push(emaLast(closes(hourly), 20), "EMA 20");
    push(emaLast(closes(hourly), 50), "EMA 50");
    const st = superTrend(hourly);
    push(st?.value ?? null, "SuperTrend");
  }

  const daily = input.dailyCandles;
  if (daily && daily.length >= 2) {
    const prev = daily[daily.length - 2];
    const p = pivotPoints(prev);
    push(p.pivot, "Daily pivot");
    push(p.s1, "Daily S1");
    push(p.s2, "Daily S2");
    push(p.r1, "Daily R1");
    push(p.r2, "Daily R2");
  }

  return out;
}

/**
 * Groups nearby levels into ZONES using an ATR-scaled tolerance, so the page
 * says "support 275.0-272.0" rather than pretending one exact number matters.
 * A zone backed by four different things is stronger than one backed by one,
 * and `strength` carries that.
 */
export function buildZones(levels: RawLevel[], price: number | null, atrValue: number, tolerance: number): Zone[] {
  if (levels.length === 0) return [];
  const width = Math.max(atrValue * tolerance, (price ?? levels[0].price) * 0.0005);
  const sorted = [...levels].sort((a, b) => a.price - b.price);

  const clusters: RawLevel[][] = [];
  for (const level of sorted) {
    const current = clusters[clusters.length - 1];
    if (current && level.price - current[current.length - 1].price <= width) current.push(level);
    else clusters.push([level]);
  }

  return clusters.map((cluster) => {
    const lo = cluster[0].price;
    const hi = cluster[cluster.length - 1].price;
    const mid = (lo + hi) / 2;
    const sources = Array.from(new Set(cluster.map((c) => c.source)));
    return {
      kind: price !== null && mid < price ? "support" : "resistance",
      low: r2(lo === hi ? lo - width / 2 : lo),
      high: r2(lo === hi ? hi + width / 2 : hi),
      mid: r2(mid),
      sources,
      strength: sources.length,
      distancePct: price !== null && price > 0 ? r2(((mid - price) / price) * 100) : null,
      state: "unknown" as ZoneState,
    };
  });
}

/**
 * How a zone is currently behaving (Part 11's seven states). The distinction
 * that matters most is BROKEN (a candle closed through) versus TESTING (price
 * merely reached it) -- everything downstream depends on not confusing them.
 */
export function classifyZoneState(zone: Zone, candles: Candle[], price: number | null): ZoneState {
  if (!candles.length || price === null) return "unknown";
  const recent = candles.slice(-6);
  const isSupport = zone.kind === "support";
  const closedThrough = recent.some((c) => (isSupport ? c.close < zone.low : c.close > zone.high));
  const wickedThrough = recent.some((c) => (isSupport ? c.low < zone.low : c.high > zone.high));
  const backInside = isSupport ? price >= zone.low : price <= zone.high;
  const inZone = price >= zone.low && price <= zone.high;

  if (closedThrough && !backInside) {
    // Broken, and a bounce back to the zone that fails is the strongest tell.
    // Start AFTER the breaking candle: its own wick is still inside the zone, so
    // including it would label every plain breakdown a "failed retest".
    const breakIndex = recent.findIndex((c) => (isSupport ? c.close < zone.low : c.close > zone.high));
    const afterBreak = recent.slice(breakIndex + 1);
    const retested = afterBreak.some((c) => (isSupport ? c.high >= zone.low : c.low <= zone.high));
    return retested ? "failed_retest" : "broken";
  }
  if (closedThrough && backInside) return "reclaimed";
  if (wickedThrough && backInside) return "rejected";
  if (inZone) return "testing";
  if (zone.distancePct !== null && Math.abs(zone.distancePct) < 0.35) return "retesting";
  return "holding";
}

// ---- Part 8: is price actually falling, and how badly ----

export interface FallRead {
  kind: FallKind;
  label: string;
  detail: string;
  fromSwingHighPct: number | null;
  atrMultiple: number | null;
  consecutiveLowerCloses: number;
  relativeVolume: number | null;
  belowVwap: boolean | null;
}

const FALL_LABEL: Record<FallKind, string> = {
  none: "No significant fall",
  normal_pullback: "Normal pullback",
  deep_pullback: "Deep pullback",
  possible_reversal: "Possible reversal",
  confirmed_reversal: "Confirmed reversal",
};

export function detectFall(candles: Candle[], structure: TfStructure, price: number | null): FallRead {
  const empty: FallRead = {
    kind: "none", label: FALL_LABEL.none, detail: "Not enough data to judge the move.",
    fromSwingHighPct: null, atrMultiple: null, consecutiveLowerCloses: 0, relativeVolume: null, belowVwap: null,
  };
  if (candles.length < MIN_BARS_PER_TF || price === null) return empty;

  const atrValue = atr(candles) ?? 0;
  // The reference high has to be the highest RECENT high, not merely the last
  // confirmed swing pivot. A pivot needs bars on both sides to be confirmed, so
  // right after a fresh top the last confirmed pivot is an old, much lower one --
  // measuring from it made a 4% drop read as "no significant fall".
  const recentHigh = Math.max(...candles.slice(-40).map((c) => c.high));
  const swingHigh = Math.max(structure.lastSwingHigh ?? 0, recentHigh);
  const fromHigh = swingHigh > 0 ? ((price - swingHigh) / swingHigh) * 100 : 0;
  const atrMultiple = atrValue > 0 ? (swingHigh - price) / atrValue : 0;

  let lowerCloses = 0;
  for (let i = candles.length - 1; i > 0; i--) {
    if (candles[i].close < candles[i - 1].close) lowerCloses++;
    else break;
  }

  const vols = candles.slice(-20).map((c) => c.volume ?? 0).filter((v) => v > 0);
  const avgVol = vols.length ? vols.reduce((a, b) => a + b, 0) / vols.length : 0;
  const lastVol = last(candles)?.volume ?? 0;
  const relativeVolume = avgVol > 0 ? r2(lastVol / avgVol) : null;
  const vw = vwap(candles);
  const belowVwap = vw === null ? null : price < vw;

  // A fall is graded by how far it has travelled in ATR terms AND what it did
  // to the structure -- never by "today's candle is red".
  let kind: FallKind = "none";
  if (structure.health === "broken" && (structure.trend === "bearish" || lowerCloses >= 2)) kind = "confirmed_reversal";
  else if (structure.health === "broken") kind = "possible_reversal";
  else if (atrMultiple >= 2.5 || fromHigh <= -2.5) kind = "deep_pullback";
  else if (atrMultiple >= 1 || fromHigh <= -0.8 || lowerCloses >= 3) kind = "normal_pullback";

  const detail =
    kind === "none"
      ? "Price is not meaningfully off its recent high."
      : `${Math.abs(fromHigh).toFixed(2)}% below the recent swing high (${atrMultiple.toFixed(1)}× ATR), ${lowerCloses} lower close${lowerCloses === 1 ? "" : "s"} in a row.`;

  return {
    kind, label: FALL_LABEL[kind], detail,
    fromSwingHighPct: r2(fromHigh), atrMultiple: r2(atrMultiple),
    consecutiveLowerCloses: lowerCloses, relativeVolume, belowVwap,
  };
}

// ---- Parts 9 and 10: the two scores ----

interface ScoreContext {
  structures: Record<TfKey, TfStructure>;
  hourly: Candle[] | undefined;
  price: number | null;
  nearestSupport: Zone | null;
  nearestResistance: Zone | null;
  fall: FallRead;
  news: ExternalSignal;
  fundamentals: ExternalSignal;
  weather: ExternalSignal;
}

function technicalLines(ctx: ScoreContext): { bull: ScoreLine[]; bear: ScoreLine[] } {
  const bull: ScoreLine[] = [];
  const bear: ScoreLine[] = [];
  const add = (side: ScoreLine[], label: string, points: number, detail: string) => {
    if (points > 0) side.push({ label, points, detail });
  };

  // Structure, weighted so the slow timeframes genuinely dominate.
  for (const tf of TF_ORDER) {
    const s = ctx.structures[tf];
    if (!s.available || s.effectiveWeight <= 0) continue;
    const w = s.effectiveWeight;
    if (s.trend === "bullish" && s.health === "intact") add(bull, `${s.label} structure`, Math.round(w * 0.5), `Higher highs and higher lows intact on ${s.label}.`);
    else if (s.trend === "bullish" && s.health === "weakening") {
      add(bull, `${s.label} structure`, Math.round(w * 0.2), `${s.label} still bullish but the last low did not hold up.`);
      add(bear, `${s.label} weakening`, Math.round(w * 0.2), `${s.label} higher-low sequence is faltering.`);
    } else if (s.health === "broken" || s.trend === "bearish") {
      add(bear, `${s.label} structure`, Math.round(w * 0.5), `${s.label} has made a lower low / closed below its last swing low.`);
    }
    if (s.changeOfCharacter) add(bear, `${s.label} character change`, Math.round(w * 0.15), `${s.label} broke structure against its own trend.`);
  }

  // Support behaviour -- the heart of the pullback case.
  const sup = ctx.nearestSupport;
  if (sup) {
    if (sup.state === "holding" || sup.state === "rejected") add(bull, "Support holding", 12, `${sup.low}-${sup.high} has not given way${sup.state === "rejected" ? " (wicked through and recovered)" : ""}.`);
    if (sup.state === "testing" || sup.state === "retesting") add(bull, "At support", 6, `Price is testing ${sup.low}-${sup.high}.`);
    if (sup.state === "reclaimed") add(bull, "Support reclaimed", 10, `Price closed back above ${sup.low}-${sup.high}.`);
    if (sup.state === "broken") add(bear, "Support broken", 16, `A candle closed below ${sup.low}-${sup.high}.`);
    if (sup.state === "failed_retest") add(bear, "Failed retest", 22, `${sup.low}-${sup.high} broke and then rejected price from below — the clearest reversal tell there is.`);
  }

  const h = ctx.hourly;
  if (h && h.length >= MIN_BARS_PER_TF && ctx.price !== null) {
    const st = superTrend(h);
    if (st) (st.direction === "bullish" ? add(bull, "SuperTrend", 6, "1H SuperTrend is bullish.") : add(bear, "SuperTrend", 6, "1H SuperTrend has flipped bearish."));
    const e20 = emaLast(closes(h), 20);
    const e50 = emaLast(closes(h), 50);
    if (e20 !== null && e50 !== null) {
      if (e20 > e50 && ctx.price > e50) add(bull, "EMA structure", 6, "1H EMA 20 above EMA 50 and price above both.");
      else if (e20 < e50 && ctx.price < e50) add(bear, "EMA breakdown", 6, "1H EMA 20 below EMA 50 and price under both.");
    }
    const vw = vwap(h);
    if (vw !== null) (ctx.price >= vw ? add(bull, "VWAP", 4, "Price is holding above VWAP.") : add(bear, "VWAP rejection", 4, "Price is trading below VWAP."));
  }

  return { bull, bear };
}

function momentumLines(ctx: ScoreContext): { bull: ScoreLine[]; bear: ScoreLine[] } {
  const bull: ScoreLine[] = [];
  const bear: ScoreLine[] = [];
  const h = ctx.hourly;
  if (!h || h.length < MIN_BARS_PER_TF) return { bull, bear };

  const r = rsi(closes(h));
  if (r !== null) {
    if (r >= 45 && r <= 70) bull.push({ label: "RSI", points: 6, detail: `RSI ${r.toFixed(0)} — healthy, not overbought.` });
    else if (r < 40) bear.push({ label: "RSI weakness", points: 6, detail: `RSI ${r.toFixed(0)} — momentum is weak.` });
  }
  const m = macd(closes(h));
  if (m) {
    if (m.histogram > 0) bull.push({ label: "MACD", points: 5, detail: "MACD histogram is positive." });
    else bear.push({ label: "MACD", points: 5, detail: "MACD histogram is negative." });
  }
  const a = adx(h);
  if (a !== null && a >= 20) {
    const trendIsUp = ctx.structures["60"].trend === "bullish";
    (trendIsUp ? bull : bear).push({ label: "ADX", points: 4, detail: `ADX ${a.toFixed(0)} — the move has real direction behind it.` });
  }

  // Volume on the way down is the classic pullback-versus-reversal separator.
  const rv = ctx.fall.relativeVolume;
  if (rv !== null) {
    if (rv < 0.9) bull.push({ label: "Selling volume", points: 8, detail: `Volume is ${rv.toFixed(2)}× normal — the fall is not being sold heavily.` });
    else if (rv > 1.6) bear.push({ label: "Heavy selling", points: 10, detail: `Volume is ${rv.toFixed(2)}× normal on the way down.` });
  }
  return { bull, bear };
}

function externalLines(ctx: ScoreContext, commodity: PullbackInput["commodity"], config: PullbackConfig): { bull: ScoreLine[]; bear: ScoreLine[]; warnings: string[] } {
  const bull: ScoreLine[] = [];
  const bear: ScoreLine[] = [];
  const warnings: string[] = [];

  const applyExternal = (signal: ExternalSignal, label: string, weight: number) => {
    if (!signal.available) {
      warnings.push(`${label} data is unavailable — it has been left out rather than scored as neutral.`);
      return;
    }
    // Freshness decay (Part 17): an old article must not weigh like breaking news.
    const age = signal.ageMinutes ?? 0;
    const freshness = age <= 0 ? 1 : clamp(1 - age / (config.newsFreshMinutes * 2), 0.15, 1);
    const points = Math.round((Math.abs(signal.score) / 100) * weight * freshness);
    if (points <= 0) return;
    const detail = signal.note ?? `${label} reading ${signal.score > 0 ? "+" : ""}${signal.score}${age ? `, ${Math.round(age)} min old` : ""}.`;
    (signal.score > 0 ? bull : bear).push({ label, points, detail });
  };

  applyExternal(ctx.news, "News", config.weights.news * 0.6);
  applyExternal(ctx.fundamentals, "Fundamentals", config.weights.news * 0.4);
  if (commodity === "NATURALGAS") applyExternal(ctx.weather, "Weather", config.weights.news * 0.4);

  return { bull, bear, warnings };
}

// ---- Part 21: a major fundamental shock ----

export function detectFundamentalShock(news: ExternalSignal, fundamentals: ExternalSignal, config: PullbackConfig): boolean {
  const shocking = (s: ExternalSignal) => s.available && Math.abs(s.score) >= 70 && (s.ageMinutes ?? 0) <= config.newsFreshMinutes;
  return shocking(news) || shocking(fundamentals);
}

// ---- The engine ----

export function evaluatePullbackReversal(input: PullbackInput): PullbackResult {
  const config = mergeConfig(input.config);
  const news = input.news ?? ABSENT;
  const fundamentals = input.fundamentals ?? ABSENT;
  const weather = input.weather ?? ABSENT;

  // 1. Structure on every timeframe that has enough data.
  const structures = {} as Record<TfKey, TfStructure>;
  for (const tf of TF_ORDER) structures[tf] = readStructure(tf, input.timeframes[tf]);

  // Weights are normalised over the timeframes that ACTUALLY have data, so a
  // missing 4H feed does not silently shrink the whole technical read.
  const usable = TF_ORDER.filter((tf) => structures[tf].available && config.weights.timeframe[tf] > 0);
  const weightSum = usable.reduce((s, tf) => s + config.weights.timeframe[tf], 0);
  for (const tf of TF_ORDER) {
    structures[tf].effectiveWeight = weightSum > 0 && usable.includes(tf) ? r2((config.weights.timeframe[tf] / weightSum) * 100) : 0;
  }

  const hourly = input.timeframes["60"];
  const reference = hourly ?? input.timeframes["30"] ?? input.timeframes["240"] ?? [];
  const price = input.currentPrice ?? last(reference)?.close ?? null;
  const atrValue = reference.length >= MIN_BARS_PER_TF ? atr(reference) ?? 0 : 0;

  // 2. Zones.
  const zones = buildZones(collectLevels(input), price, atrValue, config.zoneAtrTolerance)
    .map((z) => ({ ...z, state: classifyZoneState(z, reference, price) }));
  const supportZones = zones.filter((z) => z.kind === "support").sort((a, b) => b.mid - a.mid);
  const resistanceZones = zones.filter((z) => z.kind === "resistance").sort((a, b) => a.mid - b.mid);
  const nearestSupport = supportZones[0] ?? null;
  const majorSupport = [...supportZones].sort((a, b) => b.strength - a.strength || b.mid - a.mid)[0] ?? null;
  const nearestResistance = resistanceZones[0] ?? null;
  const majorResistance = [...resistanceZones].sort((a, b) => b.strength - a.strength || a.mid - b.mid)[0] ?? null;

  // 3. Is it falling, and how badly?
  const fall = detectFall(reference, structures["60"].available ? structures["60"] : structures["240"], price);

  // 4. Score both cases.
  const ctx: ScoreContext = { structures, hourly, price, nearestSupport, nearestResistance, fall, news, fundamentals, weather };
  const tech = technicalLines(ctx);
  const mom = momentumLines(ctx);
  const ext = externalLines(ctx, input.commodity, config);

  const bullLines = [...tech.bull, ...mom.bull, ...ext.bull];
  const bearLines = [...tech.bear, ...mom.bear, ...ext.bear];
  const bullishPullbackScore = clamp(Math.round(bullLines.reduce((s, l) => s + l.points, 0)), 0, 100);
  const bearishReversalScore = clamp(Math.round(bearLines.reduce((s, l) => s + l.points, 0)), 0, 100);

  // 5. Data quality (Part 49) -- drives the confidence cap.
  const availableTfs = TF_ORDER.filter((tf) => structures[tf].available).length;
  const wantedTfs = TF_ORDER.filter((tf) => config.weights.timeframe[tf] > 0).length;
  let dataQuality = 10;
  if (wantedTfs > 0) dataQuality -= Math.round((1 - availableTfs / wantedTfs) * 4);
  if (price === null) dataQuality -= 3;
  if (!news.available) dataQuality -= 1;
  if (input.commodity === "NATURALGAS" && !weather.available) dataQuality -= 1;
  if (!fundamentals.available) dataQuality -= 1;
  dataQuality = clamp(dataQuality, 0, 10);

  // 6. Conflict (Part 22) -- technical and news pulling opposite ways.
  const technicalNet = tech.bull.reduce((s, l) => s + l.points, 0) - tech.bear.reduce((s, l) => s + l.points, 0);
  const newsNet = ext.bull.reduce((s, l) => s + l.points, 0) - ext.bear.reduce((s, l) => s + l.points, 0);
  const conflictDetected = news.available && Math.abs(technicalNet) >= 10 && Math.abs(newsNet) >= 8 && Math.sign(technicalNet) !== Math.sign(newsNet);
  const majorFundamentalShock = detectFundamentalShock(news, fundamentals, config);

  // 7. The state, with whipsaw protection (Part 24).
  const net = bullishPullbackScore - bearishReversalScore;
  const prev = input.previousState;
  const minutesSinceChange = input.previousStateAt ? (input.now - input.previousStateAt) / 60000 : Infinity;
  // A settled state demands extra evidence to be overturned, so noise cannot
  // flip GREEN -> RED -> GREEN. This raises the bar; it never hides a genuine,
  // decisive reversal, which clears the higher bar easily.
  const bullBar = config.decisionThreshold + (prev === "bearish" ? config.hysteresis : 0);
  const bearBar = config.decisionThreshold + (prev === "still_bullish" ? config.hysteresis : 0);

  let state: PullbackState;
  if (conflictDetected) state = "uncertain";
  else if (net >= bullBar) state = "still_bullish";
  else if (-net >= bearBar) state = "bearish";
  else state = "uncertain";

  // Cooldown: a state that only just changed is not allowed to change straight
  // back unless the evidence is overwhelming.
  let heldByCooldown = false;
  if (prev && prev !== state && minutesSinceChange < config.cooldownMinutes && Math.abs(net) < config.decisionThreshold + config.hysteresis * 2) {
    state = prev;
    heldByCooldown = true;
  }

  // 8. Probabilities and confidence (Part 25).
  const total = bullishPullbackScore + bearishReversalScore;
  const pullbackProbability = total > 0 ? Math.round((bullishPullbackScore / total) * 100) : 50;
  const reversalProbability = 100 - pullbackProbability;

  const agreement = total > 0 ? Math.abs(net) / total : 0;
  const evidence = clamp(total / 80, 0, 1);
  let confidence = Math.round(35 + agreement * 40 + evidence * 20);
  confidence = Math.round(confidence * (0.6 + (dataQuality / 10) * 0.4));
  if (conflictDetected) confidence = Math.min(confidence, 55);
  if (state === "uncertain") confidence = Math.min(confidence, 65);
  if (majorFundamentalShock && Math.sign(technicalNet) !== Math.sign(newsNet)) confidence = Math.min(confidence, 50);
  confidence = clamp(confidence, 5, MAX_CONFIDENCE);

  // 9. Levels and the words around them (Parts 12, 13, 27, 28).
  const fmt = (n: number | null | undefined) => (typeof n === "number" ? n.toFixed(2) : "—");
  const bullishConfirmation = nearestResistance
    ? `A 1H candle CLOSE above ${fmt(nearestResistance.high)}, ideally followed by a successful retest, would confirm the upside.`
    : "No resistance zone is close enough to name a confirmation level.";
  const bearishConfirmation = nearestSupport
    ? `A 1H candle CLOSE below ${fmt(nearestSupport.low)} — a wick through is not enough — would confirm the downside.`
    : "No support zone is close enough to name a confirmation level.";
  const invalidation =
    state === "still_bullish"
      ? nearestSupport
        ? `This read is wrong if a 1H candle CLOSES below ${fmt(nearestSupport.low)} and the retest then fails.`
        : "This read is wrong if 1H closes below its last swing low and the retest fails."
      : state === "bearish"
        ? nearestResistance
          ? `This read is wrong if price reclaims ${fmt(nearestResistance.low)}, forms a 1H higher low and confirms a breakout.`
          : "This read is wrong if price reclaims the broken level and forms a 1H higher low."
        : "There is no call to invalidate yet — the evidence is genuinely split. Wait for a 1H close beyond one of the levels above.";

  // 10. The plain-language why (Part 26).
  const reasons = bullLines.sort((a, b) => b.points - a.points).slice(0, 6).map((l) => l.detail);
  const warnings = [...bearLines.sort((a, b) => b.points - a.points).slice(0, 4).map((l) => l.detail), ...ext.warnings];
  if (heldByCooldown) warnings.push("Whipsaw protection is holding the previous state: the evidence changed, but not decisively and not for long enough.");
  if (conflictDetected) warnings.push("The chart and the news disagree. That is why this reads UNCERTAIN rather than being forced one way.");
  if (majorFundamentalShock) warnings.push("A major fundamental headline is in play, which can override normal technical behaviour.");
  if (price === null) warnings.push("No live price is available, so distances to the levels above cannot be measured.");

  const stateLabel = state === "still_bullish" ? "STILL BULLISH" : state === "bearish" ? "BEARISH" : "UNCERTAIN";
  const stateDetail =
    state === "still_bullish" ? "Pullback may be possible" : state === "bearish" ? "Pullback not likely" : "Wait for confirmation";

  return {
    commodity: input.commodity,
    timestamp: input.now,
    currentPrice: price === null ? null : r2(price),
    state, stateLabel, stateDetail,
    pullbackProbability, reversalProbability, confidence,
    structures, supportZones, resistanceZones,
    nearestSupport, majorSupport, nearestResistance, majorResistance,
    pullbackZone: nearestSupport,
    fall: { kind: fall.kind, label: fall.label, detail: fall.detail, fromSwingHighPct: fall.fromSwingHighPct, atrMultiple: fall.atrMultiple },
    bullishPullbackScore, bearishReversalScore,
    contributions: [...bullLines.map((l) => ({ ...l })), ...bearLines.map((l) => ({ ...l, points: -l.points }))].sort((a, b) => Math.abs(b.points) - Math.abs(a.points)),
    bullishConfirmation, bearishConfirmation, invalidation,
    conflictDetected, majorFundamentalShock,
    dataQuality,
    dataAgeMinutes: news.available && news.ageMinutes !== undefined ? Math.round(news.ageMinutes) : null,
    reasons, warnings, heldByCooldown,
  };
}
