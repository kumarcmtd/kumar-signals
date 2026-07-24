import type { TimeframeAnalysis } from "./timeframeEngine";
import type { OptionsAnalytics } from "../types";

export interface EliteConfluence {
  priceAction: boolean;
  valueZone: boolean;
  volume: boolean;
}

export interface EliteCandidate {
  symbol: string;
  analysis: TimeframeAnalysis;
  options: OptionsAnalytics | undefined;
  confirmingTimeframes: string[];
  confluence: EliteConfluence;
  rr: number | null;
}

// A STRONG BUY/SELL score can clear 90 mostly on trend+momentum alone while
// price action, the support/resistance "value zone", and volume are only
// barely leaning the right way -- these thresholds require REAL separation
// from the neutral midpoint (50) in each of those three categories
// specifically, not just "not actively opposing". 100-X mirrors a bullish
// floor into the equivalent bearish ceiling.
const PRICE_ACTION_MIN = 60;
const VALUE_ZONE_MIN = 55;
const VOLUME_MIN = 55;
const MIN_RR = 1.5;

function confluenceFor(analysis: TimeframeAnalysis): EliteConfluence {
  if (!analysis.categories || analysis.bias === "neutral") return { priceAction: false, valueZone: false, volume: false };
  const { priceAction, supportResistance, volume } = analysis.categories;
  if (analysis.bias === "bullish") {
    return { priceAction: priceAction.score >= PRICE_ACTION_MIN, valueZone: supportResistance.score >= VALUE_ZONE_MIN, volume: volume.score >= VOLUME_MIN };
  }
  return {
    priceAction: priceAction.score <= 100 - PRICE_ACTION_MIN,
    valueZone: supportResistance.score <= 100 - VALUE_ZONE_MIN,
    volume: volume.score <= 100 - VOLUME_MIN,
  };
}

// Reward:risk from the real underlying entry/stop/target1 levels -- kept
// independent of options-side delta approximations so the gate applies even
// when the option chain is temporarily unavailable.
function rrFor(analysis: TimeframeAnalysis): number | null {
  if (analysis.underlyingEntry === null || analysis.underlyingStop === null || !analysis.underlyingTargets) return null;
  const risk = Math.abs(analysis.underlyingEntry - analysis.underlyingStop);
  if (risk <= 0) return null;
  const reward = Math.abs(analysis.underlyingTargets[0] - analysis.underlyingEntry);
  return Number((reward / risk).toFixed(2));
}

// The regular AI-Test pages open a trade line for ANY non-WAIT decision,
// including the weakest tiers (WATCH BUY at 65-79, SELL at 25-44 -- only a
// few points off neutral). This is deliberately much stricter: only the two
// most extreme bands (STRONG BUY 90-100 / STRONG SELL 0-24), zero vetoes,
// at least one other timeframe on the SAME symbol independently agreeing on
// the same direction, genuine price-action + support/resistance value-zone +
// volume confirmation (not just a passing weighted score), and a minimum
// 1:1.5 reward-to-risk on the underlying. If nothing clears this bar, there
// is no pick -- this never downgrades to "best of a weak field" the way a
// ranked list would.
export function findEliteSignal(
  entries: { symbol: string; analysis: TimeframeAnalysis; options: OptionsAnalytics | undefined }[]
): EliteCandidate | null {
  const bySymbol = new Map<string, typeof entries>();
  for (const e of entries) {
    const list = bySymbol.get(e.symbol) ?? [];
    list.push(e);
    bySymbol.set(e.symbol, list);
  }

  const candidates: EliteCandidate[] = [];
  for (const e of entries) {
    const { analysis } = e;
    if (analysis.decision !== "STRONG BUY" && analysis.decision !== "STRONG SELL") continue;
    if (analysis.vetoes.length > 0) continue;
    if (analysis.overallScore === null || analysis.hitProbability === null) continue;

    const siblings = (bySymbol.get(e.symbol) ?? []).filter((s) => s.analysis.tf !== analysis.tf);
    const confirmingTimeframes = siblings
      .filter((s) => s.analysis.bias === analysis.bias && (s.analysis.decision === "STRONG BUY" || s.analysis.decision === "BUY" || s.analysis.decision === "WATCH BUY" || s.analysis.decision === "STRONG SELL" || s.analysis.decision === "SELL"))
      .filter((s) => (analysis.bias === "bullish" ? s.analysis.decision !== "SELL" && s.analysis.decision !== "STRONG SELL" : s.analysis.decision !== "BUY" && s.analysis.decision !== "STRONG BUY" && s.analysis.decision !== "WATCH BUY"))
      .map((s) => s.analysis.label);

    if (confirmingTimeframes.length === 0) continue;

    const confluence = confluenceFor(analysis);
    if (!confluence.priceAction || !confluence.valueZone || !confluence.volume) continue;

    const rr = rrFor(analysis);
    if (rr === null || rr < MIN_RR) continue;

    candidates.push({ symbol: e.symbol, analysis, options: e.options, confirmingTimeframes, confluence, rr });
  }

  if (!candidates.length) return null;

  // If more than one clears the bar, prefer the most extreme score (closest
  // to 100 or 0), then more confirming timeframes as a tiebreaker.
  return candidates.reduce((best, c) => {
    const cExtremity = Math.abs((c.analysis.overallScore ?? 50) - 50);
    const bestExtremity = Math.abs((best.analysis.overallScore ?? 50) - 50);
    if (cExtremity !== bestExtremity) return cExtremity > bestExtremity ? c : best;
    return c.confirmingTimeframes.length > best.confirmingTimeframes.length ? c : best;
  });
}
