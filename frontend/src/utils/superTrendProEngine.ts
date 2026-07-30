import type { Candle, Direction } from "../types";
import { emaLast, atr, macd, rsi, superTrend, vwap, bollingerBands } from "./indicators";
import { findSwingPoints, analyzeStructure, type StructureAnalysis } from "./priceAction";

// AI SuperTrend Pro's own engine. Every other engine in this app (AI-Shoot,
// Best Call, AI-Test Pro/V2, AI Elite, AI-Risk, Kimi Playbook) trades OPTION
// PREMIUM off a strike -- this one deliberately doesn't. It's a raw
// futures/underlying-price signal engine: entry/stop/targets are all in the
// underlying's own price, no option chain involved at all (Options Chain is
// an explicit future module, not part of this build). That also means this
// page keeps working even during the option-chain outages that periodically
// affect every other page here.

const IST_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" });
const IST_TIME_FORMATTER = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false });

function lastSessionCandles(candles: Candle[]): Candle[] {
  if (!candles.length) return candles;
  const lastDay = IST_DATE_FORMATTER.format(new Date(candles[candles.length - 1].date));
  const idx = candles.findIndex((c) => IST_DATE_FORMATTER.format(new Date(c.date)) === lastDay);
  return idx === -1 ? candles : candles.slice(idx);
}

function priorSessionCandles(candles: Candle[]): Candle[] {
  const lastSession = lastSessionCandles(candles);
  const before = candles.slice(0, candles.length - lastSession.length);
  if (!before.length) return [];
  const priorDay = IST_DATE_FORMATTER.format(new Date(before[before.length - 1].date));
  const idx = before.findIndex((c) => IST_DATE_FORMATTER.format(new Date(c.date)) === priorDay);
  return idx === -1 ? before : before.slice(idx);
}

// --- Indicators not already covered by utils/indicators.ts ---------------

export function keltnerChannel(candles: Candle[], period = 20, mult = 1.5): { upper: number; middle: number; lower: number } | null {
  if (candles.length < period) return null;
  const middle = emaLast(candles.map((c) => c.close), period);
  const a = atr(candles, period);
  if (middle === null || a === null) return null;
  return { upper: middle + mult * a, middle, lower: middle - mult * a };
}

// +DI/-DI alongside ADX -- utils/indicators.ts's adx() folds these away
// internally, but DMI is its own listed indicator here.
export function dmi(candles: Candle[], period = 14): { plusDI: number; minusDI: number; adx: number } | null {
  if (candles.length < period * 2) return null;
  const plusDM: number[] = [0];
  const minusDM: number[] = [0];
  const tr: number[] = [candles[0].high - candles[0].low];
  for (let i = 1; i < candles.length; i++) {
    const upMove = candles[i].high - candles[i - 1].high;
    const downMove = candles[i - 1].low - candles[i].low;
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
    const prevClose = candles[i - 1].close;
    tr.push(Math.max(candles[i].high - candles[i].low, Math.abs(candles[i].high - prevClose), Math.abs(candles[i].low - prevClose)));
  }
  const smooth = (values: number[]): number[] => {
    const k = 2 / (period + 1);
    const out = [values[0]];
    for (let i = 1; i < values.length; i++) out.push(values[i] * k + out[i - 1] * (1 - k));
    return out;
  };
  const smoothTR = smooth(tr);
  const smoothPlusDM = smooth(plusDM);
  const smoothMinusDM = smooth(minusDM);
  const plusDIs: number[] = [];
  const minusDIs: number[] = [];
  const dx: number[] = [];
  for (let i = 0; i < smoothTR.length; i++) {
    if (smoothTR[i] === 0) {
      plusDIs.push(0);
      minusDIs.push(0);
      dx.push(0);
      continue;
    }
    const pDI = (smoothPlusDM[i] / smoothTR[i]) * 100;
    const mDI = (smoothMinusDM[i] / smoothTR[i]) * 100;
    plusDIs.push(pDI);
    minusDIs.push(mDI);
    const sum = pDI + mDI;
    dx.push(sum === 0 ? 0 : (Math.abs(pDI - mDI) / sum) * 100);
  }
  const adxSeries = smooth(dx);
  const result = { plusDI: plusDIs[plusDIs.length - 1], minusDI: minusDIs[minusDIs.length - 1], adx: adxSeries[adxSeries.length - 1] };
  if (!Number.isFinite(result.plusDI) || !Number.isFinite(result.minusDI) || !Number.isFinite(result.adx)) return null;
  return result;
}

