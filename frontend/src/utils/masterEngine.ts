import type { Candle, Direction, OptionsAnalytics, SignalCard } from "../types";
import { computeIndicatorSnapshot } from "./indicators";
import { detectCandlePattern, analyzeStructure, findSwingPoints } from "./priceAction";
import { findFairValueGaps, findOrderBlocks, detectLiquiditySweep, equalHighsLows, premiumDiscountZone } from "./smc";

export type Decision = "STRONG BUY" | "BUY" | "BUY ON DIP" | "WAIT" | "NO TRADE" | "SELL" | "STRONG SELL" | "SELL ON RISE";

export interface Meter {
  score: number; // 0-100 strength, direction-agnostic
  direction: Direction;
  notes: string[];
}

export interface MtfRow {
  tf: string;
  label: string;
  weight: number;
  direction: Direction;
  note: string;
}

export interface MasterAIResult {
  overallScore: number;
  confidenceLabel: "Extremely Strong" | "Strong" | "Good" | "Moderate" | "No Trade";
  decision: Decision;
  bias: Direction;
  sentiment: "Bullish" | "Bearish" | "Neutral";
  reasons: string[];
  meters: {
    trend: Meter;
    momentum: Meter;
    volatility: Meter;
    volume: Meter;
    priceAction: Meter;
    smc: Meter;
    option: Meter;
  };
  riskScore: number;
  mtf: MtfRow[];
  strike?: number;
  optSide?: "CE" | "PE";
  entry: number | null;
  stop: number | null;
  target1: number | null;
  target2: number | null;
  target3: number | null;
  trailingStopNote: string | null;
  rr: number | null;
  expectedHoldingTime: string;
  expectedProbability: number | null;
  pdZone: "premium" | "discount" | "equilibrium";
}

const TF_WEIGHTS: Record<string, number> = { "1D": 0.4, "30": 0.3, "15": 0.2, "5": 0.1 };
const TF_LABELS: Record<string, string> = { "1D": "Daily", "30": "30m", "15": "15m", "5": "5m" };

function trendDirectionFromSnapshot(snap: ReturnType<typeof computeIndicatorSnapshot>): Direction {
  const { ema20, ema50, ema200 } = snap;
  if (ema20 !== null && ema50 !== null && ema200 !== null) {
    if (ema20 > ema50 && ema50 > ema200) return "bullish";
    if (ema20 < ema50 && ema50 < ema200) return "bearish";
  }
  return snap.superTrend?.direction ?? "neutral";
}

function computeTrendMeter(byTf: Record<string, Candle[]>): Meter {
  let bullWeight = 0;
  let bearWeight = 0;
  let totalWeight = 0;
  const notes: string[] = [];
  for (const tf of Object.keys(TF_WEIGHTS)) {
    const candles = byTf[tf];
    if (!candles || candles.length < 20) continue;
    const snap = computeIndicatorSnapshot(candles);
    const dir = trendDirectionFromSnapshot(snap);
    const w = TF_WEIGHTS[tf];
    totalWeight += w;
    if (dir === "bullish") bullWeight += w;
    else if (dir === "bearish") bearWeight += w;
    if (dir !== "neutral") notes.push(`${TF_LABELS[tf]} EMA/SuperTrend aligned ${dir}`);
  }
  if (totalWeight === 0) return { score: 0, direction: "neutral", notes: [] };
  const direction: Direction = bullWeight > bearWeight ? "bullish" : bearWeight > bullWeight ? "bearish" : "neutral";
  const agree = direction === "bullish" ? bullWeight : direction === "bearish" ? bearWeight : 0;
  const score = Math.round((agree / totalWeight) * 100);
  return { score, direction, notes };
}

