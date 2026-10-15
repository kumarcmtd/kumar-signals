// Buyer and seller zones -- where big buyers (demand) and sellers (supply)
// stepped in before, read from finished 15-minute candles.
//
// A BUYER ZONE is a swing low that price left FAST (a strong rally away from
// it): buyers were waiting there. While price has not closed back below it,
// a return to it is where a pullback often stops before the next leg up.
// A SELLER ZONE is the mirror: a swing high price fell hard from.
// A zone that price has since closed through is dropped -- those buyers (or
// sellers) are gone. Pure arithmetic on finished candles; nothing guessed.

import type { Candle } from "../types";
import { atr } from "./indicators";

export interface Zone {
  kind: "buyer" | "seller";
  low: number;
  high: number;
  at: string; // the base candle's time, IST HH:MM
  departureAtr: number; // how hard price left the zone, in 15-minute ATRs
  held: number; // later visits that held
  volumeRatio: number | null; // base + next 2 candles' volume vs the 20-candle average
  score: number;
}

export interface ZoneMap {
  buyer: Zone[]; // below price, nearest first
  seller: Zone[]; // above price, nearest first
  atr15: number;
}

const LOOKBACK = 120; // about two MCX sessions of 15-minute candles
const SIDE = 3; // a swing must be the extreme of 3 candles each side
const MIN_DEPARTURE = 1.5; // ATRs within the next 6 candles

const r2 = (n: number) => Math.round(n * 100) / 100;
const hhmm = (iso: string) => new Date(Date.parse(iso) + 5.5 * 3600_000).toISOString().slice(11, 16);

function volRatio(c: Candle[], i: number): number | null {
  const prior = c.slice(Math.max(0, i - 20), i).map((x) => x.volume ?? 0).filter((v) => v > 0);
  const here = c.slice(i, i + 3).map((x) => x.volume ?? 0).filter((v) => v > 0);
  if (prior.length < 10 || here.length === 0) return null;
  const avg = prior.reduce((a, b) => a + b, 0) / prior.length;
  return avg > 0 ? Math.round((here.reduce((a, b) => a + b, 0) / here.length / avg) * 10) / 10 : null;
}

export function findZones(c15: Candle[], price?: number | null): ZoneMap | null {
  const c = [...c15].sort((a, b) => a.date.localeCompare(b.date)).slice(-LOOKBACK);
  if (c.length < 30) return null;
  const a = atr(c, 14);
  if (!a || a <= 0) return null;
  const now = price ?? c[c.length - 1].close;
  const zones: Zone[] = [];

  for (let i = SIDE; i < c.length - SIDE; i++) {
    const win = c.slice(i - SIDE, i + SIDE + 1);
    const next = c.slice(i + 1, i + 7);
    const later = c.slice(i + 1);
    const bodyLow = Math.min(c[i].open, c[i].close);
    const bodyHigh = Math.max(c[i].open, c[i].close);

    if (c[i].low === Math.min(...win.map((x) => x.low))) {
      const dep = (Math.max(...next.map((x) => x.high)) - c[i].low) / a;
      const low = c[i].low;
      const high = Math.min(low + 0.6 * a, Math.max(bodyLow, low + 0.3 * a));
      const broken = later.some((x) => x.close < low - 0.1 * a);
      if (dep >= MIN_DEPARTURE && !broken) {
        const held = later.slice(SIDE).filter((x) => x.low <= high && x.close > low).length;
        zones.push(mk("buyer", low, high, c, i, dep, held));
      }
    }
    if (c[i].high === Math.max(...win.map((x) => x.high))) {
      const dep = (c[i].high - Math.min(...next.map((x) => x.low))) / a;
      const high = c[i].high;
      const low = Math.max(high - 0.6 * a, Math.min(bodyHigh, high - 0.3 * a));
      const broken = later.some((x) => x.close > high + 0.1 * a);
      if (dep >= MIN_DEPARTURE && !broken) {
        const held = later.slice(SIDE).filter((x) => x.high >= low && x.close < high).length;
        zones.push(mk("seller", low, high, c, i, dep, held));
      }
    }
  }

  // Overlapping zones of one kind are one zone: keep the stronger, widen to cover both.
  const merge = (list: Zone[]) => {
    const out: Zone[] = [];
    for (const z of [...list].sort((x, y) => y.score - x.score)) {
      const hit = out.find((o) => z.low <= o.high + 0.1 * a && z.high >= o.low - 0.1 * a);
      if (hit) {
        hit.held += z.held;
        hit.score = r2(hit.score + 0.5);
      } else out.push({ ...z });
    }
    return out;
  };
  const buyer = merge(zones.filter((z) => z.kind === "buyer" && z.low < now)).sort((x, y) => y.high - x.high);
  const seller = merge(zones.filter((z) => z.kind === "seller" && z.high > now)).sort((x, y) => x.low - y.low);
  return { buyer, seller, atr15: r2(a) };

  function mk(kind: Zone["kind"], low: number, high: number, cs: Candle[], i: number, dep: number, held: number): Zone {
    const vr = volRatio(cs, i);
    const score = dep + Math.min(held, 3) * 0.5 + (vr !== null && vr >= 1.3 ? 1 : 0);
    return { kind, low: r2(low), high: r2(high), at: hhmm(cs[i].date), departureAtr: r2(dep), held, volumeRatio: vr, score: r2(score) };
  }
}
