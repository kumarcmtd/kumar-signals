import { beforeEach, expect, test, vi } from "vitest";

// The trade-log store is mocked; the entry logic is the app's own (advanceTradeLog).
const pushTradeLogs = vi.fn(async (_env: unknown, _body: unknown) => undefined);
let stored: unknown[] = [];
vi.mock("../../src/tradeLogStore", () => ({
  pushTradeLogs: (env: unknown, body: unknown) => pushTradeLogs(env, body),
  readTradeLogKey: async () => stored,
}));

import { recordBestCall } from "../../src/notify";

const pick = { source: "AI Elite", label: "15m", direction: "bullish", optSide: "CE", confidence: 80, strike: 7600, entry: 182.5, targets: [192.5, 199, 205], stop: 172.5, rr: 1.5, reasons: ["All checks agree"] } as const;
const NOW = Date.parse("2026-11-26T20:15:00+05:30");
const env = {} as never;

beforeEach(() => {
  pushTradeLogs.mockClear();
  stored = [];
});

test("a pushed Best Call is recorded as the app records it, under BEST-<symbol>", async () => {
  expect(await recordBestCall(env, "CRUDEOIL", pick as never, NOW)).toBe(true);
  const body = pushTradeLogs.mock.calls[0][1] as Record<string, unknown[]>;
  expect(Object.keys(body)).toEqual(["BEST-CRUDEOIL"]);
  expect(body["BEST-CRUDEOIL"][0]).toMatchObject({ strike: 7600, optSide: "CE", entry: 182.5, stop: 172.5, targets: [192.5, 199, 205], openedAt: NOW, status: "running", closed: false, meta: { label: "AI Elite" } });
});

test("one call at a time: a running Best Call is left alone", async () => {
  stored = [{ id: "x", strike: 7550, optSide: "PE", entry: 170, targets: [180, 185, 190], stop: 160, targetsHit: [false, false, false], status: "running", closed: false, openedAt: NOW - 600_000, closedAt: null }];
  expect(await recordBestCall(env, "CRUDEOIL", pick as never, NOW)).toBe(false);
  expect(pushTradeLogs).not.toHaveBeenCalled();
});

test("the leg just stopped out is not reopened at once", async () => {
  stored = [{ id: "y", strike: 7600, optSide: "CE", entry: 180, targets: [190, 195, 200], stop: 170, targetsHit: [false, false, false], status: "sl_hit", closed: true, openedAt: NOW - 3_600_000, closedAt: NOW - 120_000 }];
  expect(await recordBestCall(env, "CRUDEOIL", pick as never, NOW)).toBe(false);
  expect(pushTradeLogs).not.toHaveBeenCalled();
});
