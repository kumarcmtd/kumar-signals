import { describe, expect, test } from "vitest";
import type { Candle } from "../types";
import type { TradeLogEntry } from "../utils/tradeLogCore";
import type { StrikeChoice } from "../utils/twentyV3/ticket";
import { resampleCandles } from "../utils/candleResample";
import { ENGINES } from "../utils/aiEdgeEngine";
import { liteBars, liteLevels, liteSignal, type LiteBars } from "../utils/lite/engine";
import { liteGuard, liteKey, openLiteEntry, readLite, type LiteRead } from "../utils/lite/live";
import { simulateLite } from "../utils/lite/sim";

const IST = 5.5 * 3600_000;
const M15 = 15 * 60_000;
// Monday 16 Nov 2026, IST midnight. US winter time: MCX shuts at 23:55.
const DAY = Date.UTC(2026, 10, 16) - IST;
const BELL = 23 * 60 + 55;

/** 40 quiet 15-minute bars from 9:00 IST in a gentle uptrend: EMA 9 (100) over EMA 21 (99), ATR 4. */
function quietUp(): LiteBars {
  const n = 40;
  const t = Array.from({ length: n }, (_, i) => DAY + 9 * 3600_000 + i * M15);
  return {
    t,
    o: Array<number>(n).fill(100),
    h: Array<number>(n).fill(101),
    l: Array<number>(n).fill(99),
    c: Array<number>(n).fill(100.5),
    day: t.map((x) => Math.floor((x + IST) / 86_400_000)),
    ema9: Array<number>(n).fill(100),
    ema21: Array<number>(n).fill(99),
    atr: Array<number>(n).fill(4),
  };
}
function setBar(b: LiteBars, i: number, o: number, h: number, l: number, c: number) {
  b.o[i] = o;
  b.h[i] = h;
  b.l[i] = l;
  b.c[i] = c;
}
/** The same picture upside down around 100: an uptrend becomes a downtrend. */
const mirror = (b: LiteBars): LiteBars => ({
  ...b,
  o: b.o.map((x) => 200 - x),
  c: b.c.map((x) => 200 - x),
  h: b.l.map((x) => 200 - x),
  l: b.h.map((x) => 200 - x),
  ema9: b.ema9.map((x) => 200 - x),
  ema21: b.ema21.map((x) => 200 - x),
});
const check = (b: LiteBars, key: string, i = 39) => liteSignal(b, i, BELL).checks.find((c) => c.key === key);
/** The quiet uptrend with a dip to EMA 9 that turns up on the last candle. */
function dipAndTurn(): LiteBars {
  const b = quietUp();
  setBar(b, 39, 100.2, 102.2, 100, 102);
  return b;
}

