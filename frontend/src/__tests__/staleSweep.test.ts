import { describe, expect, test } from "vitest";
import { sessionCloseFor, sweepStaleRunning, STALE_GRACE_MS, type TradeLogEntry } from "../utils/tradeLogCore";
import { exitPriceFor } from "../utils/tradeLogPnl";

const ist = (s: string) => Date.parse(`${s}+05:30`);
const run = (openedAt: number, over: Partial<TradeLogEntry> = {}): TradeLogEntry => ({
  id: `x-${openedAt}`,
  strike: 8800,
  optSide: "CE",
  entry: 745.5,
  targets: [765.5, 777.5, 790.5],
  stop: 733.5,
  targetsHit: [true, false, false],
  status: "running",
  closed: false,
  openedAt,
  closedAt: null,
  highWaterMark: 768.4,
  ...over,
});

describe("calls left running from an earlier session", () => {
  test("the stuck 24 Sept call: closed at that night's bell, at breakeven (no price was ever seen)", () => {
    const opened = ist("2026-09-24T21:11:00");
    const logs = { "TWENTY20-CRUDEOIL-LIVE": [run(opened)] };
    const { logs: out, closedKeys } = sweepStaleRunning(logs, ist("2026-11-13T19:45:00"));
    expect(closedKeys).toEqual(["TWENTY20-CRUDEOIL-LIVE"]);
    const e = out["TWENTY20-CRUDEOIL-LIVE"][0];
    expect(e.closed).toBe(true);
    expect(e.status).toBe("closed_eod");
    expect(e.closedAt).toBe(ist("2026-09-24T23:30:00")); // US summer time: MCX closed 23:30
    expect(e.exitPrice).toBeUndefined();
    expect(exitPriceFor(e)).toBe(745.5);
  });

  test("today's running call is left alone; so is one still inside the hour after the bell", () => {
    const today = { k: [run(ist("2026-11-13T20:00:00"))] };
    expect(sweepStaleRunning(today, ist("2026-11-13T21:00:00")).closedKeys).toEqual([]);
    const late = { k: [run(ist("2026-11-13T23:20:00"))] };
    // US winter: MCX closes 23:55. 30 minutes after the bell -> the server still has time.
    expect(sweepStaleRunning(late, ist("2026-11-14T00:25:00")).closedKeys).toEqual([]);
    const done = sweepStaleRunning(late, ist("2026-11-13T23:55:00") + STALE_GRACE_MS + 60_000);
    expect(done.closedKeys).toEqual(["k"]);
    expect(done.logs.k[0].closedAt).toBe(ist("2026-11-13T23:55:00"));
  });

  test("closed calls and empty logs are untouched, and nothing changed means the same object back", () => {
    const logs = { a: [run(ist("2026-11-10T21:00:00"), { closed: true, status: "sl_hit", closedAt: ist("2026-11-10T21:30:00") })], b: [] };
    const r = sweepStaleRunning(logs, ist("2026-11-13T12:00:00"));
    expect(r.closedKeys).toEqual([]);
    expect(r.logs).toBe(logs);
  });

  test("session close of a call: same day before the bell; a Friday call closes Friday", () => {
    expect(sessionCloseFor(ist("2026-11-13T10:00:00"))).toBe(ist("2026-11-13T23:55:00"));
    expect(sessionCloseFor(ist("2026-10-09T22:00:00"))).toBe(ist("2026-10-09T23:30:00")); // Friday, US summer time
  });
});
