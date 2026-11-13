// Ai20-20 rules lab: replays a rule set over past 5-minute futures candles
// and trades it the way the Ai20-20 page does, so a rule change is judged by
// what it would actually have made -- not by how good it sounds.
//
// How a test trade works (same as the page's trade log):
//   - enter at the signal candle's close (only finished candles are used)
//   - Target 1 = Rs 2000 per lot, T2 = 1.6x, T3 = 2.25x, stop = 0.6x T1
//     (or ATR-sized levels for the "atr" exits)
//   - after T1 the stop moves to entry; after T2 it moves to T1; T3 closes
//   - closed at the session's last candle -- never held overnight
//   - if one candle touches both the stop and a target, the STOP counts
// The option is modelled at delta 0.5 (at the money): Rs per lot =
// 0.5 x futures move x lot size. Costs are charged on every trade: spread +
// brokerage/taxes (Rs 150 Crude, Rs 200 NG per lot) and time decay (about
// Rs 50 per lot per hour held). An estimate, so results are labelled as such.

import type { Candle } from "../types";
import { analyzeImmediate } from "./aiTwentyTwentyEngine";
import { usDstForSession } from "./mcxSession";

export type LabSym = "CRUDEOIL" | "NATURALGAS";
export const LAB_LOT: Record<LabSym, number> = { CRUDEOIL: 100, NATURALGAS: 1250 };
export const LAB_COST_RS: Record<LabSym, number> = { CRUDEOIL: 150, NATURALGAS: 200 };
export const LAB_DELTA = 0.5;
const THETA_RS_PER_HOUR = 50;
const PROFIT_PER_LOT = 2000;
const TIME_STOP_BARS = 12; // 60 minutes without reaching T1
const REENTRY_COOLDOWN_BARS = 2; // 10 minutes after a stop, same side
const IST_MS = 5.5 * 3600_000;

export type SignalKind = "score" | "pullback" | "breakout";
export interface LabRules {
  signal: SignalKind;
  /** always: re-enter whenever the read is on (the page today); fresh: only when it newly turns on. */
  mode: "always" | "fresh";
  /** "score" only: the strength needed for CE (PE mirrors it: 100 - minScore). The page uses 58. */
  minScore: number;
  /** 60ok15: the 1-hour trend agrees and the 15-minute trend is not against it. */
  htf: "none" | "15" | "60" | "60ok15";
  chop: "none" | "adx";
  /** evening: 17:30-23:00 IST. usopen: 10:00-13:15 New York time (after the US open settles), DST-aware. et: `window`. */
  hours: "all" | "evening" | "usopen" | "et";
  /** New York minutes [from, to) when hours = "et". */
  window?: [number, number];
  exits: "fixed" | "atr";
  /** ATR exits: stop = stopAtr x ATR(14, 5-min); T1 = t1R x stop. Defaults 1.5 / 1.5. */
  stopAtr?: number;
  t1R?: number;
  timeStop: boolean;
  /** No new entries on Wednesdays 10:20-10:50 New York time (EIA crude report at 10:30). */
  eiaPause?: boolean;
  /**
   * After entry: steps (the page: stop to entry after T1, to T1 after T2, out at T3),
   * half (book half at T1, the rest as steps), chandelier (no targets; the stop
   * trails trailAtr x ATR behind the best price since entry).
   */
  manage?: "steps" | "half" | "chandelier";
  trailAtr?: number;
}

export const CURRENT_RULES: LabRules = { signal: "score", mode: "always", minScore: 58, htf: "none", chop: "none", hours: "all", exits: "fixed", timeStop: false };