describe("Ai Lite rules", () => {
  test("a dip to EMA 9 that turns back up in an uptrend buys CE", () => {
    const s = liteSignal(dipAndTurn(), 39, BELL);
    expect(s).toMatchObject({ side: "CE", kind: "pullback", lean: "CE" });
    expect(s.checks.map((c) => c.ok)).toEqual([true, true, true]);
  });

  test("a strong close above the last 2 hours' high buys CE without a dip", () => {
    const b = quietUp();
    for (let j = 30; j < 39; j++) setBar(b, j, 100.6, 101, 100.5, 100.8); // never touches EMA 9
    setBar(b, 39, 100.6, 102.6, 100.5, 102.5);
    expect(liteSignal(b, 39, BELL)).toMatchObject({ side: "CE", kind: "breakout" });
  });

  test("the downtrend mirror buys PE", () => {
    expect(liteSignal(mirror(dipAndTurn()), 39, BELL)).toMatchObject({ side: "PE", kind: "pullback", lean: "PE" });
  });

  test("no chase: nothing when price is already far above EMA 21", () => {
    const b = dipAndTurn();
    b.ema21[39] = 90; // close 102 is 3 ATR above it
    const s = liteSignal(b, 39, BELL);
    expect(s.side).toBeNull();
    expect(s.lean).toBe("CE");
    expect(check(b, "trigger")?.ok).toBe(true);
    expect(check(b, "chase")?.detail).toMatch(/Too far from EMA 21 \(3\.0 ATR\)/);
  });

  test("no chase: nothing on a long wick against the call (sellers pushed back)", () => {
    const b = quietUp();
    setBar(b, 39, 100.2, 105, 100, 102); // 60% of the candle is the upper wick
    expect(liteSignal(b, 39, BELL).side).toBeNull();
    expect(check(b, "chase")?.detail).toMatch(/Rejection wick \(60%/);
  });

  test("nothing on the day's first candle or in the last 30 minutes before the bell", () => {
    const b = dipAndTurn();
    const first = { ...b, day: b.day.map((d, i) => (i === 39 ? d + 1 : d)) };
    expect(liteSignal(first, 39, BELL).side).toBeNull();
    expect(check(first, "trigger")?.detail).toMatch(/first candle/);
    const at = (min: number) => ({ ...b, t: b.t.map((x, i) => (i === 39 ? DAY + min * 60_000 : x)) });
    expect(liteSignal(at(23 * 60), 39, BELL).side).toBe("CE"); // ends 23:15, 40 minutes before the bell
    expect(liteSignal(at(23 * 60 + 15), 39, BELL).side).toBeNull();
    expect(check(at(23 * 60 + 15), "trigger")?.detail).toMatch(/Last 30 minutes/);
  });

  test("no trend, no call; and nothing before the averages have warmed up", () => {
    const flat = { ...dipAndTurn(), ema21: Array<number>(40).fill(100) };
    expect(liteSignal(flat, 39, BELL)).toMatchObject({ side: null, lean: null });
    expect(liteSignal(dipAndTurn(), 29, BELL)).toMatchObject({ side: null, lean: null });
  });

  test("indicators use only earlier candles (a later candle never changes an earlier reading)", () => {
    const candles: Candle[] = Array.from({ length: 60 }, (_, i) => {
      const c = 100 + Math.sin(i / 3) * 4 + i * 0.2;
      return { date: new Date(DAY + 9 * 3600_000 + i * M15).toISOString(), open: c - 0.5, high: c + 1, low: c - 1.5, close: c, volume: 1 };
    });
    const a = liteBars(candles);
    const b = liteBars(candles.map((k, i) => (i === 59 ? { ...k, close: 500, high: 500 } : k)));
    expect(a.ema9[58]).toBe(b.ema9[58]);
    expect(a.ema21[58]).toBe(b.ema21[58]);
    expect(a.atr[58]).toBe(b.atr[58]);
    expect(a.ema21[19]).toBeNaN();
    expect(Number.isFinite(a.ema21[20])).toBe(true);
  });
});

describe("Ai Lite money", () => {
  test("levels are Rs 1,000 / 1,500 / 2,000 profit and Rs 1,000 loss per lot", () => {
    expect(liteLevels(200, "CRUDEOIL")).toEqual({ stop: 190, targets: [210, 215, 220] }); // lot 100
    expect(liteLevels(10, "NATURALGAS")).toEqual({ stop: 9.2, targets: [10.8, 11.2, 11.6] }); // lot 1,250
    expect(liteLevels(6, "CRUDEOIL").stop).toBe(0.05); // a premium cannot go below zero
  });

  const NOW = DAY + 15 * 3600_000; // 3 PM IST
  const e = (p: Partial<TradeLogEntry>): TradeLogEntry => ({ id: `x${Math.random()}`, strike: 5400, optSide: "CE", entry: 150, targets: [160, 165, 170], stop: 140, targetsHit: [false, false, false], status: "running", closed: false, openedAt: NOW - 3600_000, closedAt: null, ...p });
  const stop = (p: Partial<TradeLogEntry> = {}) => e({ status: "sl_hit", closed: true, closedAt: NOW - 3600_000, ...p });

  test("one call at a time", () => {
    expect(liteGuard([], "CE", "CRUDEOIL", NOW)).toMatchObject({ ok: true, callsToday: 0 });
    expect(liteGuard([e({})], "PE", "CRUDEOIL", NOW)).toMatchObject({ ok: false, reason: expect.stringMatching(/one at a time/) });
  });

  test("Rs 2,000 booked ends the day", () => {
    const won = e({ status: "target3_hit", closed: true, closedAt: NOW - 600_000 }); // (170 - 150) x 100
    expect(liteGuard([won], "CE", "CRUDEOIL", NOW)).toMatchObject({ ok: false, bookedRs: 2000, reason: expect.stringMatching(/Day goal done/) });
    const half = e({ status: "stopped_after_t1", closed: true, closedAt: NOW - 600_000 }); // +Rs 1,000
    expect(liteGuard([half], "CE", "CRUDEOIL", NOW)).toMatchObject({ ok: true, bookedRs: 1000 });
  });

  test("2 stop-losses end the day; yesterday's do not count", () => {
    expect(liteGuard([stop(), stop({ optSide: "PE" })], "CE", "CRUDEOIL", NOW)).toMatchObject({ ok: false, stopsToday: 2, reason: expect.stringMatching(/2 stop-losses today/) });
    const y = NOW - 86_400_000;
    expect(liteGuard([stop({ openedAt: y, closedAt: y }), stop({ openedAt: y, closedAt: y })], "CE", "CRUDEOIL", NOW)).toMatchObject({ ok: true, stopsToday: 0 });
  });

  test("15-minute pause on the same side after a stop-loss; the other side may go", () => {
    const fresh = stop({ closedAt: NOW - 5 * 60_000 });
    expect(liteGuard([fresh], "CE", "CRUDEOIL", NOW)).toMatchObject({ ok: false, reason: expect.stringMatching(/15-minute pause/) });
    expect(liteGuard([fresh], "PE", "CRUDEOIL", NOW).ok).toBe(true);
    expect(liteGuard([stop({ closedAt: NOW - 16 * 60_000 })], "CE", "CRUDEOIL", NOW).ok).toBe(true);
  });

  test("the call entry: bought at the live premium, id and time from the signal candle", () => {
    const choice: StrikeChoice = { strike: 5400, ltp: 150, delta: 0.55, deltaKnown: true, oi: 1000, volume: 100, inMoney: 1, daysToExpiry: 20, why: "liquid" };
    const read: LiteRead = { state: "call", signal: { side: "CE", kind: "breakout", lean: "CE", checks: [] }, barEnd: NOW, fut: 5400 };
    const entry = openLiteEntry(choice, "CE", "CRUDEOIL", read);
    expect(entry).toMatchObject({ id: `5400-CE-${NOW}`, openedAt: NOW, entry: 150, stop: 140, targets: [160, 165, 170], status: "running" });
    expect(entry.meta?.label).toBe("Ai Lite · Breakout CE");
  });

  test("the call log sits under the LITE report prefix", () => {
    const eng = ENGINES.find((x) => x.id === "lite");
    expect(eng).toMatchObject({ prefix: "LITE", route: "/ai-lite" });
    expect(liteKey("NATURALGAS")).toBe("LITE-NATURALGAS");
  });
});

/** A seeded random walk of 5-minute crude candles with trending spells, weekdays 9:00-23:55 IST. */
function walk(days: number, seed: number): Candle[] {
  let s = seed;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const out: Candle[] = [];
  let px = 5400;
  let drift = 0;
  for (let d = 0, n = 0; n < days; d++) {
    const day0 = DAY + d * 86_400_000;
    const wd = new Date(day0 + IST).getUTCDay();
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
      out.push({ date: new Date(day0 + m * 60_000).toISOString(), open: o, high: h, low: l, close: px, volume: 1000 });
    }
  }
  return out;
}

