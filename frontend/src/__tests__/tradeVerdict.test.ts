import { expect, test } from "vitest";
import { findZones } from "../utils/zones";
import { readCandle, tradeVerdict, type TradeVerdict } from "../utils/tradeVerdict";
import { holdVerdict } from "../hooks/useTradeVerdict";
import type { NewsPulse } from "../utils/newsPulse";
import type { Candle } from "../types";

const pad = (n: number) => String(n).padStart(2, "0");
/** Candles from 09:00 IST on `day`, `tf` minutes apart; `move(i)` = close - open; volume from `vol(i)`. */
function bars(day: string, tf: number, n: number, move: (i: number) => number, start: number, vol: (i: number) => number = () => 1000): Candle[] {
  const out: Candle[] = [];
  let p = start;
  for (let i = 0; i < n; i++) {
    const m = 9 * 60 + i * tf;
    const o = p;
    const c = p + move(i);
    out.push({ date: `${day}T${pad(Math.floor(m / 60))}:${pad(m % 60)}:00+05:30`, open: o, high: Math.max(o, c) + 0.1, low: Math.min(o, c) - 0.1, close: c, volume: vol(i) });
    p = c;
  }
  return out;
}
const flat = (i: number) => (i % 2 ? 0.3 : -0.3);
const after5 = (n: number) => Date.parse("2026-10-13T09:00:00+05:30") + n * 5 * 60_000 + 60_000;
const close = (c: Candle[]) => c[c.length - 1].close;

// 15-minute history (the day before): flat ~100, a drop to ~95 and a hard
// rally to ~104 (buyers at 95), then on to ~110 and a hard drop (sellers at 110).
const c15Trend = bars("2026-10-12", 15, 60, (i) => (i < 20 ? flat(i) : i < 25 ? -1 : i < 31 ? 1.5 : i < 41 ? flat(i) : i < 46 ? 1.2 : i < 51 ? -1.5 : flat(i)), 100);
// 15-minute history ending just above the 95 buyer zone.
const c15Near = bars("2026-10-12", 15, 48, (i) => (i < 20 ? flat(i) : i < 25 ? -1 : i < 31 ? 1.5 : i < 38 ? -1 : flat(i)), 100);

const BUY_CE = { verdict: "BUY_CE", side: "CE", strength: 81 } as const;
const news = (net: number): NewsPulse => ({ net, direction: net > 10 ? "bullish" : net < -10 ? "bearish" : "neutral", highImpactFresh: 0, top: null, feedAgeMin: 2, available: true });

test("zones: buyers where price rallied hard from, sellers where it dropped hard from", () => {
  const z = findZones(c15Trend)!;
  expect(z.buyer[0].low).toBeGreaterThan(94.5);
  expect(z.buyer[0].high).toBeLessThan(96.5);
  expect(z.seller[0].high).toBeGreaterThan(109.5);
  expect(z.seller[0].departureAtr).toBeGreaterThanOrEqual(1.5);
});

test("readCandle: body, close near the high, volume vs average", () => {
  const c = bars("2026-10-13", 5, 25, (i) => (i < 24 ? flat(i) : 0.4), 100, (i) => (i < 24 ? 1000 : 2000));
  const r = readCandle(c)!;
  expect(r).toMatchObject({ dir: "up", strong: true, volumeRatio: 2 });
});

test("all five checks pass on a steady up run with a strong, high-volume candle -> TRADE CE", () => {
  const c5 = bars("2026-10-13", 5, 36, (i) => (i < 30 ? flat(i) : 0.2), close(c15Trend), (i) => (i < 35 ? 1000 : 2000));
  const v = tradeVerdict({ result: BUY_CE, c5, c15: c15Trend, news: news(40), now: after5(36), marketOpen: true });
  expect(v.action).toBe("TRADE_CE");
  expect(v.passed).toBe(5);
  expect(v.stop!).toBeLessThan(close(c5));
  expect(v.t1!).toBeGreaterThan(109);
});

test("trend up but the 5-min candles are falling -> WAIT for the pullback, not TRADE", () => {
  const c5 = bars("2026-10-13", 5, 36, (i) => (i < 30 ? flat(i) : -0.4), close(c15Trend));
  const v = tradeVerdict({ result: BUY_CE, c5, c15: c15Trend, news: news(73), now: after5(36), marketOpen: true });
  expect(v.action).toBe("WAIT_CE");
  expect(v.headline).toMatch(/WAIT/);
});

test("pullback into the buyer zone and a strong green candle off it -> TRADE CE (bounce)", () => {
  const start = close(c15Near);
  const c5 = bars("2026-10-13", 5, 34, (i) => (i < 30 ? flat(i) : i < 33 ? -0.5 : 0.6), start, (i) => (i < 33 ? 1000 : 1800));
  const v = tradeVerdict({ result: BUY_CE, c5, c15: c15Near, news: news(20), now: after5(34), marketOpen: true });
  expect(v.action).toBe("TRADE_CE");
  expect(v.reason).toMatch(/buyer zone/);
});

test("same pullback but a weak candle -> WAIT with the buyer zone price", () => {
  const start = close(c15Near);
  const c5 = bars("2026-10-13", 5, 34, (i) => (i < 30 ? flat(i) : i < 33 ? -0.5 : 0.1), start);
  const v = tradeVerdict({ result: BUY_CE, c5, c15: c15Near, news: news(20), now: after5(34), marketOpen: true });
  expect(v.action).toBe("WAIT_CE");
  expect(v.entryZone!.low).toBeGreaterThan(94.5);
});

test("news strongly against the chart -> AVOID; no trend -> AVOID sideways; closed market", () => {
  const c5 = bars("2026-10-13", 5, 36, (i) => (i < 30 ? flat(i) : 0.4), close(c15Trend), (i) => (i < 35 ? 1000 : 2000));
  const base = { c5, c15: c15Trend, now: after5(36), marketOpen: true };
  expect(tradeVerdict({ ...base, result: BUY_CE, news: news(-60) }).headline).toBe("AVOID — NEWS vs CHART");
  expect(tradeVerdict({ ...base, result: { verdict: "WAIT", side: null, strength: 30 }, news: null }).headline).toBe("AVOID — SIDEWAYS");
  expect(tradeVerdict({ ...base, result: BUY_CE, news: null, marketOpen: false }).action).toBe("CLOSED");
});

test("the card never jumps UP within one candle, but may get safer at once", () => {
  const v = (action: TradeVerdict["action"], basedOn: string) => ({ action, basedOn }) as TradeVerdict;
  const waiting = holdVerdict(undefined, v("WAIT_CE", "10:30"));
  expect(holdVerdict(waiting, v("TRADE_CE", "10:30")).v.action).toBe("WAIT_CE"); // no flick to green mid-candle
  expect(holdVerdict(waiting, v("AVOID", "10:30")).v.action).toBe("AVOID"); // safer, at once
  const next = holdVerdict(waiting, v("TRADE_CE", "10:35"));
  expect(next.v.action).toBe("TRADE_CE");
  expect(next.since).toBe("10:35");
  expect(holdVerdict(next, v("TRADE_CE", "10:40")).since).toBe("10:35");
});
