// "Matched": an Ai20-20 call that AI Verify Pro fully agrees with.
//
// Ai20-20 is fast and loose (5-minute price action and live premium), so on
// its own it fires often and gets stopped out often. AI Verify Pro is slow and
// strict (closed 15m/1h/4h candles). A call is MATCHED only when both point
// the same way AND AI Verify has CONFIRMED it (BUY, not just forming or
// leaning) AND the live candle is not already turning against it. That is
// the one moment the push alert and the quick-look card call a trade.

import type { DecisionResult } from "./buyDecisionEngine";
import type { LiveRead } from "./liveMomentum";

export type MatchLevel = "matched" | "same_side_unconfirmed" | "fading" | "against" | "no_view";

export interface CallMatch {
  level: MatchLevel;
  ok: boolean; // only "matched"
  text: string;
}

export function callMatch(result: Pick<DecisionResult, "verdict" | "side"> | null, live: Pick<LiveRead, "action" | "tone"> | null, optSide: "CE" | "PE"): CallMatch {
  if (!result || !result.side) return { level: "no_view", ok: false, text: `AI Verify Pro has no clear view on this ${optSide}` };
  if (result.side !== optSide) return { level: "against", ok: false, text: `AI Verify Pro leans ${result.side} — against this ${optSide}` };
  const confirmed = result.verdict === (optSide === "CE" ? "BUY_CE" : "BUY_PE");
  if (!confirmed) {
    const forming = result.verdict === (optSide === "CE" ? "FORMING_CE" : "FORMING_PE");
    return { level: "same_side_unconfirmed", ok: false, text: forming ? `Same side, but AI Verify Pro is still forming — not confirmed yet` : `Same side, but AI Verify Pro is only leaning — not confirmed` };
  }
  if (live && (live.tone === "bad" || live.action === "WEAKENING")) {
    return { level: "fading", ok: false, text: `Both agree, but the live candle is ${live.action === "WEAKENING" ? "weakening" : "turning against it"} — wait` };
  }
  return { level: "matched", ok: true, text: `MATCHED — Ai20-20 and AI Verify Pro both say BUY ${optSide}` };
}