export function rateOfChange(values: number[], period = 10): number | null {
  if (values.length < period + 1) return null;
  const base = values[values.length - 1 - period];
  if (!base) return null;
  return Number((((values[values.length - 1] - base) / base) * 100).toFixed(2));
}

export function momentumValue(values: number[], period = 10): number | null {
  if (values.length < period + 1) return null;
  return Number((values[values.length - 1] - values[values.length - 1 - period]).toFixed(4));
}

export function volumeStats(candles: Candle[], period = 20): { sma: number | null; relative: number | null } {
  if (candles.length < period + 1) return { sma: null, relative: null };
  const window = candles.slice(-period - 1, -1);
  const sma = window.reduce((s, c) => s + (c.volume ?? 0), 0) / window.length;
  const last = candles[candles.length - 1].volume ?? 0;
  return { sma, relative: sma > 0 ? Number((last / sma).toFixed(2)) : null };
}

export function camarillaPivot(prevCandle: Candle) {
  const { high, low, close } = prevCandle;
  const range = high - low;
  const pivot = (high + low + close) / 3;
  return {
    pivot,
    r4: close + range * 1.1 / 2,
    r3: close + range * 1.1 / 4,
    r2: close + range * 1.1 / 6,
    r1: close + range * 1.1 / 12,
    s1: close - range * 1.1 / 12,
    s2: close - range * 1.1 / 6,
    s3: close - range * 1.1 / 4,
    s4: close - range * 1.1 / 2,
  };
}

export function fibonacciLevels(candles: Candle[], lookback = 50): { swingHigh: number; swingLow: number; levels: Record<string, number> } | null {
  if (candles.length < 5) return null;
  const window = candles.slice(-lookback);
  const swingHigh = Math.max(...window.map((c) => c.high));
  const swingLow = Math.min(...window.map((c) => c.low));
  if (swingHigh <= swingLow) return null;
  const range = swingHigh - swingLow;
  return {
    swingHigh,
    swingLow,
    levels: {
      "23.6": Number((swingHigh - range * 0.236).toFixed(4)),
      "38.2": Number((swingHigh - range * 0.382).toFixed(4)),
      "50": Number((swingHigh - range * 0.5).toFixed(4)),
      "61.8": Number((swingHigh - range * 0.618).toFixed(4)),
      "78.6": Number((swingHigh - range * 0.786).toFixed(4)),
    },
  };
}

export interface SupportResistance {
  support: number | null;
  resistance: number | null;
  dynamicSupport: number | null;
  dynamicResistance: number | null;
  prevDayHigh: number | null;
  prevDayLow: number | null;
  prevDayClose: number | null;
}

// "Static" support/resistance = the widest recent swing extremes (structural
// levels that have held for a while); "dynamic" = the tightest nearby swing
// extremes (levels actively in play right now). Both derived from the same
// swing-pivot detector market structure already uses, so they agree with the
// HH/HL/LH/LL read elsewhere on this page instead of contradicting it.
export function autoSupportResistance(candles: Candle[]): SupportResistance {
  const swings = findSwingPoints(candles, 3);
  const highs = swings.filter((s) => s.type === "high").map((s) => s.price);
  const lows = swings.filter((s) => s.type === "low").map((s) => s.price);
  const prior = priorSessionCandles(candles);
  const prevDayHigh = prior.length ? Math.max(...prior.map((c) => c.high)) : null;
  const prevDayLow = prior.length ? Math.min(...prior.map((c) => c.low)) : null;
  const prevDayClose = prior.length ? prior[prior.length - 1].close : null;
  return {
    support: lows.length ? Math.min(...lows.slice(-6)) : null,
    resistance: highs.length ? Math.max(...highs.slice(-6)) : null,
    dynamicSupport: lows.length ? lows[lows.length - 1] : null,
    dynamicResistance: highs.length ? highs[highs.length - 1] : null,
    prevDayHigh,
    prevDayLow,
    prevDayClose,
  };
}

export interface BreakoutFlags {
  openingRange: boolean;
  range: boolean;
  volume: boolean;
  support: boolean;
  resistance: boolean;
  trendline: boolean;
  direction: Direction;
}

