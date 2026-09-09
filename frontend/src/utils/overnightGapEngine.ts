// Overnight global impact on MCX -- what actually happens AFTER the open.
//
// MCX crude/gas shuts around 11:30 PM IST and reopens at 9:00 AM. In between,
// Europe and the US trade the same barrel, so by the time MCX reopens the
// overnight global move has already happened. The trader does not need to be
// told there was a gap -- the gap is visible. The question worth answering is
// what came NEXT: did the move keep going, did it fade straight back, or did
// the tape sit flat until Europe and the US actually showed up?
//
// The overnight global move is not guessed at here. It is measured directly
// as the gap itself: MCX's open against its own previous close IS the market
// repricing everything that happened globally while it was shut. That makes
// this study entirely self-contained on real MCX candles -- no external
// overnight feed, nothing inferred.
//
// The scored window is the FIRST TWO HOURS, 9:00-11:00 AM IST -- not the whole
// session. Scoring by the 11:30 PM close answered the wrong question for a
// trader who is in and out in the morning: a gap can fade at 9:30 and still
// close green, which the daily candle records as a continuation. The worker's
// /api/gap-study builds these windows from 30-minute bars and this module
// scores them.
//
// Sample size is bounded by the contract, not by the lookback: MCX futures
// roll monthly, so a contract only has as much history as it has existed.
// Everything here reports the count it actually found, and refuses a verdict
// below MIN_GAP_SAMPLE rather than printing a confident percentage on noise.

import type { Candle } from "../types";

/** A gap smaller than this is noise, not an overnight move. */
export const FLAT_GAP_PCT = 0.3;
/** Above this, the overnight move was substantial. */
export const STRONG_GAP_PCT = 1.0;
/** A morning that ends within this of the open didn't really go anywhere. */
export const FLAT_DAY_PCT = 0.25;
/** Below this many matching sessions, no verdict is offered. */
export const MIN_GAP_SAMPLE = 10;

export type GapBucket = "strong_up" | "up" | "flat" | "down" | "strong_down";
export type GapVerdict = "follow" | "fade" | "mixed" | "insufficient";
export type DayOutcome = "continued" | "faded" | "flat";

export const BUCKET_LABEL: Record<GapBucket, string> = {
  strong_up: "Strong Up",
  up: "Up",
  flat: "Flat",
  down: "Down",
  strong_down: "Strong Down",
};

export function bucketForGap(gapPct: number): GapBucket {
  const mag = Math.abs(gapPct);
  if (mag < FLAT_GAP_PCT) return "flat";
  if (gapPct > 0) return mag >= STRONG_GAP_PCT ? "strong_up" : "up";
  return mag >= STRONG_GAP_PCT ? "strong_down" : "down";
}

/** One session's 9:00-11:00 AM window, as returned by /api/gap-study. */
export interface MorningGapRecord {
  date: string;
  gapPct: number;
  openPrice: number;
  closePrice: number;
  movePct: number;
  highPct: number;
  lowPct: number;
}

export interface GapSession {
  date: string;
  /** Open vs previous close, in percent. The overnight global move. */
  gapPct: number;
  bucket: GapBucket;
  /** 11:00 AM price vs the 9:00 AM open, in percent. */
  movePct: number;
  /**
   * Move re-signed so positive always means "kept going in the gap's
   * direction". Lets up-gaps and down-gaps be pooled and read the same way.
   */
  followThroughPct: number;
  /** Best excursion from the open in the gap's direction, percent. */
  favourablePct: number;
  /** Worst excursion from the open against the gap's direction, percent. */
  adversePct: number;
  outcome: DayOutcome;
}

