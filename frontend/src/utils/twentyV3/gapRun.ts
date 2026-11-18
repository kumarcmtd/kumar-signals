// The trader's "run to the recent high" idea as two written-down setups:
//
//   gapRun   -- price fell from a recent high, and is now racing back up fast
//               with room left: buy CE and trade the gap, last target just
//               under that high (book there). The mirror: a fast fall back
//               towards a recent low -> PE, last target just above the low.
//   gapBreak -- at the high, only a STABLE 5-minute close above it (after such
//               a run) is a fresh call: the next leg, stop just under the old
//               high. The mirror below a recent low.
//
// Lab, page and server call these same functions. `GapParams` lets the lab try
// stricter or more liberal versions; live runs GAP_LIVE.

import type { Prepared } from "../twentyLab";
import type { V3Features } from "./features";

export interface GapParams {
  /** Candles back to look for the recent high / low (36 = 3 hours). */
  lookback: number;
  /** The fall from the high (or bounce from the low) must be at least this many ATR. */
  dropAtr: number;
  /** "Fast": back at least this many ATR from the low... */
  recAtr: number;
  /** ...within this many candles. */
  recBars: number;
  /** Room left to the high, in ATR (the gap to trade). */
  roomAtr: number;
  /** 0 = off; else the Speed gauge (finished 15-minute candles) must read at least this. */
  speedMin: number;
  /** The 1-hour trend: ignored, not against the call, or with it. */
  trend: "none" | "notAgainst" | "agree";
  /** all: 9:30 AM IST to 30 minutes before the bell; euus: from 1:30 PM IST; us: 9:00 AM - 1:30 PM New York. */
  window: "all" | "euus" | "us";
  /** Stop distance in ATR (gapRun). */
  stopAtr: number;
  /** gapBreak: the close must clear the level by this many ATR. */
  breakBuf: number;
}

export const GAP_DEFAULT: GapParams = { lookback: 36, dropAtr: 2, recAtr: 1.5, recBars: 6, roomAtr: 2.5, speedMin: 0, trend: "none", window: "all", stopAtr: 1.5, breakBuf: 0.1 };
/** What the page and the server run (chosen by the lab). */
export const GAP_LIVE: GapParams = GAP_DEFAULT;

export interface GapHit {
  side: "CE" | "PE";
  /** The recent high (CE) or low (PE) the run is heading for / just broke. */
  level: number;
  stopPts: number;
  t1Pts: number;
}

const BUFFER_ATR = 0.1;

function windowOk(p: Prepared, f: V3Features, i: number, w: GapParams["window"], bell: number): boolean {
  const m = p.minute[i];
  if (m + 5 > bell - 30) return false;
  if (w === "all") return m >= 9 * 60 + 30;
  if (w === "euus") return m >= 13 * 60 + 30;
  return f.sessMin[i] >= 0 && f.sessMin[i] < 270;
}

function filtersOk(p: Prepared, f: V3Features, i: number, side: "CE" | "PE", g: GapParams): boolean {
  if (g.speedMin > 0 && !(f.speed[i] >= g.speedMin)) return false;
  const want = side === "CE" ? 1 : -1;
  if (g.trend === "agree" && p.htf60[i] !== want) return false;
  if (g.trend === "notAgainst" && p.htf60[i] === -want) return false;
  return true;
}

/** Strong candle in the call's direction: closes its way, in the better half of its range. */
function strong(p: Prepared, i: number, d: 1 | -1): boolean {
  const k = p.c[i];
  const range = k.high - k.low;
  if (range <= 0) return false;
  return d > 0 ? k.close > k.open && (k.close - k.low) / range >= 0.5 : k.close < k.open && (k.high - k.close) / range >= 0.5;
}

/**
 * The swing for side d at candle i: the extreme (high for CE) in the lookback,
 * the opposite extreme after it, and when that came. Null if too few candles.
 */
function swing(p: Prepared, i: number, d: 1 | -1, lookback: number) {
  const from = i - lookback;
  if (from < 1) return null;
  let iH = from;
  for (let j = from; j < i; j++) if (d > 0 ? p.c[j].high > p.c[iH].high : p.c[j].low < p.c[iH].low) iH = j;
  const level = d > 0 ? p.c[iH].high : p.c[iH].low;
  let iL = iH;
  for (let j = iH + 1; j <= i; j++) if (d > 0 ? p.c[j].low < p.c[iL].low : p.c[j].high > p.c[iL].high) iL = j;
  const turn = d > 0 ? p.c[iL].low : p.c[iL].high;
  return { iH, level, iL, turn };
}

export function gapRunAt(p: Prepared, f: V3Features, i: number, g: GapParams, bell: number): GapHit | null {
  const atr = p.atr[i];
  if (!Number.isFinite(atr) || atr <= 0 || !windowOk(p, f, i, g.window, bell)) return null;
  for (const d of [1, -1] as const) {
    const side = d > 0 ? "CE" : "PE";
    if (!strong(p, i, d)) continue;
    const s = swing(p, i, d, g.lookback);
    if (!s || s.iL <= s.iH || s.iL >= i) continue;
    const c = p.c[i].close;
    const dropped = d * (s.level - s.turn) >= g.dropAtr * atr;
    const back = d * (c - s.turn);
    // Fast: this candle completes the recovery (the one before had not), soon after the low.
    const fast = back >= g.recAtr * atr && d * (p.c[i - 1].close - s.turn) < g.recAtr * atr && i - s.iL <= g.recBars;
    const room = d * (s.level - c) - BUFFER_ATR * atr;
    if (!dropped || !fast || room < g.roomAtr * atr) continue;
    if (!filtersOk(p, f, i, side, g)) continue;
    // The last target (2.25 x T1) sits just short of the level.
    return { side, level: s.level, stopPts: g.stopAtr * atr, t1Pts: room / 2.25 };
  }
  return null;
}

export function gapBreakAt(p: Prepared, f: V3Features, i: number, g: GapParams, bell: number): GapHit | null {
  const atr = p.atr[i];
  if (!Number.isFinite(atr) || atr <= 0 || !windowOk(p, f, i, g.window, bell)) return null;
  for (const d of [1, -1] as const) {
    const side = d > 0 ? "CE" : "PE";
    if (!strong(p, i, d)) continue;
    // The level is the extreme BEFORE this candle; this candle is the first stable close beyond it.
    const s = swing(p, i - 1, d, g.lookback);
    if (!s || s.iL <= s.iH) continue;
    const c = p.c[i].close;
    const prev = p.c[i - 1].close;
    if (!(d * (c - s.level) >= g.breakBuf * atr && d * (prev - s.level) <= 0)) continue;
    // Only after a real run: the market fell from the level (or bounced from the low) first.
    if (!(d * (s.level - s.turn) >= g.dropAtr * atr)) continue;
    if (!filtersOk(p, f, i, side, g)) continue;
    const stopPts = Math.min(2.5 * atr, Math.max(atr, d * (c - s.level) + 0.5 * atr));
    return { side, level: s.level, stopPts, t1Pts: 1.5 * stopPts };
  }
  return null;
}
