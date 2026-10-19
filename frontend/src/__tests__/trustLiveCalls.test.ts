import { expect, test } from "vitest";
import { toLogEntry } from "../components/trust/TrustLiveCalls";
import type { CardCall } from "../utils/tradeCardLog";

const base: CardCall = { id: "x", symbol: "NATURALGAS", side: "PE", candleAt: "", openedAt: "2026-10-19T04:00:00.000Z", entry: 300, stop: 302, t1: 297, t2: 295, reason: "", closed: false, result: null, exit: null, closedAt: null, pnlPts: null, r: null, bestPts: 1, tier: "quick" };

test("a call with its option plan becomes a premium-based card entry", () => {
  const e = toLogEntry({ ...base, opt: { strike: 300, entry: 13.25, stop: 12.29, t1: 14.7, t2: 15.6, delta: -0.48 } })!;
  expect(e).toMatchObject({ strike: 300, optSide: "PE", entry: 13.25, stop: 12.29, targets: [14.7, 15.6, 15.6], status: "running", closed: false });
  expect(e.highWaterMark).toBeCloseTo(13.73, 2); // 1 futures point in its favour x |delta|
});

test("a closed call gets an estimated exit premium; old calls without a plan give null", () => {
  const e = toLogEntry({ ...base, closed: true, result: "stop", exit: 302, opt: { strike: 300, entry: 13.25, stop: 12.29, t1: 14.7, t2: 15.6, delta: -0.48 } })!;
  expect(e.status).toBe("sl_hit");
  expect(e.exitPrice).toBeCloseTo(12.29, 2);
  expect(toLogEntry(base)).toBeNull();
});