export function sessionsFromRecords(records: MorningGapRecord[]): GapSession[] {
  const out: GapSession[] = [];
  for (const r of records) {
    if (!(r.openPrice > 0)) continue;
    // A flat gap has no direction to follow through on; treat it as up-signed
    // so the arithmetic stays defined (its verdicts are read separately).
    const dir = r.gapPct === 0 ? 1 : Math.sign(r.gapPct);
    const followThroughPct = r.movePct * dir;
    let outcome: DayOutcome;
    if (Math.abs(r.movePct) < FLAT_DAY_PCT) outcome = "flat";
    else outcome = followThroughPct > 0 ? "continued" : "faded";

    out.push({
      date: r.date,
      gapPct: r.gapPct,
      bucket: bucketForGap(r.gapPct),
      movePct: r.movePct,
      followThroughPct: Number(followThroughPct.toFixed(2)),
      favourablePct: Number((dir > 0 ? r.highPct : r.lowPct).toFixed(2)),
      adversePct: Number((dir > 0 ? r.lowPct : r.highPct).toFixed(2)),
      outcome,
    });
  }
  return out;
}

export interface GapStudy {
  bucket: GapBucket;
  label: string;
  sessions: number;
  continued: number;
  faded: number;
  flat: number;
  continuedPct: number | null;
  fadedPct: number | null;
  flatPct: number | null;
  /** Average further move in the gap's direction after the open, percent. */
  avgFollowThroughPct: number | null;
  medianFollowThroughPct: number | null;
  /** Average best/worst excursion from the open, percent. */
  avgFavourablePct: number | null;
  avgAdversePct: number | null;
  verdict: GapVerdict;
  verdictReason: string;
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const pct = (n: number, total: number) => Math.round((n / total) * 100);

export function studyBucket(sessions: GapSession[], bucket: GapBucket): GapStudy {
  const matching = sessions.filter((s) => s.bucket === bucket);
  const label = BUCKET_LABEL[bucket];
  const n = matching.length;

  if (n === 0) {
    return {
      bucket, label, sessions: 0, continued: 0, faded: 0, flat: 0,
      continuedPct: null, fadedPct: null, flatPct: null,
      avgFollowThroughPct: null, medianFollowThroughPct: null, avgFavourablePct: null, avgAdversePct: null,
      verdict: "insufficient", verdictReason: "No matching sessions in the available history.",
    };
  }

  const continued = matching.filter((s) => s.outcome === "continued").length;
  const faded = matching.filter((s) => s.outcome === "faded").length;
  const flat = matching.filter((s) => s.outcome === "flat").length;
  const continuedPct = pct(continued, n);
  const fadedPct = pct(faded, n);

  const avgFollowThroughPct = Number((matching.reduce((s, m) => s + m.followThroughPct, 0) / n).toFixed(2));
  const medianFollowThroughPct = Number(median(matching.map((m) => m.followThroughPct)).toFixed(2));
  const avgFavourablePct = Number((matching.reduce((s, m) => s + m.favourablePct, 0) / n).toFixed(2));
  const avgAdversePct = Number((matching.reduce((s, m) => s + m.adversePct, 0) / n).toFixed(2));

  let verdict: GapVerdict;
  let verdictReason: string;
  if (n < MIN_GAP_SAMPLE) {
    verdict = "insufficient";
    verdictReason = `Only ${n} similar ${n === 1 ? "session" : "sessions"} on record — too few to call (needs ${MIN_GAP_SAMPLE}).`;
  } else if (bucket === "flat") {
    verdict = "mixed";
    verdictReason = "Global barely moved overnight, so the open carries no directional lean of its own.";
  } else if (continuedPct >= 55) {
    verdict = "follow";
    verdictReason = `Still going the same way at 11 AM on ${continuedPct}% of these days.`;
  } else if (fadedPct >= 55) {
    verdict = "fade";
    verdictReason = `Reversed back against the gap by 11 AM on ${fadedPct}% of these days.`;
  } else {
    verdict = "mixed";
    verdictReason = `Split roughly evenly — ${continuedPct}% continued, ${fadedPct}% faded. No reliable edge either way.`;
  }

  return {
    bucket, label, sessions: n, continued, faded, flat,
    continuedPct, fadedPct, flatPct: pct(flat, n),
    avgFollowThroughPct, medianFollowThroughPct, avgFavourablePct, avgAdversePct,
    verdict, verdictReason,
  };
}

// ---- When in the day the move actually happens ----
// The other half of the question: is it worth acting at 9 AM, or does the
// tape only wake up once Europe and then the US arrive? MCX's morning session
// runs on Asian hours alone. Rather than assert that it is quiet, this
// measures each window's share of the day's real volume from intraday
// candles the app already loads.

export interface SessionWindow {
  id: "morning" | "europe" | "us";
  label: string;
  detail: string;
  startHour: number;
  endHour: number;
}

// IST. Europe opens ~12:30 PM IST (London 08:00), NYMEX floor ~6:30 PM IST.
export const SESSION_WINDOWS: SessionWindow[] = [
  { id: "morning", label: "Morning", detail: "9:00 AM – 12:30 PM · Asia only", startHour: 9, endHour: 12.5 },
  { id: "europe", label: "Europe open", detail: "12:30 – 6:00 PM · London in", startHour: 12.5, endHour: 18 },
  { id: "us", label: "US open", detail: "6:00 PM – close · New York in", startHour: 18, endHour: 24 },
];

/**
 * Exchange-local hour for a candle. Upstox stamps candles with the exchange's
 * own +05:30 offset, so reading the clock straight off the string keeps this
 * independent of whatever timezone the phone or the test runner is set to.
 */
export function istHourOf(date: string): number | null {
  const m = /T(\d{2}):(\d{2})/.exec(date);
  if (!m) return null;
  return Number(m[1]) + Number(m[2]) / 60;
}

export function windowIdFor(hour: number): SessionWindow["id"] | null {
  for (const w of SESSION_WINDOWS) {
    if (hour >= w.startHour && hour < w.endHour) return w.id;
  }
  return null;
}

export interface WindowShare {
  id: SessionWindow["id"];
  label: string;
  detail: string;
  volumeSharePct: number;
  rangeSharePct: number;
}

export interface WindowStudy {
  shares: WindowShare[];
  sessions: number;
  available: boolean;
}

/**
 * Share of each window in the day's total traded volume and summed candle
 * range, averaged over whatever intraday history is loaded.
 */
export function analyzeSessionWindows(intraday: Candle[]): WindowStudy {
  const byDay = new Map<string, Map<SessionWindow["id"], { vol: number; range: number }>>();

  for (const c of intraday) {
    const hour = istHourOf(c.date);
    if (hour === null) continue;
    const id = windowIdFor(hour);
    if (!id) continue;
    const day = c.date.slice(0, 10);
    let dayMap = byDay.get(day);
    if (!dayMap) {
      dayMap = new Map();
      byDay.set(day, dayMap);
    }
    const cur = dayMap.get(id) ?? { vol: 0, range: 0 };
    cur.vol += c.volume ?? 0;
    cur.range += Math.max(0, c.high - c.low);
    dayMap.set(id, cur);
  }

  // Only complete-enough days count: a day must have data in every window,
  // otherwise a session cut short (today, mid-morning) would make the morning
  // look like 100% of the day's activity.
  const fullDays = [...byDay.values()].filter((m) => SESSION_WINDOWS.every((w) => (m.get(w.id)?.vol ?? 0) > 0 || (m.get(w.id)?.range ?? 0) > 0));

  if (fullDays.length === 0) {
    return { shares: [], sessions: 0, available: false };
  }

  const totals = SESSION_WINDOWS.map((w) => {
    let volShareSum = 0;
    let rangeShareSum = 0;
    let counted = 0;
    for (const day of fullDays) {
      const dayVol = SESSION_WINDOWS.reduce((s, x) => s + (day.get(x.id)?.vol ?? 0), 0);
      const dayRange = SESSION_WINDOWS.reduce((s, x) => s + (day.get(x.id)?.range ?? 0), 0);
      if (dayVol <= 0 && dayRange <= 0) continue;
      volShareSum += dayVol > 0 ? ((day.get(w.id)?.vol ?? 0) / dayVol) * 100 : 0;
      rangeShareSum += dayRange > 0 ? ((day.get(w.id)?.range ?? 0) / dayRange) * 100 : 0;
      counted += 1;
    }
    return {
      id: w.id,
      label: w.label,
      detail: w.detail,
      volumeSharePct: counted ? Math.round(volShareSum / counted) : 0,
      rangeSharePct: counted ? Math.round(rangeShareSum / counted) : 0,
    };
  });

  return { shares: totals, sessions: fullDays.length, available: true };
}