function computeMomentumMeter(byTf: Record<string, Candle[]>): Meter {
  let weighted = 0;
  let totalWeight = 0;
  const notes: string[] = [];
  for (const tf of Object.keys(TF_WEIGHTS)) {
    const candles = byTf[tf];
    if (!candles || candles.length < 30) continue;
    const snap = computeIndicatorSnapshot(candles);
    const w = TF_WEIGHTS[tf];
    if (snap.momentumScore === null) continue;
    totalWeight += w;
    weighted += snap.momentumScore * w;
    if (snap.rsi14 !== null && (snap.rsi14 > 55 || snap.rsi14 < 45)) {
      notes.push(`${TF_LABELS[tf]} RSI ${snap.rsi14.toFixed(0)} ${snap.rsi14 > 55 ? "confirms bullish" : "confirms bearish"} momentum`);
    }
    if (snap.macd && (snap.macd.histogram > 0) === (snap.rsi14 !== null && snap.rsi14 > 50)) {
      notes.push(`${TF_LABELS[tf]} MACD histogram ${snap.macd.histogram > 0 ? "positive" : "negative"}`);
    }
  }
  if (totalWeight === 0) return { score: 0, direction: "neutral", notes: [] };
  const avg = weighted / totalWeight; // -100..100
  const direction: Direction = avg > 10 ? "bullish" : avg < -10 ? "bearish" : "neutral";
  return { score: Math.round(Math.min(Math.abs(avg), 100)), direction, notes };
}

function computeVolatilityMeter(candles15: Candle[] | undefined): Meter {
  if (!candles15 || candles15.length < 40) return { score: 0, direction: "neutral", notes: [] };
  const snap = computeIndicatorSnapshot(candles15);
  const price = candles15[candles15.length - 1].close;
  if (!snap.bollinger || !snap.atr14 || price <= 0) return { score: 0, direction: "neutral", notes: [] };
  const bandwidthPct = ((snap.bollinger.upper - snap.bollinger.lower) / snap.bollinger.middle) * 100;

  const priorCloses = candles15.slice(0, candles15.length - 20).map((c) => c.close);
  const priorBB = priorCloses.length >= 20 ? computeIndicatorSnapshot(candles15.slice(0, candles15.length - 20)).bollinger : null;
  const priorBandwidthPct = priorBB ? ((priorBB.upper - priorBB.lower) / priorBB.middle) * 100 : bandwidthPct;

  const expanding = bandwidthPct > priorBandwidthPct * 1.05;
  const compressing = bandwidthPct < priorBandwidthPct * 0.95;
  const atrPct = (snap.atr14 / price) * 100;

  const notes: string[] = [];
  let score: number;
  if (expanding) {
    score = 75;
    notes.push(`Volatility expanding (band width ${bandwidthPct.toFixed(2)}% vs ${priorBandwidthPct.toFixed(2)}%) — supports a trend move`);
  } else if (compressing) {
    score = 35;
    notes.push(`Volatility compressing (band width ${bandwidthPct.toFixed(2)}%) — wait for a breakout, avoid chasing`);
  } else {
    score = 55;
    notes.push(`Volatility steady, ATR ~${atrPct.toFixed(2)}% of price`);
  }
  return { score, direction: "neutral", notes };
}

function computeVolumeMeter(candles: Candle[] | undefined): Meter {
  if (!candles || candles.length < 20) return { score: 0, direction: "neutral", notes: [] };
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const window = candles.slice(-20, -1);
  const avgVol = window.reduce((s, c) => s + (c.volume ?? 0), 0) / Math.max(window.length, 1);
  const volRatio = avgVol > 0 && last.volume != null ? last.volume / avgVol : 1;

  const notes: string[] = [];
  let direction: Direction = "neutral";
  if (last.oi != null && prev?.oi != null) {
    const oiChange = last.oi - prev.oi;
    const priceUp = last.close > (prev?.close ?? last.close);
    if (oiChange > 0 && priceUp) {
      direction = "bullish";
      notes.push("Long build-up: price up with rising OI");
    } else if (oiChange > 0 && !priceUp) {
      direction = "bearish";
      notes.push("Short build-up: price down with rising OI");
    } else if (oiChange < 0 && priceUp) {
      direction = "bullish";
      notes.push("Short covering: price up with falling OI");
    } else if (oiChange < 0 && !priceUp) {
      direction = "bearish";
      notes.push("Long unwinding: price down with falling OI");
    }
  }
  if (volRatio > 1.3) notes.push(`Volume spike: ${volRatio.toFixed(1)}x the 20-bar average`);

  const score = Math.round(Math.min(Math.max((volRatio - 1) * 60 + 40, 0), 100));
  return { score, direction, notes };
}