describe("Ai Lite: live = lab", () => {
  test("the live read calls on exactly the candles where the 10-year replay opened its trades", () => {
    const c5 = walk(6, 11);
    const c15 = resampleCandles(c5, 15);
    const trades = simulateLite(c5, "CRUDEOIL").filter((t) => c15.filter((k) => Date.parse(k.date) + M15 <= t.openAt + 5 * 60_000).length >= 40);
    expect(trades.length).toBeGreaterThan(2);
    for (const t of trades) {
      const barEnd = t.openAt + 5 * 60_000;
      const now = barEnd + 20_000;
      // What the server sees 20 seconds after the candle: everything so far, plus the new candle just starting.
      const read = readLite(c15.filter((k) => Date.parse(k.date) < now), now);
      expect(read).toMatchObject({ state: "call", barEnd });
      expect(read.signal).toMatchObject({ side: t.side, kind: t.kind });
    }
  });

  test("not enough candles reads no data; an old candle reads stale, never a call", () => {
    const c15 = resampleCandles(walk(2, 5), 15);
    const at = (n: number) => Date.parse(c15[n].date);
    expect(readLite(c15.slice(0, 40), at(39) + 5 * 60_000).state).toBe("no_data"); // the 40th is still forming
    const live = readLite(c15.slice(0, 40), at(39) + M15 + 60_000);
    expect(["call", "watch"]).toContain(live.state);
    expect(live.barEnd).toBe(at(39) + M15);
    expect(readLite(c15.slice(0, 40), at(39) + M15 + 16 * 60_000).state).toBe("stale");
  });
});
