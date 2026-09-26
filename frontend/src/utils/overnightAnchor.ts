// Is the overnight anchor actually from LAST NIGHT?
//
// The anchor is one snapshot of WTI/Brent/Henry Hub, written by the cron just
// after MCX shuts. The card built on it says "since MCX closed last night",
// and that sentence is only true while the anchor is the most recent close.
//
// It can silently stop being true. If Yahoo is down for the whole 23:30-23:59
// window, no snapshot is written that night and yesterday's stays in KV. The
// next morning the card would still render a percentage, still label it "since
// MCX closed last night", and quietly be measuring across TWO nights. The
// number would be real; the sentence around it would be a lie.
//
// So rather than trusting the anchor's age, this counts the MCX closes that
// have happened since it was taken. Zero means it IS the most recent close --
// which correctly covers a Monday morning reading against Friday's 11:30 PM,
// because MCX did not close on Saturday or Sunday. One or more means a close
// was missed and the card must say so instead of mislabelling the window.

import { mcxCloseInstant } from "./mcxSession";

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

interface IstDate {
  y: number;
  m: number;
  d: number;
}

/** The IST calendar date an instant falls on. */
function istDateOf(ms: number): IstDate {
  const t = new Date(ms + IST_OFFSET_MS);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

/**
 * The instant MCX closes on a given IST date -- from the shared DST-aware
 * clock, so this can never disagree with the Worker about when a close
 * happened. A fixed 23:30 here would count a winter close 25 minutes early,
 * flagging a perfectly current snapshot as stale mid-session.
 */
function closeInstant(x: IstDate): number {
  return mcxCloseInstant(x.y, x.m, x.d);
}

function isWeekday(x: IstDate): boolean {
  const day = new Date(Date.UTC(x.y, x.m - 1, x.d)).getUTCDay();
  return day >= 1 && day <= 5;
}

/**
 * How many MCX closes have happened since `takenAtMs`, up to and including
 * `nowMs`.
 *
 * The anchor's own close is at or just before the moment it was taken, so it is
 * never counted: the comparison is strictly after.
 */
export function mcxClosesSince(takenAtMs: number, nowMs: number): number {
  if (!Number.isFinite(takenAtMs) || !Number.isFinite(nowMs) || nowMs <= takenAtMs) return 0;

  let count = 0;
  const start = istDateOf(takenAtMs);
  const end = istDateOf(nowMs);
  // Walk IST calendar dates. Bounded by a sanity cap so a corrupt timestamp
  // cannot spin here -- anything beyond a month is stale by any measure.
  const cursor = new Date(Date.UTC(start.y, start.m - 1, start.d));
  const endMs = Date.UTC(end.y, end.m - 1, end.d);
  for (let i = 0; i <= 40 && cursor.getTime() <= endMs; i += 1) {
    const x = { y: cursor.getUTCFullYear(), m: cursor.getUTCMonth() + 1, d: cursor.getUTCDate() };
    if (isWeekday(x)) {
      const close = closeInstant(x);
      if (close > takenAtMs && close <= nowMs) count += 1;
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
}

export interface AnchorFreshness {
  /** True when the anchor is the most recent MCX close. */
  current: boolean;
  /** Closes that happened after the snapshot was taken. */
  missedCloses: number;
  /** Null when the anchor is current; otherwise a plain warning. */
  warning: string | null;
}

export function readAnchorFreshness(takenAt: string | null | undefined, now: number = Date.now()): AnchorFreshness {
  if (!takenAt) return { current: false, missedCloses: 0, warning: null };
  const t = new Date(takenAt).getTime();
  if (!Number.isFinite(t)) return { current: false, missedCloses: 0, warning: "The saved snapshot has an unreadable timestamp, so its age cannot be checked." };

  const missedCloses = mcxClosesSince(t, now);
  if (missedCloses === 0) return { current: true, missedCloses: 0, warning: null };

  return {
    current: false,
    missedCloses,
    warning:
      `This snapshot is older than last night's close — ${missedCloses} MCX ${missedCloses === 1 ? "close has" : "closes have"} happened since it was taken, so the figures below ` +
      `span more than one night. Either the snapshot failed to record (the global price feed was unreachable at 11:30 PM) or those days were market holidays, which this app has no calendar for.`,
  };
}
