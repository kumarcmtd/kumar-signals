import type { Candle, Direction, IndicatorSnapshot } from "../types";
import { rsi, computeIndicatorSnapshot, macd } from "./indicators";
import { detectCandlePattern, findSwingPoints, analyzeStructure, type SwingPoint, type StructureAnalysis } from "./priceAction";
import { sessionDayKey } from "./tradeLogStats";
import { findPlaybookSetup, type ConfluenceFactor } from "./kimiPlaybook";

// Real rule-based scanners for the 13 Kimi AI playbook setups that are
// purely technical (price/indicator based). The other 3 setups in the
// playbook (EIA Storage/Inventory Reversal, OPEC News Gap Fill) depend on
// knowing whether a specific news event just happened -- this app has no
// news/economic-calendar feed, so those are intentionally NOT scanned here
// and stay catalog-only on the page, with that limitation stated plainly
// rather than faked.
//
// Every scanner outputs underlying-price entry/stop/target (the future's
// own price units), using "current price" as the entry reference -- the
// same convention timeframeEngine.ts already uses -- rather than a
// "wait for the exact breakout tick" state machine this app has no way to
// track between scans. Several named chart patterns (Double Bottom, Head &
// Shoulders, Trendline Break+Retest, Flag Breakout) are approximated with
// swing-point heuristics, not pixel-perfect pattern recognition -- the same
// honest-approximation approach already used by analyzeStructure().

export interface ScanResult {
  setupName: string;
  direction: Direction;
  entry: number;
  stop: number;
  target: number;
  notes: string[];
}

// Which of the matched playbook setup's requiredConfluence factors are
// ACTUALLY true right now, checked independently of whichever internal
// logic made this specific scanner fire. Several scanners fire without ever
// checking volume/trend/RSI-divergence/key-level factors their own playbook
// entry claims as required -- computing this generically from real ctx data
// (rather than assuming "it fired, so it must have every required factor")
// is what makes calculateHitProbability's missing-confluence check
// meaningful instead of a permanent no-op.
export interface ScannedResult extends ScanResult {
  detectedConfluence: ConfluenceFactor[];
}

interface ScanContext {
  candles: Candle[];
  closes: number[];
  snap: IndicatorSnapshot;
  swings: SwingPoint[];
  structure: StructureAnalysis;
  pattern: ReturnType<typeof detectCandlePattern>;
  last: Candle;
  prevMacd: { line: number; signal: number } | null;
  avgVolume: number;
  volumeRatio: number;
}

function pctDiff(a: number, b: number): number {
  return b === 0 ? Infinity : (Math.abs(a - b) / b) * 100;
}

// findSwingPoints() requires `lookback` bars AFTER a point to confirm it as a
// pivot, which means a swing that formed in the last few bars can NEVER be
// detected -- fatal for setups whose whole premise is "the pattern just
// completed on the latest bars" (a double bottom's second low, a shooting
// star's supply zone, a right shoulder). This scans a recent tail window
// with a much looser 1-bar lookback (a point just needs to be a local
// extreme vs its immediate neighbor on each side) to surface those very
// recent pivots as extra candidates alongside the properly-confirmed ones.
// A 1-bar-lookback pivot check flags every bar of a multi-bar dip/peak as its
// own "local extreme" (e.g. both candles of a 2-bar dip tie on the low), so
// without merging, adjacent points collapse what is really ONE swing into
// several near-duplicates -- which then corrupts anything comparing "the last
// two distinct lows/highs" (a double bottom's two dips would otherwise both
// resolve to the same dip's two candles). Points of the same type within
// `gap` bars of each other are merged into whichever is more extreme.
function mergeAdjacent(points: SwingPoint[], gap = 3): SwingPoint[] {
  const sorted = [...points].sort((a, b) => a.index - b.index);
  const merged: SwingPoint[] = [];
  for (const p of sorted) {
    const prev = merged[merged.length - 1];
    if (prev && prev.type === p.type && p.index - prev.index <= gap) {
      const morExtreme = p.type === "high" ? p.price > prev.price : p.price < prev.price;
      if (morExtreme) merged[merged.length - 1] = p;
    } else {
      merged.push(p);
    }
  }
  return merged;
}

