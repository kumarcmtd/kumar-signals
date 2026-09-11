// Ai20-20 Call Review -- a LIVE read on a call you are already in.
//
// The Call Audit that briefly existed graded a call once, at birth: is the
// setup sound, is the contract sane. Useful before entering. Useless twenty
// minutes later, when the only question that matters is "should I still be
// holding this?".
//
// Ai20-20 is the fastest page in the app -- 5-minute price action, ~8s
// refresh, short-lived trades on a flat rupee target -- so this reviews the
// call the way the trader actually experiences it, in four questions:
//
//   1. Is it working?      progress toward the target, in rupees
//   2. Am I giving it back? peak against now -- the one that costs the most
//   3. What is time costing? theta burned since entry, in rupees
//   4. Is the tape still with me? 5-minute structure behind the direction
//
// Everything is computed from data the page already holds: the 5-minute
// candles, the option chain, the trade log and the live premium. It makes no
// network calls of its own, deliberately -- this page is where the app's
// upstream budget is tightest.
//
// Rupees, not percentages, wherever a decision depends on size: a 40% move on
// a ₹12 natural-gas premium and on a ₹500 crude premium are not the same
// trade, and the lot sizes differ by 12.5x.

import type { Candle } from "../types";
import { adx as adxOf, superTrend } from "./indicators";

export type ReviewVerdict = "early" | "hold" | "watch" | "trim" | "exit" | "unknown";
export type FactorSide = "for" | "against" | "neutral";

export interface ReviewFactor {
  id: string;
  label: string;
  side: FactorSide;
  detail: string;
}

export interface CallReview {
  verdict: ReviewVerdict;
  headline: string;
  reason: string;
  /** 0-100 health of the position right now. Not a probability. */
  health: number;
  pnlRs: number | null;
  peakRs: number | null;
  /** Share of the best run already handed back, 0-100. */
  giveBackPct: number | null;
  /** Progress toward the page's flat rupee goal, 0-100+. */
  goalProgressPct: number | null;
  /** Rupees of premium lost to time decay since entry, at 1 lot. */
  thetaBurnedRs: number | null;
  minutesOpen: number;
  factors: ReviewFactor[];
  /** The single thing that would end this call. */
  invalidation: string;
}

export interface ReviewInput {
  optSide: "CE" | "PE";
  direction: "bullish" | "bearish";
  /** Premium paid. */
  entry: number;
  /** Effective stop on the premium (already trailed, if it has been). */
  stop: number;
  targets: number[];
  targetsHit: boolean[];
  /** Live premium. Null when the chain is unreachable. */
  current: number | null;
  /** Highest premium seen on this trade. */
  peak: number | null | undefined;
  openedAt: number;
  lotSize: number;
  /** Ai20-20's flat per-lot goal. */
  goalRs: number;
  thetaPerDay: number | null;
  /** 5-minute candles this page already loads. */
  candles: Candle[];
  /** Median minutes past winners on this page took, if there are enough. */
  medianWinnerMinutes: number | null;
  now?: number;
}

/** Under this many minutes a call has not had a chance to do anything yet. */
export const TOO_EARLY_MIN = 4;
/** Handing back this share of the best run is the first real warning. */
export const GIVE_BACK_WARN_PCT = 35;
/** Handing back this much, after a real run, is the exit trigger. */
export const GIVE_BACK_EXIT_PCT = 55;

const rupees = (premiumMove: number, lotSize: number) => Math.round(premiumMove * lotSize);

