// Ai Lite: a few plain rules on finished 15-minute candles, a fixed Rs 2,000
// target. The same pure functions run in the lab (years of prices), on the
// page and on the server, so what was tested is what calls.
//
//   1. Trend    -- EMA 9 above EMA 21 and price above EMA 21 (CE); mirror for PE.
//   2. Trigger  -- a dip to EMA 9 that turns back up (pullback), or a decisive
//                  close above the last 2 hours' high (breakout).
//   3. No chase -- not more than 2 ATR away from EMA 21, and no long wick
//                  against the call (a rejection candle).
// Money: target Rs 2,000 a lot, stop Rs 1,000; at +Rs 1,000 the stop moves to
// entry, at +Rs 1,500 it locks +Rs 1,000. One call at a time; a day ends after
// 2 stop-losses or once Rs 2,000 is booked.

import type { Candle } from "../../types";

export const LITE = {
  targetRs: 2000,
  t1Rs: 1000,
  t2Rs: 1500,
  stopRs: 1000,
  maxStopsPerDay: 2,
  dayGoalRs: 2000,
  /** No new call in the last 30 minutes before the MCX bell. */
  lastCallMin: 30,
  breakoutBars: 8,
  maxStretchAtr: 2,
  maxWick: 0.4,
  /** Same side again only 15 minutes after a stop-loss. */
  cooldownMs: 15 * 60_000,
} as const;

export const LITE_LOT = { CRUDEOIL: 100, NATURALGAS: 1250 } as const;
export type LiteSym = keyof typeof LITE_LOT;
export type Side = "CE" | "PE";
export type LiteKind = "pullback" | "breakout";

const IST_MS = 5.5 * 3600_000;
const BAR_MS = 15 * 60_000;

export interface LiteBars {
  t: number[];
  o: number[];
  h: number[];
  l: number[];
  c: number[];
  day: number[];
  ema9: number[];
  ema21: number[];
  atr: number[];
}

function ema(x: number[], n: number): number[] {
  const out = new Array<number>(x.length).fill(NaN);
  const k = 2 / (n + 1);
  let e = NaN;
  for (let i = 0; i < x.length; i++) {
    if (i === n - 1) e = x.slice(0, n).reduce((a, v) => a + v, 0) / n;
    else if (i >= n) e = x[i] * k + e * (1 - k);
    out[i] = e;
  }
  return out;
}

/** 15-minute candles (oldest first) -> arrays with EMA 9, EMA 21 and ATR 14 (Wilder). */
export function liteBars(candles: Candle[]): LiteBars {
  const t = candles.map((k) => Date.parse(k.date));
  const o = candles.map((k) => k.open);
  const h = candles.map((k) => k.high);
  const l = candles.map((k) => k.low);
  const c = candles.map((k) => k.close);
  const tr = c.map((_, i) => (i === 0 ? h[0] - l[0] : Math.max(h[i], c[i - 1]) - Math.min(l[i], c[i - 1])));
  const atr = new Array<number>(c.length).fill(NaN);
  let a = NaN;
  for (let i = 0; i < c.length; i++) {
    if (i === 13) a = tr.slice(0, 14).reduce((s, v) => s + v, 0) / 14;
    else if (i > 13) a = (a * 13 + tr[i]) / 14;
    atr[i] = a;
  }
  return { t, o, h, l, c, day: t.map((x) => Math.floor((x + IST_MS) / 86_400_000)), ema9: ema(c, 9), ema21: ema(c, 21), atr };
}

export interface LiteCheck {
  key: "trend" | "trigger" | "chase";
  label: string;
  ok: boolean;
  detail: string;
}

export interface LiteSignal {
  side: Side | null;
  kind: LiteKind | null;
  /** Leaning side (the trend) and how each rule reads on this candle -- shown on the page. */
  lean: Side | null;
  checks: LiteCheck[];
}

/** Minute of the IST day a bar starts at. */
const istMin = (ms: number) => Math.floor(((ms + IST_MS) % 86_400_000) / 60_000);

