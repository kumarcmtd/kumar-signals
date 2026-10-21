// Six intraday strategies, written as exact rules so they can be TESTED on
// history instead of trusted on faith. Each looks only at finished 30-minute
// candles up to bar i and returns a trade (side, entry at that close, stop) or
// nothing. Targets are set by the tester as R multiples of the risk.
//
// Why these six. The repeated failure was: every indicator agrees -> enter
// -> price reverses -> stop. By then the early traders were taking profit.
// So half of the set deliberately trades AGAINST that late crowd:
//   sweep      price pokes above a recent high (late buyers' breakout) and
//              closes back below -> their stops are the fuel down. Mirror.
//   exhaustion a huge candle, then the next closes back past its middle ->
//              the spike is spent. Mirror.
//   vwapFade   price stretched 2+ ATR from the day's VWAP with RSI extreme,
//              turning -> fade back toward VWAP.
// and half trades WITH the trend but enters early or on a retest:
//   pullback   trend up (EMA20 > EMA50), dip touches EMA20, green close.
//   orb        the first 30-minute range of the session, first close beyond.
//   pause      a strong 3-candle push, then a resting candle that holds half.

import type { Candle } from "../types";

export type StrategyId = "sweep" | "exhaustion" | "vwapFade" | "pullback" | "orb" | "pause";

export const STRATEGIES: { id: StrategyId; name: string; idea: string }[] = [
  { id: "sweep", name: "Liquidity sweep reversal", idea: "Breaks a recent high/low, closes back inside — fades the late breakout crowd" },
  { id: "exhaustion", name: "Spike exhaustion fade", idea: "A huge candle, then the next closes back past its middle" },
  { id: "vwapFade", name: "VWAP stretch fade", idea: "2+ ATR away from VWAP with RSI extreme, turning back" },
  { id: "pullback", name: "Trend pullback", idea: "Trend up/down, dip to EMA20, closes back with the trend" },
  { id: "orb", name: "Opening range breakout", idea: "First close beyond the first 30-min range of the day" },
  { id: "pause", name: "Momentum, then pause", idea: "Strong 3-candle push, a resting candle that holds half" },
];

export interface StratSignal {
  strategy: StrategyId;
  side: "CE" | "PE";
  entry: number;
  stop: number;
  index: number;
}

export interface Prepared {
  c: Candle[];
  atr: number[];
  e20: number[];
  e50: number[];
  rsi: number[];
  vwap: number[];
  day: string[]; // IST date of each bar
  mins: number[]; // IST minutes of each bar's start
}

const istParts = (iso: string) => {
  const t = new Date(Date.parse(iso) + 5.5 * 3600_000).toISOString();
  return { day: t.slice(0, 10), mins: Number(t.slice(11, 13)) * 60 + Number(t.slice(14, 16)) };
};

/** Indicator series computed once for the whole history. */
export function prepare(raw: Candle[]): Prepared {
  const c = [...raw].sort((a, b) => a.date.localeCompare(b.date));
  const n = c.length;
  const atr: number[] = [];
  const e20: number[] = [];
  const e50: number[] = [];
  const rsi: number[] = [];
  const vwap: number[] = [];
  const day: string[] = [];
  const mins: number[] = [];
  let a = 0;
  let g = 0;
  let l = 0;
  let pv = 0;
  let vv = 0;
  for (let i = 0; i < n; i++) {
    const k = c[i];
    const p = istParts(k.date);
    day.push(p.day);
    mins.push(p.mins);
    const tr = i ? Math.max(k.high - k.low, Math.abs(k.high - c[i - 1].close), Math.abs(k.low - c[i - 1].close)) : k.high - k.low;
    a = i < 14 ? (a * i + tr) / (i + 1) : (a * 13 + tr) / 14;
    atr.push(a);
    e20.push(i ? k.close * (2 / 21) + e20[i - 1] * (19 / 21) : k.close);
    e50.push(i ? k.close * (2 / 51) + e50[i - 1] * (49 / 51) : k.close);
    const ch = i ? k.close - c[i - 1].close : 0;
    g = i < 14 ? (g * i + Math.max(ch, 0)) / (i + 1) : (g * 13 + Math.max(ch, 0)) / 14;
    l = i < 14 ? (l * i + Math.max(-ch, 0)) / (i + 1) : (l * 13 + Math.max(-ch, 0)) / 14;
    rsi.push(l === 0 ? 100 : 100 - 100 / (1 + g / l));
    if (i === 0 || day[i] !== day[i - 1]) {
      pv = 0;
      vv = 0;
    }
    const vol = k.volume && k.volume > 0 ? k.volume : 1;
    pv += ((k.high + k.low + k.close) / 3) * vol;
    vv += vol;
    vwap.push(pv / vv);
  }
  return { c, atr, e20, e50, rsi, vwap, day, mins };
}