export function reviewCall(input: ReviewInput): CallReview {
  const now = input.now ?? Date.now();
  const minutesOpen = Math.max(0, (now - input.openedAt) / 60_000);
  const factors: ReviewFactor[] = [];

  // Always long the premium on this page (a bought CE or PE), so profit is
  // simply premium above entry regardless of which way the underlying goes.
  const pnlRs = input.current === null ? null : rupees(input.current - input.entry, input.lotSize);
  const bestPremium = Math.max(input.peak ?? input.entry, input.current ?? input.entry, input.entry);
  const peakRs = rupees(bestPremium - input.entry, input.lotSize);
  const goalProgressPct = pnlRs === null || input.goalRs <= 0 ? null : Math.round((pnlRs / input.goalRs) * 100);

  // Give-back is measured in RUPEES OF THE RUN, not of the premium: handing
  // back ₹1,400 of a ₹2,400 run is the same mistake whatever the premium was.
  //
  // It only applies while the position is STILL IN PROFIT. Once a call is at a
  // loss the arithmetic runs past 100% -- a +₹200 peak now at -₹500 computes
  // as "350% given back" -- and that number then out-ranked the tape check, so
  // a losing call with the 5-minute flipped against it was being reported as a
  // trim on rolled-over momentum instead of the exit it plainly is. Past the
  // peak and underwater is not a give-back; it is simply a losing trade, and
  // the loss is the headline.
  const inProfit = pnlRs !== null && pnlRs > 0;
  const giveBackPct = !inProfit || peakRs <= 0 ? null : Math.max(0, Math.min(100, Math.round(((peakRs - pnlRs!) / peakRs) * 100)));

  // Theta is the chain's CURRENT per-day figure applied to elapsed time -- an
  // approximation, since theta itself drifts, but a real measured number
  // rather than a guess, and the card says which it is.
  const thetaBurnedRs =
    input.thetaPerDay === null ? null : Math.round(Math.abs(input.thetaPerDay) * (minutesOpen / 1440) * input.lotSize);

  // --- Tape: is the 5-minute structure still behind the direction? ---
  const st = input.candles.length ? superTrend(input.candles) : null;
  const adxNow = input.candles.length ? adxOf(input.candles) : null;
  const tapeWith = st ? st.direction === input.direction : null;
  if (tapeWith === true) {
    factors.push({ id: "tape", label: "5-minute tape", side: "for", detail: `Still ${input.direction} on the 5-minute — the move that triggered this call has not turned.` });
  } else if (tapeWith === false) {
    factors.push({ id: "tape", label: "5-minute tape", side: "against", detail: `The 5-minute has flipped against a ${input.optSide}. The reason for this call is gone.` });
  }
  if (adxNow !== null) {
    if (adxNow >= 25) factors.push({ id: "adx", label: "Trend strength", side: "for", detail: `ADX ${adxNow.toFixed(0)} — there is a real trend carrying this, not chop.` });
    else if (adxNow < 18) factors.push({ id: "adx", label: "Trend strength", side: "against", detail: `ADX ${adxNow.toFixed(0)} — the move has gone flat. Premium bleeds in chop.` });
  }

  // --- Money ---
  if (pnlRs !== null) {
    factors.push({
      id: "pnl",
      label: "Position",
      side: pnlRs > 0 ? "for" : pnlRs < 0 ? "against" : "neutral",
      detail: pnlRs >= 0 ? `Up ₹${pnlRs.toLocaleString("en-IN")} on 1 lot.` : `Down ₹${Math.abs(pnlRs).toLocaleString("en-IN")} on 1 lot.`,
    });
  }
  if (giveBackPct !== null && giveBackPct >= GIVE_BACK_WARN_PCT && peakRs > 0) {
    factors.push({
      id: "giveback",
      label: "Given back",
      side: "against",
      detail: `Peaked at +₹${peakRs.toLocaleString("en-IN")}, now +₹${Math.max(0, pnlRs ?? 0).toLocaleString("en-IN")} — ${giveBackPct}% of the run handed back.`,
    });
  }
  if (thetaBurnedRs !== null && thetaBurnedRs > 0) {
    const heavy = pnlRs !== null && pnlRs <= 0 && thetaBurnedRs >= Math.abs(rupees(input.entry * 0.03, input.lotSize));
    factors.push({
      id: "theta",
      label: "Time decay",
      side: heavy ? "against" : "neutral",
      detail: `About ₹${thetaBurnedRs.toLocaleString("en-IN")} of the premium has gone to time decay in ${formatMinutes(minutesOpen)}.`,
    });
  }
  if (input.medianWinnerMinutes !== null && minutesOpen > input.medianWinnerMinutes * 2 && (pnlRs ?? 0) <= 0) {
    factors.push({
      id: "stale",
      label: "Time in trade",
      side: "against",
      detail: `Open ${formatMinutes(minutesOpen)} — more than twice the ${formatMinutes(input.medianWinnerMinutes)} this page's winners usually need, and still not in profit.`,
    });
  }

  const { verdict, headline, reason } = decide({ input, minutesOpen, pnlRs, peakRs, giveBackPct, goalProgressPct, tapeWith });
  const health = healthScore({ pnlRs, giveBackPct, goalProgressPct, tapeWith, adxNow, goalRs: input.goalRs });

  return {
    verdict,
    headline,
    reason,
    health,
    pnlRs,
    peakRs: peakRs > 0 ? peakRs : 0,
    giveBackPct,
    goalProgressPct,
    thetaBurnedRs,
    minutesOpen: Math.round(minutesOpen),
    factors,
    invalidation: invalidationFor(input),
  };
}

