import { afterEach, expect, test, vi } from "vitest";

afterEach(() => { vi.doUnmock("../../src/upstox"); vi.resetModules(); });

const bar = (date: string, close: number, oi: number) => ({ date, open: close, high: close, low: close, close, volume: 1, oi });

async function load(daily: unknown[], intraday: unknown[] | null) {
  vi.resetModules();
  vi.doMock("../../src/upstox", () => ({
    getUpcomingFutures: async () => [{ instrument_key: "K1", trading_symbol: "NG-SEP", expiry: "2026-09-25" }],
    getHistoricalCandles: async () => daily,
    getIntradayCandles: async () => intraday,
  }));
  const { computeOiBuildup } = await import("../../src/oiBuildup");
  return computeOiBuildup({} as never, "tok", "NATURALGAS");
}

const DAILY = [bar("2026-09-22T00:00:00+05:30", 300, 9000), bar("2026-09-23T00:00:00+05:30", 310, 9500), bar("2026-09-24T00:00:00+05:30", 305, 9900)];

test("live: now = last minute bar, prev = the day before today, hour-ago bar found", async () => {
  const today = [bar("2026-09-24T09:00:00+05:30", 311, 9600), bar("2026-09-24T10:00:00+05:30", 312, 9700), bar("2026-09-24T10:30:00+05:30", 308, 9900), bar("2026-09-24T11:00:00+05:30", 305, 10000)];
  const r = await load(DAILY, today);
  const c = r.contracts[0];
  expect(c).toMatchObject({ session: "live", price: 305, oi: 10000, prevClose: 310, prevOi: 9500, prevDate: "2026-09-23", expiry: "2026-09-25" });
  expect(c.hourAgo).toMatchObject({ price: 312, oi: 9700 });
});

test("market shut: compares the last two daily candles", async () => {
  const r = await load(DAILY, []);
  expect(r.contracts[0]).toMatchObject({ session: "last", price: 305, oi: 9900, prevClose: 310, prevOi: 9500, hourAgo: null });
});

test("OI of 0 from Upstox is reported as missing, not zero", async () => {
  const r = await load([bar("2026-09-23T00:00:00+05:30", 310, 0), bar("2026-09-24T00:00:00+05:30", 305, 0)], null);
  expect(r.contracts[0].oi).toBeNull();
  expect(r.contracts[0].prevOi).toBeNull();
});
