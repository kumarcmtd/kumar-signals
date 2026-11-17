import { describe, expect, test } from "vitest";
import { isOwnKey, ownLogs, projectPremium } from "../components/aiTest/kit";
import { ENGINES } from "../utils/aiEdgeEngine";
import { buildPageReport, readReportPeriod, saveReportPeriod } from "../utils/pageReport";
import type { TimeframeAnalysis } from "../utils/timeframeEngine";
import type { OptionsAnalytics } from "../types";
import type { TradeLogEntry } from "../store/appStore";

const chain = (over: Partial<OptionsAnalytics> = {}): OptionsAnalytics =>
  ({
    symbol: "CRUDEOIL",
    atmStrike: 5400,
    spot: 5400,
    expiry: "2026-11-24",
    rows: [5350, 5400, 5450].map((strike) => ({ strike, call: { ltp: strike === 5400 ? 100 : 80, delta: 0.5 }, put: { ltp: strike === 5400 ? 90 : 70, delta: -0.5 } })),
    ...over,
  }) as unknown as OptionsAnalytics;

const read = (over: Partial<TimeframeAnalysis>): TimeframeAnalysis =>
  ({ tf: "60", label: "1 Hour", optSide: "CE", underlyingEntry: 5400, underlyingStop: 5380, underlyingTargets: [5430, 5450, 5480], ...over }) as TimeframeAnalysis;

describe("AI-Test V2 kit", () => {
  test("a call opens at the live ATM premium with delta-0.5 targets and stop (unchanged maths)", () => {
    expect(projectPremium(read({}), chain())).toEqual({ strike: 5400, optSide: "CE", entry: 100, targets: [115, 125, 140], stop: 90, rr: 1.5 });
    // Put side uses the put's premium; the stop never goes below 35% of the entry.
    expect(projectPremium(read({ optSide: "PE", underlyingStop: 5600 }), chain())).toMatchObject({ optSide: "PE", entry: 90, stop: 31.5 });
  });

  test("no live premium, no side or no levels: no call is opened", () => {
    expect(projectPremium(read({ optSide: null }), chain())).toBeNull();
    expect(projectPremium(read({ underlyingTargets: null }), chain())).toBeNull();
    expect(projectPremium(read({}), chain({ error: "down" } as Partial<OptionsAnalytics>))).toBeNull();
    expect(projectPremium(read({}), undefined)).toBeNull();
  });

  test("only this page's own '<SYMBOL>-<minutes>' lines count as its calls", () => {
    for (const k of ["CRUDEOIL-15", "NATURALGAS-240"]) expect(isOwnKey(k)).toBe(true);
    for (const k of ["ELITE-CRUDEOIL", "KUMARAI-CRUDEOIL-15", "TWENTY20-CRUDEOIL-V3", "CRUDEOIL-15-X"]) expect(isOwnKey(k)).toBe(false);
    const e = { id: "a", strike: 5400, optSide: "CE", entry: 100, targets: [106, 110, 115], stop: 94, targetsHit: [true, true, true], status: "target3_hit", closed: true, openedAt: Date.now() - 7200e3, closedAt: Date.now() - 3600e3, exitPrice: 115 } as TradeLogEntry;
    const logs = { "CRUDEOIL-15": [e], "ELITE-CRUDEOIL": [{ ...e, id: "b" }] };
    expect(Object.keys(ownLogs(logs))).toEqual(["CRUDEOIL-15"]);
    // The results strip's numbers come from the same report every page uses.
    const r = buildPageReport(logs, ENGINES.find((x) => x.id === "aitest")!, { period: "30d", market: "ALL" });
    expect(r.closed).toBe(1);
    expect(r.won).toBe(1);
  });

  test("the shared report period falls back to 30 days where storage is unavailable", () => {
    expect(() => saveReportPeriod("7d")).not.toThrow();
    expect(["30d", "7d"]).toContain(readReportPeriod());
  });
});
