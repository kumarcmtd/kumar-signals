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
// Base rates come from the daily candle history the app already fetches
// (270 calendar days, roughly 180 sessions). Every number on this page is
// counted from those sessions. Where the sample is too thin to mean anything
// it says so instead of printing a confident percentage.

import type { Candle } from "../types";

/** A gap smaller than this is noise, not an overnight move. */
export const FLAT_GAP_PCT = 0.3;
/** Above this, the overnight move was substantial. */
export const STRONG_GAP_PCT = 1.0;
/** A day that closes within this of its open didn't really go anywhere. */
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

export interface GapSession {
  date: string;
  prevClose: number;
  open: number;
  high: number;
  low: number;
  close: number;
  /** Open vs previous close, in percent. The overnight global move. */
  gapPct: number;
  bucket: GapBucket;
  /** Close vs open, in percent. What happened AFTER the gap. */
  dayMovePct: number;
  /**
   * Day move re-signed so positive always means "kept going in the gap's
   * direction". Lets up-gaps and down-gaps be pooled and read the same way.
   */
  followThroughPct: number;
  /** Best excursion from the open in the gap's direction, percent. */
  favourablePct: number;
  /** Worst excursion from the open against the gap's direction, percent. */
  adversePct: number;
  outcome: DayOutcome;
}

export function buildGapSessions(daily: Candle[]): GapSession[] {
  const out: GapSession[] = [];
  for (let i = 1; i < daily.length; i++) {
    const prev = daily[i - 1];
    const d = daily[i];
    if (!(prev.close > 0) || !(d.open > 0)) continue;

    const gapPct = ((d.open - prev.close) / prev.close) * 100;
    const dayMovePct = ((d.close - d.open) / d.open) * 100;
    // A flat gap has no direction to follow through on; treat it as up-signed
    // so the arithmetic stays defined (its verdicts are read separately).
    const dir = gapPct === 0 ? 1 : Math.sign(gapPct);
    const upExcursion = ((d.high - d.open) / d.open) * 100;
    const downExcursion = ((d.open - d.low) / d.open) * 100;

    const followThroughPct = dayMovePct * dir;
    let outcome: DayOutcome;
    if (Math.abs(dayMovePct) < FLAT_DAY_PCT) outcome = "flat";
    else outcome = followThroughPct > 0 ? "continued" : "faded";

    out.push({
      date: d.date,
      prevClose: prev.close,
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close,
      gapPct: Number(gapPct.toFixed(2)),
      bucket: bucketForGap(gapPct),
      dayMovePct: Number(dayMovePct.toFixed(2)),
      followThroughPct: Number(followThroughPct.toFixed(2)),
      favourablePct: Number((dir > 0 ? upExcursion : downExcursion).toFixed(2)),
      adversePct: Number((dir > 0 ? downExcursion : upExcursion).toFixed(2)),
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
    verdictReason = `Kept going in the same direction on ${continuedPct}% of these days.`;
  } else if (fadedPct >= 55) {
    verdict = "fade";
    verdictReason = `Reversed back against the gap on ${fadedPct}% of these days.`;
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

export interface TodayGap {
  date: string;
  gapPct: number;
  bucket: GapBucket;
  prevClose: number;
  open: number;
}

/**
 * The most recent session's gap. During a live session this is today's open
 * against yesterday's close; outside market hours it is the last completed
 * session, so the caller shows the date rather than implying it is always
 * "today".
 */
export function latestGap(daily: Candle[]): TodayGap | null {
  if (daily.length < 2) return null;
  const prev = daily[daily.length - 2];
  const cur = daily[daily.length - 1];
  if (!(prev.close > 0) || !(cur.open > 0)) return null;
  const gapPct = Number((((cur.open - prev.close) / prev.close) * 100).toFixed(2));
  return { date: cur.date, gapPct, bucket: bucketForGap(gapPct), prevClose: prev.close, open: cur.open };
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
