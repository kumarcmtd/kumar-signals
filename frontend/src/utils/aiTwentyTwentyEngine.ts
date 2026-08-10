import type { OptionsAnalytics } from "../types";
import type { TimeframeAnalysis } from "./timeframeEngine";

// Ai20-20's whole reason to exist: Best Call and AI Verify Pro are both
// deliberately strict and both go idle the moment a call closes or moves
// past its own targets -- exactly the complaint that led to this page. This
// engine trades that strictness for frequency: instead of a multi-target
// ladder sized off the underlying's own move, every signal here targets a
// flat, modest +20 premium points ("20 points is enough"), with a much
// lower bar to qualify (still a real weighted directional read, just not
// zero-veto/90+-score/cross-timeframe-confirmed like Best Call's engines).

export interface AiTwentyCandidate {
  symbol: string;
  analysis: TimeframeAnalysis;
  reason: string;
}

// Deliberately looser than hitScoreEngine's zero-veto bar: TimeframeAnalysis's
// own `bias` is already a weighted blend of trend/momentum/price-action/
// volume/support-resistance (see timeframeEngine.ts), so "not neutral" is
// already a real multi-factor read, not noise -- allowing up to one minor
// veto (an overbought RSI flag, a thin-volume flag, etc.) is what makes this
// page fire far more often than Best Call's own engines.
export function scanForAiTwenty(entries: { symbol: string; analysis: TimeframeAnalysis }[]): AiTwentyCandidate[] {
  const out: AiTwentyCandidate[] = [];
  for (const e of entries) {
    const a = e.analysis;
    if (a.bias === "neutral" || !a.categories || a.insufficient) continue;
    if (a.vetoes.length > 1) continue;
    out.push({ symbol: e.symbol, analysis: a, reason: a.vetoes.length === 1 ? `Directional, with one caution: ${a.vetoes[0]}` : "Clean directional read across trend/momentum/volume/structure" });
  }
  return out;
}

export interface AiTwentyPremium {
  strike: number;
  optSide: "CE" | "PE";
  entry: number;
  targets: [number, number, number];
  stop: number;
  rr: number | null;
}

const T1_POINTS = 20;
const T2_POINTS = 32;
const T3_POINTS = 45;
const STOP_POINTS = 12;
const MIN_ENTRY_PREMIUM = 15; // below this, a flat 12pt stop risks too much of the premium to be sensible

export function projectPremium20(analysis: TimeframeAnalysis, options: OptionsAnalytics | undefined): AiTwentyPremium | null {
  if (!options || options.error || !analysis.optSide) return null;
  const row = options.rows.find((r) => r.strike === options.atmStrike) ?? options.rows[Math.floor(options.rows.length / 2)];
  if (!row) return null;
  const leg = analysis.optSide === "CE" ? row.call : row.put;
  if (leg.ltp === null || leg.ltp < MIN_ENTRY_PREMIUM) return null;

  const entry = leg.ltp;
  const targets: [number, number, number] = [Number((entry + T1_POINTS).toFixed(2)), Number((entry + T2_POINTS).toFixed(2)), Number((entry + T3_POINTS).toFixed(2))];
  const stop = Number(Math.max(entry * 0.5, entry - STOP_POINTS).toFixed(2));
  const rr = entry - stop !== 0 ? Number(((targets[0] - entry) / (entry - stop)).toFixed(2)) : null;
  return { strike: row.strike, optSide: analysis.optSide, entry, targets, stop, rr };
}
