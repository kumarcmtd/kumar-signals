// Tests each strategy on history the way it would actually be traded:
//   - enter at the signal candle's close; one trade at a time per strategy
//   - stop and target checked on every later 30-minute candle; if one candle
//     touches both, it counts as a LOSS (cannot tell which came first)
//   - never held overnight: closed at the day's last candle; at most 8
//     candles (4 hours) in any case
//   - a cost is charged on every trade (brokerage + slippage, ~0.05 ATR)
// Results are in R (multiples of the risk), so Crude and NG compare fairly.
// A strategy is PROVEN for a market only if it hits >= 40% with a positive
// average AND stays positive in BOTH halves of the period -- a strategy that
// only worked in one lucky stretch is not proven.

import { prepare, signalAt, STRATEGIES, type Prepared, type StrategyId, type StratSignal } from "./strategies";
import type { Candle } from "../types";

export const TARGETS_R = [1, 1.5, 2] as const;
const MAX_HOLD = 8;
const COST_ATR = 0.05;

export interface SimTrade {
  signal: StratSignal;
  r: number; // result in R, after cost
  win: boolean;
  exit: "target" | "stop" | "time" | "day_end";
}

export interface StratStats {
  strategy: StrategyId;
  targetR: number;
  trades: number;
  hitRate: number | null; // 0..100
  avgR: number | null;
  profitFactor: number | null;
  maxLosingStreak: number;
  firstHalfR: number | null; // average R
  secondHalfR: number | null;
  proven: boolean;
  why: string;
}

export const PROVEN_RULE = { minTrades: 20, minHit: 40, minAvgR: 0.05 } as const;

export function simulate(p: Prepared, id: StrategyId, targetR: number): SimTrade[] {
  const { c, atr, day } = p;
  const out: SimTrade[] = [];
  let i = 0;
  while (i < c.length - 1) {
    const s = signalAt(p, i, id);
    if (!s) {
      i++;
      continue;
    }
    const up = s.side === "CE";
    const risk = Math.abs(s.entry - s.stop);
    const target = up ? s.entry + targetR * risk : s.entry - targetR * risk;
    const cost = (COST_ATR * atr[i]) / risk;
    let j = i + 1;
    let result: SimTrade | null = null;
    for (; j < c.length && j <= i + MAX_HOLD; j++) {
      const k = c[j];
      if (day[j] !== day[i]) {
        // overnight: closed at the previous day's last candle
        const exitPx = c[j - 1].close;
        const r = ((up ? exitPx - s.entry : s.entry - exitPx) / risk) - cost;
        result = { signal: s, r, win: r > 0, exit: "day_end" };
        j--;
        break;
      }
      const hitStop = up ? k.low <= s.stop : k.high >= s.stop;
      const hitTarget = up ? k.high >= target : k.low <= target;
      if (hitStop) {
        result = { signal: s, r: -1 - cost, win: false, exit: "stop" };
        break;
      }
      if (hitTarget) {
        result = { signal: s, r: targetR - cost, win: true, exit: "target" };
        break;
      }
    }
    if (!result) {
      const last = c[Math.min(j, c.length) - 1];
      const r = ((up ? last.close - s.entry : s.entry - last.close) / risk) - cost;
      result = { signal: s, r, win: r > 0, exit: "time" };
      j = Math.min(j, c.length - 1);
    }
    out.push(result);
    i = Math.max(j, i + 1); // one trade at a time
  }
  return out;
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const round = (n: number | null, d = 2) => (n === null ? null : Math.round(n * 10 ** d) / 10 ** d);

export function statsFor(trades: SimTrade[], id: StrategyId, targetR: number, splitIndex: number): StratStats {
  const n = trades.length;
  const wins = trades.filter((t) => t.win).length;
  const gross = trades.filter((t) => t.r > 0).reduce((a, t) => a + t.r, 0);
  const loss = -trades.filter((t) => t.r < 0).reduce((a, t) => a + t.r, 0);
  let streak = 0;
  let maxStreak = 0;
  for (const t of trades) {
    streak = t.win ? 0 : streak + 1;
    maxStreak = Math.max(maxStreak, streak);
  }
  const first = avg(trades.filter((t) => t.signal.index < splitIndex).map((t) => t.r));
  const second = avg(trades.filter((t) => t.signal.index >= splitIndex).map((t) => t.r));
  const hit = n ? (wins / n) * 100 : null;
  const avgR = avg(trades.map((t) => t.r));
  const fails: string[] = [];
  if (n < PROVEN_RULE.minTrades) fails.push(`only ${n} trades`);
  if (hit !== null && hit < PROVEN_RULE.minHit) fails.push(`hit ${hit.toFixed(0)}%`);
  if (avgR !== null && avgR < PROVEN_RULE.minAvgR) fails.push("loses money on average");
  if ((first ?? 0) <= 0 || (second ?? 0) <= 0) fails.push("not positive in both halves");
  return {
    strategy: id,
    targetR,
    trades: n,
    hitRate: round(hit, 0),
    avgR: round(avgR),
    profitFactor: loss > 0 ? round(gross / loss) : gross > 0 ? 99 : null,
    maxLosingStreak: maxStreak,
    firstHalfR: round(first),
    secondHalfR: round(second),
    proven: fails.length === 0,
    why: fails.length ? fails.join(", ") : "passes every test",
  };
}

/** Every strategy x target on one market's history; the best target per strategy. */
export function testAll(history: Candle[]): { all: StratStats[]; best: StratStats[] } {
  const p = prepare(history);
  const split = Math.floor(p.c.length / 2);
  const all: StratStats[] = [];
  for (const s of STRATEGIES) for (const t of TARGETS_R) all.push(statsFor(simulate(p, s.id, t), s.id, t, split));
  // Best per strategy: proven first, then the higher average R.
  const best = STRATEGIES.map((s) =>
    all
      .filter((x) => x.strategy === s.id)
      .sort((a, b) => Number(b.proven) - Number(a.proven) || (b.avgR ?? -9) - (a.avgR ?? -9))[0],
  ).sort((a, b) => Number(b.proven) - Number(a.proven) || (b.avgR ?? -9) - (a.avgR ?? -9));
  return { all, best };
}

/** Any PROVEN strategy firing on the latest finished candle. */
export function liveSignals(candles: Candle[], proven: StratStats[]): (StratSignal & { stats: StratStats; target: number })[] {
  const p = prepare(candles);
  const i = p.c.length - 1;
  const out: (StratSignal & { stats: StratStats; target: number })[] = [];
  for (const st of proven) {
    const s = signalAt(p, i, st.strategy);
    if (!s) continue;
    const risk = Math.abs(s.entry - s.stop);
    out.push({ ...s, stats: st, target: Math.round((s.side === "CE" ? s.entry + st.targetR * risk : s.entry - st.targetR * risk) * 100) / 100 });
  }
  return out;
}