function computePriceActionMeter(candles: Candle[] | undefined): Meter {
  if (!candles || candles.length < 10) return { score: 0, direction: "neutral", notes: [] };
  const { pattern, direction: patternDir } = detectCandlePattern(candles);
  const structure = analyzeStructure(candles);
  const notes: string[] = [];
  let score = 0;
  let direction: Direction = "neutral";

  if (pattern !== "none" && pattern !== "doji" && pattern !== "inside_bar") {
    score += 40;
    direction = patternDir;
    notes.push(`${pattern.replace(/_/g, " ")} detected`);
  }
  if (structure.bos) {
    score += 30;
    direction = direction === "neutral" ? structure.bosDirection : direction;
    notes.push(`Break of structure (${structure.bosDirection})${structure.choch ? " — change of character, possible reversal" : ""}`);
  }
  if (structure.label) {
    notes.push(`Swing structure: ${structure.label}`);
    if (direction === "neutral" && structure.trend !== "neutral") direction = structure.trend;
  }
  if (direction !== "neutral" && direction === structure.trend) score += 20;

  return { score: Math.min(score, 100), direction, notes };
}

function computeSmcMeter(candles: Candle[] | undefined): Meter {
  if (!candles || candles.length < 15) return { score: 0, direction: "neutral", notes: [] };
  const swings = findSwingPoints(candles);
  const fvgs = findFairValueGaps(candles);
  const obs = findOrderBlocks(candles);
  const sweep = detectLiquiditySweep(candles, swings);
  const { equalHighs, equalLows } = equalHighsLows(swings);

  const notes: string[] = [];
  let bullWeight = 0;
  let bearWeight = 0;

  const lastFvg = fvgs[fvgs.length - 1];
  if (lastFvg) {
    if (lastFvg.direction === "bullish") bullWeight += 30;
    else bearWeight += 30;
    notes.push(`Unfilled ${lastFvg.direction} fair value gap nearby`);
  }
  const lastOb = obs[obs.length - 1];
  if (lastOb) {
    if (lastOb.direction === "bullish") bullWeight += 25;
    else bearWeight += 25;
    notes.push(`${lastOb.direction} order block in range`);
  }
  if (sweep.swept) {
    if (sweep.direction === "bullish") bullWeight += 30;
    else bearWeight += 30;
    notes.push(`Liquidity sweep / stop-hunt — reversal bias ${sweep.direction}`);
  }
  if (equalHighs) notes.push("Equal highs — buy-side liquidity pool overhead");
  if (equalLows) notes.push("Equal lows — sell-side liquidity pool below");

  const direction: Direction = bullWeight > bearWeight ? "bullish" : bearWeight > bullWeight ? "bearish" : "neutral";
  const score = Math.min(Math.max(bullWeight, bearWeight), 100);
  return { score, direction, notes };
}

