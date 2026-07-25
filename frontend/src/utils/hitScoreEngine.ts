import type { Candle } from "../types";
import type { TimeframeAnalysis } from "./timeframeEngine";
import { findOrderBlocks } from "./smc";

// AI-Shoot's engine: not a new indicator library, but a stricter COMBINED
// scorer sitting on top of everything analyzeTimeframe() already computes
// (EMA/RSI/MACD/VWAP/ATR/ADX/Bollinger/SuperTrend/structure/pattern/support-
// resistance categories) plus one extra confluence factor no other page uses
// yet -- smart-money order-block alignment (findOrderBlocks(), already in
// this codebase's smc.ts but unused elsewhere). No fixed symbol, timeframe,
// or direction: every (symbol, timeframe) combination is scored independently
// on whatever direction that timeframe's own analysis already concluded, and
// only ones clearing HIT_SCORE_MIN ever surface -- some days that's zero
// candidates, some days a few. That's intentional, not a bug.
export interface HitScoreBreakdownItem {
  label: string;
  points: number;
  max: number;
}

export interface HitScoreCandidate {
  symbol: string;
  analysis: TimeframeAnalysis;
  confirmingTimeframes: string[];
  orderBlockAligned: boolean;
  hitScore: number;
  rr: number;
  breakdown: HitScoreBreakdownItem[];
}

const MIN_RR = 1.5;
export const HIT_SCORE_MIN = 90;

function dirScore(categoryScore: number, bias: "bullish" | "bearish"): number {
  return bias === "bullish" ? categoryScore : 100 - categoryScore;
}

// Reward:risk from the real underlying entry/stop/target1 -- independent of
// options-side delta approximations so scoring still works even if the
// option chain is briefly unavailable.
function rrFor(analysis: TimeframeAnalysis): number | null {
  if (analysis.underlyingEntry === null || analysis.underlyingStop === null || !analysis.underlyingTargets) return null;
  const risk = Math.abs(analysis.underlyingEntry - analysis.underlyingStop);
  if (risk <= 0) return null;
  const reward = Math.abs(analysis.underlyingTargets[0] - analysis.underlyingEntry);
  return Number((reward / risk).toFixed(2));
}

export function computeHitScore(symbol: string, analysis: TimeframeAnalysis, candles: Candle[], siblings: TimeframeAnalysis[]): HitScoreCandidate | null {
  if (analysis.bias === "neutral" || !analysis.categories || analysis.insufficient) return null;
  if (analysis.vetoes.length > 0) return null;

  const rr = rrFor(analysis);
  if (rr === null || rr < MIN_RR) return null;

  const bias = analysis.bias;
  const { priceAction, supportResistance, volume, momentum } = analysis.categories;

  const priceActionPts = (dirScore(priceAction.score, bias) / 100) * 25;
  const valueZonePts = (dirScore(supportResistance.score, bias) / 100) * 20;
  const volumePts = (dirScore(volume.score, bias) / 100) * 15;
  const momentumPts = (dirScore(momentum.score, bias) / 100) * 15;

  const confirmingTimeframes = siblings.filter((s) => s.tf !== analysis.tf && s.bias === bias).map((s) => s.label);
  const crossTfPts = Math.min(confirmingTimeframes.length * 5, 15);

  const blocks = findOrderBlocks(candles);
  const lastBlock = blocks[blocks.length - 1];
  const orderBlockAligned = !!lastBlock && lastBlock.direction === bias;
  const orderBlockPts = orderBlockAligned ? 10 : 0;

  const hitScore = Math.min(Math.round(priceActionPts + valueZonePts + volumePts + momentumPts + crossTfPts + orderBlockPts), 100);
  if (hitScore < HIT_SCORE_MIN) return null;

  return {
    symbol,
    analysis,
    confirmingTimeframes,
    orderBlockAligned,
    hitScore,
    rr,
    breakdown: [
      { label: "Price Action", points: Math.round(priceActionPts), max: 25 },
      { label: "Value Zone (Support/Resistance)", points: Math.round(valueZonePts), max: 20 },
      { label: "Volume", points: Math.round(volumePts), max: 15 },
      { label: "Momentum", points: Math.round(momentumPts), max: 15 },
      { label: "Cross-Timeframe Confirmation", points: crossTfPts, max: 15 },
      { label: "Smart-Money Order Block Alignment", points: orderBlockPts, max: 10 },
    ],
  };
}

// Scans every (symbol, timeframe) entry handed to it and returns only the
// ones clearing the bar, best score first. Entries share sibling context
// per symbol so cross-timeframe confirmation counts correctly.
export function scanForHitScoreCalls(entries: { symbol: string; analysis: TimeframeAnalysis; candles: Candle[] }[]): HitScoreCandidate[] {
  const bySymbol = new Map<string, TimeframeAnalysis[]>();
  for (const e of entries) {
    const list = bySymbol.get(e.symbol) ?? [];
    list.push(e.analysis);
    bySymbol.set(e.symbol, list);
  }
  const out: HitScoreCandidate[] = [];
  for (const e of entries) {
    const candidate = computeHitScore(e.symbol, e.analysis, e.candles, bySymbol.get(e.symbol) ?? []);
    if (candidate) out.push(candidate);
  }
  return out.sort((a, b) => b.hitScore - a.hitScore);
}
