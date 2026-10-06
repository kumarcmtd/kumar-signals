import { afterEach, expect, test, vi } from "vitest";
import { inrFor, parseYahooChart } from "../../src/seasonal";

const yahoo = (ts: number[], close: (number | null)[], offset = -14400) => ({
  chart: { result: [{ meta: { gmtoffset: offset }, timestamp: ts, indicators: { quote: [{ open: close, high: close, low: close, close }] } }] },
});

test("parses Yahoo weekly bars into exchange-time dates, skipping empty weeks", () => {
  // Mon 2026-09-28 04:00 UTC = 00:00 New York
  const t0 = Date.UTC(2026, 8, 28, 4) / 1000;
  const bars = parseYahooChart(yahoo([t0, t0 + 7 * 86400, t0 + 14 * 86400], [2.9, null, 3.04]));
  expect(bars.map((b) => b.date)).toEqual(["2026-09-28", "2026-10-12"]);
  expect(bars[1].close).toBe(3.04);
});

test("missing or malformed chart JSON gives no bars, not an error", () => {
  expect(parseYahooChart({})).toEqual([]);
  expect(parseYahooChart({ chart: { result: [{}] } })).toEqual([]);
});

test("USD/INR is matched to the same week, never to a far-off one", () => {
  const fx = [
    { date: "2026-09-21", open: 0, high: 0, low: 0, close: 88.7 },
    { date: "2026-09-28", open: 0, high: 0, low: 0, close: 88.9 },
  ];
  expect(inrFor("2026-09-28", fx)).toBe(88.9);
  expect(inrFor("2026-09-29", fx)).toBe(88.9);
  expect(inrFor("2026-12-01", fx)).toBeNull();
});

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });
test("an expired Upstox token says so, instead of 'No instrument found'", async () => {
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ status: "error", errors: [{ errorCode: "UDAPI100050", message: "Invalid token used to access API" }] }), { status: 401 }));
  const { getNearestFuture, UPSTOX_LOGIN_EXPIRED } = await import("../../src/upstox");
  await expect(getNearestFuture("old-token", "NATURALGAS")).rejects.toThrow(UPSTOX_LOGIN_EXPIRED);
});
