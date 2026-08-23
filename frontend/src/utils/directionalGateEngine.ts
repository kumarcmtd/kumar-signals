import type { Candle, OptionsAnalytics } from "../types";
import { computeIndicatorSnapshot } from "./indicators";
import { assessEntryQuality } from "./entryQuality";
import { projectPremiumFromUnderlying } from "./optionProjection";

// A deliberately different, MUCH stricter engine from analyzeTimeframe()'s
// 6-tier Decision6 score. That engine intentionally surfaces every timeframe
// crossing out of neutral (including the weakest tiers) so AI-Test V2/Pro can
// show a full board for testing/comparison -- high frequency, by design.
// This one is built for the opposite goal: research on multi-timeframe
// confirmation shows aligned signals across two timeframes win ~58% of the
// time vs ~39% for a single timeframe acting alone, and that overtrading on
// weak/choppy signals is what erodes real accounts via whipsaws. So this
// gate requires BOTH the higher timeframe's trend AND this timeframe's own
// trend to independently agree, plus real trend strength (ADX) and real
// participation (volume) -- expect it to say WAIT most of the time. That is
// the point, not a bug: one or two genuinely confirmed calls beats twenty
// noisy ones.
export type GateDirection = "bullish" | "bearish";

const MIN_ADX = 20;
const MIN_VOLUME_RATIO = 1.2;
const ATR_STOP_MULT = 1;
const ATR_TARGET_MULTS: [number, number, number] = [1.5, 2.5, 3.5];

export interface GateQualified {
  status: "qualified";
  direction: GateDirection;
  entry: number;
  stop: number;
  targets: [number, number, number];
  rr: number;
  confidence: number;
  reasons: string[];
}

export interface GateWait {
  status: "wait";
  reason: string;
}

export interface GateInsufficient {
  status: "insufficient";
  reason: string;
}

export type GateEvaluation = GateQualified | GateWait | GateInsufficient;

function volumeRatioOf(candles: Candle[]): number | null {
  if (candles.length < 11) return null;
  const last = candles[candles.length - 1];
  const recent = candles.slice(-11, -1);
  const avg = recent.reduce((s, c) => s + (c.volume ?? 0), 0) / recent.length;
  if (avg <= 0) return null;
  return Number(((last.volume ?? 0) / avg).toFixed(2));
}

// A timeframe's own directional read: EMA9 vs EMA20 stack AND price vs VWAP
// must agree, or it's "neutral" -- an honest "this timeframe isn't showing a
// clean trend right now" rather than forcing a guess.
function directionOf(candles: Candle[]): GateDirection | "neutral" {
  const snap = computeIndicatorSnapshot(candles);
  const last = candles[candles.length - 1];
  if (snap.ema9 === null || snap.ema20 === null || snap.vwap === null) return "neutral";
  const priceAboveVwap = last.close > snap.vwap;
  const priceBelowVwap = last.close < snap.vwap;
  if (snap.ema9 > snap.ema20 && priceAboveVwap) return "bullish";
  if (snap.ema9 < snap.ema20 && priceBelowVwap) return "bearish";
  return "neutral";
}

