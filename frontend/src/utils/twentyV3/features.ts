// Ai20-20 v3: New York session features, shared by the rules lab, the page
// and the server so all three read the same numbers.
//
// NYMEX crude's day session opens at 9:00 AM New York time. Each MCX day
// (9:00 AM - 11:30/11:55 PM IST) holds exactly one New York morning, so the
// IST day is the session key. Every value at candle i uses candles up to and
// including i only (finished candles), never later ones.
//
// The "noise band" follows Zarattini, Aziz & Barbon (2024), "Beat the
// Market": on a normal day price wanders about as far from the open as it
// did on recent days at the same minute. Upper/lower bounds = open x (1 +/-
// that average move), widened by any overnight gap. A close outside the band
// is a move bigger than usual noise.

import type { Prepared } from "../twentyLab";

export const NY_OPEN_MIN = 9 * 60;
/** Days of history the noise band averages over (the paper's 14), and the fewest it accepts. */
export const NOISE_DAYS = 14;
export const NOISE_MIN_DAYS = 10;
/** The first candle after the open must start within this many minutes, or the day has no session. */
const OPEN_GRACE_MIN = 15;

export interface V3Features {
  /** Minutes from the 9:00 AM New York open to this candle's start (NaN outside the session). */
  sessMin: number[];
  sessOpen: number[];
  /** Close of the previous MCX day's last candle. */
  prevClose: number[];
  /** Volume-weighted average price since the New York open (plain average if no volume). */
  vwap: number[];
  /** Average move from the open at this minute on recent days (a fraction, e.g. 0.004). */
  sigma: number[];
  upper: number[];
  lower: number[];
  /** 9:00-9:30 New York range, defined from the 9:30 candle on. */
  orHigh: number[];
  orLow: number[];
}

/** Minutes since the New York open for a New York clock minute, NaN before it (same IST day). */
export function sessionMinute(etMinute: number): number {
  return etMinute >= NY_OPEN_MIN && etMinute < 22 * 60 ? etMinute - NY_OPEN_MIN : NaN;
}

export function computeFeatures(p: Prepared): V3Features {
  const n = p.c.length;
  const nan = () => new Array<number>(n).fill(NaN);
  const f: V3Features = { sessMin: nan(), sessOpen: nan(), prevClose: nan(), vwap: nan(), sigma: nan(), upper: nan(), lower: nan(), orHigh: nan(), orLow: nan() };
  const moves = new Map<number, Map<number, number>>(); // IST day -> session minute -> |move from open|
  const sessDays: number[] = [];
  let day = NaN;
  let open = NaN;
  let prevDayClose = NaN;
  let lastClose = NaN;
  let pv = 0;
  let vv = 0;
  let tpSum = 0;
  let cnt = 0;
  let orH = -Infinity;
  let orL = Infinity;
  for (let i = 0; i < n; i++) {
    const k = p.c[i];
    if (p.day[i] !== day) {
      if (Number.isFinite(lastClose)) prevDayClose = lastClose;
      day = p.day[i];
      open = NaN;
      pv = vv = tpSum = cnt = 0;
      orH = -Infinity;
      orL = Infinity;
    }
    lastClose = k.close;
    const sm = sessionMinute(p.etMinute[i]);
    if (!Number.isFinite(sm)) continue;
    if (!Number.isFinite(open)) {
      if (sm >= OPEN_GRACE_MIN) continue; // the open was missed: no session today
      open = k.open;
      sessDays.push(day);
      moves.set(day, new Map());
    }
    f.sessMin[i] = sm;
    f.sessOpen[i] = open;
    f.prevClose[i] = prevDayClose;
    const tp = (k.high + k.low + k.close) / 3;
    const v = k.volume ?? 0;
    pv += tp * v;
    vv += v;
    tpSum += tp;
    cnt++;
    f.vwap[i] = vv > 0 ? pv / vv : tpSum / cnt;
    if (sm < 30) {
      orH = Math.max(orH, k.high);
      orL = Math.min(orL, k.low);
    } else if (Number.isFinite(orH)) {
      f.orHigh[i] = orH;
      f.orLow[i] = orL;
    }
    moves.get(day)!.set(sm, Math.abs(k.close / open - 1));
    let s = 0;
    let m = 0;
    for (let d = sessDays.length - 2; d >= 0 && d >= sessDays.length - 1 - NOISE_DAYS; d--) {
      const x = moves.get(sessDays[d])?.get(sm);
      if (x !== undefined) {
        s += x;
        m++;
      }
    }
    if (m >= NOISE_MIN_DAYS) {
      const sig = s / m;
      f.sigma[i] = sig;
      const ref = Number.isFinite(prevDayClose) ? prevDayClose : open;
      f.upper[i] = Math.max(open, ref) * (1 + sig);
      f.lower[i] = Math.min(open, ref) * (1 - sig);
    }
  }
  return f;
}
