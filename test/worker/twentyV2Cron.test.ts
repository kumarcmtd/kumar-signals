import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { prepare, signalAt } from "../../frontend/src/utils/twentyLab";
import { V2_RULES } from "../../frontend/src/utils/twentyV2";
import type { Candle } from "../../frontend/src/types";

// The data sources are mocked; the engine, the guard and the push text are real.
const pushTradeLogs = vi.fn(async (_env: unknown, _body: unknown) => undefined);
let stored: unknown[] = [];
vi.mock("../../src/tradeLogStore", () => ({
  pushTradeLogs: (env: unknown, body: unknown) => pushTradeLogs(env, body),
  readTradeLogKey: async () => stored,
}));
let candles: Candle[] = [];
vi.mock("../../src/signals", () => ({
  getCandlesForTF: async (_e: unknown, _t: unknown, _f: unknown, tf: string) => (tf === "5" ? candles : { error: "not needed" }),
}));
vi.mock("../../src/upstox", () => ({
  getNearestFuture: async () => ({ instrument_key: "MCX_FO|1", trading_symbol: "CRUDEOIL FUT" }),
  getPriorDayBars: async () => null,
}));
vi.mock("../../src/optionsAnalytics", () => ({
  computeOptionsAnalytics: async () => ({ symbol: "CRUDEOIL", atmStrike: 5400, expiry: "2026-11-17", rows: [{ strike: 5400, call: { ltp: 180, delta: 0.5 }, put: { ltp: 170, delta: -0.5 } }] }),
}));
vi.mock("../../src/news", () => ({ fetchEnergyNews: async () => null }));
vi.mock("../../src/eiaCalendar", () => ({ fetchEiaData: async () => null }));

import { runTwentyTwentyNotificationCheck } from "../../src/notify";

// Random-walk 5-min candles in MCX hours with slow drifts (as in the engine tests).
function walk(days: number, seed: number): Candle[] {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const out: Candle[] = [];
  let px = 5400;
  let drift = 0;
  const start = Date.parse("2026-10-01T00:00:00Z") - 5.5 * 3600_000;
  for (let d = 0; out.length < days * 174; d++) {
    const wd = new Date(start + d * 86_400_000 + 5.5 * 3600_000).getUTCDay();
    if (wd === 0 || wd === 6) continue;
    for (let m = 9 * 60; m < 23 * 60 + 30; m += 5) {
      if (rnd() < 0.02) drift = (rnd() - 0.5) * 3;
      const o = px;
      let h = o;
      let l = o;
      for (let k = 0; k < 5; k++) {
        px += drift / 5 + (rnd() + rnd() + rnd() - 1.5) * 3;
        h = Math.max(h, px);
        l = Math.min(l, px);
      }
      out.push({ date: new Date(start + d * 86_400_000 + m * 60_000).toISOString(), open: o, high: h, low: l, close: px, volume: 1000 });
    }
  }
  return out;
}

function kv() {
  const m = new Map<string, string>();
  return { get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => void m.set(k, v), m };
}

const fetchMock = vi.fn(async (_url: unknown, _init?: unknown) => new Response("ok", { status: 200 }));

beforeEach(() => {
  pushTradeLogs.mockClear();
  fetchMock.mockClear();
  stored = [];
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test("a v2 call is recorded in the trade log and pushed once; the same candle is never handled twice", async () => {
  const all = walk(14, 42);
  const p = prepare(all);
  const i = [...all.keys()].reverse().find((k) => k > 700 && signalAt(p, k, V2_RULES) !== null)!;
  expect(i).toBeDefined();
  candles = all.slice(0, i + 1);
  const barEnd = Date.parse(all[i].date) + 5 * 60_000;
  vi.useFakeTimers();
  vi.setSystemTime(new Date(barEnd + 20_000));
  const store = kv();
  store.m.set("access_token", "t");
  store.m.set("ntfy_topic", "topic");
  const env = { COMMODITY_KV: store, NTFY_TOKEN: undefined } as any;

  const first = await runTwentyTwentyNotificationCheck(env);
  expect(first.join(" ")).toContain("call recorded in the trade log");
  expect(first.join(" ")).toContain("Natural Gas: no Ai20-20 calls");
  expect(pushTradeLogs).toHaveBeenCalledTimes(1);
  const body = pushTradeLogs.mock.calls[0][1] as Record<string, { id: string; openedAt: number }[]>;
  expect(Object.keys(body)).toEqual(["TWENTY20-CRUDEOIL-V2"]);
  expect(body["TWENTY20-CRUDEOIL-V2"][0].openedAt).toBe(barEnd);
  const pushes = fetchMock.mock.calls.filter((c) => String(c[0]).includes("ntfy"));
  expect(pushes).toHaveLength(1);

  const again = await runTwentyTwentyNotificationCheck(env);
  expect(again.join(" ")).toContain("already handled");
  expect(pushTradeLogs).toHaveBeenCalledTimes(1);
});

test("a running call blocks a new one (one at a time)", async () => {
  const all = walk(14, 42);
  const p = prepare(all);
  const i = [...all.keys()].reverse().find((k) => k > 700 && signalAt(p, k, V2_RULES) !== null)!;
  candles = all.slice(0, i + 1);
  vi.useFakeTimers();
  vi.setSystemTime(new Date(Date.parse(all[i].date) + 5 * 60_000 + 20_000));
  stored = [{ id: "x", strike: 5400, optSide: "PE", entry: 170, targets: [180, 186, 192], stop: 160, targetsHit: [false, false, false], status: "running", closed: false, openedAt: Date.now() - 600_000, closedAt: null }];
  const store = kv();
  store.m.set("access_token", "t");
  const report = await runTwentyTwentyNotificationCheck({ COMMODITY_KV: store } as any);
  expect(report.join(" ")).toContain("one at a time");
  expect(pushTradeLogs).not.toHaveBeenCalled();
});
