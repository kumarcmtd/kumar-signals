import { expect, test } from "vitest";
import { marketPicture } from "../utils/marketPicture";
import { pickBest, type TfCall } from "../utils/todayPick";
import { projectCall } from "../hooks/useTodayFocus";
import type { Candle, OptionsAnalytics } from "../types";
import type { TimeframeAnalysis } from "../utils/timeframeEngine";
import type { TradeLogEntry } from "../utils/tradeLogCore";

const daily = (closes: number[]): Candle[] =>
  closes.map((c, i) => ({ date: new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10) + "T00:00:00+05:30", open: c, high: c + 0.05, low: c - 0.05, close: c }));

test("a close at a many-month low reads as a reversal watch favouring CE", () => {
  const closes = Array.from({ length: 500 }, (_, i) => 5 - i * 0.004); // a 2-year slide to its low today
  const p = marketPicture(daily(closes))!;
  expect(p.tone).toBe("reversal_up_watch");
  expect(p.favour).toBe("CE");
  expect(p.lowestInMonths).toBeGreaterThan(20);
  expect(p.headline).toMatch(/Lowest close in/);
  expect(p.positionPct).toBeLessThan(5);
});

test("a run-up top reads as a pullback watch favouring PE; mid-range sideways favours nothing", () => {
  const up = marketPicture(daily(Array.from({ length: 200 }, (_, i) => 60 + i * 0.1)))!;
  expect(up.tone).toBe("reversal_down_watch");
  expect(up.favour).toBe("PE");
  const flat = marketPicture(daily(Array.from({ length: 200 }, (_, i) => 70 + Math.sin(i / 3) * 5 + (i === 199 ? 0 : 0))))!;
  expect(["range", "trend_up", "trend_down"]).toContain(flat.tone);
});

const entry = (side: "CE" | "PE"): TradeLogEntry => ({ id: "x", strike: 300, optSide: side, entry: 10, targets: [11, 12, 13], stop: 9, targetsHit: [false, false, false], status: "running", closed: false, openedAt: 0, closedAt: null });
const call = (tf: string, side: "CE" | "PE" | null, winRate: number | null, closed: number, higher: ("CE" | "PE" | null)[]): TfCall => ({
  tf,
  short: tf,
  entry: side ? entry(side) : null,
  record: { closed, wins: 0, losses: 0, winRate },
  higherSides: higher,
});

test("best timeframe: proven record + agreeing with higher timeframes wins; a call against both is avoided", () => {
  const p = pickBest([call("5", "PE", 70, 30, ["CE", "CE"]), call("15", "CE", 48, 20, ["CE", "CE"]), call("60", null, 50, 20, ["CE"])], "CE")!;
  expect(p.tf).toBe("15");
  expect(p.reasons.join(" ")).toMatch(/agrees with the higher timeframes/);
  expect(pickBest([call("5", null, null, 0, [])], null)).toBeNull();
});

test("option pricing uses the leg's delta, and the stop never below 35% of the premium", () => {
  const a = { optSide: "CE", underlyingEntry: 300, underlyingStop: 296, underlyingTargets: [304, 308, 312] } as unknown as TimeframeAnalysis;
  const options = { atmStrike: 300, rows: [{ strike: 300, call: { ltp: 10, delta: 0.6 }, put: { ltp: 9, delta: -0.4 } }] } as unknown as OptionsAnalytics;
  expect(projectCall(a, options)).toEqual({ strike: 300, optSide: "CE", entry: 10, targets: [12.4, 14.8, 17.2], stop: 7.6 });
});

test("your plan: crude trades only when 5m, 10m and 15m all agree; gas only the 1h with the 4h not against", async () => {
  const { planVerdict } = await import("../utils/playbook");
  const r = (tf: string, optSide: "CE" | "PE" | null, decision: "STRONG BUY" | "BUY" | "WATCH BUY" | "WAIT" = "BUY") => ({ tf, optSide, decision });
  const all = planVerdict("CRUDEOIL", [r("5", "CE"), r("10", "CE", "STRONG BUY"), r("15", "CE")]);
  expect(all).toMatchObject({ trade: true, side: "CE", agree: 3 });
  expect(planVerdict("CRUDEOIL", [r("5", "CE"), r("10", "CE"), r("15", "CE", "WATCH BUY")]).trade).toBe(false); // risky buy doesn't count
  expect(planVerdict("CRUDEOIL", [r("5", "PE"), r("10", "CE"), r("15", "CE")]).headline).toMatch(/2 of 3/);
  expect(planVerdict("NATURALGAS", [r("60", "CE"), r("240", "CE")]).trade).toBe(true);
  expect(planVerdict("NATURALGAS", [r("60", "CE"), r("240", "PE")]).headline).toMatch(/4h PE/);
  expect(planVerdict("NATURALGAS", [r("60", "CE"), r("240", null)], { closed: 20, wins: 5, losses: 15, winRate: 25 }).trade).toBe(false);
  expect(planVerdict("NATURALGAS", [r("60", null), r("240", "CE")]).trade).toBe(false);
});

test("today's live price moves the picture: a break below the old low shows as 0% and a fresh low", () => {
  const closes = Array.from({ length: 110 }, (_, i) => 300 - Math.sin(i / 9) * 30 - i * 0.2); // ends near its low
  const d = daily(closes);
  const old = marketPicture(d, null, Date.parse("2024-06-01T12:00:00Z"))!;
  const live = marketPicture(d, Math.min(...d.map((k) => k.low)) - 7, Date.parse("2024-06-01T12:00:00Z"))!;
  expect(live.positionPct).toBe(0);
  expect(live.rangeLow).toBeLessThan(old.rangeLow);
  expect(live.tone).toBe("reversal_up_watch");
});