// Simple linear-regression trendline fit through the last `period` closes --
// a plain-language "trendline breakout" reads as price closing meaningfully
// above/below where that trendline projects to right now.
function trendlineBreak(closes: number[], period = 20): { broke: boolean; direction: Direction } {
  if (closes.length < period) return { broke: false, direction: "neutral" };
  const window = closes.slice(-period);
  const n = window.length;
  const xs = Array.from({ length: n }, (_, i) => i);
  const meanX = xs.reduce((s, v) => s + v, 0) / n;
  const meanY = window.reduce((s, v) => s + v, 0) / n;
  const slope = xs.reduce((s, x, i) => s + (x - meanX) * (window[i] - meanY), 0) / xs.reduce((s, x) => s + (x - meanX) ** 2, 0);
  const intercept = meanY - slope * meanX;
  const projected = intercept + slope * (n - 1);
  const last = window[window.length - 1];
  const tolerance = Math.abs(projected) * 0.002;
  if (last > projected + tolerance) return { broke: true, direction: "bullish" };
  if (last < projected - tolerance) return { broke: true, direction: "bearish" };
  return { broke: false, direction: "neutral" };
}

export function detectBreakouts(candles: Candle[], sr: SupportResistance, relVolume: number | null): BreakoutFlags {
  const session = lastSessionCandles(candles);
  const last = candles[candles.length - 1];
  // Opening range = first 30 minutes of today's own session (however many
  // bars that is on this timeframe, minimum 1).
  const openingBars = Math.max(1, Math.min(session.length, Math.ceil(30 / Math.max(1, (+new Date(session[1]?.date ?? session[0].date) - +new Date(session[0].date)) / 60000))));
  const openingRangeBars = session.slice(0, openingBars);
  const orHigh = openingRangeBars.length ? Math.max(...openingRangeBars.map((c) => c.high)) : null;
  const orLow = openingRangeBars.length ? Math.min(...openingRangeBars.map((c) => c.low)) : null;
  const openingRange = orHigh !== null && orLow !== null && session.length > openingBars && (last.close > orHigh || last.close < orLow);

  const donchian = candles.slice(-11, -1);
  const rangeHigh = donchian.length ? Math.max(...donchian.map((c) => c.high)) : null;
  const rangeLow = donchian.length ? Math.min(...donchian.map((c) => c.low)) : null;
  const range = rangeHigh !== null && rangeLow !== null && (last.close > rangeHigh || last.close < rangeLow);

  const volume = relVolume !== null && relVolume >= 1.5;
  const support = sr.support !== null && last.close < sr.support;
  const resistance = sr.resistance !== null && last.close > sr.resistance;
  const tl = trendlineBreak(candles.map((c) => c.close));

  let direction: Direction = "neutral";
  if (resistance || (range && last.close > (rangeHigh ?? 0)) || tl.direction === "bullish") direction = "bullish";
  else if (support || (range && last.close < (rangeLow ?? Infinity)) || tl.direction === "bearish") direction = "bearish";

  return { openingRange, range, volume, support, resistance, trendline: tl.broke, direction };
}

export interface EmaStack {
  ema9: number | null;
  ema20: number | null;
  ema50: number | null;
  ema100: number | null;
  ema200: number | null;
  stacked: Direction; // all EMAs in bullish/bearish order, or neutral (mixed)
}

export function emaStackOf(closes: number[]): EmaStack {
  const ema9 = emaLast(closes, 9);
  const ema20 = emaLast(closes, 20);
  const ema50 = emaLast(closes, 50);
  const ema100 = emaLast(closes, 100);
  const ema200 = emaLast(closes, 200);
  let stacked: Direction = "neutral";
  if (ema9 !== null && ema20 !== null && ema50 !== null) {
    if (ema9 > ema20 && ema20 > ema50 && (ema100 === null || ema50 > ema100) && (ema200 === null || (ema100 ?? ema50) > ema200)) stacked = "bullish";
    else if (ema9 < ema20 && ema20 < ema50 && (ema100 === null || ema50 < ema100) && (ema200 === null || (ema100 ?? ema50) < ema200)) stacked = "bearish";
  }
  return { ema9, ema20, ema50, ema100, ema200, stacked };
}