// entryCandles = the timeframe being evaluated; trendCandles = the next
// higher timeframe used purely as a trend filter (e.g. 15m entry gated by
// 1H trend, 1H entry gated by 4H trend, 4H entry gated by the daily trend).
export function evaluateDirectionalGate(direction: GateDirection, entryCandles: Candle[], trendCandles: Candle[]): GateEvaluation {
  if (entryCandles.length < 30 || trendCandles.length < 30) {
    return { status: "insufficient", reason: "Not enough bars yet on this timeframe or its higher-timeframe trend filter." };
  }

  const trendDir = directionOf(trendCandles);
  if (trendDir !== direction) {
    return { status: "wait", reason: `Higher-timeframe trend is ${trendDir === "neutral" ? "not clearly trending" : trendDir} right now, not ${direction}.` };
  }

  const entryDir = directionOf(entryCandles);
  if (entryDir !== direction) {
    return { status: "wait", reason: `This timeframe's own EMA9/EMA20 + VWAP read doesn't agree with the higher-timeframe ${direction} trend yet.` };
  }

  const snap = computeIndicatorSnapshot(entryCandles);
  if (snap.adx14 === null || snap.adx14 < MIN_ADX) {
    return { status: "wait", reason: `Trend strength (ADX ${snap.adx14 !== null ? snap.adx14.toFixed(1) : "—"}) is below the ${MIN_ADX} minimum -- too choppy to trust.` };
  }

  const volRatio = volumeRatioOf(entryCandles);
  if (volRatio === null || volRatio < MIN_VOLUME_RATIO) {
    return { status: "wait", reason: `Volume (${volRatio !== null ? `${volRatio}x` : "—"} recent average) is below the ${MIN_VOLUME_RATIO}x minimum -- a move needs real participation behind it.` };
  }

  if (snap.atr14 === null || snap.atr14 <= 0) {
    return { status: "wait", reason: "ATR unavailable right now -- can't size a reliable stop/target." };
  }

  const last = entryCandles[entryCandles.length - 1];
  const entry = last.close;
  const stopDist = snap.atr14 * ATR_STOP_MULT;
  const sign = direction === "bullish" ? 1 : -1;
  const stop = entry - sign * stopDist;
  const targets = ATR_TARGET_MULTS.map((m) => Number((entry + sign * snap.atr14! * m).toFixed(2))) as [number, number, number];

  const adxScore = Math.min(((snap.adx14 - MIN_ADX) / 30) * 50, 50);
  const volScore = Math.min(((volRatio - MIN_VOLUME_RATIO) / 1.5) * 30, 30);
  // Graduated docking for a trigger candle that doesn't actually confirm --
  // never a hard veto, since ADX/volume/trend already cleared their own
  // bars above (see entryQuality.ts).
  const quality = assessEntryQuality(last, direction, snap, entryCandles);
  const confidence = Math.round(Math.max(20, Math.min(60 + adxScore + volScore - quality.penaltyPct, 97)));

  return {
    status: "qualified",
    direction,
    entry: Number(entry.toFixed(2)),
    stop: Number(stop.toFixed(2)),
    targets,
    rr: ATR_TARGET_MULTS[0] / ATR_STOP_MULT,
    confidence,
    reasons: [
      `Higher-timeframe trend confirmed ${direction} (EMA9/EMA20 stack + price vs VWAP agree)`,
      `This timeframe's own EMA9/EMA20 + VWAP also confirm ${direction}`,
      `ADX ${snap.adx14.toFixed(1)} shows a real trend, not chop (minimum ${MIN_ADX})`,
      `Volume ${volRatio.toFixed(2)}x the recent average confirms real participation (minimum ${MIN_VOLUME_RATIO}x)`,
      `Stop at 1x ATR, Target 1 at 1.5x ATR -- minimum 1:1.5 reward-to-risk by construction`,
      ...quality.reasons,
    ],
  };
}

export interface GatePremiumProjection {
  strike: number;
  optSide: "CE" | "PE";
  entry: number;
  targets: [number, number, number];
  stop: number;
  rr: number | null;
}

// Delegates to the shared, Greeks-aware projection (real per-strike delta +
// theta haircut, one consistent reward:risk convention) so the Gate's premium
// cards are built identically to every other engine's.
export function projectGatePremium(signal: GateQualified, optSide: "CE" | "PE", options: OptionsAnalytics | undefined): GatePremiumProjection | null {
  const proj = projectPremiumFromUnderlying(optSide, signal.entry, signal.stop, signal.targets, options);
  if (!proj) return null;
  return { strike: proj.strike, optSide, entry: proj.entry, targets: proj.targets, stop: proj.stop, rr: proj.rr };
}
