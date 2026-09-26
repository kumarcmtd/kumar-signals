// MCX energy session clock -- the ONE place that decides when MCX is open.
//
// Before this existed the app carried five separate answers. The Worker's
// market status and the GPT News session said 23:30; Global Market Hours and
// the session strategy said 23:55; the time profile said 23:30. So between
// 23:30 and 23:55 IST, half the app said MCX was open and half said it was
// shut -- and the end-of-day close had no definition at all.
//
// THE RULE. MCX energy trades 9:00 AM IST until 11:30 PM while the US is on
// daylight-saving time, and until 11:55 PM while the US is on standard time,
// because the session is pinned to the NYMEX close rather than to Indian
// clocks. US DST runs from the second Sunday of March to the first Sunday of
// November, so in 2026 the late close starts on Monday 2 November.
//
// Everything here is pure and takes the instant as an argument, so the Worker,
// the cron and the browser all compute the same answer from the same code, and
// the tests can pin any date without touching the system clock.
//
// NOT HANDLED: exchange holidays. There is no holiday calendar in this app, so
// a holiday weekday reads as a normal session. Every consumer that matters
// (the EOD close, the overnight anchor) is written to tolerate that.

export const MCX_OPEN_MIN = 9 * 60;
export const PRE_OPEN_MIN = 8 * 60 + 30;
/** Close while the US is on daylight-saving time. */
export const CLOSE_US_DST_MIN = 23 * 60 + 30;
/** Close while the US is on standard time. */
export const CLOSE_US_STD_MIN = 23 * 60 + 55;

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface IstParts {
  y: number;
  /** 1-12 */
  m: number;
  d: number;
  /** 0 = Sunday ... 6 = Saturday */
  weekday: number;
  /** Minutes since IST midnight. */
  minutes: number;
  /** "YYYY-MM-DD" in IST. */
  date: string;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The IST wall clock for an instant, without relying on the host's timezone. */
export function istParts(ms: number = Date.now()): IstParts {
  const t = new Date(ms + IST_OFFSET_MS);
  const y = t.getUTCFullYear();
  const m = t.getUTCMonth() + 1;
  const d = t.getUTCDate();
  return { y, m, d, weekday: t.getUTCDay(), minutes: t.getUTCHours() * 60 + t.getUTCMinutes(), date: `${y}-${pad(m)}-${pad(d)}` };
}

export function isTradingWeekday(weekday: number): boolean {
  return weekday >= 1 && weekday <= 5;
}

/** Day-of-month of the nth Sunday of a month (monthIndex 0-11). */
function nthSunday(y: number, monthIndex: number, n: number): number {
  const firstDow = new Date(Date.UTC(y, monthIndex, 1)).getUTCDay();
  const firstSunday = 1 + ((7 - firstDow) % 7);
  return firstSunday + (n - 1) * 7;
}

/**
 * Is the US on daylight-saving time for the MCX session on this IST date?
 *
 * Compared as whole calendar dates. The switch happens on a Sunday, when MCX
 * does not trade, so every trading day is unambiguously one side or the other:
 * the Monday after the March switch is the first DST session, and the Monday
 * after the November switch is the first standard-time one.
 */
export function usDstForSession(y: number, m: number, d: number): boolean {
  const start = nthSunday(y, 2, 2); // second Sunday of March
  const end = nthSunday(y, 10, 1); // first Sunday of November
  const key = m * 100 + d;
  return key > 300 + start && key < 1100 + end;
}

/** Minutes after IST midnight at which MCX closes on this date. */
export function mcxCloseMinutes(y: number, m: number, d: number): number {
  return usDstForSession(y, m, d) ? CLOSE_US_DST_MIN : CLOSE_US_STD_MIN;
}

/** The UTC instant of MCX's open on an IST date. */
export function mcxOpenInstant(y: number, m: number, d: number): number {
  return Date.UTC(y, m - 1, d) + MCX_OPEN_MIN * 60_000 - IST_OFFSET_MS;
}

/** The UTC instant of MCX's close on an IST date. */
export function mcxCloseInstant(y: number, m: number, d: number): number {
  return Date.UTC(y, m - 1, d) + mcxCloseMinutes(y, m, d) * 60_000 - IST_OFFSET_MS;
}

/** "11:30 PM" or "11:55 PM", for anywhere the close is shown to a person. */
export function closeLabel(closeMin: number): string {
  const h = Math.floor(closeMin / 60);
  const mm = pad(closeMin % 60);
  return `${h > 12 ? h - 12 : h}:${mm} ${h >= 12 ? "PM" : "AM"}`;
}

export interface McxSession {
  isOpen: boolean;
  isPreOpen: boolean;
  weekday: number;
  minutes: number;
  date: string;
  /** Today's close, in IST minutes -- DST-aware. */
  closeMin: number;
  closeLabel: string;
}

export function mcxSessionAt(ms: number = Date.now()): McxSession {
  const p = istParts(ms);
  const closeMin = mcxCloseMinutes(p.y, p.m, p.d);
  const weekday = isTradingWeekday(p.weekday);
  return {
    isOpen: weekday && p.minutes >= MCX_OPEN_MIN && p.minutes < closeMin,
    isPreOpen: weekday && p.minutes >= PRE_OPEN_MIN && p.minutes < MCX_OPEN_MIN,
    weekday: p.weekday,
    minutes: p.minutes,
    date: p.date,
    closeMin,
    closeLabel: closeLabel(closeMin),
  };
}

/**
 * The most recent MCX close at or before `ms`, as a UTC instant.
 *
 * Walks back over IST calendar dates to the latest trading weekday whose close
 * has already happened. On Saturday morning that is Friday's close; on Monday
 * at 10 AM it is also Friday's, because Monday's has not happened yet.
 */
export function lastMcxClose(ms: number = Date.now()): { date: string; closeAt: number } {
  for (let back = 0; back < 10; back += 1) {
    const p = istParts(ms - back * DAY_MS);
    if (!isTradingWeekday(p.weekday)) continue;
    const closeAt = mcxCloseInstant(p.y, p.m, p.d);
    if (closeAt <= ms) return { date: p.date, closeAt };
  }
  // Unreachable in practice -- ten days always contains a weekday close.
  return { date: istParts(ms).date, closeAt: ms };
}

/**
 * Is an option/future expiry still tradable?
 *
 * Expiries arrive as bare "YYYY-MM-DD". `new Date("2026-10-15")` parses that as
 * UTC midnight, which is 05:30 IST -- so the old `>= now` check dropped every
 * contract from 05:30 on its own expiry day, while it was still trading.
 * A contract is live until MCX closes on its expiry date.
 */
export function expiryStillLive(expiry: string, now: number = Date.now()): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(expiry);
  if (!m) return Number.isFinite(+new Date(expiry)) ? +new Date(expiry) >= now : false;
  return now < mcxCloseInstant(Number(m[1]), Number(m[2]), Number(m[3]));
}