export function rulesLabel(r: LabRules): string {
  const parts: string[] = [r.signal];
  if (r.signal === "score") parts.push(r.mode);
  if (r.signal === "score" && r.minScore !== 58) parts.push(`s${r.minScore}`);
  if (r.htf !== "none") parts.push(`htf${r.htf}`);
  if (r.chop !== "none") parts.push(r.chop);
  const hm = (m: number) => `${Math.floor(m / 60)}${String(m % 60).padStart(2, "0")}`;
  if (r.hours === "et" && r.window) parts.push(`et${hm(r.window[0])}-${hm(r.window[1])}`);
  else if (r.hours !== "all") parts.push(r.hours);
  parts.push(r.exits === "atr" && (r.stopAtr ?? 1.5) !== 1.5 ? `atr${r.stopAtr}` : r.exits);
  if (r.exits === "atr" && (r.t1R ?? 1.5) !== 1.5) parts.push(`r${r.t1R}`);
  if (r.eiaPause) parts.push("eia");
  if (r.manage === "half") parts.push("half");
  if (r.manage === "chandelier") parts.push(`trail${r.trailAtr ?? 3}`);
  if (r.timeStop) parts.push("tstop");
  return parts.join("+");
}

// ---- series helpers (whole-array passes, so a test is O(n)) ----

function emaSeries(v: number[], p: number): number[] {
  const out = new Array<number>(v.length).fill(NaN);
  if (v.length < p) return out;
  let s = 0;
  for (let i = 0; i < p; i++) s += v[i];
  let e = s / p;
  out[p - 1] = e;
  const k = 2 / (p + 1);
  for (let i = p; i < v.length; i++) {
    e = v[i] * k + e * (1 - k);
    out[i] = e;
  }
  return out;
}

/** Wilder smoothing: SMA seed at index p-1, then prev + (x - prev) / p. */
function wilderSeries(v: number[], p: number, start = 0): number[] {
  const out = new Array<number>(v.length).fill(NaN);
  if (v.length - start < p) return out;
  let s = 0;
  for (let i = start; i < start + p; i++) s += v[i];
  let w = s / p;
  out[start + p - 1] = w;
  for (let i = start + p; i < v.length; i++) {
    w = w + (v[i] - w) / p;
    out[i] = w;
  }
  return out;
}

function trSeries(c: Candle[]): number[] {
  return c.map((k, i) => (i === 0 ? k.high - k.low : Math.max(k.high - k.low, Math.abs(k.high - c[i - 1].close), Math.abs(k.low - c[i - 1].close))));
}

function adxSeries(c: Candle[], p = 14): number[] {
  const n = c.length;
  const plus = new Array<number>(n).fill(0);
  const minus = new Array<number>(n).fill(0);
  for (let i = 1; i < n; i++) {
    const up = c[i].high - c[i - 1].high;
    const dn = c[i - 1].low - c[i].low;
    plus[i] = up > dn && up > 0 ? up : 0;
    minus[i] = dn > up && dn > 0 ? dn : 0;
  }
  const tr = trSeries(c);
  const sTr = wilderSeries(tr, p, 1);
  const sP = wilderSeries(plus, p, 1);
  const sM = wilderSeries(minus, p, 1);
  const dx = new Array<number>(n).fill(NaN);
  let first = -1;
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(sTr[i])) continue;
    if (first < 0) first = i;
    const pdi = sTr[i] ? (sP[i] / sTr[i]) * 100 : 0;
    const mdi = sTr[i] ? (sM[i] / sTr[i]) * 100 : 0;
    dx[i] = pdi + mdi ? (Math.abs(pdi - mdi) / (pdi + mdi)) * 100 : 0;
  }
  return first < 0 ? dx : wilderSeries(dx.map((x) => (Number.isFinite(x) ? x : 0)), p, first);
}

export interface Prepared {
  c: Candle[];
  day: number[]; // IST calendar day number
  minute: number[]; // IST minute of the day
  lastOfDay: boolean[];
  ema9: number[];
  ema20: number[];
  ema50: number[];
  atr: number[];
  adx: number[];
  volAvg: number[]; // average volume of the 20 candles BEFORE this one
  htf15: number[]; // +1 / -1 / 0: EMA20 vs EMA50 on finished 15-min candles
  htf60: number[];
  score: number[]; // the page's own analyzeImmediate strength (NaN while too few candles)
  etMinute: number[]; // New York minute of the day (DST-aware)
  etWeekday: number[]; // New York day of the week (0 = Sunday)
}

