import { describe, expect, test } from "vitest";
import { prepare } from "../utils/twentyLab";
import { speedSeries } from "../utils/twentyV3/speed";
import { liquidityGate, newsGate } from "../utils/twentyV3/gates";
import { ENGINE_FAST, ENGINE_V3, isPracticeAnywhere } from "../utils/twentyV3/engines";
import type { Candle, OptionsAnalytics } from "../types";
import type { NewsPulse } from "../utils/newsPulse";

const DAY0 = Date.UTC(2026, 10, 9) - 5.5 * 3600_000; // IST midnight, Mon 9 Nov 2026

/** 5-minute candles whose 15-minute ranges are `base` wide, then `fast` wide for the last `n` buckets. */
function candles(buckets: number, base: number, fast: number, n: number): Candle[] {
  const out: Candle[] = [];
  let t = DAY0 + 9 * 3600_000;
  for (let b = 0; b < buckets; b++) {
    const w = b >= buckets - n ? fast : base;
    for (let k = 0; k < 3; k++) {
      // The three 5-minute candles of a bucket span [100, 100 + w] together; closes back at 100.
      const hi = k === 1 ? 100 + w : 100 + 1;
      out.push({ date: new Date(t).toISOString(), open: 100, high: hi, low: 100, close: 100, volume: 1 });
      t += 5 * 60_000;
    }
  }
  return out;
}

describe("Speed gauge (engine version)", () => {
  test("usual pace reads 50; twice the usual range reads 100; nothing before 43 finished 15-minute candles", () => {
    const calm = speedSeries(prepare(candles(50, 10, 10, 0), false));
    expect(calm.speed[calm.speed.length - 1]).toBe(50);
    const fast = speedSeries(prepare(candles(50, 10, 20, 3), false));
    expect(fast.speed[fast.speed.length - 1]).toBe(100);
    const short = speedSeries(prepare(candles(40, 10, 10, 0), false));
    expect(short.speed.every((x) => Number.isNaN(x))).toBe(true);
  });
});

describe("Ai-Super Fast live checks", () => {
  const chain = (oi: number, vol: number): OptionsAnalytics =>
    ({
      symbol: "CRUDEOIL",
      atmStrike: 5400,
      spot: 5400,
      expiry: "2026-11-24",
      rows: [5350, 5400, 5450].map((strike) => ({ strike, call: { ltp: 150, oi: strike === 5400 ? oi : 10000, volume: strike === 5400 ? vol : 2000, delta: 0.5 }, put: { ltp: 150, oi: 1, volume: 1, delta: -0.5 } })),
    }) as unknown as OptionsAnalytics;
  const choice = (oi: number, vol: number) => ({ strike: 5400, ltp: 150, delta: 0.5, deltaKnown: true, oi, volume: vol, inMoney: 0 as const, daysToExpiry: 9, why: "" });

  test("liquidity: a strike with a fifth of the busiest strike's OI and volume passes; a thin one does not", () => {
    expect(liquidityGate(chain(8000, 1500), choice(8000, 1500), "CE").ok).toBe(true);
    const thin = liquidityGate(chain(500, 50), choice(500, 50), "CE");
    expect(thin.ok).toBe(false);
    expect(thin.detail).toMatch(/thin/);
    expect(liquidityGate(undefined, null, "CE").ok).toBe(false);
  });

  test("news must be on the call's side: with passes; neutral, against and unavailable do not", () => {
    const pulse = (net: number): NewsPulse => ({ net, direction: net > 10 ? "bullish" : net < -10 ? "bearish" : "neutral", highImpactFresh: 0, top: null, feedAgeMin: 5, available: true });
    expect(newsGate(pulse(30), "CE").ok).toBe(true);
    expect(newsGate(pulse(-30), "PE").ok).toBe(true);
    expect(newsGate(pulse(0), "CE").ok).toBe(false);
    expect(newsGate(pulse(-30), "CE").ok).toBe(false);
    expect(newsGate(null, "CE").ok).toBe(false);
  });

  test("the page runs its own log, practice only, with both live checks on", () => {
    expect(ENGINE_FAST.key("CRUDEOIL")).toBe("SUPERFAST-CRUDEOIL-FAST");
    expect(ENGINE_FAST.gates).toEqual({ liquidity: true, news: true });
    expect(ENGINE_V3.gates).toEqual({ liquidity: false, news: false });
    expect(ENGINE_FAST.active.CRUDEOIL.every(isPracticeAnywhere)).toBe(true);
  });
});
