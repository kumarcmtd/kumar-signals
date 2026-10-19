import { expect, test } from "vitest";
import { findFvgs, plannedPath, trendChannel } from "../utils/chartMarks";
import type { Candle } from "../types";

const k = (i: number, o: number, h: number, l: number, c: number): Candle => ({ date: `2026-10-19T${String(9 + Math.floor(i / 4)).padStart(2, "0")}:${String((i % 4) * 15).padStart(2, "0")}:00+05:30`, open: o, high: h, low: l, close: c });
const flat = (n: number, p = 100) => Array.from({ length: n }, (_, i) => k(i, p, p + 0.5, p - 0.5, p));

test("a bullish 3-candle gap left unfilled is an FVG; once price trades back through it, it is gone", () => {
  const base = flat(20);
  const gap = [k(20, 100, 100.5, 99.8, 100.4), k(21, 100.4, 103, 100.3, 102.8), k(22, 102.8, 104, 101.5, 103.6)];
  const after = [k(23, 103.6, 104.2, 103, 104), k(24, 104, 104.5, 103.4, 104.2)];
  const f = findFvgs([...base, ...gap, ...after]);
  expect(f).toEqual([{ kind: "bull", low: 100.5, high: 101.5, index: 21 }]);
  const filled = [...base, ...gap, ...after, k(25, 104, 104.1, 100.2, 100.6)];
  expect(findFvgs(filled)).toEqual([]);
});

test("the channel slopes with the trend and contains every candle", () => {
  const c = Array.from({ length: 40 }, (_, i) => k(i, 100 + i * 0.5, 100.8 + i * 0.5 + (i % 3) * 0.3, 99.4 + i * 0.5, 100.4 + i * 0.5));
  const ch = trendChannel(c)!;
  expect(ch.slopePerCandle).toBeCloseTo(0.5, 1);
  c.forEach((x, i) => {
    expect(x.high).toBeLessThanOrEqual(ch.at(i).up + 1e-9);
    expect(x.low).toBeGreaterThanOrEqual(ch.at(i).dn - 1e-9);
  });
});

test("planned path: pullback to the zone first, then T1, a dip, then T2", () => {
  const p = plannedPath("CE", 97.9, 99, 100.7, { low: 96, high: 96.6 });
  expect(p.map((x) => x.price)).toEqual([97.9, 96.3, 99, 99 - (99 - 96.3) * 0.35, 100.7]);
  expect(p.map((x) => x.dx)).toEqual([0, 4, 10, 13, 19]);
  expect(plannedPath("PE", 100, 98, null, null).at(-1)!.price).toBeLessThan(98);
});

test("Ai20-20 premium levels map to futures levels by delta (CE up, PE mirrored)", async () => {
  const { premiumToFutures } = await import("../utils/chartMarks");
  // CE: entry 13.25, SL 12.29, T1 14.25 at delta 0.5, futures 300 at entry
  expect(premiumToFutures({ entry: 13.25, stop: 12.29, targets: [14.25, 15.25, 16.25] }, 0.5, 300)).toEqual({ entry: 300, stop: 298.08, t1: 302, t2: 304 });
  // PE: delta negative -> the stop sits ABOVE the futures entry
  const pe = premiumToFutures({ entry: 10, stop: 9, targets: [11, 12, 13] }, -0.5, 300)!;
  expect(pe.stop).toBe(302);
  expect(pe.t1).toBe(298);
  expect(premiumToFutures({ entry: 10, stop: 9, targets: [11, 12, 13] }, null, 300)).toBeNull();
});
