import { expect, test } from "vitest";
import { advanceCall, cardStats, maybeOpen, type CardCall } from "../utils/tradeCardLog";
import type { Candle } from "../types";

const at = (m: number) => `2026-10-14T${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}:00+05:30`;
const bar = (m: number, o: number, h: number, l: number, c: number): Candle => ({ date: at(m), open: o, high: h, low: l, close: c });
const trade = { action: "TRADE_CE", side: "CE" as const, stop: 98, t1: 106, reason: "all pass" };

function opened(): CardCall {
  return maybeOpen([], "CRUDEOIL", trade, bar(600, 99.5, 100.2, 99.4, 100))[0];
}

test("a TRADE verdict opens one call at the candle's close; WAIT and duplicates do not", () => {
  const c = opened();
  expect(c).toMatchObject({ side: "CE", entry: 100, stop: 98, t1: 106, closed: false });
  expect(Date.parse(c.openedAt)).toBe(Date.parse(at(605)));
  expect(maybeOpen([], "CRUDEOIL", { ...trade, action: "WAIT_CE" }, bar(600, 99, 100, 99, 100))).toHaveLength(0);
  expect(maybeOpen([c], "CRUDEOIL", trade, bar(610, 100, 101, 99, 101))).toHaveLength(1); // one open at a time
});

test("target first is a win, stop first a loss, a candle touching both counts as a loss", () => {
  const win = advanceCall(opened(), [bar(605, 100, 103, 99.5, 102), bar(610, 102, 106.5, 101, 106)], false);
  expect(win).toMatchObject({ closed: true, result: "target", exit: 106, pnlPts: 6, r: 3 });
  const loss = advanceCall(opened(), [bar(605, 100, 100.5, 97.5, 98)], false);
  expect(loss).toMatchObject({ result: "stop", pnlPts: -2, r: -1 });
  const both = advanceCall(opened(), [bar(605, 100, 107, 97, 101)], false);
  expect(both.result).toBe("stop");
  // The candle the call was based on never counts against it.
  expect(advanceCall(opened(), [bar(600, 99.5, 100.2, 90, 100)], false).closed).toBe(false);
});

test("neither by the close -> closed at the last price; stats add up", () => {
  const timed = advanceCall(opened(), [bar(605, 100, 101, 99.5, 101), bar(610, 101, 102, 100.5, 101.5)], true);
  expect(timed).toMatchObject({ result: "day_end", exit: 101.5, pnlPts: 1.5, r: 0.75 });
  const loss = advanceCall(opened(), [bar(605, 100, 100.5, 97.5, 98)], false);
  const s = cardStats([timed, loss, opened()]);
  expect(s).toMatchObject({ calls: 3, closed: 2, wins: 1, losses: 1, open: 1, winRate: 50, totalR: -0.25, totalPts: -0.5 });
});
