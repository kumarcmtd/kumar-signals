import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { prepare } from "../../frontend/src/utils/twentyLab";
import { computeFeatures } from "../../frontend/src/utils/twentyV3/features";
import { firstEntry } from "../../frontend/src/utils/twentyV3/setups";
import { V3_LIVE } from "../../frontend/src/utils/twentyV3/live";
import { callWindow } from "../../frontend/src/utils/twentyV3/dayPlan";
import type { Candle } from "../../frontend/src/types";

// Data sources are mocked; the engine, guards, ticket and push texts are real.
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
  computeOptionsAnalytics: async () => ({
    symbol: "CRUDEOIL",
    atmStrike: 5400,
    spot: 5400,
    expiry: "2026-12-17",
    rows: [5350, 5400, 5450].map((strike) => ({ strike, call: { ltp: 180 - (strike - 5400) / 2, delta: 0.5 - (strike - 5400) / 500, oi: 1000, volume: 100 }, put: { ltp: 170 + (strike - 5400) / 2, delta: -0.5 - (strike - 5400) / 500, oi: 1000, volume: 100 } })),
  }),
}));
vi.mock("../../src/news", () => ({ fetchEnergyNews: async () => null }));
vi.mock("../../src/eiaCalendar", () => ({ fetchEiaData: async () => null }));

import { runTwentyV3CallCheck, runTwentyV3StepCheck } from "../../src/twentyV3Cron";

function walk(days: number, seed: number): Candle[] {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const out: Candle[] = [];
  let px = 5400;
  let drift = 0;
  const start = Date.parse("2026-11-02T00:00:00Z") - 5.5 * 3600_000; // US winter: MCX to 23:55
  for (let d = 0; out.length < days * 179; d++) {
    const wd = new Date(start + d * 86_400_000 + 5.5 * 3600_000).getUTCDay();
    if (wd === 0 || wd === 6) continue;
    for (let m = 9 * 60; m < 23 * 60 + 55; m += 5) {
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

/** The latest candle (with 20 earlier days) where a live crude setup fires inside the call window. */
function findCall(all: Candle[]) {
  const p = prepare(all, true);
  const ctx = { p, f: computeFeatures(p) };
  for (let i = all.length - 1; i > 2400; i--) {
    const e = firstEntry(ctx, i, V3_LIVE.CRUDEOIL);
    const barEnd = Date.parse(all[i].date) + 5 * 60_000;
    if (e && callWindow(V3_LIVE.CRUDEOIL, barEnd + 20_000)?.open) return { i, barEnd, e };
  }
  return null;
}

test("a v3 call is recorded with the same entry the page writes and pushed once; never twice for one candle", async () => {
  const all = walk(22, 42);
  const hit = findCall(all);
  expect(hit).not.toBeNull();
  candles = all.slice(0, hit!.i + 1);
  vi.useFakeTimers();
  vi.setSystemTime(new Date(hit!.barEnd + 20_000));
  const store = kv();
  store.m.set("access_token", "t");
  store.m.set("ntfy_topic", "topic");
  const env = { COMMODITY_KV: store, NTFY_TOKEN: undefined } as any;

  const first = await runTwentyV3CallCheck(env);
  expect(first.join(" ")).toContain("call recorded");
  expect(pushTradeLogs).toHaveBeenCalledTimes(1);
  const body = pushTradeLogs.mock.calls[0][1] as Record<string, { id: string; openedAt: number; meta?: { label: string } }[]>;
  expect(Object.keys(body)).toEqual(["TWENTY20-CRUDEOIL-V3"]);
  expect(body["TWENTY20-CRUDEOIL-V3"][0].openedAt).toBe(hit!.barEnd);
  expect(body["TWENTY20-CRUDEOIL-V3"][0].meta?.label).toMatch(/^Ai20-20 v3 · /);
  expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes("ntfy"))).toHaveLength(1);

  const again = await runTwentyV3CallCheck(env);
  expect(again.join(" ")).toContain("already handled");
  expect(pushTradeLogs).toHaveBeenCalledTimes(1);
}, 60_000);

test("a running call blocks a new one (one at a time)", async () => {
  const all = walk(22, 42);
  const hit = findCall(all)!;
  candles = all.slice(0, hit.i + 1);
  vi.useFakeTimers();
  vi.setSystemTime(new Date(hit.barEnd + 20_000));
  stored = [{ id: "x", strike: 5400, optSide: "PE", entry: 170, targets: [180, 186, 192], stop: 160, targetsHit: [false, false, false], status: "running", closed: false, openedAt: Date.now() - 600_000, closedAt: null }];
  const store = kv();
  store.m.set("access_token", "t");
  const report = await runTwentyV3CallCheck({ COMMODITY_KV: store } as any);
  expect(report.join(" ")).toContain("one at a time");
  expect(pushTradeLogs).not.toHaveBeenCalled();
}, 60_000);

test("each step of a running call is pushed once: T1, then the close", async () => {
  const now = Date.parse("2026-11-16T21:40:00+05:30");
  vi.useFakeTimers();
  vi.setSystemTime(new Date(now));
  const store = kv();
  store.m.set("ntfy_topic", "topic");
  const env = { COMMODITY_KV: store } as any;
  const base = { id: "c1", strike: 5400, optSide: "CE", entry: 150, targets: [162, 169, 177], stop: 142, openedAt: now - 30 * 60_000, closedAt: null };
  stored = [{ ...base, targetsHit: [true, false, false], status: "running", closed: false }];
  expect((await runTwentyV3StepCheck(env)).join(" ")).toContain("t1 pushed");
  expect(await runTwentyV3StepCheck(env)).toEqual([]);
  stored = [{ ...base, targetsHit: [true, false, false], status: "stopped_breakeven", closed: true, closedAt: now, exitPrice: 150 }];
  expect((await runTwentyV3StepCheck(env)).join(" ")).toContain("closed pushed");
  const bodies = fetchMock.mock.calls.map((c) => String((c[1] as RequestInit | undefined)?.body ?? ""));
  expect(bodies.some((b) => b.includes("MOVE YOUR STOP UP TO YOUR ENTRY"))).toBe(true);
});
