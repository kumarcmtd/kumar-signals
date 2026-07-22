import type { Candle, Direction, OptionsAnalytics } from "../types";
import { computeIndicatorSnapshot, rsi, stochasticRsi, obvTrend, pivotPoints, centralPivotRange } from "./indicators";
import { detectCandlePattern, analyzeStructure, findSwingPoints } from "./priceAction";
import { detectLiquiditySweep, premiumDiscountZone } from "./smc";

export type Decision6 = "STRONG BUY" | "BUY" | "WATCH BUY" | "WAIT" | "SELL" | "STRONG SELL";

export interface CategoryResult {
  score: number; // 0-100
  notes: string[];
}

export interface TimeframeAnalysis {
  tf: string;
  label: string;
  insufficient: string | null;
  overallScore: number | null;
  decision: Decision6;
  bias: Direction;
  optSide: "CE" | "PE" | null;
  reasons: string[];
  vetoes: string[];
  hitProbability: number | null;
  confidenceLabel: string;
  signalStrength: string;
  categories: {
    trend: CategoryResult;
    momentum: CategoryResult;
    priceAction: CategoryResult;
    volume: CategoryResult;
    supportResistance: CategoryResult;
    volatility: CategoryResult;
  } | null;
  underlyingEntry: number | null;
  underlyingStop: number | null;
  underlyingTargets: [number, number, number] | null;
  holdingTime: string;
}

const MIN_BARS = 30;

function clamp100(x: number): number {
  return Math.max(0, Math.min(100, x));
}

function scoreTrend(candles: Candle[], snap: ReturnType<typeof computeIndicatorSnapshot>): CategoryResult {
  let score = 50;
  const notes: string[] = [];
  if (snap.ema20 !== null && snap.ema50 !== null && snap.ema200 !== null) {
    if (snap.ema20 > snap.ema50 && snap.ema50 > snap.ema200) {
      score += 20;
      notes.push("EMA20 > EMA50 > EMA200 (bullish stack)");
    } else if (snap.ema20 < snap.ema50 && snap.ema50 < snap.ema200) {
      score -= 20;
      notes.push("EMA20 < EMA50 < EMA200 (bearish stack)");
    }
  }
  const structure = analyzeStructure(candles);
  if (structure.label === "HH") {
    score += 20;
    notes.push("Higher highs & higher lows");
  } else if (structure.label === "LL") {
    score -= 20;
    notes.push("Lower highs & lower lows");
  } else if (structure.label === "HL") {
    score += 8;
    notes.push("Higher low forming");
  } else if (structure.label === "LH") {
    score -= 8;
    notes.push("Lower high forming");
  }
  if (structure.bos) {
    if (structure.bosDirection === "bullish") {
      score += 10;
      notes.push(`Break of structure to the upside${structure.choch ? " (change of character)" : ""}`);
    } else {
      score -= 10;
      notes.push(`Break of structure to the downside${structure.choch ? " (change of character)" : ""}`);
    }
  }
  return { score: clamp100(score), notes };
}

function scoreMomentum(closes: number[], snap: ReturnType<typeof computeIndicatorSnapshot>): CategoryResult {
  let score = 50;
  const notes: string[] = [];
  if (snap.rsi14 !== null) {
    if (snap.rsi14 > 60) {
      score += 15;
      notes.push(`RSI ${snap.rsi14.toFixed(0)} bullish`);
    } else if (snap.rsi14 < 40) {
      score -= 15;
      notes.push(`RSI ${snap.rsi14.toFixed(0)} bearish`);
    }
  }
  if (snap.macd) {
    if (snap.macd.histogram > 0) {
      score += 15;
      notes.push("MACD bullish crossover");
    } else if (snap.macd.histogram < 0) {
      score -= 15;
      notes.push("MACD bearish crossover");
    }
  }
  const stoch = stochasticRsi(closes);
  if (stoch !== null) {
    score += stoch > 50 ? 10 : -10;
    if (stoch > 80) notes.push(`Stochastic RSI ${stoch.toFixed(0)} — overbought, momentum extended`);
    else if (stoch < 20) notes.push(`Stochastic RSI ${stoch.toFixed(0)} — oversold, momentum extended`);
  }
  if (snap.momentumScore !== null) {
    score += Math.max(-100, Math.min(100, snap.momentumScore)) * 0.1;
    if (snap.momentumScore > 20) notes.push("Positive momentum score");
    else if (snap.momentumScore < -20) notes.push("Negative momentum score");
  }
  return { score: clamp100(score), notes };
}

