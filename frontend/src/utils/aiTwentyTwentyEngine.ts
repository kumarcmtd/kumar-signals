import type { InstrumentSymbol, OptionsAnalytics } from "../types";
import type { TimeframeAnalysis } from "./timeframeEngine";

// Ai20-20's whole reason to exist: Best Call and AI Verify Pro are both
// deliberately strict and both go idle the moment a call closes or moves
// past its own targets -- exactly the complaint that led to this page. This
// engine trades that strictness for frequency, with a much lower bar to
// qualify (still a real weighted directional read, just not zero-veto/
// 90+-score/cross-timeframe-confirmed like Best Call's engines).
//
// The actual target: a flat PROFIT_PER_LOT (see below), not a flat point
// count. A flat point count breaks the moment you compare two symbols with
// very different lot sizes -- Crude Oil's lot size (100) means a 20-point
// premium move is exactly Rs2000/lot, but Natural Gas's lot size (1250)
// means that SAME 20 points would be Rs25,000/lot, an unrealistic ask given
// NG premiums typically sit around Rs9-18 to begin with. Anchoring on
// profit-per-lot and deriving each symbol's own point target from its own
// lot size keeps "one lot, one clean win" consistent across both markets.

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
  profitPerLot: number;
}

// Rs2000/lot at Target 1 is the actual bar -- "20 points" is just what that
// works out to for Crude Oil specifically (lot size 100). Same ratios as
// before (T2 = 1.6x T1, T3 = 2.25x T1, stop = 0.6x T1) so Crude Oil's own
// numbers are unchanged from the original design; only Natural Gas's point
// target shrinks to something its own premiums can realistically reach.
const PROFIT_PER_LOT = 2000;
const T2_RATIO = 1.6;
const T3_RATIO = 2.25;
const STOP_RATIO = 0.6;
export const LOT_SIZE: Record<InstrumentSymbol, number> = { CRUDEOIL: 100, NATURALGAS: 1250, GOLD: 100, SILVER: 30 };
// Just enough to keep the stop-distance math numerically sane for a
// near-zero premium -- the entry*0.5 floor below does the real guarding.
const MIN_ENTRY_PREMIUM = 1;

export function projectPremium20(analysis: TimeframeAnalysis, options: OptionsAnalytics | undefined): AiTwentyPremium | null {
  if (!options || options.error || !analysis.optSide) return null;
  const row = options.rows.find((r) => r.strike === options.atmStrike) ?? options.rows[Math.floor(options.rows.length / 2)];
  if (!row) return null;
  const leg = analysis.optSide === "CE" ? row.call : row.put;
  if (leg.ltp === null || leg.ltp < MIN_ENTRY_PREMIUM) return null;

  const lotSize = LOT_SIZE[options.symbol];
  const t1Points = PROFIT_PER_LOT / lotSize;

  const entry = leg.ltp;
  const targets: [number, number, number] = [
    Number((entry + t1Points).toFixed(2)),
    Number((entry + t1Points * T2_RATIO).toFixed(2)),
    Number((entry + t1Points * T3_RATIO).toFixed(2)),
  ];
  const stop = Number(Math.max(entry * 0.5, entry - t1Points * STOP_RATIO).toFixed(2));
  const rr = entry - stop !== 0 ? Number(((targets[0] - entry) / (entry - stop)).toFixed(2)) : null;
  return { strike: row.strike, optSide: analysis.optSide, entry, targets, stop, rr, profitPerLot: Number(((targets[0] - entry) * lotSize).toFixed(2)) };
}