export type MarketStatusLabel = "Strong Buy" | "Buy" | "Bullish" | "Wait" | "Range" | "Neutral" | "Weak Sell" | "Sell" | "Strong Sell";
export type RiskLevel = "Very Low" | "Low" | "Medium" | "High" | "Very High";
export type VolatilityLevel = "Low" | "Medium" | "High" | "Extreme";

interface Vote {
  label: string;
  weight: number;
  vote: -1 | 0 | 1;
  note: string;
}

export interface ConfidenceResult {
  buyPct: number;
  sellPct: number;
  waitPct: number;
  netScore: number; // -1..1
  tradeQuality: number; // 0-100, % of factors agreeing with the net direction
  votes: Vote[];
}

// Weights straight from the spec (they add to 120, not 100 -- normalized
// below so the three probabilities are a real distribution rather than
// claiming more than 100% of confidence exists).
const WEIGHTS = {
  superTrend: 15,
  emaAlignment: 15,
  vwap: 10,
  adx: 10,
  macd: 10,
  rsi: 10,
  volume: 10,
  higherTimeframe: 10,
  supportResistance: 5,
  pivot: 5,
  momentum: 5,
  volatility: 5,
};

function computeConfidence(votes: Vote[]): ConfidenceResult {
  const totalWeight = votes.reduce((s, v) => s + v.weight, 0);
  const weightedSum = votes.reduce((s, v) => s + v.vote * v.weight, 0);
  const netScore = totalWeight > 0 ? weightedSum / totalWeight : 0;
  const agreeing = votes.filter((v) => v.vote !== 0 && Math.sign(v.vote) === Math.sign(netScore)).reduce((s, v) => s + v.weight, 0);
  const decided = votes.filter((v) => v.vote !== 0).reduce((s, v) => s + v.weight, 0);
  const tradeQuality = decided > 0 ? Math.round((agreeing / decided) * 100) : 0;

  const edge = Math.abs(netScore);
  const waitPct = Math.round(Math.max(15, 60 * (1 - edge)));
  const directional = 100 - waitPct;
  const buyShare = (netScore + 1) / 2;
  const buyPct = Math.round(directional * buyShare);
  const sellPct = 100 - waitPct - buyPct;
  return { buyPct, sellPct, waitPct, netScore: Number(netScore.toFixed(3)), tradeQuality, votes };
}

export interface TradeSetup {
  direction: Direction;
  entry: number;
  currentPrice: number;
  stopLoss: number;
  atrStop: number;
  trailingStop: number;
  targets: [number, number, number, number, number];
  targetsHit: [boolean, boolean, boolean, boolean, boolean];
  rr: number;
  expectedProfit: number;
  expectedLoss: number;
}

// Trailing stop mirrors the same philosophy every other engine in this app
// already uses (lock in profit as targets are hit rather than waiting for a
// deep original stop) -- generalized to 5 targets: the floor rises to the
// PREVIOUS target's level once the next one is hit (T1 hit -> floor at
// entry; T2 hit -> floor at T1; ... T5 hit -> fully closed).
export function effectiveStopForSetup(setup: Pick<TradeSetup, "entry" | "targets" | "stopLoss">, targetsHit: boolean[]): number {
  for (let i = targetsHit.length - 1; i >= 1; i--) {
    if (targetsHit[i]) return setup.targets[i - 1];
  }
  if (targetsHit[0]) return setup.entry;
  return setup.stopLoss;
}

export interface SuperTrendProSnapshot {
  trend: Direction;
  trendStrength: number;
  superTrend: { value: number; direction: Direction } | null;
  emaStack: EmaStack;
  vwap: number | null;
  rsi14: number | null;
  macd: { line: number; signal: number; histogram: number } | null;
  keltner: { upper: number; middle: number; lower: number } | null;
  bollinger: { upper: number; middle: number; lower: number } | null;
  dmi: { plusDI: number; minusDI: number; adx: number } | null;
  atr14: number | null;
  momentum: number | null;
  roc: number | null;
  volumeRatio: number | null;
  volumeSma: number | null;
  structure: StructureAnalysis;
  sr: SupportResistance;
  pivots: { pivot: number; r1: number; r2: number; r3: number; s1: number; s2: number; s3: number } | null;
  camarilla: ReturnType<typeof camarillaPivot> | null;
  fibonacci: ReturnType<typeof fibonacciLevels>;
  breakouts: BreakoutFlags;
  higherTfTrend: Direction | null;
  confidence: ConfidenceResult;
  marketStatus: MarketStatusLabel;
  riskLevel: RiskLevel;
  volatilityLevel: VolatilityLevel;
  tradeSetup: TradeSetup | null;
  supportingReasons: string[];
  opposingReasons: string[];
  smartSuggestions: string[];
  lastPrice: number;
  asOf: string;
}

