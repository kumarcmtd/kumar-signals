import { expect, test } from "vitest";
import { keyLevels, macdDivergence, marketChecklist } from "../utils/checklist";
import type { TradeVerdict } from "../utils/tradeVerdict";
import type { Candle } from "../types";

const pad = (n: number) => String(n).padStart(2, "0");
/** 15-min candles across days: `perDay` candles from 09:00 each day. */
function days(nDays: number, perDay: number, move: (i: number) => number, start = 100): Candle[] {
  const out: Candle[] = [];
  let p = start;
  let i = 0;
  for (let d = 0; d < nDays; d++) {
    for (let k = 0; k < perDay; k++, i++) {
      const m = 9 * 60 + k * 15;
      const o = p;
      const c = p + move(i);
      out.push({ date: `2026-10-${pad(10 + d)}T${pad(Math.floor(m / 60))}:${pad(m % 60)}:00+05:30`, open: o, high: Math.max(o, c) + 0.2, low: Math.min(o, c) - 0.2, close: c, volume: 1000 });
      p = c;
    }
  }
  return out;
}
const hourly = (c: Candle[]) => c.filter((_, i) => i % 4 === 3);
const verdict = (over: Partial<TradeVerdict> = {}) =>
  ({ action: "TRADE_CE", side: "CE", checks: [], stop: null, t1: null, buyerZone: null, sellerZone: null, newsSide: "with", ...over }) as TradeVerdict;

test("key levels come from the previous session's high, low and close", () => {
  const c = days(2, 10, (i) => (i < 10 ? 1 : -0.5));
  const lv = keyLevels(c)!;
  expect(lv.pdh).toBeCloseTo(110.2, 1);
  expect(lv.pdc).toBe(110);
  expect(lv.r1).toBeGreaterThan(lv.pivot);
  expect(lv.s1).toBeLessThan(lv.pivot);
});

test("bearish MACD divergence: a higher high on weaker momentum warns a CE", () => {
  // strong rally, pullback, then a slow grind to a marginally higher high
  const c = days(1, 80, (i) => (i < 40 ? 0 : i < 55 ? 1.5 : i < 68 ? -1 : 1.2));
  expect(macdDivergence(c, "CE")).toBe(true);
  const clean = days(1, 80, (i) => (i < 40 ? 0 : 0.5));
  expect(macdDivergence(clean, "CE")).toBe(false);
});

test("RSI above 70 blocks a CE (don't chase); 1-hour EMA stack is read", () => {
  const c15 = days(6, 40, (i) => (i < 200 ? (i % 2 ? 0.3 : -0.25) : 0.6));
  const now = Date.parse("2026-10-15T19:20:00+05:30");
  const mc = marketChecklist({ symbol: "CRUDEOIL", v: verdict(), c15, c60: hourly(c15), now });
  const rsiItem = mc.sections[1].items.find((i) => i.id === "rsi")!;
  expect(rsiItem.state).toBe("fail");
  expect(rsiItem.text).toMatch(/overbought/);
  expect(mc.sections[0].items.find((i) => i.id === "h1")!.text).toMatch(/Long bias/);
  expect(mc.ok).toBe(false);
});

test("EIA within 2 hours fails the news filter; the plan's stop is at least 1.5x ATR", () => {
  const c15 = days(3, 40, (i) => (i % 2 ? 0.3 : -0.3));
  // Wed 14 Oct 2026 19:00 IST -- crude EIA at 20:00 IST
  const now = Date.parse("2026-10-14T19:00:00+05:30");
  const c = c15.map((x) => ({ ...x, date: x.date.replace("2026-10-12", "2026-10-14").replace("2026-10-11", "2026-10-13").replace("2026-10-10", "2026-10-12") }));
  const mc = marketChecklist({ symbol: "CRUDEOIL", v: verdict({ stop: 99.9, t1: 104 }), c15: c, c60: hourly(c), now });
  expect(mc.sections[4].items.find((i) => i.id === "eia")!.state).toBe("fail");
  expect(mc.plan!.stop).toBeLessThanOrEqual(mc.plan!.atrStop);
});
