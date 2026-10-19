// What the AI chart draws on top of the candles, all from finished candles:
//   FVG (fair value gap): a 3-candle gap price left behind -- candle 1's high
//     below candle 3's low (bullish) or candle 1's low above candle 3's high
//     (bearish). Price often returns to fill it; while unfilled it acts like
//     a buyer (bullish) or seller (bearish) zone.
//   Channel: the straight-line trend through the closes (least squares), with
//     parallel lines through the furthest high and low -- the rising / falling
//     channel a trader would draw by hand.
//   Path: where the setup EXPECTS price to go if it works (pullback to the
//     zone, then the targets). A picture of the plan -- not a forecast.

import type { Candle } from "../types";
import { atr } from "./indicators";

export interface Fvg {
  kind: "bull" | "bear";
  low: number;
  high: number;
  index: number; // the middle candle
}

export function findFvgs(c: Candle[], perKind = 2): Fvg[] {
  const a = atr(c, 14) ?? 0;
  const out: Fvg[] = [];
  for (let i = 2; i < c.length; i++) {
    const later = c.slice(i + 1);
    if (c[i - 2].high < c[i].low && c[i].low - c[i - 2].high >= 0.3 * a) {
      const low = c[i - 2].high;
      const high = c[i].low;
      if (!later.some((k) => k.low <= low)) out.push({ kind: "bull", low, high, index: i - 1 });
    }
    if (c[i - 2].low > c[i].high && c[i - 2].low - c[i].high >= 0.3 * a) {
      const low = c[i].high;
      const high = c[i - 2].low;
      if (!later.some((k) => k.high >= high)) out.push({ kind: "bear", low, high, index: i - 1 });
    }
  }
  const last = (k: Fvg["kind"]) => out.filter((f) => f.kind === k).slice(-perKind);
  return [...last("bull"), ...last("bear")];
}

export interface Channel {
  /** Price on the mid / upper / lower line at candle index x. */
  at: (x: number) => { mid: number; up: number; dn: number };
  slopePerCandle: number;
}

export function trendChannel(c: Candle[]): Channel | null {
  const n = c.length;
  if (n < 20) return null;
  const xs = c.map((_, i) => i);
  const ys = c.map((k) => k.close);
  const mx = (n - 1) / 2;
  const my = ys.reduce((s, y) => s + y, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  const b = den ? num / den : 0;
  const a0 = my - b * mx;
  const upOff = Math.max(...c.map((k, i) => k.high - (a0 + b * i)));
  const dnOff = Math.min(...c.map((k, i) => k.low - (a0 + b * i)));
  return { slopePerCandle: b, at: (x) => ({ mid: a0 + b * x, up: a0 + b * x + upOff, dn: a0 + b * x + dnOff }) };
}

export interface PathPoint {
  dx: number; // candles after the last one
  price: number;
}

/**
 * The plan as a path: now -> (pullback to the entry zone) -> T1 -> a small
 * dip -> T2. `zone` only when the card is waiting for a pullback.
 */
export function plannedPath(side: "CE" | "PE", now: number, t1: number, t2: number | null, zone: { low: number; high: number } | null): PathPoint[] {
  const up = side === "CE";
  const pts: PathPoint[] = [{ dx: 0, price: now }];
  let start = now;
  let x = 0;
  if (zone) {
    start = (zone.low + zone.high) / 2;
    x = 4;
    pts.push({ dx: x, price: start });
  }
  pts.push({ dx: x + 6, price: t1 });
  const second = t2 ?? (up ? t1 + (t1 - start) * 0.6 : t1 - (start - t1) * 0.6);
  pts.push({ dx: x + 9, price: t1 - (t1 - start) * 0.35 });
  pts.push({ dx: x + 15, price: second });
  return pts;
}
