import { expect, test } from "vitest";
import { buildOiView, classifyBuildup, daysToExpiry, type OiContractSnapshot } from "../utils/oiBuildup";

test("the four build-ups, plus flat and missing data", () => {
  expect(classifyBuildup(1, 3).kind).toBe("long-buildup");
  expect(classifyBuildup(-1, 3).kind).toBe("short-buildup");
  expect(classifyBuildup(1, -3).kind).toBe("short-covering");
  expect(classifyBuildup(-1, -3).kind).toBe("long-unwinding");
  expect(classifyBuildup(0.05, 3).kind).toBe("no-clear-signal");
  expect(classifyBuildup(1, 0.1).kind).toBe("no-clear-signal");
  expect(classifyBuildup(null, 3).kind).toBe("no-data");
  expect(classifyBuildup(1, null).kind).toBe("no-data");
});

const NOW = Date.parse("2026-09-24T12:00:00+05:30");
const c = (over: Partial<OiContractSnapshot>): OiContractSnapshot => ({
  tradingSymbol: "NATURALGAS26SEPFUT", expiry: "2026-10-20", price: 300, oi: 10_000, asOf: null,
  prevClose: 310, prevOi: 9_000, prevDate: "2026-09-23", session: "live", hourAgo: null, ...over,
});

test("days to expiry counts IST calendar days", () => {
  expect(daysToExpiry("2026-09-24", NOW)).toBe(0);
  expect(daysToExpiry("2026-09-27", NOW)).toBe(3);
  expect(daysToExpiry("bad", NOW)).toBeNull();
});

test("away from expiry, the headline is the near month alone", () => {
  const v = buildOiView({ symbol: "NATURALGAS", contracts: [c({}), c({ tradingSymbol: "NG-NOV", expiry: "2026-11-20" })] }, NOW)!;
  expect(v.rollover).toBeNull();
  expect(v.headline.kind).toBe("short-buildup"); // price down, OI up
});

test("in rollover week, a falling near-month OI is offset by next month's rise", () => {
  const near = c({ expiry: "2026-09-26", oi: 6_000, prevOi: 10_000, price: 300, prevClose: 310 }); // OI -40%
  const next = c({ tradingSymbol: "NG-OCT", expiry: "2026-10-27", oi: 12_000, prevOi: 6_000, price: 305, prevClose: 315 });
  const v = buildOiView({ symbol: "NATURALGAS", contracts: [near, next] }, NOW)!;
  expect(v.perContract[0].read.kind).toBe("long-unwinding"); // what the near month alone would say
  expect(v.rollover!.combinedOiChangePct).toBeCloseTo(12.5); // 16,000 -> 18,000
  expect(v.headline.kind).toBe("short-buildup"); // the real picture
  expect(v.headlineBasis).toContain("NG-OCT");
});

test("last-hour read uses the bar an hour ago, only while live", () => {
  const live = buildOiView({ symbol: "X", contracts: [c({ hourAgo: { price: 298, oi: 9_800, at: "" } })] }, NOW)!;
  expect(live.lastHour!.kind).toBe("long-buildup");
  const shut = buildOiView({ symbol: "X", contracts: [c({ session: "last", hourAgo: null })] }, NOW)!;
  expect(shut.lastHour).toBeNull();
});

test("no price at all gives no view rather than a made-up read", () => {
  expect(buildOiView({ symbol: "X", contracts: [c({ price: null })] }, NOW)).toBeNull();
});