function scorePriceAction(candles: Candle[]): CategoryResult {
  let score = 50;
  const notes: string[] = [];
  const { pattern, direction } = detectCandlePattern(candles);
  if (pattern !== "none" && pattern !== "doji" && pattern !== "inside_bar") {
    if (direction === "bullish") {
      score += 15;
      notes.push(`${pattern.replace(/_/g, " ")} detected (bullish)`);
    } else if (direction === "bearish") {
      score -= 15;
      notes.push(`${pattern.replace(/_/g, " ")} detected (bearish)`);
    }
  } else if (pattern === "inside_bar") {
    notes.push("Inside bar — compression, awaiting breakout");
  }
  const structure = analyzeStructure(candles);
  if (structure.bos) {
    if (structure.bosDirection === "bullish") {
      score += 15;
      notes.push(`Breakout confirmed${structure.choch ? " (change of character)" : ""}`);
    } else {
      score -= 15;
      notes.push(`Breakdown confirmed${structure.choch ? " (change of character)" : ""}`);
    }
  }
  const swings = findSwingPoints(candles);
  const sweep = detectLiquiditySweep(candles, swings);
  if (sweep.swept) {
    if (sweep.direction === "bullish") {
      score += 12;
      notes.push("Fake breakdown swept then reversed up");
    } else {
      score -= 12;
      notes.push("Fake breakout swept then reversed down");
    }
  }
  const zone = premiumDiscountZone(candles, swings);
  if (zone === "discount") {
    score += 8;
    notes.push("Price in discount zone — favorable for longs");
  } else if (zone === "premium") {
    score -= 8;
    notes.push("Price in premium zone — favorable for shorts");
  }
  return { score: clamp100(score), notes };
}

function scoreVolume(candles: Candle[]): CategoryResult {
  let score = 50;
  const notes: string[] = [];
  const last = candles[candles.length - 1];
  const window = candles.slice(-20, -1);
  const avgVol = window.reduce((s, c) => s + (c.volume ?? 0), 0) / Math.max(window.length, 1);
  const volRatio = avgVol > 0 && last.volume != null ? last.volume / avgVol : 1;
  const spike = volRatio > 1.3;
  if (spike) notes.push(`Volume spike: ${volRatio.toFixed(1)}x the 20-bar average`);
  const trend = obvTrend(candles);
  if (trend && trend.direction !== "neutral") {
    const delta = (trend.strength / 100) * 25;
    score += trend.direction === "bullish" ? delta : -delta;
    notes.push(`OBV trending ${trend.direction}${spike ? " with a volume spike confirming it" : ""}`);
  }
  return { score: clamp100(score), notes };
}