function augmentWithRecentSwings(candles: Candle[], swings: SwingPoint[], window = 15): SwingPoint[] {
  const start = Math.max(1, candles.length - window);
  const end = candles.length - 1; // exclude the very last bar, which is "now"
  const augmented = [...swings];
  for (let i = start; i < end; i++) {
    const isHigh = candles[i].high >= candles[i - 1].high && candles[i].high >= candles[i + 1].high;
    const isLow = candles[i].low <= candles[i - 1].low && candles[i].low <= candles[i + 1].low;
    if (isHigh && !augmented.some((s) => s.type === "high" && s.index === i)) augmented.push({ index: i, price: candles[i].high, type: "high" });
    if (isLow && !augmented.some((s) => s.type === "low" && s.index === i)) augmented.push({ index: i, price: candles[i].low, type: "low" });
  }
  return mergeAdjacent(augmented.sort((a, b) => a.index - b.index));
}

function buildContext(candles: Candle[]): ScanContext | null {
  if (candles.length < 40) return null;
  const closes = candles.map((c) => c.close);
  const snap = computeIndicatorSnapshot(candles);
  const swings = augmentWithRecentSwings(candles, findSwingPoints(candles));
  const structure = analyzeStructure(candles);
  const pattern = detectCandlePattern(candles);
  const last = candles[candles.length - 1];
  const prevMacd = macd(closes.slice(0, -1));

  const recentVolumes = candles.slice(-11, -1).map((c) => c.volume ?? 0);
  const avgVolume = recentVolumes.length ? recentVolumes.reduce((s, v) => s + v, 0) / recentVolumes.length : 0;
  const volumeRatio = avgVolume > 0 ? (last.volume ?? 0) / avgVolume : 0;

  return { candles, closes, snap, swings, structure, pattern, last, prevMacd: prevMacd ? { line: prevMacd.line, signal: prevMacd.signal } : null, avgVolume, volumeRatio };
}

function scanBullishEngulfingEmaBounce(ctx: ScanContext): ScanResult | null {
  const { snap, pattern, last, volumeRatio } = ctx;
  if (snap.ema200 === null || snap.ema20 === null || snap.ema50 === null) return null;
  if (last.close <= snap.ema200) return null;
  if (pattern.pattern !== "bullish_engulfing") return null;
  const nearEma20 = pctDiff(last.close, snap.ema20) < 0.6;
  const nearEma50 = pctDiff(last.close, snap.ema50) < 0.6;
  if (!nearEma20 && !nearEma50) return null;
  if (volumeRatio < 1.5) return null;

  const entry = last.close;
  const stop = last.low * 0.997;
  const target = Number((entry + 1.75 * (entry - stop)).toFixed(2));
  return {
    setupName: "Bullish Engulfing + EMA Bounce",
    direction: "bullish",
    entry,
    stop: Number(stop.toFixed(2)),
    target,
    notes: [`Bullish engulfing at ${nearEma20 ? "EMA20" : "EMA50"} support`, `Volume ${volumeRatio.toFixed(1)}x average`, "Price above EMA200 (uptrend)"],
  };
}

function scanDoubleBottomVolumeSpike(ctx: ScanContext): ScanResult | null {
  const { swings, closes, last, volumeRatio } = ctx;
  const lows = swings.filter((s) => s.type === "low");
  if (lows.length < 2) return null;
  const [l1, l2] = lows.slice(-2);
  if (pctDiff(l1.price, l2.price) > 1.0) return null;
  const rsi1 = rsi(closes.slice(0, l1.index + 1));
  const rsi2 = rsi(closes.slice(0, l2.index + 1));
  if (rsi1 === null || rsi2 === null || rsi2 <= rsi1) return null;
  const between = swings.filter((s) => s.type === "high" && s.index > l1.index && s.index < l2.index);
  const neckline = between.length ? Math.max(...between.map((s) => s.price)) : Math.max(l1.price, l2.price) * 1.01;
  if (last.close <= neckline) return null;
  if (volumeRatio < 1.2) return null;

  const entry = last.close;
  const stop = Math.min(l1.price, l2.price) * 0.995;
  const depth = neckline - Math.min(l1.price, l2.price);
  const target = Number((neckline + depth).toFixed(2));
  return {
    setupName: "Double Bottom + Volume Spike",
    direction: "bullish",
    entry,
    stop: Number(stop.toFixed(2)),
    target,
    notes: ["Two similar-price swing lows with rising RSI (bullish divergence)", "Neckline broken with elevated volume"],
  };
}