/** Trend of finished higher-timeframe candles, as seen at each 5-min candle's close. */
function htfTrend(c: Candle[], day: number[], minute: number[], tf: number): number[] {
  const out = new Array<number>(c.length).fill(0);
  const closes: number[] = [];
  let e20: number | null = null;
  let e50: number | null = null;
  let bucket = "";
  let lastClose = NaN;
  const push = (x: number) => {
    closes.push(x);
    const n = closes.length;
    if (n === 20) e20 = closes.reduce((s, v) => s + v, 0) / 20;
    else if (n > 20 && e20 !== null) e20 = x * (2 / 21) + e20 * (19 / 21);
    if (n === 50) e50 = closes.reduce((s, v) => s + v, 0) / 50;
    else if (n > 50 && e50 !== null) e50 = x * (2 / 51) + e50 * (49 / 51);
  };
  for (let i = 0; i < c.length; i++) {
    const b = `${day[i]}-${Math.floor(minute[i] / tf)}`;
    if (bucket && b !== bucket && Number.isFinite(lastClose)) push(lastClose);
    bucket = b;
    lastClose = c[i].close;
    // This candle closes its bucket when its end reaches the bucket's end.
    const done = (minute[i] + 5) % tf === 0 || (minute[i] + 5) >= (Math.floor(minute[i] / tf) + 1) * tf;
    let a20 = e20 as number | null;
    let a50 = e50 as number | null;
    if (done) {
      // Include this just-finished bucket without double counting it later.
      const n = closes.length + 1;
      const v = lastClose;
      if (n === 20) a20 = (closes.reduce((s, x) => s + x, 0) + v) / 20;
      else if (n > 20 && a20 !== null) a20 = v * (2 / 21) + a20 * (19 / 21);
      if (n === 50) a50 = (closes.reduce((s, x) => s + x, 0) + v) / 50;
      else if (n > 50 && a50 !== null) a50 = v * (2 / 51) + a50 * (49 / 51);
    }
    out[i] = a20 !== null && a50 !== null ? (a20 > a50 ? 1 : a20 < a50 ? -1 : 0) : 0;
  }
  return out;
}

const SCORE_WINDOW = 300;

/**
 * @param withScore true: score every candle (the lab). A number n: only the
 * last n candles (the live engine needs just the latest two -- scoring each
 * candle runs the page's whole indicator read, the slow part).
 */
