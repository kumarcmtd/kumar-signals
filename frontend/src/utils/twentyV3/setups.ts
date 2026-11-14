// Ai20-20 v3 setups: each one is a written-down rule that says, at a finished
// 5-minute candle, "buy CE", "buy PE" or nothing -- plus where its stop and
// first target sit and how the trade is managed. The rules lab replays these
// exact functions over years of prices; the page and the server call the same
// functions live, so what was measured is what trades.

import { signalAt, type Prepared } from "../twentyLab";
import { V2_RULES } from "../twentyV2";
import type { V3Features } from "./features";

export type V3SetupId = "trend" | "noise" | "noise30" | "orb" | "orbTrend" | "drive" | "drive60" | "vwapPull" | "eia" | "eiaFade";

/**
 * steps: T1 -> stop to entry, T2 -> stop to T1, out at T3 (the page's way).
 * trail5 / trail30: no targets; out when a 5-min (or half-hour) candle closes
 * back inside the noise band or across VWAP. hold: stop only, out at day end.
 */
export type V3Manage = "steps" | "trail5" | "trail30" | "hold";

export interface V3Entry {
  setup: V3SetupId;
  side: "CE" | "PE";
  /** Futures points from entry to the stop. */
  stopPts: number;
  /** Futures points to Target 1 (T2 = 1.6x, T3 = 2.25x). For trail/hold setups it is shown, not used to exit. */
  t1Pts: number;
  manage: V3Manage;
}

export interface V3Ctx {
  p: Prepared;
  f: V3Features;
  /** Sensitivity check only: scales band widths and ATR stops (1 = the rules as written). */
  k?: number;
}

export const SETUP_NAMES: Record<V3SetupId, string> = {
  trend: "Trend turn (v2)",
  noise: "Noise breakout",
  noise30: "Noise breakout (half-hourly)",
  orb: "Opening range breakout",
  orbTrend: "Opening range + 1h trend",
  drive: "Opening drive (9:30)",
  drive60: "Opening drive (10:00)",
  vwapPull: "VWAP pullback",
  eia: "EIA follow-through",
  eiaFade: "EIA fade",
};

const sameDay = (p: Prepared, a: number, b: number) => a >= 0 && p.day[a] === p.day[b];

/** Noise band at candle i, widened by k. */
export function bandAt(f: V3Features, i: number, k = 1): { upper: number; lower: number } | null {
  const sig = f.sigma[i];
  if (!Number.isFinite(sig)) return null;
  if (k === 1) return { upper: f.upper[i], lower: f.lower[i] };
  const open = f.sessOpen[i];
  const ref = Number.isFinite(f.prevClose[i]) ? f.prevClose[i] : open;
  return { upper: Math.max(open, ref) * (1 + k * sig), lower: Math.min(open, ref) * (1 - k * sig) };
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export function entryAt(ctx: V3Ctx, i: number, id: V3SetupId): V3Entry | null {
  const { p, f } = ctx;
  const k = ctx.k ?? 1;
  const c = p.c[i];
  const atr = p.atr[i];
  if (!Number.isFinite(atr) || atr <= 0) return null;
  const sm = f.sessMin[i];
  const mk = (side: "CE" | "PE", stopPts: number, t1Pts: number, manage: V3Manage): V3Entry => ({ setup: id, side, stopPts, t1Pts, manage });

  if (id === "trend") {
    const side = signalAt(p, i, V2_RULES);
    if (!side) return null;
    const stop = 2 * k * atr;
    return mk(side, stop, 1.5 * stop, "steps");
  }
  if (!Number.isFinite(sm)) return null;

  if (id === "noise" || id === "noise30") {
    // Checked only on candles that end on the hour or half hour, 9:30 to 12:30 New York.
    if (sm % 30 !== 25 || sm < 25 || sm > 205) return null;
    const b = bandAt(f, i, k);
    if (!b) return null;
    const side = c.close > b.upper && c.close > f.vwap[i] ? "CE" : c.close < b.lower && c.close < f.vwap[i] ? "PE" : null;
    return side ? mk(side, 3 * atr, 3 * atr, id === "noise" ? "trail5" : "trail30") : null;
  }

  if (id === "orb" || id === "orbTrend") {
    if (sm < 30 || sm >= 120 || !Number.isFinite(f.orHigh[i])) return null;
    const side = c.close > f.orHigh[i] ? "CE" : c.close < f.orLow[i] ? "PE" : null;
    if (!side) return null;
    // Only the day's first close outside the range.
    for (let j = i - 1; sameDay(p, j, i) && f.sessMin[j] >= 30; j--) {
      if (p.c[j].close > f.orHigh[j] || p.c[j].close < f.orLow[j]) return null;
    }
    if (id === "orbTrend" && p.htf60[i] !== (side === "CE" ? 1 : -1)) return null;
    const mid = (f.orHigh[i] + f.orLow[i]) / 2;
    const stop = clamp(Math.abs(c.close - mid), k * atr, 3 * k * atr);
    return mk(side, stop, 1.5 * stop, "steps");
  }

  if (id === "drive" || id === "drive60") {
    if (sm !== (id === "drive" ? 25 : 55)) return null;
    const b = bandAt(f, i, k);
    if (!b) return null;
    const side = c.close > b.upper ? "CE" : c.close < b.lower ? "PE" : null;
    return side ? mk(side, 2 * k * atr, 3 * k * atr, "hold") : null;
  }

  if (id === "vwapPull") {
    if (sm < 60 || sm > 210 || i < 8 || !sameDay(p, i - 8, i) || !Number.isFinite(f.vwap[i - 8])) return null;
    const v = f.vwap[i];
    let above = 0;
    let below = 0;
    for (let j = i - 8; j < i; j++) {
      if (p.c[j].close > f.vwap[j]) above++;
      else if (p.c[j].close < f.vwap[j]) below++;
    }
    const up = p.htf60[i] === 1 && v > f.vwap[i - 6] && above >= 6 && c.low <= v + 0.25 * atr && c.close > v && c.close > c.open;
    const dn = p.htf60[i] === -1 && v < f.vwap[i - 6] && below >= 6 && c.high >= v - 0.25 * atr && c.close < v && c.close < c.open;
    if (!up && !dn) return null;
    const stop = clamp(Math.abs(c.close - v) + k * atr, k * atr, 3 * k * atr);
    return mk(up ? "CE" : "PE", stop, 1.5 * stop, "steps");
  }

  if (id === "eia" || id === "eiaFade") {
    // Wednesday, the candle that closes 10:45 New York (15 minutes after the 10:30 report).
    if (p.etWeekday[i] !== 3 || p.etMinute[i] !== 10 * 60 + 40 || !sameDay(p, i - 3, i) || p.etMinute[i - 2] !== 10 * 60 + 30) return null;
    const pre = p.atr[i - 3];
    if (!Number.isFinite(pre) || pre <= 0) return null;
    const move = c.close - p.c[i - 2].open;
    const need = (id === "eia" ? 1.5 : 2) * k * pre;
    if (Math.abs(move) < need) return null;
    const withMove = move > 0 ? "CE" : "PE";
    const side = id === "eia" ? withMove : withMove === "CE" ? "PE" : "CE";
    const stop = 2 * atr;
    return mk(side, stop, 1.5 * stop, "steps");
  }
  return null;
}

/** The first setup (in priority order) that fires at candle i. */
export function firstEntry(ctx: V3Ctx, i: number, setups: readonly V3SetupId[]): V3Entry | null {
  for (const id of setups) {
    const e = entryAt(ctx, i, id);
    if (e) return e;
  }
  return null;
}
