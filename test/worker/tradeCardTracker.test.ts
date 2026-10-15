import { afterEach, expect, test, vi } from "vitest";
import { runTradeCardTracker } from "../../src/tradeCardTracker";

afterEach(() => vi.useRealTimers());

test("closed market with nothing open makes no Upstox call and writes nothing", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-10T06:00:00Z")); // Saturday
  const put = vi.fn();
  const env = { COMMODITY_KV: { get: async () => null, put } } as any;
  const report = await runTradeCardTracker(env);
  expect(report[0]).toContain("no open Trade Card call");
  expect(put).not.toHaveBeenCalled();
});