function decide(a: {
  input: ReviewInput;
  minutesOpen: number;
  pnlRs: number | null;
  peakRs: number;
  giveBackPct: number | null;
  goalProgressPct: number | null;
  tapeWith: boolean | null;
}): { verdict: ReviewVerdict; headline: string; reason: string } {
  const { input, minutesOpen, pnlRs, peakRs, giveBackPct, goalProgressPct, tapeWith } = a;

  if (pnlRs === null) {
    return { verdict: "unknown", headline: "No live premium", reason: "The option chain is unreachable, so this call cannot be reviewed right now. Nothing is being guessed." };
  }
  if (minutesOpen < TOO_EARLY_MIN) {
    return { verdict: "early", headline: "Too early to judge", reason: `Open ${formatMinutes(minutesOpen)}. Give it room — reviewing a call this young is reading noise.` };
  }

  // Handing back a real run is the single most expensive habit on a fast
  // page, so it outranks everything except having no data at all.
  if (giveBackPct !== null && peakRs >= input.goalRs && giveBackPct >= GIVE_BACK_EXIT_PCT) {
    return {
      verdict: "exit",
      headline: "You are giving back the win",
      reason: `This hit +₹${peakRs.toLocaleString("en-IN")}, past the ₹${input.goalRs.toLocaleString("en-IN")} goal, and has handed back ${giveBackPct}% of it. The trade already did its job.`,
    };
  }
  if (goalProgressPct !== null && goalProgressPct >= 100) {
    return {
      verdict: "trim",
      headline: "Target reached",
      reason: `Up ₹${pnlRs.toLocaleString("en-IN")} on 1 lot, at or past this page's ₹${input.goalRs.toLocaleString("en-IN")} goal. This is what you came for.`,
    };
  }
  if (giveBackPct !== null && giveBackPct >= GIVE_BACK_EXIT_PCT && peakRs > 0) {
    return {
      verdict: "trim",
      headline: "Momentum has rolled over",
      reason: `Peaked at +₹${peakRs.toLocaleString("en-IN")} and given back ${giveBackPct}% of it. The run is over even though the stop has not been hit.`,
    };
  }
  if (tapeWith === false && pnlRs <= 0) {
    return {
      verdict: "exit",
      headline: "The reason for this call is gone",
      reason: `The 5-minute tape has flipped against the ${input.optSide} and the position is not in profit. There is nothing left backing it.`,
    };
  }
  if (tapeWith === false) {
    return {
      verdict: "trim",
      headline: "Tape turned while you are ahead",
      reason: `The 5-minute has flipped against the ${input.optSide} but you are still up ₹${pnlRs.toLocaleString("en-IN")}. Taking something here is the cautious read.`,
    };
  }
  if (giveBackPct !== null && giveBackPct >= GIVE_BACK_WARN_PCT) {
    return {
      verdict: "watch",
      headline: "Slipping from the high",
      reason: `${giveBackPct}% of the run is already gone. Not broken yet — but this is where a winner quietly turns into a scratch.`,
    };
  }
  if (pnlRs > 0) {
    return {
      verdict: "hold",
      headline: "Working",
      reason: `Up ₹${pnlRs.toLocaleString("en-IN")} with the tape still onside${goalProgressPct !== null ? ` — ${goalProgressPct}% of the way to the ₹${input.goalRs.toLocaleString("en-IN")} goal` : ""}.`,
    };
  }
  return {
    verdict: "watch",
    headline: "Not working yet",
    reason: `Down ₹${Math.abs(pnlRs).toLocaleString("en-IN")}, but the tape has not turned against the ${input.optSide}. The stop is still the line that matters.`,
  };
}

// A blunt 0-100 read on the position's current health. Deliberately NOT a
// win probability -- nothing here can compute one honestly.
function healthScore(a: {
  pnlRs: number | null;
  giveBackPct: number | null;
  goalProgressPct: number | null;
  tapeWith: boolean | null;
  adxNow: number | null;
  goalRs: number;
}): number {
  if (a.pnlRs === null) return 0;
  let score = 50;
  if (a.goalProgressPct !== null) score += Math.max(-30, Math.min(30, a.goalProgressPct * 0.3));
  if (a.giveBackPct !== null) score -= Math.min(30, a.giveBackPct * 0.4);
  if (a.tapeWith === true) score += 12;
  if (a.tapeWith === false) score -= 20;
  if (a.adxNow !== null) score += a.adxNow >= 25 ? 8 : a.adxNow < 18 ? -8 : 0;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function invalidationFor(input: ReviewInput): string {
  const nextIdx = input.targetsHit.findIndex((h) => !h);
  const nextTarget = input.targets[nextIdx === -1 ? input.targets.length - 1 : nextIdx];
  return `Premium back to ₹${input.stop.toFixed(2)} ends this call. ₹${nextTarget.toFixed(2)} is the next level that pays.`;
}

export function formatMinutes(mins: number): string {
  const m = Math.round(mins);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h}h ${rem}m` : `${h}h`;
}

/**
 * Median minutes this page's own WINNING closed trades stayed open. Used only
 * to say when a call has been open unusually long, so it needs enough closed
 * winners to mean anything.
 */
export const MIN_WINNERS_FOR_MEDIAN = 5;

export function medianWinnerMinutes(
  closed: { status: string; openedAt: number; closedAt: number | null }[]
): number | null {
  const durations = closed
    .filter((e) => (e.status === "target3_hit" || e.status === "stopped_after_t1") && e.closedAt !== null)
    .map((e) => (e.closedAt! - e.openedAt) / 60_000)
    .filter((m) => m > 0)
    .sort((x, y) => x - y);
  if (durations.length < MIN_WINNERS_FOR_MEDIAN) return null;
  const mid = Math.floor(durations.length / 2);
  return durations.length % 2 ? durations[mid] : (durations[mid - 1] + durations[mid]) / 2;
}