/** The three rules on finished bar i. `bellMin`: that day's MCX close (IST minutes). */
export function liteSignal(b: LiteBars, i: number, bellMin: number): LiteSignal {
  const none = (detail: string): LiteSignal => ({ side: null, kind: null, lean: null, checks: [{ key: "trend", label: "Trend", ok: false, detail }] });
  if (i < 30 || !Number.isFinite(b.atr[i]) || !Number.isFinite(b.ema21[i])) return none("Warming up — needs about 8 hours of 15-minute candles.");
  const up = b.ema9[i] > b.ema21[i] && b.c[i] > b.ema21[i];
  const dn = b.ema9[i] < b.ema21[i] && b.c[i] < b.ema21[i];
  const lean: Side | null = up ? "CE" : dn ? "PE" : null;
  const trend: LiteCheck = { key: "trend", label: "Trend", ok: lean !== null, detail: up ? "Up — EMA 9 over EMA 21, price above" : dn ? "Down — EMA 9 under EMA 21, price below" : "No clear trend — price is between the averages" };
  if (!lean) return { side: null, kind: null, lean, checks: [trend] };
  const d = lean === "CE" ? 1 : -1;
  const range = b.h[i] - b.l[i];
  const first = i === 0 || b.day[i - 1] !== b.day[i];
  const late = istMin(b.t[i]) + 15 > bellMin - LITE.lastCallMin;
  // Trigger: a dip to EMA 9 in the last 3 candles (same day) that turns back with this candle.
  let dipped = false;
  for (let j = i - 1; j >= i - 3 && j >= 0 && b.day[j] === b.day[i]; j--) {
    if (d > 0 ? b.l[j] <= b.ema9[j] : b.h[j] >= b.ema9[j]) dipped = true;
  }
  const turned = d > 0 ? b.c[i] > b.h[i - 1] && b.c[i] > b.o[i] : b.c[i] < b.l[i - 1] && b.c[i] < b.o[i];
  const pullback = !first && dipped && turned;
  let edge = d > 0 ? -Infinity : Infinity;
  for (let j = i - LITE.breakoutBars; j < i; j++) edge = d > 0 ? Math.max(edge, b.h[j]) : Math.min(edge, b.l[j]);
  const body = d * (b.c[i] - b.o[i]);
  const tail = d > 0 ? b.h[i] - b.c[i] : b.c[i] - b.l[i];
  const breakout = !first && range > 0 && (d > 0 ? b.c[i] > edge : b.c[i] < edge) && body >= 0.5 * range && tail <= 0.25 * range;
  const kind: LiteKind | null = pullback ? "pullback" : breakout ? "breakout" : null;
  const trigger: LiteCheck = {
    key: "trigger",
    label: "Trigger",
    ok: kind !== null && !late,
    detail: late ? "Last 30 minutes before the bell — no new call" : first ? "Day's first candle — waiting for the open to settle" : kind === "pullback" ? `Dip to EMA 9 turned back ${d > 0 ? "up" : "down"}` : kind === "breakout" ? `Strong close beyond the last 2 hours' ${d > 0 ? "high" : "low"}` : `Waiting for a dip to EMA 9 that turns, or a close beyond the 2-hour ${d > 0 ? "high" : "low"}`,
  };
  const stretch = (d * (b.c[i] - b.ema21[i])) / b.atr[i];
  const wick = range > 0 ? (d > 0 ? b.h[i] - Math.max(b.o[i], b.c[i]) : Math.min(b.o[i], b.c[i]) - b.l[i]) / range : 0;
  const chaseOk = stretch <= LITE.maxStretchAtr && wick <= LITE.maxWick;
  const chase: LiteCheck = {
    key: "chase",
    label: "No chase",
    ok: chaseOk,
    detail: stretch > LITE.maxStretchAtr ? `Too far from EMA 21 (${stretch.toFixed(1)} ATR) — wait for a dip` : wick > LITE.maxWick ? `Rejection wick (${Math.round(wick * 100)}% of the candle) — sellers pushed back` : `Close to the trend line (${Math.max(0, stretch).toFixed(1)} ATR), no rejection wick`,
  };
  const fire = trigger.ok && chaseOk;
  return { side: fire ? lean : null, kind: fire ? kind : null, lean, checks: [trend, trigger, chase] };
}

/** Option levels for a call bought at `entry` premium: Rs per lot -> premium points. */
export function liteLevels(entry: number, sym: LiteSym): { stop: number; targets: [number, number, number] } {
  const pts = (rs: number) => rs / LITE_LOT[sym];
  const r2 = (x: number) => Math.round(x * 100) / 100;
  return {
    stop: r2(Math.max(0.05, entry - pts(LITE.stopRs))),
    targets: [r2(entry + pts(LITE.t1Rs)), r2(entry + pts(LITE.t2Rs)), r2(entry + pts(LITE.targetRs))],
  };
}

/** Finished 15-minute candles only (the feed's last candle may still be forming). */
export const finished15 = (candles: Candle[], now: number) => candles.filter((k) => Date.parse(k.date) + BAR_MS <= now);
export const LITE_BAR_MS = BAR_MS;