export function prepare(raw: Candle[], withScore: boolean | number = true): Prepared {
  const c = [...raw].sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  const ist = c.map((k) => Date.parse(k.date) + IST_MS);
  const day = ist.map((t) => Math.floor(t / 86_400_000));
  const minute = ist.map((t) => Math.floor((t % 86_400_000) / 60_000));
  const lastOfDay = c.map((_, i) => i === c.length - 1 || day[i + 1] !== day[i]);
  const closes = c.map((k) => k.close);
  const vols = c.map((k) => k.volume ?? 0);
  const volAvg = vols.map((_, i) => {
    if (i < 20) return NaN;
    let s = 0;
    for (let j = i - 20; j < i; j++) s += vols[j];
    return s / 20;
  });
  const score: number[] = c.map(() => NaN);
  if (withScore !== false) {
    const from = typeof withScore === "number" ? Math.max(0, c.length - withScore) : 0;
    for (let i = from; i < c.length; i++) {
      if (i + 1 < 30) continue;
      const a = analyzeImmediate(c.slice(Math.max(0, i + 1 - SCORE_WINDOW), i + 1), null, null);
      score[i] = a.underlyingScore ?? NaN;
    }
  }
  const etMs = c.map((k) => {
    const ms = Date.parse(k.date);
    const d = new Date(ms);
    const dst = usDstForSession(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    return ms - (dst ? 4 : 5) * 3600_000;
  });
  const etMinute = etMs.map((et) => Math.floor((((et % 86_400_000) + 86_400_000) % 86_400_000) / 60_000));
  const etWeekday = etMs.map((et) => new Date(et).getUTCDay());
  return {
    c,
    day,
    minute,
    lastOfDay,
    ema9: emaSeries(closes, 9),
    ema20: emaSeries(closes, 20),
    ema50: emaSeries(closes, 50),
    atr: wilderSeries(trSeries(c), 14),
    adx: adxSeries(c, 14),
    volAvg,
    htf15: htfTrend(c, day, minute, 15),
    htf60: htfTrend(c, day, minute, 60),
    score,
    etMinute,
    etWeekday,
  };
}

function rawSide(p: Prepared, i: number, kind: SignalKind, minScore = 58): "CE" | "PE" | null {
  const { c, ema9, ema20, ema50, atr, volAvg } = p;
  if (kind === "score") {
    const sc = p.score[i];
    if (!Number.isFinite(sc)) return null;
    return sc >= minScore ? "CE" : sc <= 100 - minScore ? "PE" : null;
  }
  if (i < 60 || !Number.isFinite(atr[i]) || !Number.isFinite(ema50[i])) return null;
  const k = c[i];
  if (kind === "pullback") {
    const lo = Math.min(c[i].low, c[i - 1].low, c[i - 2].low);
    const hi = Math.max(c[i].high, c[i - 1].high, c[i - 2].high);
    const up = ema20[i] > ema50[i] && ema20[i] > ema20[i - 3] && lo <= ema20[i] + 0.25 * atr[i] && k.close > ema9[i] && k.close > k.open && k.close > ema20[i];
    const dn = ema20[i] < ema50[i] && ema20[i] < ema20[i - 3] && hi >= ema20[i] - 0.25 * atr[i] && k.close < ema9[i] && k.close < k.open && k.close < ema20[i];
    return up && !dn ? "CE" : dn && !up ? "PE" : null;
  }
  // breakout: closes beyond the last hour's range on a wide candle, with volume when volume is known
  let hh = -Infinity;
  let ll = Infinity;
  for (let j = i - 12; j < i; j++) {
    hh = Math.max(hh, c[j].high);
    ll = Math.min(ll, c[j].low);
  }
  const wide = k.high - k.low >= 0.8 * atr[i];
  const volOk = !Number.isFinite(volAvg[i]) || volAvg[i] <= 0 || (k.volume ?? 0) >= 1.3 * volAvg[i];
  if (k.close > hh && wide && volOk && k.close > k.open) return "CE";
  if (k.close < ll && wide && volOk && k.close < k.open) return "PE";
  return null;
}

/** The side a rule set calls at candle i, or null. Pure; exported for the live engine. */
export function signalAt(p: Prepared, i: number, r: LabRules): "CE" | "PE" | null {
  const side = rawSide(p, i, r.signal, r.minScore);
  if (!side) return null;
  if (r.signal === "score" && r.mode === "fresh" && i > 0 && rawSide(p, i - 1, r.signal, r.minScore) === side) return null;
  const want = side === "CE" ? 1 : -1;
  if (r.htf === "15" && p.htf15[i] !== want) return null;
  if ((r.htf === "60" || r.htf === "60ok15") && p.htf60[i] !== want) return null;
  if (r.htf === "60ok15" && p.htf15[i] === -want) return null;
  if (r.chop === "adx" && !(p.adx[i] >= 20)) return null;
  const m = p.minute[i];
  if (r.hours === "evening" && (m < 17 * 60 + 30 || m >= 23 * 60)) return null;
  if (r.hours === "usopen" && (p.etMinute[i] < 10 * 60 || p.etMinute[i] >= 13 * 60 + 15 || m >= 23 * 60 + 30)) return null;
  if (r.hours === "et" && r.window && (p.etMinute[i] < r.window[0] || p.etMinute[i] >= r.window[1] || m >= 23 * 60 + 30)) return null;
  if (r.eiaPause && p.etWeekday[i] === 3 && p.etMinute[i] >= 10 * 60 + 20 && p.etMinute[i] < 10 * 60 + 50) return null;
  return side;
}

export type LabExit = "sl" | "breakeven" | "after_t1" | "t3" | "time" | "day_end";
export interface LabTrade {
  side: "CE" | "PE";
  openIdx: number;
  closeIdx: number;
  openAt: string;
  entryMinute: number;
  t1: boolean;
  exit: LabExit;
  rs: number; // Rs per lot after costs
}

export function simulate(p: Prepared, r: LabRules, sym: LabSym): LabTrade[] {
  const { c } = p;
  const lot = LAB_LOT[sym];
  const out: LabTrade[] = [];
  const manage = r.manage ?? "steps";
  let open: { side: "CE" | "PE"; i0: number; entry: number; stop: number; t1: number; t2: number; t3: number; h1: boolean; h2: boolean; atr: number; best: number; booked: boolean } | null = null;
  let lastStop: { side: "CE" | "PE"; at: number } | null = null;

  const close = (j: number, fav: number, exit: LabExit) => {
    const o = open!;
    const hours = ((j - o.i0) * 5) / 60;
    // Half booked at T1: half the position earned T1, the rest earns `fav`.
    const total = o.booked ? 0.5 * o.t1 + 0.5 * fav : fav;
    const rs = LAB_DELTA * total * lot - LAB_COST_RS[sym] - (o.booked ? 50 : 0) - THETA_RS_PER_HOUR * hours;
    out.push({ side: o.side, openIdx: o.i0, closeIdx: j, openAt: c[o.i0].date, entryMinute: p.minute[o.i0], t1: o.h1, exit, rs: Math.round(rs) });
    if (exit === "sl" || exit === "breakeven" || exit === "after_t1") lastStop = { side: o.side, at: j };
    open = null;
  };

  for (let i = 0; i < c.length; i++) {
    if (open) {
      const o = open as NonNullable<typeof open>;
      const k = c[i];
      const d = o.side === "CE" ? 1 : -1;
      const favOf = (x: number) => d * (x - o.entry);
      const adverse = d > 0 ? favOf(k.low) : favOf(k.high);
      const best = d > 0 ? favOf(k.high) : favOf(k.low);
      if (manage === "chandelier") {
        // The stop trails behind the best price reached on EARLIER candles.
        const trail = Math.max(-o.stop, o.best - (r.trailAtr ?? 3) * o.atr);
        if (adverse <= trail) close(i, Math.min(favOf(k.open), trail), trail > 0 ? "after_t1" : trail > -o.stop ? "breakeven" : "sl");
        else {
          o.best = Math.max(o.best, best);
          if (o.best >= o.t1) o.h1 = true;
          if (p.lastOfDay[i]) close(i, favOf(k.close), "day_end");
        }
      } else {
      const eff = o.h2 ? o.t1 : o.h1 ? 0 : -o.stop;
      if (adverse <= eff) {
        close(i, Math.min(favOf(k.open), eff), o.h2 ? "after_t1" : o.h1 ? "breakeven" : "sl");
      } else {
        if (best >= o.t1) {
          o.h1 = true;
          if (manage === "half") o.booked = true;
        }
        if (best >= o.t2) o.h2 = true;
        if (best >= o.t3) close(i, o.t3, "t3");
        else {
          const eff2 = o.h2 ? o.t1 : o.h1 ? 0 : -o.stop;
          if (eff2 > eff && favOf(k.close) <= eff2) close(i, eff2, o.h2 ? "after_t1" : "breakeven");
          else if (r.timeStop && !o.h1 && i - o.i0 >= TIME_STOP_BARS) close(i, favOf(k.close), "time");
          else if (p.lastOfDay[i]) close(i, favOf(k.close), "day_end");
        }
      }
      }
    }
    if (!open && !p.lastOfDay[i]) {
      const side = signalAt(p, i, r);
      if (!side) continue;
      const ls = lastStop as { side: "CE" | "PE"; at: number } | null;
      if (ls && ls.side === side && i - ls.at < REENTRY_COOLDOWN_BARS) continue;
      let stop: number;
      let t1: number;
      if (r.exits === "fixed") {
        t1 = PROFIT_PER_LOT / lot / LAB_DELTA;
        stop = 0.6 * t1;
      } else {
        const a = p.atr[i];
        if (!Number.isFinite(a) || a <= 0) continue;
        stop = (r.stopAtr ?? 1.5) * a;
        t1 = (r.t1R ?? 1.5) * stop;
      }
      open = { side, i0: i, entry: c[i].close, stop, t1, t2: 1.6 * t1, t3: 2.25 * t1, h1: false, h2: false, atr: Number.isFinite(p.atr[i]) ? p.atr[i] : stop / 2, best: 0, booked: false };
    }
  }
  return out;
}

export interface LabStats {
  label: string;
  trades: number;
  days: number;
  perDay: number;
  t1Pct: number | null;
  winPct: number | null;
  avgRs: number | null;
  netRs: number;
  profitFactor: number | null;
  maxDrawdownRs: number;
  firstHalfAvg: number | null;
  secondHalfAvg: number | null;
  exits: Partial<Record<LabExit, number>>;
}

export function statsOf(trades: LabTrade[], p: Prepared, label: string): LabStats {
  const days = new Set(p.day).size;
  const n = trades.length;
  const net = trades.reduce((s, t) => s + t.rs, 0);
  const gains = trades.filter((t) => t.rs > 0).reduce((s, t) => s + t.rs, 0);
  const losses = -trades.filter((t) => t.rs < 0).reduce((s, t) => s + t.rs, 0);
  let peak = 0;
  let eq = 0;
  let dd = 0;
  for (const t of trades) {
    eq += t.rs;
    peak = Math.max(peak, eq);
    dd = Math.max(dd, peak - eq);
  }
  const mid = p.c.length / 2;
  const avg = (xs: LabTrade[]) => (xs.length ? Math.round(xs.reduce((s, t) => s + t.rs, 0) / xs.length) : null);
  const exits: Partial<Record<LabExit, number>> = {};
  for (const t of trades) exits[t.exit] = (exits[t.exit] ?? 0) + 1;
  return {
    label,
    trades: n,
    days,
    perDay: days ? Math.round((n / days) * 10) / 10 : 0,
    t1Pct: n ? Math.round((trades.filter((t) => t.t1).length / n) * 100) : null,
    winPct: n ? Math.round((trades.filter((t) => t.rs > 0).length / n) * 100) : null,
    avgRs: avg(trades),
    netRs: Math.round(net),
    profitFactor: losses > 0 ? Math.round((gains / losses) * 100) / 100 : gains > 0 ? 99 : null,
    maxDrawdownRs: Math.round(dd),
    firstHalfAvg: avg(trades.filter((t) => t.openIdx < mid)),
    secondHalfAvg: avg(trades.filter((t) => t.openIdx >= mid)),
    exits,
  };
}

/** Every combination the lab compares (the page's current rules first). */
export function ruleGrid(): LabRules[] {
  const out: LabRules[] = [CURRENT_RULES];
  const seen = new Set([rulesLabel(CURRENT_RULES)]);
  const add = (r: LabRules) => {
    const k = rulesLabel(r);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(r);
    }
  };
  const base = { chop: "none" as const };
  for (const mode of ["always", "fresh"] as const)
    for (const minScore of [58, 62, 66])
      for (const htf of ["none", "60", "60ok15"] as const)
        for (const hours of ["all", "evening", "usopen"] as const)
          for (const exits of ["fixed", "atr"] as const)
            for (const timeStop of [false, true]) add({ ...base, signal: "score", mode, minScore, htf, hours, exits, timeStop });
  for (const signal of ["pullback", "breakout"] as const)
    for (const htf of ["none", "60"] as const)
      for (const hours of ["all", "evening", "usopen"] as const)
        for (const exits of ["fixed", "atr"] as const)
          for (const timeStop of [false, true]) add({ ...base, signal, mode: "always", minScore: 58, htf, hours, exits, timeStop });
  return out;
}

