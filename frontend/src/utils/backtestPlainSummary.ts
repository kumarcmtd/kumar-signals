// "What this all means" -- the backtest results in plain words.
//
// The Lab reports precision, F1, calibration bands and a walk-forward split.
// All correct, all useless to someone who does not already know what they
// mean. This module turns those numbers into sentences a trader can act on,
// and it is deliberately blunt: if the signals did not clear the bar, it says
// so in the first line rather than burying it under a chart.
//
// The one rule here: NEVER dress up a bad result. A backtest that flatters the
// app is worth nothing -- the whole point of the page is to catch the app
// being wrong before the market does.

import type { Summary, CalibrationBand, Breakdown, Threshold } from "./backtestEngine";

export type Grade = "good" | "borderline" | "poor" | "unusable";

export interface PlainPoint {
  /** Short heading, e.g. "Is it better than a coin flip?" */
  question: string;
  /** The number, in context. */
  answer: string;
  /** What it means in plain words. */
  meaning: string;
  tone: "good" | "bad" | "neutral";
}

export interface PlainSummary {
  grade: Grade;
  /** The single sentence that matters most. */
  verdict: string;
  /** The supporting sentence. */
  verdictDetail: string;
  /** How often you must be right just to break even at this target/stop. */
  breakEvenPct: number;
  /** How often it actually was right, on decided signals. */
  actualPct: number | null;
  points: PlainPoint[];
  /** Concrete next actions, in order. */
  actions: string[];
}

/**
 * Break-even win rate.
 *
 * This engine always sets the target and the stop the SAME distance apart, so
 * break-even is 50% whichever ATR multiple is selected -- the multiple changes
 * how often either side gets reached, not the arithmetic of winning. It is a
 * constant rather than a function of the threshold because pretending it
 * varied would be a made-up number.
 *
 * It is also BEFORE costs. Buying options adds the spread and loses premium
 * every day, which is what OPTION_BUYER_BUFFER below accounts for.
 */
export const BREAK_EVEN_PCT = 50;

/** The extra edge a premium buyer needs on top of break-even, in points. */
const OPTION_BUYER_BUFFER = 6;

function fmtPct(v: number | null): string {
  return v === null ? "—" : `${Math.round(v)}%`;
}

