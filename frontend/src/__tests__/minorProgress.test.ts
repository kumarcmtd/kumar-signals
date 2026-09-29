import { expect, test } from "vitest";
import { isMinorListChange, isMinorProgress, type TradeLogEntry } from "../utils/tradeLogCore";

const run = { id: "x", strike: 310, optSide: "CE", entry: 15, targets: [18, 21, 24], stop: 12, targetsHit: [false, false, false], status: "running", closed: false, openedAt: 1, closedAt: null, highWaterMark: 15.5 } as unknown as TradeLogEntry;

test("only a new high is minor", () => {
  expect(isMinorProgress(run, { ...run, highWaterMark: 16.2 })).toBe(true);
});

test("anything that changes an outcome is not minor", () => {
  expect(isMinorProgress(run, { ...run, targetsHit: [true, false, false] })).toBe(false);
  expect(isMinorProgress(run, { ...run, closed: true, status: "sl_hit" } as TradeLogEntry)).toBe(false);
  expect(isMinorProgress(run, { ...run, targetAboveState: [true, false, false] } as TradeLogEntry)).toBe(false);
  expect(isMinorProgress(run, { ...run, id: "y" })).toBe(false);
  expect(isMinorProgress(undefined, run)).toBe(false);
});

test("lists: a new entry or an earlier edit is not minor", () => {
  const closed = { ...run, id: "old", closed: true, status: "sl_hit" } as TradeLogEntry;
  expect(isMinorListChange([closed, run], [closed, { ...run, highWaterMark: 17 }])).toBe(true);
  expect(isMinorListChange([closed], [closed, run])).toBe(false);
  expect(isMinorListChange([closed, run], [{ ...closed, exitPrice: 11 } as TradeLogEntry, { ...run, highWaterMark: 17 }])).toBe(false);
});