function scanRsiDivergenceAtSupport(ctx: ScanContext): ScanResult | null {
  const { swings, closes, last, pattern } = ctx;
  const lows = swings.filter((s) => s.type === "low");
  if (lows.length < 2) return null;
  const [l1, l2] = lows.slice(-2);
  if (l2.price >= l1.price) return null; // must be a genuine lower low
  const rsi1 = rsi(closes.slice(0, l1.index + 1));
  const rsi2 = rsi(closes.slice(0, l2.index + 1));
  if (rsi1 === null || rsi2 === null || rsi2 <= rsi1) return null;
  const nearSupport = pctDiff(last.close, l2.price) < 0.6;
  if (!nearSupport) return null;
  if (!["bullish_engulfing", "hammer", "bullish_pin_bar"].includes(pattern.pattern)) return null;

  const entry = last.close;
  const stop = l2.price * 0.995;
  const target = Number((entry + 1.75 * (entry - stop)).toFixed(2));
  return {
    setupName: "RSI Divergence at Support",
    direction: "bullish",
    entry,
    stop: Number(stop.toFixed(2)),
    target,
    notes: ["Price lower low but RSI higher low (bullish divergence)", `${pattern.pattern.replace(/_/g, " ")} confirmation at support`],
  };
}

function scanBearishPinBarAtResistance(ctx: ScanContext): ScanResult | null {
  const { swings, last, pattern } = ctx;
  const highs = swings.filter((s) => s.type === "high");
  if (!highs.length) return null;
  const resistance = highs[highs.length - 1].price;
  if (pctDiff(last.high, resistance) > 0.6) return null;
  if (pattern.pattern !== "shooting_star" && pattern.pattern !== "bearish_pin_bar") return null;
  if (last.close >= last.low + (last.high - last.low) * 0.5) return null; // confirmation: close in lower half

  const entry = last.close;
  const stop = last.high * 1.003;
  const target = Number((entry - 1.5 * (stop - entry)).toFixed(2));
  return {
    setupName: "Bearish Pin Bar at Resistance",
    direction: "bearish",
    entry,
    stop: Number(stop.toFixed(2)),
    target,
    notes: [`${pattern.pattern.replace(/_/g, " ")} at resistance ${resistance.toFixed(2)}`, "Rejection confirmed by close in lower half of range"],
  };
}

function scan200EmaRejection(ctx: ScanContext): ScanResult | null {
  const { snap, pattern, last } = ctx;
  if (snap.ema200 === null) return null;
  if (last.close > snap.ema200) return null; // must still be at/below the level, not already broken above it
  if (pctDiff(last.close, snap.ema200) > 0.5) return null;
  if (!["bearish_engulfing", "shooting_star", "bearish_pin_bar"].includes(pattern.pattern)) return null;

  const entry = last.close;
  const stop = snap.ema200 * 1.005;
  const target = Number((entry - 1.5 * (stop - entry)).toFixed(2));
  return {
    setupName: "200 EMA Rejection",
    direction: "bearish",
    entry,
    stop: Number(stop.toFixed(2)),
    target,
    notes: [`Rally rejected at 200 EMA (${snap.ema200.toFixed(2)})`, `${pattern.pattern.replace(/_/g, " ")} reversal candle`],
  };
}

