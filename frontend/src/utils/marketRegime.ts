import type { Candle } from "../types";
import { adx, obvTrend, superTrend } from "./indicators";

// Classifies the CURRENT market condition from the same candles every check
// already reads, then hands back a set of per-category weight multipliers so
// AI Verify Pro can lean harder on the categories that actually matter for
// this kind of market (e.g. Support/Resistance matters far more in a
// sideways market than in a strong trend) -- exactly the "adjust scoring
// based on market condition" idea from the spec, implemented as a weight
// nudge on the existing 9-category confidence breakdown rather than a
// separate scoring system.

export type MarketRegimeKey =
  | "strong_trend"
  | "weak_trend"
  | "sideways"
  | "breakout"
  | "false_breakout"
  | "pullback"
  | "reversal"
  | "accumulation"
  | "distribution"
  | "high_volatility"
  | "low_volatility"
  | "liquidity_trap";

export type ConfidenceCategory = "trend" | "momentum" | "volume" | "vwap" | "structure" | "smartMoney" | "risk" | "optionsSentiment" | "orderFlow";

export interface RegimeResult {
  regime: MarketRegimeKey;
  label: string;
  explain: string;
  weightMultipliers: Partial<Record<ConfidenceCategory, number>>;
}

const REGIME_LABEL: Record<MarketRegimeKey, string> = {
  strong_trend: "Strong Trend",
  weak_trend: "Weak Trend",
  sideways: "Sideways",
  breakout: "Breakout",
  false_breakout: "False Breakout",
  pullback: "Pullback",
  reversal: "Reversal",
  accumulation: "Accumulation",
  distribution: "Distribution",
  high_volatility: "High Volatility",
  low_volatility: "Low Volatility",
  liquidity_trap: "Liquidity Trap",
};

// Trending regimes lean on Trend/Momentum, sideways ones lean on Structure
// (S/R), breakouts lean on Volume/VWAP, and anything with a stop-hunt flavor
// leans on Risk/Smart Money -- a rough version of the spec's own example
// weight tables, mapped onto this app's actual 9 confidence categories.
const REGIME_WEIGHTS: Record<MarketRegimeKey, Partial<Record<ConfidenceCategory, number>>> = {
  strong_trend: { trend: 1.3, momentum: 1.15 },
  weak_trend: { trend: 1.1, momentum: 1.05, risk: 1.1 },
  sideways: { structure: 1.35, momentum: 1.15, trend: 0.6 },
  breakout: { volume: 1.4, vwap: 1.2, momentum: 1.15 },
  false_breakout: { structure: 1.3, risk: 1.3, smartMoney: 1.2 },
  pullback: { trend: 1.15, structure: 1.15 },
  reversal: { structure: 1.2, smartMoney: 1.25, momentum: 1.1 },
  accumulation: { smartMoney: 1.25, structure: 1.1, trend: 0.7 },
  distribution: { smartMoney: 1.25, structure: 1.1, trend: 0.7 },
  high_volatility: { risk: 1.35 },
  low_volatility: { risk: 0.9 },
  liquidity_trap: { structure: 1.3, smartMoney: 1.3, risk: 1.3 },
};

// A candle-range volatility read that doesn't need atr()'s internal series --
// just the average high-low range of one window vs another, both a simple
// and honest proxy for "is this more or less volatile than usual."
function avgRange(window: Candle[]): number {
  if (!window.length) return 0;
  return window.reduce((s, c) => s + (c.high - c.low), 0) / window.length;
}