function computeOptionMeter(options: OptionsAnalytics | undefined, signal: SignalCard | undefined): Meter {
  if (!options || options.error) return { score: 0, direction: "neutral", notes: [] };
  const notes: string[] = [];
  let score = 0;
  const direction = options.bias;

  if (options.pcr !== null) {
    const extremity = Math.abs(options.pcr - 1);
    score += Math.min(extremity * 60, 40);
    notes.push(`PCR ${options.pcr.toFixed(2)} ${options.pcr > 1 ? "tilts bullish (more puts written)" : options.pcr < 1 ? "tilts bearish (more calls written)" : "neutral"}`);
  }
  if (options.maxPain !== null && options.spot) {
    const distPct = (Math.abs(options.spot - options.maxPain) / options.spot) * 100;
    if (distPct > 1) {
      score += 20;
      notes.push(`Spot ${distPct.toFixed(1)}% away from Max Pain (${options.maxPain}) — less pinning pressure`);
    } else {
      notes.push(`Spot near Max Pain (${options.maxPain}) — expect some pinning into expiry`);
    }
  }
  if (signal?.trade.confidence) {
    if (signal.trade.confidence.startsWith("High")) score += 40;
    else if (signal.trade.confidence.startsWith("Medium")) score += 20;
    notes.push(`Chain OI bias: ${signal.trade.confidence}`);
  }

  return { score: Math.min(Math.round(score), 100), direction, notes };
}

function expectedHoldingTime(trendMeter: Meter, momentumMeter: Meter): string {
  if (trendMeter.score >= 70) return "1–3 sessions (daily/30m trend driven)";
  if (momentumMeter.score >= 60) return "Intraday (2–6 hours)";
  return "Intraday, tight management (< 2 hours)";
}

