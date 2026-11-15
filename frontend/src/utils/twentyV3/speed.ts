// The app's "Speed" gauge (components/VolatilityMeter + utils/priceSpeed) as
// an engine feature, on FINISHED 15-minute candles only: 50 x (average true
// range of the last 3) / (average of the 40 before them), 0-100. 50 = moving
// at its usual recent pace; 70+ = at least 1.4x faster (the gauge's Volatile /
// Extreme bands). Also: did the 15-minute candle that just finished close
// beyond the previous hour (4 finished 15-minute candles)?

import type { Prepared } from "../twentyLab";

export const SPEED_RECENT = 3;
export const SPEED_BASE = 40;
/** Ai-Super Fast trades only at this Speed or above. */
export const SPEED_MIN = 70;

export function speedSeries(p: Prepared): { speed: number[]; brk15: number[] } {
  const n = p.c.length;
  const speed = new Array<number>(n).fill(NaN);
  const brk15 = new Array<number>(n).fill(0);
  const done: { h: number; l: number; c: number; tr: number }[] = [];
  let bucket = "";
  let h = -Infinity;
  let l = Infinity;
  let cur = NaN;
  for (let i = 0; i < n; i++) {
    const k = p.c[i];
    const b = `${p.day[i]}-${Math.floor(p.minute[i] / 15)}`;
    if (b !== bucket) {
      bucket = b;
      h = -Infinity;
      l = Infinity;
    }
    h = Math.max(h, k.high);
    l = Math.min(l, k.low);
    // This 5-minute candle ends its 15-minute bucket.
    if (p.minute[i] % 15 === 10) {
      const prev = done[done.length - 1];
      const tr = prev ? Math.max(h, prev.c) - Math.min(l, prev.c) : h - l;
      if (done.length >= 4) {
        let hh = -Infinity;
        let ll = Infinity;
        for (let j = done.length - 4; j < done.length; j++) {
          hh = Math.max(hh, done[j].h);
          ll = Math.min(ll, done[j].l);
        }
        brk15[i] = k.close > hh ? 1 : k.close < ll ? -1 : 0;
      }
      done.push({ h, l, c: k.close, tr });
      const m = done.length;
      if (m >= SPEED_RECENT + SPEED_BASE) {
        let rs = 0;
        let bs = 0;
        for (let j = m - SPEED_RECENT; j < m; j++) rs += done[j].tr;
        for (let j = m - SPEED_RECENT - SPEED_BASE; j < m - SPEED_RECENT; j++) bs += done[j].tr;
        const base = bs / SPEED_BASE;
        cur = base > 0 ? Math.max(0, Math.min(100, Math.round((50 * (rs / SPEED_RECENT)) / base))) : NaN;
      }
    }
    speed[i] = cur;
  }
  return { speed, brk15 };
}