export function classifyMarketRegime(candles: Candle[]): RegimeResult {
  if (candles.length < 25) {
    return { regime: "sideways", label: "Gathering Data", explain: "Not enough candles yet to classify the market condition.", weightMultipliers: {} };
  }

  const adxValue = adx(candles);
  const fast = superTrend(candles, 7, 2);
  const lastClose = candles[candles.length - 1].close;

  const recentWindow = candles.slice(-10);
  const priorWindow = candles.slice(-30, -10);
  const recentAvgRange = avgRange(recentWindow);
  const priorAvgRange = avgRange(priorWindow);
  const volRatio = priorAvgRange > 0 ? recentAvgRange / priorAvgRange : 1;

  const lookback = candles.slice(-21, -1);
  const rangeHigh = Math.max(...lookback.map((c) => c.high));
  const rangeLow = Math.min(...lookback.map((c) => c.low));
  const lastCandle = candles[candles.length - 1];
  const prevCandle = candles[candles.length - 2];
  const avgVol20 = lookback.reduce((s, c) => s + (c.volume ?? 0), 0) / Math.max(lookback.length, 1);
  const volSpike = avgVol20 > 0 ? (lastCandle.volume ?? 0) / avgVol20 > 1.3 : false;

  // Liquidity trap / stop hunt -- a wick sweeps beyond the recent range then
  // closes back inside it, the classic "stop hunt" candle signature.
  const sweptHighTrapped = lastCandle.high > rangeHigh && lastCandle.close < rangeHigh;
  const sweptLowTrapped = lastCandle.low < rangeLow && lastCandle.close > rangeLow;
  if (sweptHighTrapped || sweptLowTrapped) {
    return {
      regime: "liquidity_trap",
      label: REGIME_LABEL.liquidity_trap,
      explain: `Price wicked ${sweptHighTrapped ? "above" : "below"} the recent 20-bar range then closed back inside -- looks like a stop hunt, not a real breakout.`,
      weightMultipliers: REGIME_WEIGHTS.liquidity_trap,
    };
  }

  // False breakout -- closed beyond the range 1-3 bars ago, already back
  // inside now.
  const brokeRecently = candles.slice(-4, -1).some((c) => c.close > rangeHigh || c.close < rangeLow);
  const backInside = lastClose <= rangeHigh && lastClose >= rangeLow;
  if (brokeRecently && backInside) {
    return {
      regime: "false_breakout",
      label: REGIME_LABEL.false_breakout,
      explain: "Price broke the recent range within the last few bars but has already closed back inside it.",
      weightMultipliers: REGIME_WEIGHTS.false_breakout,
    };
  }

  // Breakout -- closing beyond the range right now, with volume behind it.
  if ((lastClose > rangeHigh || lastClose < rangeLow) && volSpike) {
    return {
      regime: "breakout",
      label: REGIME_LABEL.breakout,
      explain: `Price closed ${lastClose > rangeHigh ? "above" : "below"} its 20-bar range on ${(((lastCandle.volume ?? 0) / Math.max(avgVol20, 1)) || 0).toFixed(1)}x average volume.`,
      weightMultipliers: REGIME_WEIGHTS.breakout,
    };
  }

  // Reversal -- the fast SuperTrend flipped direction within the last 3 bars.
  const fastPrev = superTrend(candles.slice(0, -2), 7, 2);
  if (fast && fastPrev && fast.direction !== fastPrev.direction) {
    return {
      regime: "reversal",
      label: REGIME_LABEL.reversal,
      explain: `SuperTrend just flipped to ${fast.direction === "bullish" ? "BUY" : "SELL"} within the last few bars.`,
      weightMultipliers: REGIME_WEIGHTS.reversal,
    };
  }

  const obv = obvTrend(candles, 20);

  if (adxValue !== null && adxValue < 20) {
    // Sideways sub-classification: quiet accumulation/distribution (OBV
    // trending while price doesn't) vs plain range-bound chop.
    if (obv && obv.strength > 40) {
      const isAccum = obv.direction === "bullish";
      return {
        regime: isAccum ? "accumulation" : "distribution",
        label: REGIME_LABEL[isAccum ? "accumulation" : "distribution"],
        explain: `Price is range-bound but On-Balance Volume is quietly ${isAccum ? "rising" : "falling"} -- possible ${isAccum ? "accumulation" : "distribution"} under the surface.`,
        weightMultipliers: REGIME_WEIGHTS[isAccum ? "accumulation" : "distribution"],
      };
    }
    const volRegime: MarketRegimeKey = volRatio > 1.4 ? "high_volatility" : volRatio < 0.7 ? "low_volatility" : "sideways";
    if (volRegime !== "sideways") {
      return {
        regime: volRegime,
        label: REGIME_LABEL[volRegime],
        explain: `Range-bound market (ADX ${adxValue.toFixed(1)}) with ${volRegime === "high_volatility" ? "wider" : "tighter"} candle ranges than usual (${volRatio.toFixed(2)}x).`,
        weightMultipliers: REGIME_WEIGHTS[volRegime],
      };
    }
    return { regime: "sideways", label: REGIME_LABEL.sideways, explain: `ADX ${adxValue.toFixed(1)} -- no clear trend, range-bound market.`, weightMultipliers: REGIME_WEIGHTS.sideways };
  }

  // Pullback -- there IS a trend (fast SuperTrend has a direction), but the
  // last 1-2 candles closed counter to it without a fresh SuperTrend flip.
  if (fast && ((fast.direction === "bullish" && lastCandle.close < prevCandle.close) || (fast.direction === "bearish" && lastCandle.close > prevCandle.close))) {
    return {
      regime: "pullback",
      label: REGIME_LABEL.pullback,
      explain: `Underlying trend is still ${fast.direction === "bullish" ? "up" : "down"}, but the last candle pulled back against it.`,
      weightMultipliers: REGIME_WEIGHTS.pullback,
    };
  }

  if (adxValue !== null && adxValue > 25) {
    return { regime: "strong_trend", label: REGIME_LABEL.strong_trend, explain: `ADX ${adxValue.toFixed(1)} -- a real, tradeable trend.`, weightMultipliers: REGIME_WEIGHTS.strong_trend };
  }
  return { regime: "weak_trend", label: REGIME_LABEL.weak_trend, explain: `ADX ${adxValue?.toFixed(1) ?? "n/a"} -- a trend is forming but isn't strong yet.`, weightMultipliers: REGIME_WEIGHTS.weak_trend };
}

// applyRegimeWeight lives here (not in the engine) since it's purely a
// function of RegimeResult -- one place to see how a regime's multipliers
// actually get used.
export function applyRegimeWeight(baseWeight: number, category: ConfidenceCategory, regime: RegimeResult): number {
  const mult = regime.weightMultipliers[category] ?? 1;
  return baseWeight * mult;
}