const ATR_STOP_MULT = 1.5;
const ATR_TARGET_MULTS: [number, number, number, number, number] = [1, 1.8, 2.6, 3.5, 4.5];

export function computeSuperTrendPro(candles: Candle[], higherTfCandles: Candle[] | null): SuperTrendProSnapshot | null {
  if (candles.length < 60) return null;
  const closes = candles.map((c) => c.close);
  const last = candles[candles.length - 1];

  const st = superTrend(candles);
  const emaStack = emaStackOf(closes);
  const vwapValue = vwap(lastSessionCandles(candles));
  const rsiValue = rsi(closes);
  const macdValue = macd(closes);
  const keltner = keltnerChannel(candles);
  const boll = bollingerBands(closes);
  const dmiValue = dmi(candles);
  const atrValue = atr(candles);
  const momentum = momentumValue(closes, 10);
  const roc = rateOfChange(closes, 10);
  const vol = volumeStats(candles);
  const structure = analyzeStructure(candles);
  const sr = autoSupportResistance(candles);
  const pivots = candles.length >= 2 ? { ...pivotsFrom(prevSessionLast(candles)) } : null;
  const camarilla = candles.length >= 2 ? camarillaPivot(prevSessionLast(candles)) : null;
  const fib = fibonacciLevels(candles);
  const breakouts = detectBreakouts(candles, sr, vol.relative);

  let higherTfTrend: Direction | null = null;
  if (higherTfCandles && higherTfCandles.length >= 60) {
    const hSt = superTrend(higherTfCandles);
    const hEma = emaStackOf(higherTfCandles.map((c) => c.close));
    higherTfTrend = hSt?.direction ?? (hEma.stacked !== "neutral" ? hEma.stacked : null);
  }

  const votes: Vote[] = [];
  if (st) votes.push({ label: "SuperTrend", weight: WEIGHTS.superTrend, vote: st.direction === "bullish" ? 1 : -1, note: `SuperTrend is ${st.direction} (₹${st.value.toFixed(2)})` });
  if (emaStack.stacked !== "neutral") votes.push({ label: "EMA Alignment", weight: WEIGHTS.emaAlignment, vote: emaStack.stacked === "bullish" ? 1 : -1, note: `EMAs stacked ${emaStack.stacked}` });
  else votes.push({ label: "EMA Alignment", weight: WEIGHTS.emaAlignment, vote: 0, note: "EMAs are mixed, not stacked in either direction" });
  if (vwapValue !== null) votes.push({ label: "VWAP", weight: WEIGHTS.vwap, vote: last.close > vwapValue ? 1 : -1, note: `Price is ${last.close > vwapValue ? "above" : "below"} session VWAP (₹${vwapValue.toFixed(2)})` });
  if (dmiValue) votes.push({ label: "ADX/DMI", weight: WEIGHTS.adx, vote: dmiValue.adx < 20 ? 0 : dmiValue.plusDI > dmiValue.minusDI ? 1 : -1, note: dmiValue.adx < 20 ? `ADX ${dmiValue.adx.toFixed(1)} -- trend too weak to read` : `+DI ${dmiValue.plusDI > dmiValue.minusDI ? "above" : "below"} -DI, ADX ${dmiValue.adx.toFixed(1)}` });
  if (macdValue) votes.push({ label: "MACD", weight: WEIGHTS.macd, vote: macdValue.histogram > 0 ? 1 : macdValue.histogram < 0 ? -1 : 0, note: `MACD histogram ${macdValue.histogram > 0 ? "positive" : "negative"} (${macdValue.histogram.toFixed(3)})` });
  if (rsiValue !== null) votes.push({ label: "RSI", weight: WEIGHTS.rsi, vote: rsiValue > 55 ? 1 : rsiValue < 45 ? -1 : 0, note: `RSI ${rsiValue.toFixed(1)}` });
  if (vol.relative !== null) votes.push({ label: "Volume", weight: WEIGHTS.volume, vote: vol.relative >= 1.2 ? (last.close > (candles[candles.length - 2]?.close ?? last.close) ? 1 : -1) : 0, note: `Volume ${vol.relative}x its ${20}-bar average` });
  if (higherTfTrend) votes.push({ label: "Higher Timeframe", weight: WEIGHTS.higherTimeframe, vote: higherTfTrend === "bullish" ? 1 : -1, note: `Higher timeframe trend is ${higherTfTrend}` });
  if (sr.support !== null && sr.resistance !== null) {
    const mid = (sr.support + sr.resistance) / 2;
    votes.push({ label: "Support & Resistance", weight: WEIGHTS.supportResistance, vote: last.close > mid ? 1 : -1, note: `Price is on the ${last.close > mid ? "resistance" : "support"} side of its recent range` });
  }
  if (pivots) votes.push({ label: "Pivot", weight: WEIGHTS.pivot, vote: last.close > pivots.pivot ? 1 : -1, note: `Price is ${last.close > pivots.pivot ? "above" : "below"} the classic pivot` });
  if (momentum !== null) votes.push({ label: "Momentum", weight: WEIGHTS.momentum, vote: momentum > 0 ? 1 : momentum < 0 ? -1 : 0, note: `10-bar momentum is ${momentum > 0 ? "positive" : "negative"}` });
  const atrPct = atrValue !== null ? (atrValue / last.close) * 100 : null;
  votes.push({ label: "Volatility", weight: WEIGHTS.volatility, vote: 0, note: atrPct !== null ? `ATR is ${atrPct.toFixed(2)}% of price` : "ATR unavailable" });

  const confidence = computeConfidence(votes);

  const adxNow = dmiValue?.adx ?? null;
  let marketStatus: MarketStatusLabel;
  const s = confidence.netScore;
  if (s > 0.55 && adxNow !== null && adxNow >= 25 && higherTfTrend === "bullish") marketStatus = "Strong Buy";
  else if (s > 0.55 && adxNow !== null && adxNow >= 25 && higherTfTrend === "bearish") marketStatus = "Wait"; // higher TF disagrees -- spec: only Strong when aligned
  else if (s > 0.3) marketStatus = "Buy";
  else if (s > 0.1) marketStatus = "Bullish";
  else if (s < -0.55 && adxNow !== null && adxNow >= 25 && higherTfTrend === "bearish") marketStatus = "Strong Sell";
  else if (s < -0.55 && adxNow !== null && adxNow >= 25 && higherTfTrend === "bullish") marketStatus = "Wait";
  else if (s < -0.3) marketStatus = "Sell";
  else if (s < -0.1) marketStatus = "Weak Sell";
  else if (adxNow !== null && adxNow < 15) marketStatus = "Range";
  else marketStatus = "Wait";

  let volatilityLevel: VolatilityLevel = "Low";
  if (atrPct !== null) {
    if (atrPct >= 1.2) volatilityLevel = "Extreme";
    else if (atrPct >= 0.6) volatilityLevel = "High";
    else if (atrPct >= 0.3) volatilityLevel = "Medium";
  }

  let riskLevel: RiskLevel = "Medium";
  const edge = Math.abs(confidence.netScore);
  if (volatilityLevel === "Extreme" || edge < 0.1) riskLevel = "Very High";
  else if (volatilityLevel === "High" || edge < 0.25) riskLevel = "High";
  else if (edge >= 0.5 && (volatilityLevel === "Low" || volatilityLevel === "Medium")) riskLevel = edge >= 0.7 ? "Very Low" : "Low";

  const tradeDirection: Direction | null = marketStatus === "Strong Buy" || marketStatus === "Buy" || marketStatus === "Bullish" ? "bullish" : marketStatus === "Strong Sell" || marketStatus === "Sell" || marketStatus === "Weak Sell" ? "bearish" : null;

  let tradeSetup: TradeSetup | null = null;
  if (tradeDirection && atrValue !== null) {
    const sign = tradeDirection === "bullish" ? 1 : -1;
    const entry = last.close;
    const stopLoss = Number((entry - sign * atrValue * ATR_STOP_MULT).toFixed(4));
    const targets = ATR_TARGET_MULTS.map((m) => Number((entry + sign * atrValue * m).toFixed(4))) as [number, number, number, number, number];
    const targetsHit: [boolean, boolean, boolean, boolean, boolean] = [false, false, false, false, false];
    const trailingStop = effectiveStopForSetup({ entry, targets, stopLoss }, targetsHit);
    tradeSetup = {
      direction: tradeDirection,
      entry,
      currentPrice: last.close,
      stopLoss,
      atrStop: stopLoss,
      trailingStop,
      targets,
      targetsHit,
      rr: Number((Math.abs(targets[0] - entry) / Math.abs(entry - stopLoss)).toFixed(2)),
      expectedProfit: Number(Math.abs(targets[0] - entry).toFixed(4)),
      expectedLoss: Number(Math.abs(entry - stopLoss).toFixed(4)),
    };
  }

  const supportingReasons = votes.filter((v) => v.vote !== 0 && Math.sign(v.vote) === Math.sign(confidence.netScore || 1)).map((v) => v.note);
  const opposingReasons = votes.filter((v) => v.vote !== 0 && Math.sign(v.vote) !== Math.sign(confidence.netScore || 1)).map((v) => v.note);

  const smartSuggestions: string[] = [];
  if (adxNow !== null && adxNow >= 25) smartSuggestions.push("Trend is strong.");
  if (higherTfTrend && tradeDirection && higherTfTrend !== tradeDirection) smartSuggestions.push(`Higher timeframe is ${higherTfTrend} -- avoid counter-trend trades.`);
  if (vol.relative !== null && vol.relative < 0.9) smartSuggestions.push("Volume confirmation missing.");
  if (rsiValue !== null && ((tradeDirection === "bullish" && rsiValue > 70) || (tradeDirection === "bearish" && rsiValue < 30))) smartSuggestions.push("Wait for pullback.");
  if (momentum !== null && Math.abs(roc ?? 0) > 0.4) smartSuggestions.push("Strong momentum detected.");
  if (atrPct !== null && volatilityLevel === "Extreme") smartSuggestions.push("ATR expanding.");
  if (!smartSuggestions.length) smartSuggestions.push("No standout condition right now -- reading is balanced.");

  return {
    trend: st?.direction ?? emaStack.stacked,
    trendStrength: adxNow ?? 0,
    superTrend: st,
    emaStack,
    vwap: vwapValue,
    rsi14: rsiValue,
    macd: macdValue,
    keltner,
    bollinger: boll,
    dmi: dmiValue,
    atr14: atrValue,
    momentum,
    roc,
    volumeRatio: vol.relative,
    volumeSma: vol.sma,
    structure,
    sr,
    pivots,
    camarilla,
    fibonacci: fib,
    breakouts,
    higherTfTrend,
    confidence,
    marketStatus,
    riskLevel,
    volatilityLevel,
    tradeSetup,
    supportingReasons,
    opposingReasons,
    smartSuggestions,
    lastPrice: last.close,
    asOf: IST_TIME_FORMATTER.format(new Date(last.date)),
  };
}