// ---- Fast IST day keys ------------------------------------------------------
// IST is a fixed UTC+05:30 with no daylight saving, so the IST calendar day of
// an instant is plain arithmetic. These replace per-candle calls to
// Intl.DateTimeFormat, which the Worker profiler showed as the single largest
// CPU cost in the cron's Best Call analysis -- each format call costs several
// microseconds and they were being made for every bar of every previous day.
// Tested against the Intl-based versions they replace.

/** IST calendar day as an integer (days since the epoch, in IST). */
export function istDayNumber(ms: number): number {
  return Math.floor((ms + IST_OFFSET_MS) / DAY_MS);
}

/** MCX session day: an instant before 09:00 IST belongs to the previous day. */
export function sessionDayNumber(ms: number): number {
  return Math.floor((ms + IST_OFFSET_MS - MCX_OPEN_MIN * 60_000) / DAY_MS);
}

/** "YYYY-MM-DD" for a day number from istDayNumber / sessionDayNumber. */
export function dayNumberToKey(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Index of the first bar in the final run of bars sharing the last bar's key.
 *
 * Scans BACKWARD from the end, so on a many-day array it touches only the
 * last session's bars. For candles in time order (as every source here
 * provides them) this equals findIndex-from-the-start, which is what it
 * replaces.
 */
export function lastRunStart<T>(items: T[], key: (item: T) => number): number {
  if (!items.length) return -1;
  const last = key(items[items.length - 1]);
  let i = items.length - 1;
  while (i > 0 && key(items[i - 1]) === last) i -= 1;
  return i;
}