function scanFlagBreakout(ctx: ScanContext): ScanResult | null {
  const { candles, snap, last } = ctx;
  if (!snap.bollinger || candles.length < 25) return null;
  const bandWidthNow = snap.bollinger.upper - snap.bollinger.lower;
  const priorCloses = candles.slice(-25, -10).map((c) => c.close);
  const priorRange = Math.max(...priorCloses) - Math.min(...priorCloses);
  if (priorRange <= 0) return null;
  const poleMove = Math.max(...candles.slice(-25, -10).map((c) => c.high)) - Math.min(...candles.slice(-25, -10).map((c) => c.low));
  const consolidation = candles.slice(-10, -1);
  const consolHigh = Math.max(...consolidation.map((c) => c.high));
  const consolLow = Math.min(...consolidation.map((c) => c.low));
  const contracted = bandWidthNow < (consolHigh - consolLow) * 1.2 && consolHigh - consolLow < priorRange * 0.6;
  if (!contracted) return null;

  if (last.close > consolHigh) {
    const entry = last.close;
    const stop = consolLow * 0.997;
    const target = Number((entry + poleMove).toFixed(2));
    return { setupName: "Flag Breakout (30-min)", direction: "bullish", entry, stop: Number(stop.toFixed(2)), target, notes: ["Broke above flag consolidation", "Target = pole height projected from breakout"] };
  }
  if (last.close < consolLow) {
    const entry = last.close;
    const stop = consolHigh * 1.003;
    const target = Number((entry - poleMove).toFixed(2));
    return { setupName: "Flag Breakout (30-min)", direction: "bearish", entry, stop: Number(stop.toFixed(2)), target, notes: ["Broke below flag consolidation", "Target = pole height projected from breakout"] };
  }
  return null;
}

function scanOpeningRangeBreakout(ctx: ScanContext, todaysCandles: Candle[]): ScanResult | null {
  if (todaysCandles.length < 8) return null; // need at least ~first hour of bars
  const rangeBars = todaysCandles.slice(0, Math.min(12, Math.floor(todaysCandles.length / 2)));
  const rangeHigh = Math.max(...rangeBars.map((c) => c.high));
  const rangeLow = Math.min(...rangeBars.map((c) => c.low));
  const width = rangeHigh - rangeLow;
  if (width <= 0) return null;
  const last = ctx.last;
  if (todaysCandles.length <= rangeBars.length) return null; // still inside the opening range window itself

  if (last.close > rangeHigh) {
    const entry = last.close;
    const stop = rangeLow;
    const target = Number((entry + 1.5 * width).toFixed(2));
    return { setupName: "Opening Range Breakout", direction: "bullish", entry, stop: Number(stop.toFixed(2)), target, notes: [`Broke above opening range high (${rangeHigh.toFixed(2)})`] };
  }
  if (last.close < rangeLow) {
    const entry = last.close;
    const stop = rangeHigh;
    const target = Number((entry - 1.5 * width).toFixed(2));
    return { setupName: "Opening Range Breakout", direction: "bearish", entry, stop: Number(stop.toFixed(2)), target, notes: [`Broke below opening range low (${rangeLow.toFixed(2)})`] };
  }
  return null;
}

function scanTrendlineBreakRetest(ctx: ScanContext): ScanResult | null {
  const { structure, swings, last } = ctx;
  if (!structure.bos || !structure.choch) return null; // a break AGAINST the prior trend just occurred
  const relevantSwings = swings.filter((s) => s.type === (structure.bosDirection === "bullish" ? "high" : "low"));
  if (!relevantSwings.length) return null;
  const brokenLevel = relevantSwings[relevantSwings.length - 1].price;
  const nearRetest = pctDiff(last.close, brokenLevel) < 0.8;
  if (!nearRetest) return null;

  if (structure.bosDirection === "bullish") {
    const entry = last.close;
    const stop = brokenLevel * 0.99;
    const target = Number((entry + 1.75 * (entry - stop)).toFixed(2));
    return { setupName: "Trendline Break + Retest", direction: "bullish", entry, stop: Number(stop.toFixed(2)), target, notes: ["Structure broke bullish, price retesting the broken level"] };
  }
  const entry = last.close;
  const stop = brokenLevel * 1.01;
  const target = Number((entry - 1.75 * (stop - entry)).toFixed(2));
  return { setupName: "Trendline Break + Retest", direction: "bearish", entry, stop: Number(stop.toFixed(2)), target, notes: ["Structure broke bearish, price retesting the broken level"] };
}