function scoreSupportResistance(candles: Candle[], dailyCandles: Candle[] | undefined): CategoryResult {
  let score = 50;
  const notes: string[] = [];
  const last = candles[candles.length - 1].close;
  const snap = computeIndicatorSnapshot(candles);

  const swings = findSwingPoints(candles);
  const highsAbove = swings.filter((s) => s.type === "high" && s.price > last).map((s) => s.price);
  const lowsBelow = swings.filter((s) => s.type === "low" && s.price < last).map((s) => s.price);
  const nearestRes = highsAbove.length ? Math.min(...highsAbove) : null;
  const nearestSup = lowsBelow.length ? Math.max(...lowsBelow) : null;

  if (nearestRes !== null) {
    const distPct = ((nearestRes - last) / last) * 100;
    if (distPct < 0.3) {
      score -= 15;
      notes.push(`Resistance nearby at ${nearestRes.toFixed(1)} (${distPct.toFixed(2)}% away)`);
    } else {
      score += 8;
      notes.push(`Clear of resistance (${distPct.toFixed(1)}% below ${nearestRes.toFixed(1)})`);
    }
  }
  if (nearestSup !== null) {
    const distPct = ((last - nearestSup) / last) * 100;
    if (distPct < 0.3) {
      score += 15;
      notes.push(`Support nearby at ${nearestSup.toFixed(1)} (${distPct.toFixed(2)}% away) — bounce zone`);
    } else {
      notes.push(`Clear of support (${distPct.toFixed(1)}% above ${nearestSup.toFixed(1)})`);
    }
  }
  if (snap.vwap !== null) {
    if (last > snap.vwap) {
      score += 8;
      notes.push("Price trading above VWAP");
    } else {
      score -= 8;
      notes.push("Price trading below VWAP");
    }
  }
  if (dailyCandles && dailyCandles.length >= 2) {
    const prevDay = dailyCandles[dailyCandles.length - 2];
    const pivot = pivotPoints(prevDay);
    if (last > pivot.pivot) score += 5;
    else score -= 5;
    const cpr = centralPivotRange(prevDay);
    notes.push(`CPR ${cpr.bc.toFixed(1)}–${cpr.tc.toFixed(1)}, Pivot ${pivot.pivot.toFixed(1)}`);
  }
  return { score: clamp100(score), notes };
}

// Volatility is direction-agnostic (an expanding range doesn't itself mean
// bullish or bearish) -- it's returned as an "expansion strength" 0-100
// (50 = steady/compressed, 100 = strongly expanding) and folded into the
// overall score as an amplifier on whatever direction the other 5 categories
// already lean, not as an independent bullish/bearish vote.
function scoreVolatility(candles: Candle[], snap: ReturnType<typeof computeIndicatorSnapshot>): CategoryResult {
  const notes: string[] = [];
  if (!snap.bollinger || !snap.atr14) return { score: 50, notes: [] };
  const price = candles[candles.length - 1].close;
  const bandwidthPct = ((snap.bollinger.upper - snap.bollinger.lower) / snap.bollinger.middle) * 100;
  const priorSlice = candles.slice(0, candles.length - 20);
  const priorBB = priorSlice.length >= 20 ? computeIndicatorSnapshot(priorSlice).bollinger : null;
  const priorBandwidthPct = priorBB ? ((priorBB.upper - priorBB.lower) / priorBB.middle) * 100 : bandwidthPct;
  const atrPct = (snap.atr14 / price) * 100;

  let score = 50;
  if (bandwidthPct > priorBandwidthPct * 1.05) {
    score = 80;
    notes.push(`Volatility expanding (band width ${bandwidthPct.toFixed(2)}% vs ${priorBandwidthPct.toFixed(2)}%)`);
  } else if (bandwidthPct < priorBandwidthPct * 0.95) {
    score = 35;
    notes.push(`Volatility compressing (band width ${bandwidthPct.toFixed(2)}%) — range expansion may be near`);
  } else {
    notes.push(`Volatility steady, ATR ~${atrPct.toFixed(2)}% of price`);
  }
  return { score: clamp100(score), notes };
}

function detectBullishDivergence(candles: Candle[], closes: number[]): boolean {
  const swings = findSwingPoints(candles);
  const lows = swings.filter((s) => s.type === "low");
  if (lows.length < 2) return false;
  const [l1, l2] = lows.slice(-2);
  if (l2.price >= l1.price) return false; // price must make a lower low
  const rsi1 = rsi(closes.slice(0, l1.index + 1));
  const rsi2 = rsi(closes.slice(0, l2.index + 1));
  if (rsi1 === null || rsi2 === null) return false;
  return rsi2 > rsi1; // RSI makes a higher low while price makes a lower low
}

function decisionFor(score: number): Decision6 {
  if (score >= 90) return "STRONG BUY";
  if (score >= 80) return "BUY";
  if (score >= 65) return "WATCH BUY";
  if (score >= 45) return "WAIT";
  if (score >= 25) return "SELL";
  return "STRONG SELL";
}

