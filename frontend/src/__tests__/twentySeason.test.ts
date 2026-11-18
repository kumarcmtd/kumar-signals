import { describe, expect, test } from "vitest";
import type { Candle } from "../types";
import { prepare, type LabTrade, type Prepared } from "../utils/twentyLab";
import { computeFeatures } from "../utils/twentyV3/features";
import { GAP_LIVE, gapRoomOk } from "../utils/twentyV3/gapRun";
import { seasonOf, SEASON } from "../utils/twentyV3/season";
import { simulateV3 } from "../utils/twentyV3/sim";
import { ENGINE_SEASON } from "../utils/twentyV3/engines";
import { measureV3, openV3Entry, readV3 } from "../utils/twentyV3/live";
import { buildTicket } from "../utils/twentyV3/ticket";

const IST = 5.5 * 3600_000;
const D = 86_400_000;

/** A Prepared stand-in with only what seasonOf reads: one candle per trading day. */
function daysOnly(days: number[]): Prepared {
  return { day: days } as unknown as Prepared;
}
const trade = (closeIdx: number, rs: number): LabTrade => ({ side: "CE", openIdx: closeIdx, closeIdx, openAt: "", entryMinute: 0, t1: false, exit: "sl", rs });

describe("season switch", () => {
  // Trading days 100..115 (IST day numbers); "today" is day 116.
  const days = Array.from({ length: 16 }, (_, k) => 100 + k);
  const p = daysOnly(days);
  const now = 116 * D - IST + 12 * 3600_000;

  test("rests only on clear evidence: 5+ calls in the last 10 trading days, averaging below zero", () => {
    const losing = [6, 8, 10, 12, 14].map((k) => trade(k, -400));
    expect(seasonOf(losing, p, now)).toMatchObject({ resting: true, calls: 5, avgRs: -400, netRs: -2000 });
    // Four losing calls is not enough evidence -- stays live.
    expect(seasonOf(losing.slice(1), p, now).resting).toBe(false);
    // Five calls that made money overall -- live.
    expect(seasonOf([...losing, trade(15, 2500)], p, now)).toMatchObject({ resting: false, calls: 6 });
  });

  test("only the last 10 trading days before today count", () => {
    // Old losses (days 100-105) are outside the window; today's trades are not counted yet.
    const old = [0, 1, 2, 3, 4, 5].map((k) => trade(k, -900));
    expect(seasonOf(old, p, now)).toMatchObject({ resting: false, calls: 0 });
    const withToday = daysOnly([...days, 116]);
    expect(seasonOf([trade(16, -5000), trade(16, -5000), trade(16, -5000), trade(16, -5000), trade(16, -5000)], withToday, now).calls).toBe(0);
    expect(seasonOf([], p, now).days).toHaveLength(SEASON.lookbackDays);
  });
});

/** Seeded 5-minute crude candles with trending spells, weekdays 9:00 AM - 11:55 PM IST (US winter). */
function walk(days: number, seed: number): Candle[] {
  let s = seed;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const out: Candle[] = [];
  let px = 5400;
  let drift = 0;
  const start = Date.parse("2026-11-02T00:00:00Z") - IST;
  for (let d = 0, n = 0; n < days; d++) {
    const wd = new Date(start + d * D + IST).getUTCDay();
    if (wd === 0 || wd === 6) continue;
    n++;
    for (let m = 9 * 60; m < 23 * 60 + 55; m += 5) {
      if (rnd() < 0.02) drift = (rnd() - 0.5) * 3;
      const o = px;
      let h = o;
      let l = o;
      for (let k = 0; k < 5; k++) {
        px += drift / 5 + (rnd() + rnd() + rnd() - 1.5) * 3;
        h = Math.max(h, px);
        l = Math.min(l, px);
      }
      out.push({ date: new Date(start + d * D + m * 60_000).toISOString(), open: o, high: h, low: l, close: px, volume: 1000 });
    }
  }
  return out;
}

describe("careful at the high", () => {
  const c = walk(6, 3);
  const p = prepare(c, false);
  const f = computeFeatures(p);
  const i = c.length - 40;
  let hi = -Infinity;
  for (let j = i - GAP_LIVE.lookback; j < i; j++) hi = Math.max(hi, p.c[j].high);
  const atr = p.atr[i];
  const at = (close: number) => {
    const q = { ...p, c: p.c.map((k, j) => (j === i ? { ...k, close } : k)) };
    return gapRoomOk(q, f, i, "CE", GAP_LIVE);
  };

  test("a CE right under the 3-hour high waits; with room, or after a close above it, it may go", () => {
    expect(at(hi - 0.5 * atr)).toBe(false);
    expect(at(hi - 1.5 * atr)).toBe(true);
    expect(at(hi + 0.2 * atr)).toBe(true);
  });
});

describe("the main line: live = lab", () => {
  const c = walk(12, 42);
  const p = prepare(c, true);
  const ctx = { p, f: computeFeatures(p) };
  const trades = simulateV3(ctx, ["trendGap"], { sym: "CRUDEOIL" });

  test("the page reads a call on exactly the candles where the replay opened one, and a resting line marks it practice", () => {
    expect(trades.length).toBeGreaterThan(0);
    for (const t of trades.slice(-3)) {
      const barEnd = Date.parse(c[t.openIdx].date) + 5 * 60_000;
      const read = readV3(c.slice(0, t.openIdx + 1), "CRUDEOIL", barEnd + 20_000, undefined, ENGINE_SEASON);
      expect(read.state).toBe("call");
      expect(read.entry).toMatchObject({ setup: "trendGap", side: t.side });
      const ticket = buildTicket(read.entry!, { strike: 5400, ltp: 180, delta: 0.5, deltaKnown: true, oi: 1, volume: 1, inMoney: 0, daysToExpiry: 10, why: "" }, "CRUDEOIL");
      expect(openV3Entry(ticket, read, ENGINE_SEASON, false).practice).toBeUndefined();
      const resting = openV3Entry(ticket, readV3(c.slice(0, t.openIdx + 1), "CRUDEOIL", barEnd + 20_000, undefined, ENGINE_SEASON, true), ENGINE_SEASON, true);
      expect(resting.practice).toBe(true);
      expect(resting.meta?.label).toBe("Ai20-20 · Trend turn, careful at the high (practice)");
    }
  });

  test("the measured record carries the season for the season line only", () => {
    const now = Date.parse(c[c.length - 1].date) + D;
    const m = measureV3(c, "CRUDEOIL", ENGINE_SEASON, now);
    expect(m?.season).toBeTruthy();
    expect(m?.season?.days).toHaveLength(SEASON.lookbackDays);
    expect(measureV3(c, "CRUDEOIL", undefined, now)?.season).toBeUndefined();
  });
});
