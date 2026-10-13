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
import { newsVsSide, type NewsPulse } from "./newsPulse";
import type { TrendPulse } from "./trendPulse";

export type MatchLevel = "matched" | "same_side_unconfirmed" | "fading" | "choppy" | "stretched" | "news_against" | "against" | "no_view";

export interface CallMatch {
  level: MatchLevel;
  ok: boolean; // only "matched"
  text: string;
}

/**
 * Beyond the two engines agreeing, three things now have to be clean too,
 * because they are what stopped out the recent calls:
 *  - the 5-minute candles are not CHOPPY and not running steadily the other way,
 *  - price has not already STRETCHED far from its 5-minute average (late entry),
 *  - the news (risk premium) is not clearly against the side.
 */
export function callMatch(
  result: Pick<DecisionResult, "verdict" | "side"> | null,
  live: Pick<LiveRead, "action" | "tone"> | null,
  optSide: "CE" | "PE",
  extra: { pulse?: Pick<TrendPulse, "state" | "stretched"> | null; news?: NewsPulse | null } = {},
): CallMatch {
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
  const { pulse, news } = extra;
  if (newsVsSide(news ?? null, optSide) === "strongly_against") {
    return { level: "news_against", ok: false, text: `Both agree, but the news is strongly ${optSide === "CE" ? "bearish" : "bullish"} (${news!.net > 0 ? "+" : ""}${news!.net}) — headline risk, wait` };
  }
  if (pulse?.state === "CHOPPY") return { level: "choppy", ok: false, text: "Both agree, but the 5-minute candles are choppy — wait for a steady run" };
  if (pulse && (optSide === "CE" ? pulse.state === "STEADY_DOWN" : pulse.state === "STEADY_UP")) {
    return { level: "fading", ok: false, text: `Both agree, but the 5-minute candles are running steadily ${optSide === "CE" ? "down" : "up"} — wait` };
  }
  if (pulse?.stretched && pulse.stretched.side === (optSide === "CE" ? "up" : "down")) {
    return { level: "stretched", ok: false, text: `Both agree, but price has already run far (${pulse.stretched.atrs}× ATR) — don't chase; better near ${pulse.stretched.pullbackTo}` };
  }
  return { level: "matched", ok: true, text: `MATCHED — Ai20-20 and AI Verify Pro both say BUY ${optSide}` };
}