/** Round 3: settings around the best crude rule set, to see whether its neighbours hold up too. */
export function sensitivityGrid(): LabRules[] {
  const out: LabRules[] = [CURRENT_RULES];
  const seen = new Set([rulesLabel(CURRENT_RULES)]);
  const add = (r: LabRules) => {
    const k = rulesLabel(r);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(r);
    }
  };
  const windows: (["usopen", undefined] | ["et", [number, number]] | ["evening", undefined] | ["all", undefined])[] = [
    ["usopen", undefined],
    ["et", [9 * 60 + 45, 13 * 60 + 15]],
    ["et", [10 * 60 + 30, 13 * 60 + 15]],
    ["et", [10 * 60, 12 * 60 + 30]],
    ["et", [9 * 60, 13 * 60 + 15]],
    ["evening", undefined],
    ["all", undefined],
  ];
  const exits: { exits: "fixed" | "atr"; stopAtr?: number; t1R?: number }[] = [
    { exits: "fixed" },
    { exits: "atr" },
    { exits: "atr", stopAtr: 1.2 },
    { exits: "atr", stopAtr: 2 },
    { exits: "atr", t1R: 1.2 },
    { exits: "atr", t1R: 2 },
  ];
  for (const mode of ["fresh", "always"] as const)
    for (const minScore of [58, 62])
      for (const htf of ["60", "60ok15"] as const)
        for (const [hours, window] of windows)
          for (const ex of exits)
            for (const timeStop of [false, true]) add({ signal: "score", mode, minScore, htf, chop: "none", hours, window, ...ex, timeStop });
  return out;
}

