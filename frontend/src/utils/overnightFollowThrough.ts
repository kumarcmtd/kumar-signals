// Overnight move -> next-day follow-through.
//
// The question this answers, which the gap study did not: when the overnight
// move is big, does MCX just gap and stop, or does the move KEEP GOING -- and
// if it keeps going, until roughly what time of day?
//
// "Crude fell 2% overnight, MCX gapped down and kept falling most of the day"
// is a claim that can be measured. So is "it gapped up and had given it all
// back by noon". The two lead to completely different trades, and the gap size
// alone does not tell you which one you are in.
//
// WHERE THE OVERNIGHT NUMBER COMES FROM, and why it is not WTI.
//
// The obvious approach is to fetch WTI or Henry Hub between MCX's 11:30 PM
// close and its 9:00 AM open. This app cannot: it holds only the CURRENT
// global quote, with no historical intraday record of where WTI was at 11:30
// PM on a past date, and inventing one would poison every number below.
//
// It does not need to. The gap between yesterday's MCX close and today's MCX
// open IS the overnight move, already converted into rupees and already
// including the USD/INR move -- which a raw WTI percentage would miss. It is
// measured from the same 30-minute candles every other page uses, so it is
// real data rather than a second-hand estimate.
//
// WHAT THIS CANNOT DO. There is no historical news archive, so a session
// driven by a mid-morning headline cannot be separated from one that simply
// trended. Some of what looks like follow-through is news arriving after the
// open. The page says so rather than implying the pattern is purely mechanical.

import type { Candle } from "../types";
import { istMinutesOfStamp } from "./timeProfileEngine";

/** Named parts of the MCX energy session, in IST minutes from midnight. */
export interface SessionWindow {
  id: string;
  label: string;
  /** Inclusive start, exclusive end. */
  from: number;
  to: number;
}

export const WINDOWS: SessionWindow[] = [
  { id: "open", label: "9–12 (Indian morning)", from: 9 * 60, to: 12 * 60 },
  { id: "midday", label: "12–3 (quiet midday)", from: 12 * 60, to: 15 * 60 },
  { id: "euro", label: "3–5:30 (Europe active)", from: 15 * 60, to: 17 * 60 + 30 },
  { id: "preus", label: "5:30–7 (pre-US)", from: 17 * 60 + 30, to: 19 * 60 },
  { id: "us", label: "7–9 (US session)", from: 19 * 60, to: 21 * 60 },
  { id: "late", label: "9–11:30 (late US)", from: 21 * 60, to: 23 * 60 + 30 },
];

export type GapBand = "big_down" | "down" | "flat" | "up" | "big_up";

export const BAND_LABEL: Record<GapBand, string> = {
  big_down: "Gapped DOWN hard (1.5%+)",
  down: "Gapped down (0.5–1.5%)",
  flat: "Barely moved (under 0.5%)",
  up: "Gapped up (0.5–1.5%)",
  big_up: "Gapped UP hard (1.5%+)",
};

const FLAT_PCT = 0.5;
const BIG_PCT = 1.5;
/** Extension past the open that counts as the move genuinely continuing. */
const CONTINUED_PCT = 0.3;

export function bandFor(gapPct: number): GapBand {
  const mag = Math.abs(gapPct);
  if (mag < FLAT_PCT) return "flat";
  if (gapPct > 0) return mag >= BIG_PCT ? "big_up" : "up";
  return mag >= BIG_PCT ? "big_down" : "down";
}

/** The IST calendar date of a stamp, used to split candles into sessions. */
export function istDateOf(stamp: string): string {
  return stamp.slice(0, 10);
}

