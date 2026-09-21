// "Can I Buy Now?" -- one answer, from every gate at once.
//
// WHY THIS EXISTS. The cards already showed a green "Buy Now" badge and, a few
// centimetres below it, a red "CONFLICT -- WAIT for alignment, don't trade the
// news alone." Both were computed correctly; nothing reconciled them. A trader
// glancing at the page between other work reads the green badge and enters.
//
// Worse, the green badge was driven almost entirely by entry TIMING -- how far
// through the leg price had travelled. A signal that has only just fired is by
// definition 0% through its leg, so a fresh call almost always showed "Buy Now
// -- most of the move is still ahead". That is not a safety check. It is a
// restatement of the fact that the signal is new.
//
// This module asks every gate and returns ONE verdict that is allowed to say
// no. The gates are ordered by how expensive it is to ignore them.
//
// TWO THINGS IT WILL NEVER DO
//  1. Say "safe". No option purchase is safe; the whole position can go to
//     zero. It says whether the entry is still VALID, which is a different and
//     honest claim.
//  2. Invent a level. Entry, target and stop are recalculated from the live
//     premium and the card's own levels, never made up -- and if entering late
//     has ruined the risk/reward, it says so with the new numbers.

export type BuyVerdict = "yes" | "wait" | "no";

export interface BuyGate {
  /** Short name of the check, e.g. "News and chart agree". */
  name: string;
  passed: boolean;
  /** Why it passed or failed, in plain words. */
  detail: string;
  /** A failed blocking gate forces NO; a failed soft gate only downgrades to WAIT. */
  blocking: boolean;
}

export interface BuyPlan {
  /** What you would actually pay now. */
  entry: number;
  stop: number;
  target: number;
  /** Rupees at risk per lot if the stop is hit. */
  riskPerLot: number;
  /** Rupees gained per lot if the target is hit. */
  rewardPerLot: number;
  /** Reward divided by risk. Below 1 means risking more than you stand to make. */
  riskReward: number;
}

export interface BuyAnswer {
  verdict: BuyVerdict;
  /** The big line. */
  headline: string;
  /** One sentence of why. */
  reason: string;
  plan: BuyPlan | null;
  gates: BuyGate[];
  /** Everything that failed, for the "why not" list. */
  blockers: string[];
  /** Said on every YES, without exception. */
  riskNote: string;
}

export interface BuyCheckInput {
  /** Live premium of the option right now. */
  livePremium: number | null;
  /** The card's stop and next target for this leg. */
  stop: number;
  target: number;
  /** Contract multiplier, so risk can be shown in rupees. */
  lotSize: number;
  /** Is MCX actually open? */
  marketOpen: boolean;
  /** The entry-timing tier already computed for the card. */
  timingTier: "excellent" | "good" | "fair" | "late" | "underwater" | "past_target" | "past_stop";
  /** True when news and technicals point opposite ways. */
  conflict: boolean;
  /** Combined score, -100..100, positive = bullish. */
  netScore: number | null;
  /** Which side the card is proposing. A PE profits when the underlying falls. */
  optSide: "CE" | "PE";
  /** Typical premium movement per candle, for judging whether the stop is real. */
  premiumSwingPerCandle: number | null;
  /** IST hour, 0-23. The backtest found the hour matters more than expected. */
  istHour: number | null;
  /** Minutes since the signal was created. A stale signal is a different trade. */
  signalAgeMinutes: number | null;
}

/**
 * The current hour in IST, 0-23.
 *
 * Shared rather than re-derived on each page: the backtest's time-of-day
 * finding is only useful if every page reads the clock the same way, and the
 * browser's own timezone is not necessarily India's.
 */
export function istHourInKolkata(now: Date = new Date()): number | null {
  const h = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", hour12: false }).format(now);
  const n = Number(h);
  return Number.isFinite(n) ? n : null;
}

/** A stop closer than this many candle-swings is inside normal noise. */
const MIN_STOP_IN_SWINGS = 1.2;
/** Below this reward-to-risk, a premium buy is not worth taking. */
const MIN_RISK_REWARD = 1;
/** Hours the backtest found materially worse on this engine (IST). */
const WEAK_HOURS = [9, 10, 11];
/** A signal older than this has had time to become a different trade. */
const STALE_AFTER_MINUTES = 45;