const body = (k: Candle) => Math.abs(k.close - k.open);
const range = (k: Candle) => Math.max(1e-9, k.high - k.low);
const strongUp = (k: Candle) => k.close > k.open && body(k) / range(k) >= 0.55 && (k.close - k.low) / range(k) >= 0.7;
const strongDn = (k: Candle) => k.close < k.open && body(k) / range(k) >= 0.55 && (k.high - k.close) / range(k) >= 0.7;

/** The signal (if any) of one strategy at the close of bar i. */
export function signalAt(p: Prepared, i: number, id: StrategyId): StratSignal | null {
  if (i < 60) return null;
  const { c, atr, e20, e50, rsi, vwap, day, mins } = p;
  const k = c[i];
  const a = atr[i];
  const mk = (side: "CE" | "PE", stop: number): StratSignal | null => {
    const risk = side === "CE" ? k.close - stop : stop - k.close;
    if (!(risk > 0.3 * a && risk < 2.5 * a)) return null;
    return { strategy: id, side, entry: k.close, stop, index: i };
  };
  switch (id) {
    case "sweep": {
      const prior = c.slice(i - 12, i);
      const hi = Math.max(...prior.map((x) => x.high));
      const lo = Math.min(...prior.map((x) => x.low));
      if (k.high > hi + 0.05 * a && k.close < hi && k.close < k.open && (k.high - Math.max(k.open, k.close)) / range(k) >= 0.4) return mk("PE", k.high + 0.1 * a);
      if (k.low < lo - 0.05 * a && k.close > lo && k.close > k.open && (Math.min(k.open, k.close) - k.low) / range(k) >= 0.4) return mk("CE", k.low - 0.1 * a);
      return null;
    }
    case "exhaustion": {
      const s = c[i - 1];
      if (range(s) < 2 * atr[i - 1]) return null;
      const mid = (s.high + s.low) / 2;
      if (strongUp(s) && k.close < mid) return mk("PE", Math.max(s.high, k.high) + 0.1 * a);
      if (strongDn(s) && k.close > mid) return mk("CE", Math.min(s.low, k.low) - 0.1 * a);
      return null;
    }
    case "vwapFade": {
      const d = (k.close - vwap[i]) / a;
      if (d >= 2 && rsi[i] >= 70 && k.close < k.open) return mk("PE", k.high + 0.1 * a);
      if (d <= -2 && rsi[i] <= 30 && k.close > k.open) return mk("CE", k.low - 0.1 * a);
      return null;
    }
    case "pullback": {
      const upTrend = e20[i] > e50[i] && e20[i] > e20[i - 3];
      const dnTrend = e20[i] < e50[i] && e20[i] < e20[i - 3];
      if (upTrend && k.low <= e20[i] + 0.1 * a && k.close > e20[i] && k.close > k.open) return mk("CE", Math.min(k.low, c[i - 1].low) - 0.1 * a);
      if (dnTrend && k.high >= e20[i] - 0.1 * a && k.close < e20[i] && k.close < k.open) return mk("PE", Math.max(k.high, c[i - 1].high) + 0.1 * a);
      return null;
    }
    case "orb": {
      // The day's first bar is the range; trade the first close beyond it, until 13:00.
      let f = i;
      while (f > 0 && day[f - 1] === day[i]) f--;
      if (f === i || mins[i] > 13 * 60) return null;
      const or = c[f];
      const earlier = c.slice(f + 1, i);
      if (k.close > or.high && !earlier.some((x) => x.close > or.high || x.close < or.low)) return mk("CE", (or.high + or.low) / 2);
      if (k.close < or.low && !earlier.some((x) => x.close > or.high || x.close < or.low)) return mk("PE", (or.high + or.low) / 2);
      return null;
    }
    case "pause": {
      const push = c.slice(i - 3, i);
      const start = c[i - 4].close;
      const net = c[i - 1].close - start;
      const ups = push.filter(strongUp).length;
      const dns = push.filter(strongDn).length;
      if (ups >= 2 && net >= 1.2 * a) {
        const mid = (start + Math.max(...push.map((x) => x.high))) / 2;
        if (!strongUp(k) && k.low >= mid) return mk("CE", Math.min(mid, k.low) - 0.15 * a);
      }
      if (dns >= 2 && -net >= 1.2 * a) {
        const mid = (start + Math.min(...push.map((x) => x.low))) / 2;
        if (!strongDn(k) && k.high <= mid) return mk("PE", Math.max(mid, k.high) + 0.15 * a);
      }
      return null;
    }
  }
}