function scanVwapRejection(ctx: ScanContext): ScanResult | null {
  const { snap, last, pattern } = ctx;
  if (snap.vwap === null) return null;
  const extensionPct = ((last.close - snap.vwap) / snap.vwap) * 100;
  const rsiVal = snap.rsi14;
  if (rsiVal === null) return null;

  if (extensionPct > 1.5 && rsiVal > 65 && ["bearish_engulfing", "shooting_star", "bearish_pin_bar"].includes(pattern.pattern)) {
    const entry = last.close;
    const stop = snap.vwap * 1.003 > entry ? entry * 1.003 : snap.vwap * 1.003;
    const target = Number(snap.vwap.toFixed(2));
    return { setupName: "VWAP Rejection (Intraday)", direction: "bearish", entry, stop: Number(stop.toFixed(2)), target, notes: [`${extensionPct.toFixed(1)}% above VWAP, RSI ${rsiVal.toFixed(0)} overbought`] };
  }
  if (extensionPct < -1.5 && rsiVal < 35 && ["bullish_engulfing", "hammer", "bullish_pin_bar"].includes(pattern.pattern)) {
    const entry = last.close;
    const stop = snap.vwap * 0.997 < entry ? entry * 0.997 : snap.vwap * 0.997;
    const target = Number(snap.vwap.toFixed(2));
    return { setupName: "VWAP Rejection (Intraday)", direction: "bullish", entry, stop: Number(stop.toFixed(2)), target, notes: [`${Math.abs(extensionPct).toFixed(1)}% below VWAP, RSI ${rsiVal.toFixed(0)} oversold`] };
  }
  return null;
}

function scanHeadAndShoulders(ctx: ScanContext): ScanResult | null {
  const { swings, last } = ctx;
  const highs = swings.filter((s) => s.type === "high");
  const lows = swings.filter((s) => s.type === "low");
  if (highs.length < 3 || lows.length < 2) return null;
  const [leftShoulder, head, rightShoulder] = highs.slice(-3);
  if (!(head.price > leftShoulder.price && head.price > rightShoulder.price)) return null;
  if (pctDiff(leftShoulder.price, rightShoulder.price) > 3) return null; // shoulders roughly symmetric
  const troughs = lows.filter((l) => l.index > leftShoulder.index && l.index < rightShoulder.index);
  if (troughs.length < 2) return null;
  const neckline = (troughs[0].price + troughs[troughs.length - 1].price) / 2;
  if (last.close >= neckline) return null;

  const entry = last.close;
  const stop = rightShoulder.price * 1.003;
  const depth = head.price - neckline;
  const target = Number((entry - depth).toFixed(2));
  return {
    setupName: "Head & Shoulders Pattern",
    direction: "bearish",
    entry,
    stop: Number(stop.toFixed(2)),
    target,
    notes: ["Three-peak pattern with middle (head) highest", `Neckline (${neckline.toFixed(2)}) broken with close below`],
  };
}

function scanHammerAt200Ema(ctx: ScanContext): ScanResult | null {
  const { snap, pattern, last } = ctx;
  if (snap.ema200 === null) return null;
  if (last.close <= snap.ema200) return null;
  if (pctDiff(last.close, snap.ema200) > 0.6) return null;
  if (pattern.pattern !== "hammer") return null;

  const entry = last.close;
  const stop = last.low * 0.997;
  const target = Number((entry + 1.75 * (entry - stop)).toFixed(2));
  return { setupName: "Hammer at 200 EMA Support", direction: "bullish", entry, stop: Number(stop.toFixed(2)), target, notes: [`Hammer forms testing 200 EMA (${snap.ema200.toFixed(2)}) in an uptrend`] };
}

function scanShootingStarAtSupply(ctx: ScanContext): ScanResult | null {
  const { swings, pattern, last } = ctx;
  const highs = swings.filter((s) => s.type === "high");
  if (!highs.length) return null;
  const supply = highs[highs.length - 1].price;
  if (pctDiff(last.high, supply) > 0.6) return null;
  if (pattern.pattern !== "shooting_star") return null;

  const entry = last.close;
  const stop = last.high * 1.003;
  const target = Number((entry - 1.5 * (stop - entry)).toFixed(2));
  return { setupName: "Shooting Star at Supply Zone", direction: "bearish", entry, stop: Number(stop.toFixed(2)), target, notes: [`Shooting star rejects supply zone at ${supply.toFixed(2)}`] };
}