function prevSessionLast(candles: Candle[]): Candle {
  const prior = priorSessionCandles(candles);
  return prior.length ? prior[prior.length - 1] : candles[Math.max(0, candles.length - 2)];
}

function pivotsFrom(prevCandle: Candle) {
  const { high, low, close } = prevCandle;
  const pivot = (high + low + close) / 3;
  return { pivot, r1: 2 * pivot - low, r2: pivot + (high - low), r3: high + 2 * (pivot - low), s1: 2 * pivot - high, s2: pivot - (high - low), s3: low - 2 * (high - pivot) };
}

// Higher-timeframe pairing used for the "only Strong Buy/Sell when lower and
// higher timeframes agree" confirmation gate.
export const HIGHER_TF: Record<string, string> = {
  "1": "15",
  "3": "15",
  "5": "15",
  "10": "30",
  "15": "60",
  "30": "240",
  "60": "240",
  "240": "1D",
  "1D": "1D",
};

export const TIMEFRAME_OPTIONS: { value: string; label: string }[] = [
  { value: "1", label: "1 Minute" },
  { value: "3", label: "3 Minute" },
  { value: "5", label: "5 Minute" },
  { value: "10", label: "10 Minute" },
  { value: "15", label: "15 Minute" },
  { value: "30", label: "30 Minute" },
  { value: "60", label: "1 Hour" },
  { value: "240", label: "4 Hour" },
  { value: "1D", label: "Daily" },
];