export interface FollowThroughSession {
  date: string;
  prevClose: number;
  open: number;
  gapPct: number;
  band: GapBand;
  /** Furthest the day went IN THE GAP'S DIRECTION, as % of the open. */
  extensionPct: number;
  /** Window that contained that furthest point -- "it ran until about here". */
  peakWindowId: string | null;
  peakWindowLabel: string | null;
  /** True when price came back through the open, i.e. the gap filled. */
  filled: boolean;
  /** Close against open, signed in the gap's direction. */
  closeVsOpenPct: number;
  /** True when the day extended at least CONTINUED_PCT beyond the open. */
  continued: boolean;
  bars: number;
}

/**
 * Splits a flat candle list into sessions and measures each one.
 *
 * A session needs the PREVIOUS session's last bar to have a gap at all, so the
 * first session in the data is skipped rather than given an invented previous
 * close.
 */
export function buildSessions(candles: Candle[]): FollowThroughSession[] {
  const byDate = new Map<string, Candle[]>();
  for (const c of candles) {
    const d = istDateOf(c.date);
    const list = byDate.get(d);
    if (list) list.push(c);
    else byDate.set(d, [c]);
  }

  const dates = [...byDate.keys()].sort();
  const out: FollowThroughSession[] = [];

  for (let i = 1; i < dates.length; i += 1) {
    const prev = byDate.get(dates[i - 1])!;
    const day = byDate.get(dates[i])!;
    // A stub session (a holiday half-day, or a partial download) says nothing
    // about follow-through and would distort every average it entered.
    if (prev.length < 4 || day.length < 6) continue;

    const prevClose = prev[prev.length - 1].close;
    const open = day[0].open;
    if (!(prevClose > 0) || !(open > 0)) continue;

    const gapPct = ((open - prevClose) / prevClose) * 100;
    const band = bandFor(gapPct);
    const dir = gapPct >= 0 ? 1 : -1;

    let extensionPct = 0;
    let peakBar: Candle | null = null;
    let filled = false;

    for (let b = 0; b < day.length; b += 1) {
      const c = day[b];
      // Extension is measured in the gap's own direction: for a gap down that
      // is the LOW, for a gap up the HIGH.
      const far = dir > 0 ? c.high : c.low;
      const movePct = ((far - open) / open) * 100 * dir;
      if (movePct > extensionPct) {
        extensionPct = movePct;
        peakBar = c;
      }

      // Filled = traded back THROUGH the opening price, against the gap.
      //
      // The opening bar is skipped and the comparison is strict, because price
      // starts AT the open by definition: counting that as a fill marked every
      // single gap filled at 9:00 AM and made the whole study meaningless.
      if (b === 0) continue;
      const against = dir > 0 ? c.low : c.high;
      if (dir > 0 ? against < open : against > open) filled = true;
    }

    const closeRaw = ((day[day.length - 1].close - open) / open) * 100;
    const peakMinutes = peakBar ? istMinutesOfStamp(peakBar.date) : null;
    const peakWindow = peakMinutes === null ? null : (WINDOWS.find((w) => peakMinutes >= w.from && peakMinutes < w.to) ?? null);

    out.push({
      date: dates[i],
      prevClose,
      open,
      gapPct: Number(gapPct.toFixed(2)),
      band,
      extensionPct: Number(extensionPct.toFixed(2)),
      peakWindowId: peakWindow?.id ?? null,
      peakWindowLabel: peakWindow?.label ?? null,
      filled,
      closeVsOpenPct: Number((closeRaw * dir).toFixed(2)),
      continued: extensionPct >= CONTINUED_PCT,
      bars: day.length,
    });
  }

  return out;
}

export interface BandStudy {
  band: GapBand;
  label: string;
  sessions: number;
  /** How many kept going in the gap's direction after the open. */
  continuedCount: number;
  continuedPct: number | null;
  /** How many traded back through the open at some point. */
  filledCount: number;
  filledPct: number | null;
  /** Median extra move past the open, in the gap's direction. */
  medianExtensionPct: number | null;
  /** Median close-vs-open, signed with the gap. Negative = faded. */
  medianCloseVsOpenPct: number | null;
  /** The window the move most often ran into before turning. */
  usualPeakWindow: string | null;
  usualPeakCount: number;
  /** True when there are too few sessions to read anything into. */
  thin: boolean;
  /** Plain-language reading, written from the numbers above. */
  verdict: string;
}