function scanMacdBullishCrossoverBelowZero(ctx: ScanContext): ScanResult | null {
  const { snap, prevMacd, last, swings } = ctx;
  if (!snap.macd || !prevMacd) return null;
  if (snap.macd.line >= 0 || snap.macd.signal >= 0) return null;
  const justCrossed = snap.macd.line > snap.macd.signal && prevMacd.line <= prevMacd.signal;
  if (!justCrossed) return null;
  const lows = swings.filter((s) => s.type === "low");
  if (!lows.length) return null;

  const entry = last.close;
  const stop = lows[lows.length - 1].price * 0.995;
  const target = Number((entry + 1.5 * (entry - stop)).toFixed(2));
  return { setupName: "MACD Bullish Crossover < 0", direction: "bullish", entry, stop: Number(stop.toFixed(2)), target, notes: ["MACD crossed above signal while both below zero (early reversal)"] };
}

const NG_SCANNERS = [scanBullishEngulfingEmaBounce, scanDoubleBottomVolumeSpike, scanRsiDivergenceAtSupport, scanBearishPinBarAtResistance, scan200EmaRejection, scanFlagBreakout];
const CL_SCANNERS = [scanTrendlineBreakRetest, scanVwapRejection, scanHeadAndShoulders, scanHammerAt200Ema, scanShootingStarAtSupply, scanMacdBullishCrossoverBelowZero];

// v2.1 CRITICAL FIX from the playbook: live testing of the raw scanner
// output showed a 0% win rate traced to stops far tighter than the setup's
// own natural volatility (a 3.1pt stop on 4.5 ATR = 0.69x, when the setup
// needed 1.5x = 6.75pts). Every scanner result is now floored to each
// setup's own minAtrSl/minAtrTarget (from the playbook catalog) using the
// SAME ATR(14) already computed for this timeframe -- widening the stop
// and target outward from entry if the setup's natural rule would leave
// them narrower than that minimum, in whichever direction the trade runs.
function applyAtrFloor(r: ScanResult, atr14: number | null, commodity: "NG" | "CL"): ScanResult {
  if (!atr14 || atr14 <= 0) return r;
  const setup = findPlaybookSetup(r.setupName, commodity);
  if (!setup) return r;
  const minStopDist = atr14 * setup.minAtrSl;
  const minTargetDist = atr14 * setup.minAtrTarget;
  const bullish = r.direction === "bullish";
  let stop = r.stop;
  let target = r.target;
  let widened = false;
  if (bullish) {
    if (r.entry - r.stop < minStopDist) {
      stop = Number((r.entry - minStopDist).toFixed(2));
      widened = true;
    }
    if (r.target - r.entry < minTargetDist) {
      target = Number((r.entry + minTargetDist).toFixed(2));
      widened = true;
    }
  } else {
    if (r.stop - r.entry < minStopDist) {
      stop = Number((r.entry + minStopDist).toFixed(2));
      widened = true;
    }
    if (r.entry - r.target < minTargetDist) {
      target = Number((r.entry - minTargetDist).toFixed(2));
      widened = true;
    }
  }
  if (!widened) return r;
  return { ...r, stop, target, notes: [...r.notes, `Stop/target widened to ${setup.minAtrSl}x/${setup.minAtrTarget}x ATR minimum (was too tight)`] };
}

// Real bullish/bearish RSI divergence between the last two opposing swing
// points -- price making a lower low (bullish) or higher high (bearish)
// while RSI moves the other way. Reused generically here rather than
// duplicated per-scanner, since only 2 of the 7 setups claiming
// "divergence_rsi" actually computed this inline.
function hasRsiDivergence(ctx: ScanContext, direction: Direction): boolean {
  const { swings, closes } = ctx;
  if (direction === "bullish") {
    const lows = swings.filter((s) => s.type === "low");
    if (lows.length < 2) return false;
    const [a, b] = lows.slice(-2);
    if (b.price >= a.price) return false;
    const r1 = rsi(closes.slice(0, a.index + 1));
    const r2 = rsi(closes.slice(0, b.index + 1));
    return r1 !== null && r2 !== null && r2 > r1;
  }
  if (direction === "bearish") {
    const highs = swings.filter((s) => s.type === "high");
    if (highs.length < 2) return false;
    const [a, b] = highs.slice(-2);
    if (b.price <= a.price) return false;
    const r1 = rsi(closes.slice(0, a.index + 1));
    const r2 = rsi(closes.slice(0, b.index + 1));
    return r1 !== null && r2 !== null && r2 < r1;
  }
  return false;
}