export function canIBuyNow(input: BuyCheckInput): BuyAnswer {
  const gates: BuyGate[] = [];
  const {
    livePremium, stop, target, lotSize, marketOpen, timingTier, conflict,
    netScore, optSide, premiumSwingPerCandle, istHour, signalAgeMinutes,
  } = input;

  const add = (name: string, passed: boolean, detail: string, blocking: boolean) => gates.push({ name, passed, detail, blocking });

  // --- Gate 1: is the market even open? ---------------------------------
  add("Market is open", marketOpen, marketOpen ? "MCX is trading." : "MCX is closed — nothing can be entered right now.", true);

  // --- Gate 2: do we have a live price? ---------------------------------
  const havePrice = livePremium !== null && Number.isFinite(livePremium) && livePremium > 0;
  add("Live price available", havePrice, havePrice ? `Premium is ₹${livePremium!.toFixed(2)}.` : "No live premium, so there is nothing to price an entry against.", true);

  if (!havePrice || !marketOpen) {
    return {
      verdict: "no",
      headline: marketOpen ? "Can't check right now" : "Market is closed",
      reason: marketOpen ? "No live premium is available, so there is no honest answer." : "MCX is closed. Nothing to enter until it reopens.",
      plan: null,
      gates,
      blockers: gates.filter((g) => !g.passed).map((g) => g.detail),
      riskNote: "",
    };
  }

  const entry = livePremium!;

  // --- Gate 3: is the trade still alive at all? -------------------------
  const pastStop = entry <= stop;
  add("Still above the stop", !pastStop, pastStop ? `Premium ₹${entry.toFixed(2)} is already at or below the stop ₹${stop.toFixed(2)} — this is an exit, not an entry.` : `Premium is ₹${(entry - stop).toFixed(2)} above the stop.`, true);

  const pastTarget = entry >= target;
  add("Target not already reached", !pastTarget, pastTarget ? `Premium ₹${entry.toFixed(2)} has already passed the target ₹${target.toFixed(2)} — entering now is chasing.` : `Target is ₹${(target - entry).toFixed(2)} away.`, true);

  // --- Gate 4: news and chart agreement ---------------------------------
  // The gate the old green badge ignored entirely.
  add(
    "News and chart agree",
    !conflict,
    conflict
      ? "News and the technical/options structure point opposite ways. When they fight, price usually chops and a tight stop gets taken out by noise."
      : "No conflict flagged between news and the chart.",
    true
  );

  // --- Gate 5: does the combined score back THIS side? -------------------
  // A PE needs a bearish score; a CE needs a bullish one.
  let scoreBacksSide = true;
  let scoreDetail = "No combined score available, so this check is skipped rather than assumed.";
  if (netScore !== null) {
    scoreBacksSide = optSide === "CE" ? netScore > 0 : netScore < 0;
    scoreDetail = scoreBacksSide
      ? `Combined score ${netScore > 0 ? "+" : ""}${netScore} is on the same side as this ${optSide === "CE" ? "Call" : "Put"}.`
      : `Combined score ${netScore > 0 ? "+" : ""}${netScore} points the OTHER way from this ${optSide === "CE" ? "Call" : "Put"}.`;
  }
  add("Overall score backs this side", scoreBacksSide, scoreDetail, true);

  // --- Gate 6: is the stop outside normal noise? ------------------------
  let stopIsReal = true;
  let stopDetail = "No per-candle swing figure available, so stop distance could not be checked.";
  if (premiumSwingPerCandle !== null && premiumSwingPerCandle > 0) {
    const swings = (entry - stop) / premiumSwingPerCandle;
    stopIsReal = swings >= MIN_STOP_IN_SWINGS;
    stopDetail = stopIsReal
      ? `Stop is ${swings.toFixed(1)} normal candle moves away — outside the everyday noise.`
      : `Stop is only ${swings.toFixed(1)} of a normal candle move away. Ordinary wobble would hit it even if the direction is right.`;
  }
  add("Stop is outside the noise", stopIsReal, stopDetail, true);

  // --- Gate 7: risk and reward at the CURRENT price ---------------------
  const riskPerLot = Number(((entry - stop) * lotSize).toFixed(0));
  const rewardPerLot = Number(((target - entry) * lotSize).toFixed(0));
  const riskReward = riskPerLot > 0 ? Number((rewardPerLot / riskPerLot).toFixed(2)) : 0;
  const rrOk = riskReward >= MIN_RISK_REWARD;
  add(
    "Worth the risk at this price",
    rrOk,
    rrOk
      ? `Risking ₹${riskPerLot.toLocaleString("en-IN")} to make ₹${rewardPerLot.toLocaleString("en-IN")} — ${riskReward}:1.`
      : `Risking ₹${riskPerLot.toLocaleString("en-IN")} to make only ₹${rewardPerLot.toLocaleString("en-IN")} — ${riskReward}:1. Entering this late has spoiled the trade even though the direction may still be right.`,
    true
  );

  // --- Gate 8 (soft): entry timing --------------------------------------
  const timingOk = timingTier === "excellent" || timingTier === "good";
  add(
    "Entry is not late",
    timingOk,
    timingOk ? "Most of the expected move is still ahead." : "A good part of this move has already happened, so the reward left is smaller than it was.",
    false
  );

  // --- Gate 9 (soft): the hour, from the backtest -----------------------
  const hourOk = istHour === null || !WEAK_HOURS.includes(istHour);
  add(
    "Time of day",
    hourOk,
    hourOk ? "Not in the window this engine historically did worst in." : `${istHour}:00 IST is inside the morning window where this engine's past signals did clearly worse.`,
    false
  );

  // --- Gate 10 (soft): signal freshness ---------------------------------
  const fresh = signalAgeMinutes === null || signalAgeMinutes <= STALE_AFTER_MINUTES;
  add(
    "Signal is still fresh",
    fresh,
    fresh ? "The call is recent." : `The call is ${Math.round(signalAgeMinutes!)} minutes old. The setup that produced it may no longer be the setup in front of you.`,
    false
  );

  // --- Verdict -----------------------------------------------------------
  const failedBlocking = gates.filter((g) => g.blocking && !g.passed);
  const failedSoft = gates.filter((g) => !g.blocking && !g.passed);
  const plan: BuyPlan = { entry: Number(entry.toFixed(2)), stop: Number(stop.toFixed(2)), target: Number(target.toFixed(2)), riskPerLot, rewardPerLot, riskReward };

  if (failedBlocking.length > 0) {
    return {
      verdict: "no",
      headline: "No — don't enter this one",
      reason: failedBlocking[0].detail,
      plan: null,
      gates,
      blockers: failedBlocking.map((g) => g.detail),
      riskNote: "",
    };
  }

  if (failedSoft.length >= 2) {
    return {
      verdict: "wait",
      headline: "Wait — not a clean entry",
      reason: "Nothing here says the trade is wrong, but more than one thing is against you at this exact moment.",
      plan,
      gates,
      blockers: failedSoft.map((g) => g.detail),
      riskNote: "",
    };
  }

  if (failedSoft.length === 1) {
    return {
      verdict: "wait",
      headline: "Probably — but one thing is against you",
      reason: failedSoft[0].detail,
      plan,
      gates,
      blockers: failedSoft.map((g) => g.detail),
      riskNote: `If you do take it: risk ₹${riskPerLot.toLocaleString("en-IN")} per lot, and the whole premium can still be lost.`,
    };
  }

  return {
    verdict: "yes",
    headline: "Yes — this is still a valid entry",
    reason: `Every check passed at ₹${entry.toFixed(2)}. Risking ₹${riskPerLot.toLocaleString("en-IN")} per lot to make ₹${rewardPerLot.toLocaleString("en-IN")} — ${riskReward}:1.`,
    plan,
    gates,
    blockers: [],
    // Said on every single YES. "Valid" is not "safe", and the difference is
    // the entire premium.
    riskNote: `Valid does not mean safe. If this goes wrong you lose ₹${riskPerLot.toLocaleString("en-IN")} per lot at the stop, and the full premium if you do not use the stop. Conditions can change in minutes.`,
  };
}
