// Ai-News -- the combined read: what the news says, what the chart says, and
// what to do when they disagree.
//
// Neither half is allowed to speak alone. News without the chart is how you
// buy a bullish headline into a falling market; the chart without the news is
// how you get run over by an inventory number you did not know was coming.
//
// The rule that matters most is the DISAGREEMENT rule. When the news leans one
// way and the chart leans the other, the honest output is "these two do not
// agree, wait for confirmation" -- never the more exciting of the two. Picking
// a side there is exactly how a decision-support tool turns into a bad tip.
//
// Runs in the browser over data already fetched for other reasons, so it costs
// no Worker CPU and makes no extra upstream call.

import type { NewsTilt } from "./claudeNewsAnalytics";
import type { PullbackResult } from "./pullbackReversalEngine";

export type Side = "bullish" | "bearish" | "neutral" | "unknown";
export type VerdictKind =
  | "bullish_confirmed"
  | "bearish_confirmed"
  | "bullish_bias"
  | "bearish_bias"
  | "conflict"
  | "wait"
  | "insufficient";

export interface CombinedVerdict {
  kind: VerdictKind;
  newsSide: Side;
  techSide: Side;
  /** The big line, e.g. "Bullish — news and chart agree". */
  headline: string;
  /** Plain-language explanation, written for someone who is not a chartist. */
  detail: string;
  /** What would have to happen for this to become actionable. */
  nextStep: string;
  /** 0-94. Model confidence in the READ, never a probability of profit. */
  confidence: number;
  /** Green ticks. */
  agrees: string[];
  /** Amber cautions. */
  cautions: string[];
  /** Drives the colour of the card. */
  tone: "green" | "red" | "amber" | "grey";
}

/** Never present a machine read as certainty. Matches the rest of the app. */
export const MAX_CONFIDENCE = 94;

/** Below this, the news sample is too thin to be half of a verdict. */
const MIN_NEWS_SAMPLE = 4;

export function newsSideOf(tilt: NewsTilt | null): Side {
  if (!tilt || tilt.sampleSize < MIN_NEWS_SAMPLE) return "unknown";
  if (tilt.direction === "bullish") return "bullish";
  if (tilt.direction === "bearish") return "bearish";
  return "neutral";
}

export function techSideOf(pullback: PullbackResult | null | undefined): Side {
  if (!pullback) return "unknown";
  if (pullback.state === "still_bullish") return "bullish";
  if (pullback.state === "bearish") return "bearish";
  return "neutral";
}

function commodityName(symbol: "CRUDEOIL" | "NATURALGAS"): string {
  return symbol === "CRUDEOIL" ? "Crude Oil" : "Natural Gas";
}

/**
 * Combine the two halves.
 *
 * Confidence starts from the technical engine's own number (which already
 * accounts for data quality and timeframe agreement) and is then adjusted:
 * agreement raises it a little, disagreement cuts it hard, and missing data on
 * either side caps it. It is never allowed past MAX_CONFIDENCE.
 */
