import { describe, expect, test } from "vitest";
import type { Candle } from "../types";
import type { TradeLogEntry } from "../utils/tradeLogCore";
import { chartLevels, findSrLevels } from "../utils/srLevels";
import { callMarks, callResult, pageOfKey, pageScores } from "../utils/callMarks";
import { spreadStars, STAR_R } from "../components/aichart/primitives";

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
    expect(pageOfKey("BEST-NATURALGAS")).toMatchObject({ page: "Best Call", tag: "Best Call", route: "/best-call" });
    expect(pageOfKey("SOMETHING-ELSE")).toBeNull();
  });

  test("each page has its letter for the star: B Best Call, 20 Ai20-20, L Ai Lite, T Ai-Today", () => {
    expect(pageOfKey("BEST-CRUDEOIL")?.code).toBe("B");
    expect(pageOfKey("TWENTY20-CRUDEOIL-LIVE")?.code).toBe("20");
    expect(pageOfKey("LITE-NATURALGAS")?.code).toBe("L");
    expect(pageOfKey("TODAY-CRUDEOIL-15")?.code).toBe("T");
    expect(pageOfKey("CRUDEOIL-15")?.code).toBe("V2");
    expect(pageOfKey("SUPERFAST-CRUDEOIL-FAST")?.code).toBe("F");
  });

  test("old Ai20-20 rule logs are not drawn as Ai20 calls -- the page's report leaves them out too", () => {
    expect(pageOfKey("TWENTY20-CRUDEOIL-V3")).toBeNull();
    expect(pageOfKey("TWENTY20-CRUDEOIL-SEASON")).toBeNull();
    const at = T0 + 3 * 15 * 60_000 + 60_000;
    expect(callMarks({ "TWENTY20-CRUDEOIL-V2": [e("v", at, "CE")] }, "CRUDEOIL", candles, 15 * 60_000)).toEqual([]);
  });

  test("stars that would sit on one another are stacked: CE upwards, PE downwards", () => {
    const r = STAR_R;
    expect(spreadStars([{ x: 100, y: 100, side: "CE", r }, { x: 100, y: 100, side: "CE", r }, { x: 100, y: 100, side: "PE", r }])).toEqual([0, -(2 * r + 1), 2 * r + 1]);
    // Far apart: nothing moves.
    expect(spreadStars([{ x: 100, y: 100, side: "CE", r }, { x: 160, y: 100, side: "PE", r }])).toEqual([0, 0]);
  });

  test("each page's success rate on this market, counted like its trade report", () => {
    const D = 86_400_000;
    const now = T0 + 40 * D;
    // Each call an hour long, two hours apart -- calls on one strike that overlap are one call (a second phone's copy).
    let slot = 0;
    const done = (id: string, status: TradeLogEntry["status"], daysAgo: number) => {
      const closedAt = now - daysAgo * D - slot++ * 7_200_000;
      return e(id, closedAt - 3_600_000, "CE", { status, closed: true, closedAt });
    };
    const won = (n: number, tag: string) => Array.from({ length: n }, (_, i) => done(`${tag}w${i}`, "target3_hit", 1));
    const lost = (n: number, tag: string) => Array.from({ length: n }, (_, i) => done(`${tag}l${i}`, "sl_hit", 2));
    const logs: Record<string, TradeLogEntry[]> = {
      // Best Call: 3 won (one at T2, out at T1), 7 stopped, 1 out at entry after T1 (not counted), 1 running.
      "BEST-CRUDEOIL": [...won(2, "b"), done("bt2", "stopped_after_t1", 1), ...lost(7, "b"), done("bbe", "stopped_breakeven", 1), e("brun", now - 60_000, "PE")],
      // Ai20-20: 6 of 10 won; one more from 35 days ago is outside 30 days.
      "TWENTY20-CRUDEOIL-LIVE": [...won(6, "t"), ...lost(4, "t"), done("old", "target3_hit", 35)],
      // Ai Lite: 1 lucky win -- too few to rank above pages with a real record.
      "LITE-CRUDEOIL": [done("l1", "target3_hit", 1)],
      // Other market and old Ai20-20 rule logs: not counted.
      "BEST-NATURALGAS": [...won(5, "n")],
      "TWENTY20-CRUDEOIL-V3": [...lost(9, "v")],
    };
    const s = pageScores(logs, "CRUDEOIL", now - 30 * D);
    expect(s.map((p) => [p.code, p.winPct, p.won, p.stopped, p.running])).toEqual([
      ["20", 60, 6, 4, 0],
      ["B", 30, 3, 7, 1],
      ["L", 100, 1, 0, 0],
    ]);
    // All time: the 35-day-old Ai20-20 win counts too.
    expect(pageScores(logs, "CRUDEOIL", null)[0]).toMatchObject({ code: "20", won: 7, stopped: 4, winPct: 64 });
  });

  test("the result reads in rupees a lot", () => {
    const m = callMarks({ "LITE-CRUDEOIL": [e("w", T0 + 20 * 60_000, "CE", { closed: true, status: "target3_hit", exitPrice: 200 })] }, "CRUDEOIL", candles, 15 * 60_000)[0];
    expect(callResult(m, "CRUDEOIL")).toEqual({ text: "Target 3 hit", rs: 2000, tone: "win" });
  });
});