export function buildPlainSummary(
  summary: Summary,
  bands: CalibrationBand[],
  splits: Breakdown[],
  hours: Breakdown[],
  threshold: Threshold,
  horizonLabel: string
): PlainSummary {
  const points: PlainPoint[] = [];
  const breakEvenPct = BREAK_EVEN_PCT;
  const needed = breakEvenPct + OPTION_BUYER_BUFFER;
  const actualPct = summary.precision === null ? null : summary.precision * 100;

  // --- 1. The headline question -------------------------------------------
  const decided = summary.greenSuccess + summary.greenFailure + summary.redSuccess + summary.redFailure;
  points.push({
    question: "Is it better than a coin flip?",
    answer: `${fmtPct(actualPct)} right, out of ${decided.toLocaleString("en-IN")} signals that finished`,
    meaning:
      actualPct === null
        ? "Not enough finished signals to say."
        : `Your target and your stop are the same distance apart (${threshold} ATR each way), so you need to be right more than ${breakEvenPct}% of the time just to finish level. Buying options costs more on top — the spread, plus premium lost every day — so realistically you need about ${needed}%.`,
    tone: actualPct === null ? "neutral" : actualPct >= needed ? "good" : actualPct >= breakEvenPct ? "neutral" : "bad",
  });

  // --- 2. The out-of-sample slice, which is the honest one ----------------
  const outOfSample = splits.find((s) => s.key === "test") ?? null;
  if (outOfSample && outOfSample.successPct !== null) {
    points.push({
      question: "Does it still work on data it never saw?",
      answer: `${outOfSample.successPct}% on the most recent slice`,
      meaning:
        outOfSample.successPct >= needed
          ? "This is the number that counts, and it held up. The rules were never tuned on this stretch of data."
          : `This is the number that counts, and it did not hold up. Anything above ${needed}% here would be encouraging; below ${breakEvenPct}% means the older results were flattering it.`,
      tone: outOfSample.successPct >= needed ? "good" : outOfSample.successPct >= breakEvenPct ? "neutral" : "bad",
    });
  }

  // --- 3. Is the confidence number trustworthy? ---------------------------
  const scoredBands = bands.filter((b) => b.signals >= 25 && b.actualPct !== null);
  const overclaiming = scoredBands.filter((b) => b.miscalibrated);
  const lowBand = scoredBands.find((b) => b.lo < 60) ?? null;
  const highBand = [...scoredBands].reverse().find((b) => b.lo >= 70) ?? null;
  const inverted = lowBand !== null && highBand !== null && (lowBand.actualPct ?? 0) > (highBand.actualPct ?? 0) + 3;

  if (scoredBands.length > 0) {
    points.push({
      question: "Can you trust the confidence %?",
      answer: inverted
        ? `No — low confidence beat high confidence (${fmtPct(lowBand!.actualPct)} vs ${fmtPct(highBand!.actualPct)})`
        : overclaiming.length > 0
          ? `Partly — ${overclaiming.length} of ${scoredBands.length} bands promised more than they delivered`
          : "Yes — what it claimed roughly matched what happened",
      meaning: inverted
        ? "This is backwards. When the app was MORE sure it did WORSE. Until that is fixed, treat a high confidence number as no reason to trade bigger — if anything it is a warning."
        : overclaiming.length > 0
          ? "When it says a high number, expect less than it promises. Use the direction, ignore the size of the percentage."
          : "The percentage broadly means what it says. That is unusual and worth keeping.",
      tone: inverted || overclaiming.length > scoredBands.length / 2 ? "bad" : overclaiming.length > 0 ? "neutral" : "good",
    });
  }

  // --- 4. Best and worst time of day --------------------------------------
  const ranked = hours.filter((h) => h.successPct !== null && h.signals >= 40).sort((a, b) => (b.successPct ?? 0) - (a.successPct ?? 0));
  if (ranked.length >= 2) {
    const best = ranked[0];
    const worst = ranked[ranked.length - 1];
    points.push({
      question: "When did it work best?",
      answer: `${best.label} was best at ${best.successPct}%, ${worst.label} was worst at ${worst.successPct}%`,
      meaning: `The same signal is not equally good all day. On this data it was ${(best.successPct ?? 0) - (worst.successPct ?? 0)} points better in the ${best.label} window than in the ${worst.label} one.`,
      tone: (best.successPct ?? 0) >= needed ? "good" : "neutral",
    });
  }

  // --- 5. How far price actually travels ----------------------------------
  points.push({
    question: "How far does price actually move?",
    answer: `${summary.avgMfeAtr.toFixed(1)}× in your favour, ${summary.avgMaeAtr.toFixed(1)}× against`,
    meaning:
      summary.avgMfeAtr > summary.avgMaeAtr
        ? `Within ${horizonLabel}, price typically travelled further your way than against you. That suggests a target further out than ${threshold} ATR may suit this engine better — try the wider buttons above and watch whether the win rate holds.`
        : `Within ${horizonLabel}, price typically moved further AGAINST you than for you. A tight stop gets hit by normal noise here.`,
    tone: summary.avgMfeAtr > summary.avgMaeAtr ? "neutral" : "bad",
  });

  // --- Grade and verdict --------------------------------------------------
  const oos = outOfSample?.successPct ?? null;
  let grade: Grade;
  if (summary.sampleLabel === "insufficient" || actualPct === null) grade = "unusable";
  else if (actualPct >= needed && (oos === null || oos >= breakEvenPct)) grade = "good";
  else if (actualPct >= breakEvenPct && (oos === null || oos >= breakEvenPct - 3)) grade = "borderline";
  else grade = "poor";

  let verdict: string;
  let verdictDetail: string;
  switch (grade) {
    case "good":
      verdict = "These signals cleared the bar on this data.";
      verdictDetail = `${fmtPct(actualPct)} right against the ${needed}% an option buyer needs. Still one contract and a few weeks — good here does not mean proven.`;
      break;
    case "borderline":
      verdict = "These signals are around a coin flip.";
      verdictDetail = `${fmtPct(actualPct)} right, and you need about ${needed}% for buying options to pay after costs and time decay. Not a system to follow blindly — use it as one input, not the decision.`;
      break;
    case "poor":
      verdict = "On this data these signals did not make money.";
      verdictDetail = `${fmtPct(actualPct)} right against the ${needed}% needed${oos !== null ? `, and only ${oos}% on the most recent unseen stretch` : ""}. Following them mechanically would have lost money after costs. This is the page doing its job — better to find this here than with real trades.`;
      break;
    default:
      verdict = "Not enough finished signals to judge.";
      verdictDetail = "Too few signals reached either the target or the stop. Try a wider time window above, or wait for more history.";
  }

  // --- What to do next ----------------------------------------------------
  const actions: string[] = [];
  if (grade === "poor" || grade === "borderline") {
    actions.push(`Do not size up on high-confidence signals${inverted ? " — on this data they were the weaker ones" : ""}.`);
  }
  if (summary.avgMfeAtr > summary.avgMaeAtr && threshold < 2) {
    actions.push("Try a wider target (1.5 or 2 ATR) — price ran further than your current target on average.");
  }
  if (ranked.length >= 2) {
    actions.push(`Favour the ${ranked[0].label} window; be far more careful in ${ranked[ranked.length - 1].label}.`);
  }
  actions.push("Change the target and time buttons above — the whole page re-scores instantly, so you can see which settings actually held up.");
  if (summary.sampleLabel !== "useful") {
    actions.push("Treat all of this as a hint, not proof — the sample is small.");
  }

  return { grade, verdict, verdictDetail, breakEvenPct, actualPct, points, actions };
}
