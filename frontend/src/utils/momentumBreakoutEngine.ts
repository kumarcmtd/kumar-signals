import type { Candle, OptionsAnalytics } from "../types";
import { atr, bollingerBands } from "./indicators";

// AI-Risk's own engine -- deliberately the OPPOSITE philosophy from the
// Directional Gate / Kimi Playbook / AI Elite engines elsewhere in this app.
// Those all require multi-signal confluence (higher-timeframe trend agreeing
// with this timeframe, ADX/structure/volume all lining up) before firing --
// great for avoiding whipsaws, but structurally SLOW: a fast, one-directional
// news/fundamentals-driven crash or rally often finishes most of its move
// before that much confluence has time to build (this is exactly what
// happened with the natural gas PE move this engine was built in response
// to -- Kimi Playbook only fired at 9:52pm, hours after the bulk of the move).
//
// Standard quant approach for catching this shape of move instead: detect a
// volatility SQUEEZE (Bollinger Bands narrow relative to their own recent
// history) followed by a channel BREAKOUT (price closes beyond its own
// recent N-bar range), confirmed by a genuine ATR expansion (volatility is
// really changing regime, not just one noisy wick) and above-average volume
// (real participation, not thin-book noise) and short-term rate-of-change
// momentum in the breakout's own direction. This mirrors the well-known
// "ATR/Bollinger-Keltner squeeze breakout + momentum confirmation" family of
// systems used across futures/commodities breakout trading.
export type BreakoutDirection = "bullish" | "bearish";

const LOOKBACK = 10; // bars used for the Donchian-style channel breakout
const SQUEEZE_WINDOW = 20; // bars of band-width history used as the "normal" baseline
const MIN_ATR_EXPANSION = 1.15; // current ATR vs its own recent average
const MIN_VOLUME_RATIO = 1.3;
const MIN_ROC_PCT = 0.15; // 3-bar rate of change, in percent
const ATR_STOP_MULT = 1;
const ATR_TARGET_MULTS: [number, number, number] = [1.2, 2, 3]; // tighter first target than the Directional Gate -- this engine is built to bank the fast opening leg of a move quickly, not hold for a slow grind

export interface BreakoutQualified {
  status: "qualified";
  direction: BreakoutDirection;
  entry: number;
  stop: number;
  targets: [number, number, number];
  rr: number;
  confidence: number;
  reasons: string[];
  squeezeDetected: boolean;
  atrExpansionRatio: number;
  volumeRatio: number;
  rocPct: number;
}

export interface BreakoutWait {
  status: "wait";
  reason: string;
}

export interface BreakoutInsufficient {
  status: "insufficient";
  reason: string;
}

export type BreakoutEvaluation = BreakoutQualified | BreakoutWait | BreakoutInsufficient;

function volumeRatioOf(candles: Candle[]): number | null {
  if (candles.length < 11) return null;
  const last = candles[candles.length - 1];
  const recent = candles.slice(-11, -1);
  const avg = recent.reduce((s, c) => s + (c.volume ?? 0), 0) / recent.length;
  if (avg <= 0) return null;
  return Number(((last.volume ?? 0) / avg).toFixed(2));
}

// Normalized Bollinger band width ((upper-lower)/middle) evaluated as of
// each bar ending at `endIdx`, walking back SQUEEZE_WINDOW bars -- lets us
// tell a genuinely NARROW-then-widening regime apart from bands that have
// been wide all along (a breakout out of an already-wide band is much more
// likely to be a false spike than a real regime change).
function bandWidthSeries(closes: number[], period: number, count: number): number[] {
  const out: number[] = [];
  const start = Math.max(period, closes.length - count);
  for (let i = start; i <= closes.length; i++) {
    const bands = bollingerBands(closes.slice(0, i), period);
    if (bands && bands.middle > 0) out.push((bands.upper - bands.lower) / bands.middle);
  }
  return out;
}

function atrSeries(candles: Candle[], period: number, count: number): number[] {
  const out: number[] = [];
  const start = Math.max(period + 1, candles.length - count);
  for (let i = start; i <= candles.length; i++) {
    const value = atr(candles.slice(0, i), period);
    if (value !== null) out.push(value);
  }
  return out;
}

