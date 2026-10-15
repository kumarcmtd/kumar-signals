import { afterEach, expect, test, vi } from "vitest";
import { eventWarningText, loginWarningText, runImportantAlerts } from "../../src/importantAlerts";
import { cardCloseText, cardTradeText } from "../../src/tradeCardTracker";
import type { CardCall } from "../../frontend/src/utils/tradeCardLog";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const call: CardCall = { id: "x", symbol: "CRUDEOIL", side: "CE", candleAt: "", openedAt: "2026-10-15T14:35:00.000Z", entry: 8912, stop: 8885, t1: 8968, reason: "All 6 checks pass.", closed: false, result: null, exit: null, closedAt: null, pnlPts: null, r: null, bestPts: 0 };

test("Trade Card push: side, strike, levels, premium estimate, real newlines", () => {
  const m = cardTradeText(call, { strike: 8900, ltp: 182.4, atStop: 168.9, atT1: 210.4 });
  expect(m.title).toBe("🟢 TRADE CE: Crude Oil 8900 CE");
  expect(m.body).toContain("Trade Card is FULL GREEN");
  expect(m.body).toContain("20:05 candle");
  expect(m.body).toContain("Futures entry 8912 | stop 8885 | target 8968 (2.1x reward)");
  expect(m.body).toContain("stop ~Rs 168.9 | target ~Rs 210.4");
  expect(m.body).not.toContain("\\n");
  expect(cardTradeText({ ...call, side: "PE" }, null).title).toBe("🔴 TRADE PE: Crude Oil");
});

test("close pushes say what to do", () => {
  expect(cardCloseText({ ...call, closed: true, result: "target", exit: 8968, pnlPts: 56, r: 2.07 }).title).toContain("TARGET hit");
  const stop = cardCloseText({ ...call, closed: true, result: "stop", exit: 8885, pnlPts: -27, r: -1 });
  expect(stop.title).toContain("STOP hit");
  expect(stop.body).toContain("-27 pts, -1R");
  expect(cardCloseText({ ...call, closed: true, result: "day_end", exit: 8920, pnlPts: 8, r: 0.3 }).body).toContain("don't carry an option overnight");
});

test("EIA and login warnings", () => {
  const e = eventWarningText({ name: "EIA Weekly Crude Inventories", affects: "CRUDEOIL", istLabel: "8:00 PM", minutesAway: 30 });
  expect(e.title).toBe("⏰ EIA Weekly Crude Inventories in 30 min");
  expect(e.body).toContain("No new entries");
  expect(loginWarningText("not logged in").body).toContain("Reason: not logged in");
});

test("EIA warning goes once, ~30 min before the release, during market hours", async () => {
  vi.useFakeTimers();
  // Wed 14 Oct 2026, 10:30 ET = 20:00 IST; 30 min before = 19:30 IST = 14:00 UTC.
  vi.setSystemTime(new Date("2026-10-14T14:00:00Z"));
  const store = new Map<string, string>([["ntfy_topic", "t"]]);
  const env = { COMMODITY_KV: { get: async (k: string) => store.get(k) ?? null, put: async (k: string, v: string) => void store.set(k, v) } } as any;
  const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  const r1 = await runImportantAlerts(env);
  expect(r1.join(" ")).toContain("warning pushed");
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await runImportantAlerts(env);
  expect(fetchMock).toHaveBeenCalledTimes(1); // not repeated
});