/** Below this many sessions a band is reported but explicitly marked thin. */
export const MIN_SESSIONS_PER_BAND = 6;

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return Number((s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2).toFixed(2));
}

export function studyBand(sessions: FollowThroughSession[], band: GapBand): BandStudy {
  const rows = sessions.filter((s) => s.band === band);
  const n = rows.length;
  const continuedCount = rows.filter((r) => r.continued).length;
  const filledCount = rows.filter((r) => r.filled).length;

  const windowCounts = new Map<string, number>();
  for (const r of rows) {
    if (!r.peakWindowLabel) continue;
    windowCounts.set(r.peakWindowLabel, (windowCounts.get(r.peakWindowLabel) ?? 0) + 1);
  }
  let usualPeakWindow: string | null = null;
  let usualPeakCount = 0;
  for (const [label, count] of windowCounts) {
    if (count > usualPeakCount) {
      usualPeakWindow = label;
      usualPeakCount = count;
    }
  }

  const continuedPct = n > 0 ? Math.round((continuedCount / n) * 100) : null;
  const filledPct = n > 0 ? Math.round((filledCount / n) * 100) : null;
  const medianExtensionPct = median(rows.map((r) => r.extensionPct));
  const medianCloseVsOpenPct = median(rows.map((r) => r.closeVsOpenPct));
  const thin = n < MIN_SESSIONS_PER_BAND;

  let verdict: string;
  if (n === 0) {
    verdict = "No sessions of this kind in the data yet.";
  } else if (thin) {
    verdict = `Only ${n} ${n === 1 ? "session" : "sessions"} like this. Far too few to read a pattern into — treat it as a note, not a finding.`;
  } else {
    const dirWord = band.includes("up") ? "higher" : band.includes("down") ? "lower" : "either way";
    const keeps = continuedPct ?? 0;
    const fills = filledPct ?? 0;
    if (keeps >= 70 && usualPeakWindow) {
      verdict = `The move usually kept going ${dirWord} — ${continuedCount} of ${n} sessions — and most often ran furthest during ${usualPeakWindow}. It still traded back through the open in ${filledCount} of ${n}.`;
    } else if (fills >= 70) {
      verdict = `This mostly faded: ${filledCount} of ${n} sessions traded back through the opening price. Chasing the gap here would usually have been the wrong side.`;
    } else {
      verdict = `Genuinely mixed — it continued in ${continuedCount} of ${n} and came back through the open in ${filledCount} of ${n}. The gap alone does not tell you which.`;
    }
  }

  return {
    band,
    label: BAND_LABEL[band],
    sessions: n,
    continuedCount,
    continuedPct,
    filledCount,
    filledPct,
    medianExtensionPct,
    medianCloseVsOpenPct,
    usualPeakWindow,
    usualPeakCount,
    thin,
    verdict,
  };
}

export interface FollowThroughStudy {
  sessions: FollowThroughSession[];
  bands: BandStudy[];
  firstDate: string | null;
  lastDate: string | null;
  /** The most recent sessions, newest first, for the worked-example list. */
  recent: FollowThroughSession[];
}

export function buildFollowThroughStudy(candles: Candle[], recentCount = 12): FollowThroughStudy {
  const sessions = buildSessions(candles);
  const order: GapBand[] = ["big_up", "up", "flat", "down", "big_down"];
  return {
    sessions,
    bands: order.map((b) => studyBand(sessions, b)),
    firstDate: sessions.length ? sessions[0].date : null,
    lastDate: sessions.length ? sessions[sessions.length - 1].date : null,
    recent: [...sessions].reverse().slice(0, recentCount),
  };
}