function signalStrengthFor(score: number): string {
  const distFrom50 = Math.abs(score - 50);
  if (distFrom50 >= 40) return "Very Strong";
  if (distFrom50 >= 25) return "Strong";
  if (distFrom50 >= 10) return "Moderate";
  return "Weak";
}

const HOLDING_TIME: Record<string, string> = {
  "5": "15–45 minutes",
  "10": "30–60 minutes",
  "15": "45–90 minutes",
  "30": "1.5–3 hours",
  "60": "3–6 hours",
  "240": "6–12 hours (multi-session)",
};

export function analyzeTimeframe(params: {
  tf: string;
  label: string;
  candles: Candle[];
  dailyCandles?: Candle[];
  options?: OptionsAnalytics;
  journalWinRate?: number | null;
}): TimeframeAnalysis {
  const { tf, label, candles, dailyCandles, options, journalWinRate } = params;

  const base: TimeframeAnalysis = {
    tf,
    label,
    insufficient: null,
    overallScore: null,
    decision: "WAIT",
    bias: "neutral",
    optSide: null,
    reasons: [],
    vetoes: [],
    hitProbability: null,
    confidenceLabel: "No Data",
    signalStrength: "—",
    categories: null,
    underlyingEntry: null,
    underlyingStop: null,
    underlyingTargets: null,
    holdingTime: HOLDING_TIME[tf] ?? "—",
  };

  if (!candles || candles.length < MIN_BARS) {
    return { ...base, insufficient: `Not enough ${label} bars yet for a reliable read (need ${MIN_BARS}+, have ${candles?.length ?? 0})` };
  }

  const closes = candles.map((c) => c.close);
  const snap = computeIndicatorSnapshot(candles);

  const trend = scoreTrend(candles, snap);
  const momentum = scoreMomentum(closes, snap);
  const priceAction = scorePriceAction(candles);
  const volume = scoreVolume(candles);
  const supportResistance = scoreSupportResistance(candles, dailyCandles);
  const volatility = scoreVolatility(candles, snap);

  const dirWeights = { trend: 0.25, momentum: 0.2, priceAction: 0.2, volume: 0.15, supportResistance: 0.1 };
  const dirWeightSum = 0.9; // everything except volatility (10%)
  const weightedDir =
    (trend.score * dirWeights.trend +
      momentum.score * dirWeights.momentum +
      priceAction.score * dirWeights.priceAction +
      volume.score * dirWeights.volume +
      supportResistance.score * dirWeights.supportResistance) /
    dirWeightSum;

  const dirLean = weightedDir - 50;
  const volDeviation = volatility.score - 50; // negative when compressed
  const volContribution = dirLean === 0 ? 0 : Math.sign(dirLean) * volDeviation;
  let overallScore = clamp100(weightedDir + volContribution * (0.1 / 0.9) * 5); // 10% weight, scaled into the 0-100 range

  overallScore = Math.round(clamp100(overallScore));

  let decision = decisionFor(overallScore);
  let bias: Direction = overallScore >= 65 ? "bullish" : overallScore <= 44 ? "bearish" : "neutral";

  const reasons: string[] = [];
  for (const cat of [trend, momentum, priceAction, volume, supportResistance, volatility]) reasons.push(...cat.notes);

  // Explicit veto rules -- these can downgrade an actionable call to WAIT
  // even if the weighted score alone would have crossed the action bands.
  const vetoes: string[] = [];
  const lastClose = candles[candles.length - 1].close;
  const priceAboveVwapPct = snap.vwap ? ((lastClose - snap.vwap) / snap.vwap) * 100 : 0;
  const swings = findSwingPoints(candles);
  const highsAbove = swings.filter((s) => s.type === "high" && s.price > lastClose).map((s) => s.price);
  const lowsBelow = swings.filter((s) => s.type === "low" && s.price < lastClose).map((s) => s.price);
  const nearestResPct = highsAbove.length ? ((Math.min(...highsAbove) - lastClose) / lastClose) * 100 : null;
  const nearestSupPct = lowsBelow.length ? ((lastClose - Math.max(...lowsBelow)) / lastClose) * 100 : null;

  if (decision === "STRONG BUY" || decision === "BUY" || decision === "WATCH BUY") {
    if (snap.rsi14 !== null && snap.rsi14 > 80) vetoes.push(`RSI ${snap.rsi14.toFixed(0)} > 80 (overbought)`);
    if (priceAboveVwapPct > 2) vetoes.push(`Price ${priceAboveVwapPct.toFixed(1)}% above VWAP (extended)`);
    if (nearestResPct !== null && nearestResPct < 0.3) vetoes.push(`Resistance only ${nearestResPct.toFixed(2)}% away`);
    if (volume.score < 40) vetoes.push("Volume too weak to confirm");
  } else if (decision === "SELL" || decision === "STRONG SELL") {
    if (snap.rsi14 !== null && snap.rsi14 < 20) vetoes.push(`RSI ${snap.rsi14.toFixed(0)} < 20 (oversold)`);
    if (nearestSupPct !== null && nearestSupPct < 0.3) vetoes.push(`Strong support only ${nearestSupPct.toFixed(2)}% away`);
    if (options && !options.error && options.bias === "bullish") vetoes.push("Chain shows heavy put writing (bullish OI bias)");
    if (detectBullishDivergence(candles, closes)) vetoes.push("Bullish divergence — price lower low, RSI higher low");
  }

  if (vetoes.length > 0) {
    decision = "WAIT";
    bias = "neutral";
  }

  const optSide: "CE" | "PE" | null = bias === "bullish" ? "CE" : bias === "bearish" ? "PE" : null;

  // Hit probability: a weighted blend of real computed factors only -- never
  // a random number. Falls back to a neutral 50 for the journal-win-rate
  // input when the user has no closed trades logged yet.
  const structureQuality = clamp100(50 + (analyzeStructure(candles).bos ? 20 : 0) + (analyzeStructure(candles).label ? 15 : 0));
  const srQuality = clamp100(
    50 + (nearestResPct !== null && nearestResPct > 0.5 ? 15 : 0) + (nearestSupPct !== null && nearestSupPct > 0.5 ? 15 : 0)
  );
  const hitProbabilityInputs = [
    Math.abs(trend.score - 50) * 2,
    Math.abs(momentum.score - 50) * 2,
    volume.score,
    srQuality,
    volatility.score,
    structureQuality,
    journalWinRate ?? 50,
  ];
  const hitProbability =
    decision === "WAIT" ? null : Math.round(clamp100(hitProbabilityInputs.reduce((s, v) => s + v, 0) / hitProbabilityInputs.length));

  const atr = snap.atr14 ?? lastClose * 0.01;
  const underlyingEntry = lastClose;
  const underlyingStop = bias === "bullish" ? lastClose - atr * 1.5 : bias === "bearish" ? lastClose + atr * 1.5 : null;
  const underlyingTargets: [number, number, number] | null =
    bias === "bullish"
      ? [lastClose + atr * 1.5, lastClose + atr * 2.5, lastClose + atr * 4]
      : bias === "bearish"
        ? [lastClose - atr * 1.5, lastClose - atr * 2.5, lastClose - atr * 4]
        : null;

  const confidenceLabel =
    overallScore >= 90 || overallScore <= 10
      ? "Excellent Setup"
      : overallScore >= 80 || overallScore <= 20
        ? "Good Setup"
        : overallScore >= 65 || overallScore <= 35
          ? "Fair Setup"
          : "No High-Probability Trade";

  return {
    tf,
    label,
    insufficient: null,
    overallScore,
    decision,
    bias,
    optSide,
    reasons: Array.from(new Set(reasons)),
    vetoes,
    hitProbability,
    confidenceLabel,
    signalStrength: signalStrengthFor(overallScore),
    categories: { trend, momentum, priceAction, volume, supportResistance, volatility },
    underlyingEntry,
    underlyingStop,
    underlyingTargets,
    holdingTime: HOLDING_TIME[tf] ?? "—",
  };
}
