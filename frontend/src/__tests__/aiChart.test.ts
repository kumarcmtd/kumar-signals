import { describe, expect, test } from "vitest";
import type { Candle } from "../types";
import type { TradeLogEntry } from "../utils/tradeLogCore";
import { chartLevels, findSrLevels } from "../utils/srLevels";
import { callMarks, callResult, pageOfKey } from "../utils/callMarks";

const T0 = Date.parse("2026-11-02T09:00:00+05:30");
const M30 = 30 * 60_000;

/**
 * 30-minute candles that swing between a floor at 100 and a ceiling at 120:
 * each leg walks 2 points a candle, so every turn is a clear reversal.
 * `floors` / `ceilings` say how many times each is reached.
 */
function swings(floors: number, ceilings: number): Candle[] {
  const out: Candle[] = [];
  let px = 110;
  const leg = (to: number) => {
    while (Math.abs(to - px) > 0.01) {
      const o = px;
      px += Math.sign(to - px) * Math.min(2, Math.abs(to - px));
      out.push({ date: new Date(T0 + out.length * M30).toISOString(), open: o, high: Math.max(o, px) + 0.2, low: Math.min(o, px) - 0.2, close: px, volume: 100 });
    }
  };
  const n = Math.max(floors, ceilings);
  for (let k = 0; k < n; k++) {
    leg(k < floors ? 100 : 104);
    leg(k < ceilings ? 120 : 116);
  }
  leg(110);
  return out;
}

describe("support and rejection levels", () => {
  test("a floor price turned at 4 times is strong support; a ceiling hit twice is weak resistance", () => {
    const c = swings(4, 2);
    const lv = findSrLevels(c, 110);
    const floor = lv.find((l) => Math.abs(l.price - 99.8) < 1);
    const ceiling = lv.find((l) => Math.abs(l.price - 120.2) < 1);
    expect(floor).toMatchObject({ kind: "support", tier: "strong", holds: 4 });
    expect(ceiling).toMatchObject({ kind: "resistance", tier: "weak", holds: 2 });
  });

  test("a level counts as support or resistance by where price is now", () => {
    const c = swings(3, 3);
    expect(findSrLevels(c, 125).every((l) => l.kind === "support")).toBe(true);
    expect(findSrLevels(c, 95).every((l) => l.kind === "resistance")).toBe(true);
  });

  test("a single turn is not a level, and too few candles give none", () => {
    const c = swings(1, 1);
    expect(findSrLevels(c, 110)).toEqual([]);
    expect(findSrLevels(c.slice(0, 20), 110)).toEqual([]);
  });

  test("the chart draws the nearest levels per side and tier, within reach", () => {
    const mk = (price: number, kind: "support" | "resistance", tier: "strong" | "weak") => ({ price, kind, tier, holds: 3, lastHeld: "" });
    const all = [mk(99, "support", "strong"), mk(95, "support", "strong"), mk(90, "support", "strong"), mk(40, "support", "strong"), mk(101, "resistance", "weak")];
    const shown = chartLevels(all, 100, 20);
    expect(shown.map((l) => l.price)).toEqual([99, 95, 101]);
  });
});

describe("call stars", () => {
  const candles: Candle[] = Array.from({ length: 10 }, (_, i) => ({ date: new Date(T0 + i * 15 * 60_000).toISOString(), open: 7500 + i, high: 7510 + i, low: 7490 + i, close: 7505 + i, volume: 1 }));
  const e = (id: string, openedAt: number, side: "CE" | "PE", extra: Partial<TradeLogEntry> = {}): TradeLogEntry => ({ id, strike: 7500, optSide: side, entry: 180, targets: [190, 195, 200], stop: 170, targetsHit: [false, false, false], status: "running", closed: false, openedAt, closedAt: null, ...extra });

  test("each page's calls get the page's name, at the futures price of the candle that had just finished", () => {
    const at = T0 + 3 * 15 * 60_000 + 60_000; // 1 minute into the 4th candle
    const logs = {
      "TWENTY20-CRUDEOIL-LIVE": [e("a", at, "CE")],
      "LITE-CRUDEOIL": [e("b", at, "PE", { practice: true })],
      "CRUDEOIL-15": [e("c", at, "CE")],
      "TWENTY20-NATURALGAS-LIVE": [e("d", at, "CE")],
      "LITE-CRUDEOIL-old": [e("x", T0 - 86_400_000, "CE")],
    };
    const marks = callMarks(logs, "CRUDEOIL", candles, 15 * 60_000);
    expect(marks.map((m) => [m.tag, m.side, m.practice])).toEqual([
      ["Ai20", "CE", false],
      ["Ai Lite", "PE", true],
      ["Test V2", "CE", false],
    ]);
    // The 3rd candle (index 2) had just finished: its close.
    expect(marks[0]).toMatchObject({ price: 7507, barTime: T0 + 2 * 15 * 60_000 });
  });

  test("pages are named, unknown keys are not drawn", () => {
    expect(pageOfKey("TWENTY20-CRUDEOIL-LIVE")).toMatchObject({ page: "Ai20-20", tag: "Ai20", route: "/ai-20-20" });
    expect(pageOfKey("SUPERFAST-CRUDEOIL-FAST")).toMatchObject({ tag: "Fast" });
    expect(pageOfKey("SOMETHING-ELSE")).toBeNull();
  });

  test("the result reads in rupees a lot", () => {
    const m = callMarks({ "LITE-CRUDEOIL": [e("w", T0 + 20 * 60_000, "CE", { closed: true, status: "target3_hit", exitPrice: 200 })] }, "CRUDEOIL", candles, 15 * 60_000)[0];
    expect(callResult(m, "CRUDEOIL")).toEqual({ text: "Target 3 hit", rs: 2000, tone: "win" });
  });
});
