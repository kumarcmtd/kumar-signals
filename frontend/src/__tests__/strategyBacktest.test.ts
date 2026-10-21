import { expect, test } from "vitest";
import { prepare, signalAt } from "../utils/strategies";
import { simulate, statsFor, testAll } from "../utils/strategyBacktest";
import type { Candle } from "../types";

const pad = (n: number) => String(n).padStart(2, "0");
/** 30-min candles, `perDay` per day from 09:00 IST. */
function bars(n: number, f: (i: number, prev: number) => Omit<Candle, "date">, perDay = 28, start = 100): Candle[] {
  const out: Candle[] = [];
  let p = start;
  for (let i = 0; i < n; i++) {
    const d = Math.floor(i / perDay);
    const m = 9 * 60 + (i % perDay) * 30;
    const k = f(i, p);
    const day = new Date(Date.UTC(2026, 8, 1 + d)).toISOString().slice(0, 10);
    out.push({ date: `${day}T${pad(Math.floor(m / 60))}:${pad(m % 60)}:00+05:30`, ...k });
    p = k.close;
  }
  return out;
}
const chop = (i: number, p: number) => {
  const c = p + (i % 2 ? 0.4 : -0.4);
  return { open: p, high: Math.max(p, c) + 0.2, low: Math.min(p, c) - 0.2, close: c, volume: 1000 };
};

test("liquidity sweep: a candle that pokes above the recent high and closes back below is a PE signal", () => {
  const c = bars(80, (i, p) => (i < 79 ? chop(i, p) : { open: p, high: p + 1.6, low: p - 0.3, close: p - 0.2, volume: 1500 }));
  const s = signalAt(prepare(c), 79, "sweep")!;
  expect(s.side).toBe("PE");
  expect(s.stop).toBeGreaterThan(c[79].high);
});

test("tester: target first = +R minus cost; stop and target in one candle = loss; never overnight", () => {
  const p = prepare(bars(70, chop));
  // hand-made: a CE signal at bar 62 is not produced by chop, so test simulate through a sweep series
  const base = bars(64, (i, q) => (i < 63 ? chop(i, q) : { open: q, high: q + 0.3, low: q - 1.6, close: q + 0.2, volume: 1500 }));
  const up = [...base, ...bars(3, (i, q) => ({ open: q, high: q + 3, low: q - 0.1, close: q + 2.8, volume: 1000 }), 28, base[63].close).map((k, i) => ({ ...k, date: `2026-09-03T${pad(14 + i)}:00:00+05:30` }))];
  const tr = simulate(prepare(up), "sweep", 1);
  const last = tr[tr.length - 1];
  expect(last.signal.side).toBe("CE");
  expect(last.exit).toBe("target");
  expect(last.r).toBeLessThan(1);
  expect(last.r).toBeGreaterThan(0.8);
  expect(p.c.length).toBe(70);
});

test("PROVEN needs enough trades, 40%+ hit, positive average and BOTH halves positive", () => {
  const t = (index: number, r: number) => ({ signal: { strategy: "sweep" as const, side: "CE" as const, entry: 1, stop: 0, index }, r, win: r > 0, exit: (r > 0 ? "target" : "stop") as "target" | "stop" });
  const good = Array.from({ length: 30 }, (_, i) => t(i * 10, i % 2 ? 1.4 : -1));
  expect(statsFor(good, "sweep", 1.5, 150).proven).toBe(true);
  // same overall, but all the wins in the first half -> not proven
  const lucky = [...Array.from({ length: 15 }, (_, i) => t(i, 1.4)), ...Array.from({ length: 15 }, (_, i) => t(200 + i, -1))];
  const s = statsFor(lucky, "sweep", 1.5, 100);
  expect(s.proven).toBe(false);
  expect(s.why).toMatch(/both halves/);
  expect(statsFor(good.slice(0, 10), "sweep", 1.5, 50).why).toMatch(/only 10 trades/);
});

test("testAll runs every strategy and target without crashing on a long history", () => {
  const h = bars(1500, (i, p) => {
    const drift = Math.sin(i / 40) * 0.6 + (i % 7 === 0 ? 1.2 : 0) - (i % 11 === 0 ? 1.4 : 0);
    const c = p + drift + (i % 2 ? 0.3 : -0.3);
    return { open: p, high: Math.max(p, c) + 0.4, low: Math.min(p, c) - 0.4, close: c, volume: 1000 + (i % 5) * 200 };
  });
  const r = testAll(h);
  expect(r.all).toHaveLength(18);
  expect(r.best).toHaveLength(6);
});