export function combineNewsAndTechnical(
  symbol: "CRUDEOIL" | "NATURALGAS",
  tilt: NewsTilt | null,
  pullback: PullbackResult | null | undefined
): CombinedVerdict {
  const newsSide = newsSideOf(tilt);
  const techSide = techSideOf(pullback);
  const name = commodityName(symbol);

  const agrees: string[] = [];
  const cautions: string[] = [];

  if (tilt && tilt.sampleSize > 0) {
    agrees.push(`News read from ${tilt.sampleSize} ${tilt.sampleSize === 1 ? "story" : "stories"} (score ${tilt.score > 0 ? "+" : ""}${tilt.score}).`);
  }
  if (tilt && tilt.sampleSize > 0 && tilt.sampleSize < MIN_NEWS_SAMPLE) {
    cautions.push(`Only ${tilt.sampleSize} usable ${tilt.sampleSize === 1 ? "story" : "stories"} — too thin to count as a news view.`);
  }
  if (!tilt || tilt.sampleSize === 0) {
    cautions.push("No usable news arrived. That is missing information, not a calm market.");
  }
  if (pullback) {
    agrees.push(`Chart read: ${pullback.stateLabel.toLowerCase()} (${pullback.stateDetail.toLowerCase()}).`);
    if (pullback.dataQuality < 7) cautions.push(`Chart data quality is ${pullback.dataQuality}/10 — some inputs were missing or stale.`);
    if (pullback.majorFundamentalShock) cautions.push("A major fundamental shock is flagged — normal chart behaviour may not apply.");
  } else {
    cautions.push("The chart engine has not returned a read yet.");
  }

  // Nothing usable on either side.
  if (newsSide === "unknown" && techSide === "unknown") {
    return {
      kind: "insufficient",
      newsSide,
      techSide,
      headline: `Not enough to call ${name}`,
      detail: "Neither the news feed nor the chart engine has given a usable read right now. An empty screen is an absence of information, not a signal to trade.",
      nextStep: "Wait for the feed and the chart to load, then look again.",
      confidence: 0,
      agrees,
      cautions,
      tone: "grey",
    };
  }

  const baseConfidence = pullback ? pullback.confidence : 40;

  // THE DISAGREEMENT RULE. Both sides have an opinion and they point opposite
  // ways. Neither wins; the answer is "wait".
  if ((newsSide === "bullish" && techSide === "bearish") || (newsSide === "bearish" && techSide === "bullish")) {
    const newsWord = newsSide === "bullish" ? "bullish" : "bearish";
    const techWord = techSide === "bullish" ? "bullish" : "bearish";
    cautions.push("News and chart point opposite ways — the single most common way a confident-looking signal goes wrong.");
    return {
      kind: "conflict",
      newsSide,
      techSide,
      headline: `${name}: news and chart disagree`,
      detail:
        `The news flow is ${newsWord} while the chart is ${techWord}. When these two fight, price usually chops around until one of them wins, ` +
        "and a trade entered in the middle gets stopped out by noise rather than by being wrong about direction.",
      nextStep: `Wait for the chart to confirm the news, or for fresh news to confirm the chart. ${pullback ? `On the chart that means ${techSide === "bearish" ? pullback.bullishConfirmation.toLowerCase() : pullback.bearishConfirmation.toLowerCase()}.` : ""}`.trim(),
      confidence: Math.min(MAX_CONFIDENCE, Math.round(baseConfidence * 0.45)),
      agrees,
      cautions,
      tone: "amber",
    };
  }

  // Both agree and both have a direction.
  if (newsSide === techSide && (newsSide === "bullish" || newsSide === "bearish")) {
    const bull = newsSide === "bullish";
    agrees.push("News and chart are pointing the same way.");
    return {
      kind: bull ? "bullish_confirmed" : "bearish_confirmed",
      newsSide,
      techSide,
      headline: `${name} is leaning ${bull ? "up" : "down"} — news and chart agree`,
      detail:
        `Both halves point ${bull ? "up" : "down"} right now, which is the strongest reading this page can give. ` +
        "It still is not a promise: agreement means the evidence is consistent, not that the next move is settled.",
      nextStep: pullback
        ? `Watch ${bull ? pullback.bullishConfirmation.toLowerCase() : pullback.bearishConfirmation.toLowerCase()}. It stops being valid if ${pullback.invalidation.toLowerCase()}`
        : "Confirm on the chart before acting.",
      confidence: Math.min(MAX_CONFIDENCE, Math.round(baseConfidence * 1.1)),
      agrees,
      cautions,
      tone: bull ? "green" : "red",
    };
  }

  // One side has a view, the other is flat or missing. A bias, not a signal.
  const leaning: Side = newsSide === "bullish" || newsSide === "bearish" ? newsSide : techSide;
  if (leaning === "bullish" || leaning === "bearish") {
    const bull = leaning === "bullish";
    const from = newsSide === leaning ? "news" : "chart";
    const other = from === "news" ? "chart" : "news";
    const otherState = from === "news" ? techSide : newsSide;
    cautions.push(`Only the ${from} has a view; the ${other} is ${otherState === "unknown" ? "not available" : "flat"}.`);
    return {
      kind: bull ? "bullish_bias" : "bearish_bias",
      newsSide,
      techSide,
      headline: `${name}: mild ${bull ? "upward" : "downward"} bias — needs confirmation`,
      detail:
        `The ${from} is leaning ${bull ? "up" : "down"}, but the ${other} is ${otherState === "unknown" ? "not giving a read at all" : "sitting flat"}. ` +
        "One half of the picture agreeing with itself is a bias, not a confirmed setup.",
      nextStep: `Wait for the ${other} to agree before treating this as anything more than background.`,
      confidence: Math.min(MAX_CONFIDENCE, Math.round(baseConfidence * 0.7)),
      agrees,
      cautions,
      tone: "amber",
    };
  }

  // Both present, both flat.
  return {
    kind: "wait",
    newsSide,
    techSide,
    headline: `${name} is quiet both ways`,
    detail: "Neither the news flow nor the chart is leaning meaningfully in either direction. Quiet conditions are where small edges get eaten by the spread.",
    nextStep: "Nothing to act on. Come back when something actually moves.",
    confidence: Math.min(MAX_CONFIDENCE, Math.round(baseConfidence * 0.6)),
    agrees,
    cautions,
    tone: "grey",
  };
}