// Is price genuinely near a recent, opposing swing level right now (a real
// support for a bullish trade, a real resistance for a bearish one) --
// reused generically for the same reason as hasRsiDivergence above.
function nearKeyLevel(ctx: ScanContext, direction: Direction, tolerancePct = 0.8): boolean {
  const { swings, last } = ctx;
  const relevant = swings.filter((s) => s.type === (direction === "bullish" ? "low" : "high"));
  if (!relevant.length) return false;
  const level = relevant[relevant.length - 1].price;
  const price = direction === "bullish" ? last.low : last.high;
  return pctDiff(price, level) < tolerancePct;
}

// Checks each of the matched setup's requiredConfluence factors against
// real, currently-computed market data -- NOT against whatever the scanner
// happened to check internally to fire. This is what makes it honest: a
// factor only counts as detected if it demonstrably holds right now.
function detectConfluence(ctx: ScanContext, r: ScanResult, required: ConfluenceFactor[]): ConfluenceFactor[] {
  const out: ConfluenceFactor[] = [];
  for (const f of required) {
    if (f === "volume_spike_1_5x" && ctx.volumeRatio >= 1.5) out.push(f);
    else if (f === "volume_spike_2x" && ctx.volumeRatio >= 2) out.push(f);
    else if (f === "trend_aligned" && ctx.structure.trend === r.direction) out.push(f);
    else if (f === "divergence_rsi" && hasRsiDivergence(ctx, r.direction)) out.push(f);
    else if (f === "key_level_sr" && nearKeyLevel(ctx, r.direction)) out.push(f);
  }
  return out;
}

function withConfluence(r: ScanResult, ctx: ScanContext, commodity: "NG" | "CL"): ScannedResult {
  const setup = findPlaybookSetup(r.setupName, commodity);
  return { ...r, detectedConfluence: setup ? detectConfluence(ctx, r, setup.requiredConfluence) : [] };
}

export function scanNaturalGasSetups(candles: Candle[], todaysCandles: Candle[]): ScannedResult[] {
  const ctx = buildContext(candles);
  if (!ctx) return [];
  const results = NG_SCANNERS.map((fn) => fn(ctx)).filter((r): r is ScanResult => r !== null);
  const orb = scanOpeningRangeBreakout(ctx, todaysCandles);
  if (orb) results.push(orb);
  return results.map((r) => withConfluence(applyAtrFloor(r, ctx.snap.atr14, "NG"), ctx, "NG"));
}

export function scanCrudeOilSetups(candles: Candle[]): ScannedResult[] {
  const ctx = buildContext(candles);
  if (!ctx) return [];
  return CL_SCANNERS.map((fn) => fn(ctx))
    .filter((r): r is ScanResult => r !== null)
    .map((r) => withConfluence(applyAtrFloor(r, ctx.snap.atr14, "CL"), ctx, "CL"));
}

// Candles belonging to the same MCX session day as the most recent candle --
// used as the Opening Range Breakout's "today so far" window.
function todaysCandles(candles: Candle[]): Candle[] {
  if (!candles.length) return [];
  const lastKey = sessionDayKey(new Date(candles[candles.length - 1].date).getTime());
  const idx = candles.findIndex((c) => sessionDayKey(new Date(c.date).getTime()) === lastKey);
  return idx === -1 ? candles : candles.slice(idx);
}

export interface TimedScanResult extends ScannedResult {
  tf: string;
  tfLabel: string;
}

interface TfCandles {
  tf: string;
  label: string;
  candles: Candle[];
}

// Runs every technical setup for one commodity across all supplied
// timeframes and tags each hit with the timeframe it fired on -- a setup's
// "best timeframe" in the playbook is usually a loose range (e.g.
// "30-min / 1-hour"), so rather than guess a single match we scan everything
// available and let the trader see exactly where it's currently valid.
export function scanAllSetups(commodity: "NG" | "CL", timeframes: TfCandles[]): TimedScanResult[] {
  const out: TimedScanResult[] = [];
  for (const { tf, label, candles } of timeframes) {
    const results = commodity === "NG" ? scanNaturalGasSetups(candles, todaysCandles(candles)) : scanCrudeOilSetups(candles);
    for (const r of results) out.push({ ...r, tf, tfLabel: label });
  }
  return out;
}