export function computeMasterAI(params: {
  candlesByTf: Record<string, Candle[]>;
  options?: OptionsAnalytics;
  signal?: SignalCard;
}): MasterAIResult {
  const { candlesByTf, options, signal } = params;
  const dominant = candlesByTf["15"] ?? candlesByTf["5"] ?? candlesByTf["30"] ?? candlesByTf["1D"] ?? [];

  const trend = computeTrendMeter(candlesByTf);
  const momentum = computeMomentumMeter(candlesByTf);
  const volatility = computeVolatilityMeter(candlesByTf["15"]);
  const volume = computeVolumeMeter(candlesByTf["15"] ?? candlesByTf["30"]);
  const priceAction = computePriceActionMeter(candlesByTf["15"]);
  const smc = computeSmcMeter(candlesByTf["15"]);
  const option = computeOptionMeter(options, signal);

  const meters = { trend, momentum, volatility, volume, priceAction, smc, option };

  const votes: { direction: Direction; weight: number }[] = [
    { direction: trend.direction, weight: 0.25 },
    { direction: momentum.direction, weight: 0.15 },
    { direction: priceAction.direction, weight: 0.15 },
    { direction: smc.direction, weight: 0.15 },
    { direction: option.direction, weight: 0.15 },
    { direction: volume.direction, weight: 0.15 },
  ];
  let bullVote = 0;
  let bearVote = 0;
  for (const v of votes) {
    if (v.direction === "bullish") bullVote += v.weight;
    else if (v.direction === "bearish") bearVote += v.weight;
  }
  const bias: Direction = bullVote > bearVote && bullVote - bearVote > 0.1 ? "bullish" : bearVote > bullVote && bearVote - bullVote > 0.1 ? "bearish" : "neutral";

  const weights: Record<keyof typeof meters, number> = {
    trend: 0.2,
    momentum: 0.15,
    priceAction: 0.15,
    smc: 0.15,
    option: 0.15,
    volume: 0.1,
    volatility: 0.1,
  };

  let overallScore = 0;
  const reasons: string[] = [];
  if (bias !== "neutral") {
    (Object.keys(meters) as (keyof typeof meters)[]).forEach((key) => {
      const m = meters[key];
      const w = weights[key];
      let contribution: number;
      if (key === "volatility") {
        contribution = m.score; // supportive-only, not direction-scored
      } else if (m.direction === bias) {
        contribution = m.score;
        reasons.push(...m.notes);
      } else if (m.direction === "neutral") {
        contribution = m.score * 0.3;
      } else {
        contribution = -m.score * 0.5;
      }
      overallScore += w * contribution;
    });
  }
  // Defense-in-depth: a single indicator producing NaN/Infinity from a data
  // edge case (e.g. a division by a zero true-range) must never leak into
  // the displayed confidence -- treat it as "no confluence" rather than show
  // NaN.
  overallScore = Number.isFinite(overallScore) ? Math.max(0, Math.min(100, Math.round(overallScore))) : 0;

  const confidenceLabel: MasterAIResult["confidenceLabel"] =
    overallScore >= 95 ? "Extremely Strong" : overallScore >= 90 ? "Strong" : overallScore >= 80 ? "Good" : overallScore >= 70 ? "Moderate" : "No Trade";

  const swings = findSwingPoints(dominant);
  const pdZone = premiumDiscountZone(dominant, swings);

  let decision: Decision = "NO TRADE";
  if (bias !== "neutral" && overallScore >= 70) {
    if (overallScore >= 90) decision = bias === "bullish" ? "STRONG BUY" : "STRONG SELL";
    else if (overallScore >= 80) decision = bias === "bullish" ? "BUY" : "SELL";
    else {
      if (bias === "bullish") decision = pdZone === "discount" ? "BUY ON DIP" : "WAIT";
      else decision = pdZone === "premium" ? "SELL ON RISE" : "WAIT";
    }
  }
  if (bias !== "neutral" && overallScore < 70 && overallScore >= 55) decision = "WAIT";

  const trade = signal && !signal.error ? signal.trade : undefined;
  const tradeLive = trade && trade.action !== "NO TRADE";
  const entry = tradeLive ? trade!.premiumEntry ?? null : null;
  const stop = tradeLive ? trade!.premiumStop ?? null : null;
  const target1 = tradeLive ? trade!.premiumTarget ?? null : null;
  const target2 = entry !== null && target1 !== null ? Number((entry + 1.5 * (target1 - entry)).toFixed(2)) : null;
  const target3 = entry !== null && target1 !== null ? Number((entry + 2 * (target1 - entry)).toFixed(2)) : null;
  const rr = entry !== null && stop !== null && target1 !== null && entry - stop !== 0 ? Number(((target1 - entry) / (entry - stop)).toFixed(2)) : null;
  const expectedProbability = decision === "NO TRADE" || decision === "WAIT" ? null : Math.round(Math.min(Math.max(overallScore - 15, 40), 90));

  const mtf: MtfRow[] = Object.keys(TF_WEIGHTS).map((tf) => {
    const candles = candlesByTf[tf];
    const dir = candles && candles.length >= 20 ? trendDirectionFromSnapshot(computeIndicatorSnapshot(candles)) : "neutral";
    return {
      tf,
      label: TF_LABELS[tf],
      weight: TF_WEIGHTS[tf],
      direction: dir,
      note: dir === bias && bias !== "neutral" ? "agrees with overall bias" : dir === "neutral" ? "no clear trend" : "diverges from overall bias",
    };
  });

  return {
    overallScore,
    confidenceLabel,
    decision,
    bias,
    sentiment: bias === "bullish" ? "Bullish" : bias === "bearish" ? "Bearish" : "Neutral",
    reasons: Array.from(new Set(reasons)),
    meters,
    riskScore: Math.round(100 - overallScore * 0.6),
    mtf,
    strike: tradeLive ? trade!.strike : undefined,
    optSide: tradeLive ? trade!.optSide : undefined,
    entry,
    stop,
    target1,
    target2,
    target3,
    trailingStopNote:
      target1 !== null && entry !== null ? `Once Target 1 (₹${target1}) is hit, trail stop up to ₹${entry.toFixed(2)} (breakeven) or higher.` : null,
    rr,
    expectedHoldingTime: expectedHoldingTime(trend, momentum),
    expectedProbability,
    pdZone,
  };
}