export const GATE = { lookbackDays: 15, minTrades: 8 } as const;

/**
 * The edge gate, replayed: a trade is taken only when the SAME rules' test
 * trades over the previous `lookbackDays` trading days averaged above zero
 * (with at least `minTrades` of them). Judged only on days after that
 * window, so it never sees its own future. Days before the window have no
 * evidence yet and take no trades.
 */
export function gateTrades(
  trades: LabTrade[],
  p: Prepared,
  lookbackDays: number = GATE.lookbackDays,
  minTrades: number = GATE.minTrades,
  /** Average Rs per trade the window must beat. */
  floorRs = 0,
  /** true: pause only on clear evidence (enough trades AND below the floor); too few trades -> take it. */
  pauseOnlyOnEvidence = false
): { gated: LabTrade[]; eligible: LabTrade[] } {
  const days = [...new Set(p.day)].sort((a, b) => a - b);
  const idx = new Map(days.map((d, i) => [d, i]));
  const gated: LabTrade[] = [];
  const eligible: LabTrade[] = [];
  for (const t of trades) {
    const di = idx.get(p.day[t.openIdx])!;
    if (di < lookbackDays) continue;
    eligible.push(t);
    let n = 0;
    let sum = 0;
    for (const x of trades) {
      const xi = idx.get(p.day[x.closeIdx])!;
      if (xi < di && xi >= di - lookbackDays) {
        n++;
        sum += x.rs;
      }
    }
    const enough = n >= minTrades;
    const take = pauseOnlyOnEvidence ? !(enough && sum / n < floorRs) : enough && sum / n > floorRs;
    if (take) gated.push(t);
  }
  return { gated, eligible };
}
