import type { TimeframeAnalysis } from "./timeframeEngine";
import type { OptionsAnalytics } from "../types";

export interface EliteCandidate {
  symbol: string;
  analysis: TimeframeAnalysis;
  options: OptionsAnalytics | undefined;
  confirmingTimeframes: string[];
}

// The regular AI-Test pages open a trade line for ANY non-WAIT decision,
// including the weakest tiers (WATCH BUY at 65-79, SELL at 25-44 -- only a
// few points off neutral). This is deliberately much stricter: only the two
// most extreme bands (STRONG BUY 90-100 / STRONG SELL 0-24), zero vetoes,
// AND at least one other timeframe on the SAME symbol independently agreeing
// on the same direction (a real cross-timeframe confluence check, not just
// one timeframe's opinion). If nothing clears this bar, there is no pick --
// this never downgrades to "best of a weak field" the way a ranked list would.
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

    candidates.push({ symbol: e.symbol, analysis, options: e.options, confirmingTimeframes });
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