export function evaluateMomentumBreakout(candles: Candle[]): BreakoutEvaluation {
  const minBars = SQUEEZE_WINDOW + 20;
  if (candles.length < minBars) {
    return { status: "insufficient", reason: `Not enough bars yet on this timeframe (need ${minBars}+, have ${candles.length}).` };
  }

  const closes = candles.map((c) => c.close);
  const last = candles[candles.length - 1];

  const widths = bandWidthSeries(closes, 20, SQUEEZE_WINDOW);
  if (widths.length < 5) {
    return { status: "insufficient", reason: "Not enough Bollinger Band history yet to read a squeeze." };
  }
  const widthNow = widths[widths.length - 1];
  const priorWidths = widths.slice(0, -1);
  const widthBaseline = priorWidths.reduce((s, v) => s + v, 0) / priorWidths.length;
  const recentLow = Math.min(...priorWidths.slice(-8));
  // A squeeze on its own isn't enough -- the band must actually be WIDENING
  // again off that low (a real release in progress), or this was just a
  // quiet patch that's still quiet.
  const squeezeDetected = recentLow < widthBaseline * 0.75 && widthNow > recentLow;

  const atrs = atrSeries(candles, 14, 10);
  const atrNow = atrs[atrs.length - 1];
  const atrBaseline = atrs.slice(0, -1).reduce((s, v) => s + v, 0) / Math.max(atrs.length - 1, 1);
  if (!atrNow || !atrBaseline) {
    return { status: "insufficient", reason: "ATR unavailable right now -- can't confirm a volatility expansion." };
  }
  const atrExpansionRatio = Number((atrNow / atrBaseline).toFixed(2));

  const channel = candles.slice(-LOOKBACK - 1, -1);
  const channelHigh = Math.max(...channel.map((c) => c.high));
  const channelLow = Math.min(...channel.map((c) => c.low));

  const brokeUp = last.close > channelHigh;
  const brokeDown = last.close < channelLow;
  if (!brokeUp && !brokeDown) {
    return { status: "wait", reason: `Price (₹${last.close}) is still inside its own last ${LOOKBACK}-bar range (₹${channelLow.toFixed(2)}–₹${channelHigh.toFixed(2)}) -- no breakout yet.` };
  }
  const direction: BreakoutDirection = brokeUp ? "bullish" : "bearish";

  if (atrExpansionRatio < MIN_ATR_EXPANSION) {
    return { status: "wait", reason: `Price broke its range but ATR has only expanded ${atrExpansionRatio}x (need ${MIN_ATR_EXPANSION}x+) -- looks like a single wick, not a real volatility regime change.` };
  }

  const volRatio = volumeRatioOf(candles);
  if (volRatio === null || volRatio < MIN_VOLUME_RATIO) {
    return { status: "wait", reason: `Breakout has volatility behind it but volume (${volRatio !== null ? `${volRatio}x` : "—"} recent average) is below the ${MIN_VOLUME_RATIO}x minimum -- too thin to trust yet.` };
  }

  const rocBase = closes[closes.length - 4];
  const rocPct = rocBase ? Number((((last.close - rocBase) / rocBase) * 100).toFixed(2)) : 0;
  if (direction === "bullish" && rocPct < MIN_ROC_PCT) {
    return { status: "wait", reason: `Broke the range up but 3-bar momentum (${rocPct}%) hasn't confirmed yet (need +${MIN_ROC_PCT}%+).` };
  }
  if (direction === "bearish" && rocPct > -MIN_ROC_PCT) {
    return { status: "wait", reason: `Broke the range down but 3-bar momentum (${rocPct}%) hasn't confirmed yet (need -${MIN_ROC_PCT}%+).` };
  }

  const entry = last.close;
  const stopDist = atrNow * ATR_STOP_MULT;
  const sign = direction === "bullish" ? 1 : -1;
  const stop = Number((entry - sign * stopDist).toFixed(2));
  const targets = ATR_TARGET_MULTS.map((m) => Number((entry + sign * atrNow * m).toFixed(2))) as [number, number, number];

  const atrScore = Math.min(((atrExpansionRatio - MIN_ATR_EXPANSION) / 1.5) * 25, 25);
  const volScore = Math.min(((volRatio - MIN_VOLUME_RATIO) / 1.5) * 25, 25);
  const rocScore = Math.min((Math.abs(rocPct) / 2) * 20, 20);
  const squeezeScore = squeezeDetected ? 15 : 0;
  const confidence = Math.round(Math.min(45 + atrScore + volScore + rocScore + squeezeScore, 96));

  const reasons = [
    squeezeDetected
      ? `Volatility was squeezed (band width fell to <75% of its ${SQUEEZE_WINDOW}-bar baseline) before this breakout -- a classic coiled-spring setup`
      : `Band width is already wide -- not a squeeze release, but the breakout still clears every other bar`,
    `Broke ${direction === "bullish" ? "above" : "below"} its own last ${LOOKBACK}-bar range at ₹${entry}`,
    `ATR expanded ${atrExpansionRatio}x vs its recent average -- a real volatility regime shift, not one stray wick`,
    `Volume ${volRatio.toFixed(2)}x the recent average confirms real participation behind the move`,
    `3-bar momentum (${rocPct > 0 ? "+" : ""}${rocPct}%) confirms the breakout direction`,
  ];

  return { status: "qualified", direction, entry, stop, targets, rr: ATR_TARGET_MULTS[0] / ATR_STOP_MULT, confidence, reasons, squeezeDetected, atrExpansionRatio, volumeRatio: volRatio, rocPct };
}

export interface BreakoutPremiumProjection {
  strike: number;
  optSide: "CE" | "PE";
  entry: number;
  targets: [number, number, number];
  stop: number;
  rr: number | null;
}

// Same delta~=0.5 ATM premium projection every other engine in this app uses,
// generalized to take the breakout's raw underlying levels directly.
export function projectBreakoutPremium(signal: BreakoutQualified, optSide: "CE" | "PE", options: OptionsAnalytics | undefined): BreakoutPremiumProjection | null {
  if (!options || options.error) return null;
  const row = options.rows.find((r) => r.strike === options.atmStrike) ?? options.rows[Math.floor(options.rows.length / 2)];
  if (!row) return null;
  const leg = optSide === "CE" ? row.call : row.put;
  if (leg.ltp === null || leg.ltp <= 0) return null;

  const DELTA = 0.5;
  const favMove = Math.abs(signal.targets[0] - signal.entry);
  const riskMove = Math.abs(signal.entry - signal.stop);
  const entry = leg.ltp;
  const targets: [number, number, number] = [
    Number((entry + DELTA * favMove).toFixed(2)),
    Number((entry + DELTA * Math.abs(signal.targets[1] - signal.entry)).toFixed(2)),
    Number((entry + DELTA * Math.abs(signal.targets[2] - signal.entry)).toFixed(2)),
  ];
  const stop = Number(Math.max(entry * 0.35, entry - DELTA * riskMove).toFixed(2));
  const rr = entry - stop !== 0 ? Number(((targets[0] - entry) / (entry - stop)).toFixed(2)) : null;
  return { strike: row.strike, optSide, entry, targets, stop, rr };
}
