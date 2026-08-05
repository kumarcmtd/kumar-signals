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
// Below this, a setup is too weak to be worth showing at all, even as a
// watchlist item -- above it (but under HIT_SCORE_MIN) it's a genuine "close
// but not there yet" near miss.
export const NEAR_MISS_MIN = 60;
const MAX_NEAR_MISSES = 3;

export interface NearMissCandidate {
  symbol: string;
  analysis: TimeframeAnalysis;
  confirmingTimeframes: string[];
  orderBlockAligned: boolean;
  hitScore: number;
  rr: number | null;
  breakdown: HitScoreBreakdownItem[];
  // Why this fell short of a live call -- shown directly on the watchlist
  // card so it reads as "here's what's still missing," not a mystery score.
  reasons: string[];
}

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

// The actual scoring math, shared by both the strict live-call gate
// (computeHitScore) and the looser watchlist read (computeNearMiss) -- only
// the pass/fail threshold differs between the two, not how a setup is scored.
interface ScoredSetup {
  confirmingTimeframes: string[];
  orderBlockAligned: boolean;
  hitScore: number;
  rr: number | null;
  breakdown: HitScoreBreakdownItem[];
}

function scoreSetup(analysis: TimeframeAnalysis, candles: Candle[], siblings: TimeframeAnalysis[]): ScoredSetup | null {
  if (analysis.bias === "neutral" || !analysis.categories || analysis.insufficient) return null;
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

  return {
    confirmingTimeframes,
    orderBlockAligned,
    hitScore,
    rr: rrFor(analysis),
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

export function computeHitScore(symbol: string, analysis: TimeframeAnalysis, candles: Candle[], siblings: TimeframeAnalysis[]): HitScoreCandidate | null {
  if (analysis.vetoes.length > 0) return null;
  const scored = scoreSetup(analysis, candles, siblings);
  if (!scored || scored.rr === null || scored.rr < MIN_RR || scored.hitScore < HIT_SCORE_MIN) return null;

  return { symbol, analysis, confirmingTimeframes: scored.confirmingTimeframes, orderBlockAligned: scored.orderBlockAligned, hitScore: scored.hitScore, rr: scored.rr, breakdown: scored.breakdown };
}

// Looser read of the SAME scoring math for the watchlist: no veto/RR gate,
// just "did it score in the 60-89 band" -- with reasons[] spelling out
// exactly what's still missing versus a real call.
export function computeNearMiss(symbol: string, analysis: TimeframeAnalysis, candles: Candle[], siblings: TimeframeAnalysis[]): NearMissCandidate | null {
  const scored = scoreSetup(analysis, candles, siblings);
  if (!scored || scored.hitScore < NEAR_MISS_MIN || scored.hitScore >= HIT_SCORE_MIN) return null;

  const reasons: string[] = [];
  if (analysis.vetoes.length > 0) reasons.push(`${analysis.vetoes.length} veto${analysis.vetoes.length > 1 ? "s" : ""} flagged`);
  if (scored.rr === null) reasons.push("Reward:risk not available yet");
  else if (scored.rr < MIN_RR) reasons.push(`Reward:risk only 1:${scored.rr.toFixed(2)} (needs 1:${MIN_RR}+)`);
  reasons.push(`${scored.hitScore}/100 Hit Score (needs ${HIT_SCORE_MIN}+)`);

  return {
    symbol,
    analysis,
    confirmingTimeframes: scored.confirmingTimeframes,
    orderBlockAligned: scored.orderBlockAligned,
    hitScore: scored.hitScore,
    rr: scored.rr,
    breakdown: scored.breakdown,
    reasons,
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

// Same scan, but for the watchlist: the best few setups that are close but
// don't clear the bar -- capped so the page can never turn into a second
// wall of cards, just a short "here's what's building" list.
export function scanForNearMisses(entries: { symbol: string; analysis: TimeframeAnalysis; candles: Candle[] }[]): NearMissCandidate[] {
  const bySymbol = new Map<string, TimeframeAnalysis[]>();
  for (const e of entries) {
    const list = bySymbol.get(e.symbol) ?? [];
    list.push(e.analysis);
    bySymbol.set(e.symbol, list);
  }
  const out: NearMissCandidate[] = [];
  for (const e of entries) {
    const candidate = computeNearMiss(e.symbol, e.analysis, e.candles, bySymbol.get(e.symbol) ?? []);
    if (candidate) out.push(candidate);
  }
  return out.sort((a, b) => b.hitScore - a.hitScore).slice(0, MAX_NEAR_MISSES);
}
