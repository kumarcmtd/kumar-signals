// "Can I buy now?" for a call that is already running -- answered for someone
// who is NOT in it yet, from the live premium against the call's own plan.
//
// The plan (entry, stop, T1) was right at the moment of the call. The further
// the price has already run toward T1, the less reward is left for the same
// stop -- so a late buyer gets a worse trade than the call did:
//   at or below the call price ........ ENTER (a better price than the call)
//   up to 1/4 of the way to T1 ........ ENTER, but don't pay more than "buy up to"
//   1/4 to 1/2 of the way ............. WAIT for a dip to "buy up to"
//   past 1/2, or T1 already touched ... DON'T CHASE
//   more than halfway DOWN to the stop  WAIT -- the call is not working yet
// Plus: the call is over, the signal has weakened, or MCX closes too soon.

import { mcxSessionAt } from "./mcxSession";

/** Minutes left until MCX closes today; null while it is shut. */
export function minutesToMcxClose(now: number = Date.now()): number | null {
  const s = mcxSessionAt(now);
  return s.isOpen ? s.closeMin - s.minutes : null;
}

export type BuyNowState = "enter" | "wait_dip" | "weak" | "near_stop" | "no_chase" | "too_late" | "over" | "no_price";

export interface BuyNowAdvice {
  state: BuyNowState;
  title: string;
  detail: string;
  /** The highest price at which a new entry still keeps most of the plan's reward. */
  buyUpTo: number | null;
  /** What to do if you are already in it (null when there is nothing to add). */
  holding: string | null;
}

export const BUY_UP_TO_SHARE = 0.25; // of the way from entry to T1
const WAIT_SHARE = 0.5;
const NEAR_STOP_SHARE = 0.5; // of the way from entry down to the stop
export const LATE_MINUTES = 45; // before the MCX close

const p2 = (n: number) => `₹${n.toFixed(2)}`;
const rsLot = (n: number) => `₹${Math.abs(Math.round(n)).toLocaleString("en-IN")}`;

export function buyNowAdvice(p: {
  entry: number;
  stop: number;
  targets: [number, number, number];
  targetsHit: [boolean, boolean, boolean];
  closed: boolean;
  live: number | null;
  lot: number;
  /** Minutes until MCX closes today, or null when unknown. */
  minutesToClose: number | null;
  /** Is the signal that made the call still saying BUY? null = not known for this page. */
  stillValid?: boolean | null;
  /** How the signal reads now, e.g. "WATCH BUY" (shown when it has weakened). */
  signalNow?: string | null;
  /** Minutes until a time-limited call (Ai-Trust quick trade) closes itself. */
  exitByMinutes?: number | null;
  /** A hold-to-close call: the stop never moves and targets are only profit marks. */
  hold?: boolean;
}): BuyNowAdvice {
  const { entry, stop, targets, targetsHit, live, lot } = p;
  const t1 = targets[0];
  const buyUpTo = Number((entry + BUY_UP_TO_SHARE * (t1 - entry)).toFixed(2));
  const holdStop = p.hold
    ? targetsHit[0]
      ? `Already in? Keep your stop at ${p2(stop)} — this call holds to the close (booking some profit is your choice).`
      : null
    : targetsHit[1]
      ? `Already in? Your stop is now T1 (${p2(t1)}) — profit locked.`
      : targetsHit[0]
        ? `Already in? Move your stop to your entry (${p2(entry)}) — no loss from here. Book some near T2 (${p2(targets[1])}).`
        : null;

  if (p.closed) return { state: "over", title: "CALL OVER — don't enter", detail: "This call has already closed. Wait for the next one.", buyUpTo: null, holding: null };
  if (live === null) return { state: "no_price", title: "CAN'T CHECK — no live price", detail: "The option price is not available right now. Don't enter blind.", buyUpTo: null, holding: null };
  const effStop = p.hold ? stop : targetsHit[1] ? t1 : targetsHit[0] ? entry : stop;
  if (live <= effStop) {
    return { state: "over", title: "STOP REACHED — don't enter", detail: `${p2(live)} is at the stop (${p2(effStop)}). This call is finishing — wait for the next one.`, buyUpTo: null, holding: "Already in? Exit — the stop is hit." };
  }
  if (targetsHit[0]) {
    return { state: "no_chase", title: "DON'T CHASE — T1 already reached", detail: `This call already touched T1 (${p2(t1)}). The planned move is done — wait for the next fresh call.`, buyUpTo: null, holding: holdStop };
  }
  const riskLot = (live - stop) * lot;
  const rewardLot = (t1 - live) * lot;
  const plan = `Stop ${p2(stop)} (risk −${rsLot(riskLot)}/lot) · T1 ${p2(t1)} (+${rsLot(rewardLot)}/lot).`;
  if (p.minutesToClose !== null && p.minutesToClose < LATE_MINUTES) {
    return { state: "too_late", title: "TOO LATE TODAY — don't start a new trade", detail: `Less than ${LATE_MINUTES} minutes to MCX close: no time for the move, and open calls close at the bell.`, buyUpTo: null, holding: null };
  }
  if (p.exitByMinutes != null && p.exitByMinutes < 10) {
    return { state: "too_late", title: "TOO LATE — this quick trade is about to close", detail: `It closes itself in ${Math.max(0, Math.round(p.exitByMinutes))} min — no time left for a new entry.`, buyUpTo: null, holding: null };
  }
  if (p.stillValid === false) {
    return {
      state: "weak",
      title: "WAIT — the signal has weakened",
      detail: `The signal that made this call now reads ${p.signalNow ?? "weaker"}. Don't start a new trade until it says BUY again.`,
      buyUpTo: null,
      holding: `Already in? Keep the stop at ${p2(stop)}.`,
    };
  }
  if (live < entry) {
    const down = (entry - live) / Math.max(1e-9, entry - stop);
    if (down > NEAR_STOP_SHARE) {
      return { state: "near_stop", title: "WAIT — the call is not working yet", detail: `Price fell more than halfway to the stop (${p2(stop)}). Buy only if it climbs back above ${p2(entry)}.`, buyUpTo: null, holding: `Already in? Exit if ${p2(stop)} breaks — don't add more.` };
    }
    return { state: "enter", title: `YES — good price, you can buy at ${p2(live)}`, detail: `That is below the call price ${p2(entry)}. ${plan}`, buyUpTo, holding: null };
  }
  const share = (live - entry) / Math.max(1e-9, t1 - entry);
  const pct = Math.round(share * 100);
  if (share <= BUY_UP_TO_SHARE) {
    return { state: "enter", title: `YES — you can still buy at ${p2(live)}`, detail: `Only ${pct}% of the move to T1 is done. ${plan} Don't pay more than ${p2(buyUpTo)}.`, buyUpTo, holding: null };
  }
  if (share <= WAIT_SHARE) {
    return { state: "wait_dip", title: `WAIT — don't buy at ${p2(live)}`, detail: `${pct}% of the move to T1 is already done. Buy only at ${p2(buyUpTo)} or lower — set a limit order there.`, buyUpTo, holding: null };
  }
  return {
    state: "no_chase",
    title: "DON'T CHASE — price already moved",
    detail: `${pct}% of the move to T1 is done: only +${rsLot(rewardLot)}/lot left against −${rsLot(riskLot)}/lot risk. Wait for a dip to ${p2(buyUpTo)} or the next call.`,
    buyUpTo,
    holding: `Already in? Hold with the stop at ${p2(stop)}; book profit near T1 (${p2(t1)}).`,
  };
}
