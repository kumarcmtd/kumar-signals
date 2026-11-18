import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { prepare } from "../../frontend/src/utils/twentyLab";
import { computeFeatures } from "../../frontend/src/utils/twentyV3/features";
import { entryAt } from "../../frontend/src/utils/twentyV3/setups";
import { callWindow } from "../../frontend/src/utils/twentyV3/dayPlan";
import { ENGINE_SEASON } from "../../frontend/src/utils/twentyV3/engines";
import type { Candle } from "../../frontend/src/types";

// Data sources are mocked, and so is the season measurement (a 20-day replay)
// so each test can set the line live or resting; the engine, ticket and push
// texts are real.
const pushTradeLogs = vi.fn(async (_env: unknown, _body: unknown) => undefined);
vi.mock("../../src/tradeLogStore", () => ({
  pushTradeLogs: (env: unknown, body: unknown) => pushTradeLogs(env, body),
  readTradeLogKey: async () => [],
}));
let candles: Candle[] = [];
vi.mock("../../src/signals", () => ({
  getCandlesForTF: async (_e: unknown, _t: unknown, _f: unknown, tf: string) => (tf === "5" ? candles : { error: "not needed" }),
}));
vi.mock("../../src/upstox", () => ({
  getNearestFuture: async () => ({ instrument_key: "MCX_FO|1", trading_symbol: "CRUDEOIL FUT" }),
  getPriorDayBars: async () => [],
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
let season: { resting: boolean; calls: number; avgRs: number | null } | null = null;
vi.mock("../../frontend/src/utils/twentyV3/live", async (orig) => ({
  ...(await orig<typeof import("../../frontend/src/utils/twentyV3/live")>()),
  measureV3: () => (season ? { together: { trades: 12, avgRs: 300 }, season: { ...season, netRs: 0, days: [] } } : null),
}));

import { runTwentyV3CallCheck } from "../../src/twentyV3Cron";

function walk(days: number, seed: number): Candle[] {
  let s = seed;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const out: Candle[] = [];
  let px = 5400;
  let drift = 0;
  const start = Date.parse("2026-11-02T00:00:00Z") - 5.5 * 3600_000;
  for (let d = 0, n = 0; n < days; d++) {
    const wd = new Date(start + d * 86_400_000 + 5.5 * 3600_000).getUTCDay();
    if (wd === 0 || wd === 6) continue;
    n++;
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
const pushes = () => fetchMock.mock.calls.filter((c) => String(c[0]).includes("ntfy")).map((c) => ({ title: String(((c[1] as RequestInit).headers as Record<string, string>).Title), body: String((c[1] as RequestInit).body) }));

/** The latest candle where the main line's rule fires inside its window. */
const all = walk(12, 42);
const hit = (() => {
  const p = prepare(all, true);
  const ctx = { p, f: computeFeatures(p) };
  for (let i = all.length - 1; i > 700; i--) {
    const barEnd = Date.parse(all[i].date) + 5 * 60_000;
    if (entryAt(ctx, i, "trendGap") && callWindow(ENGINE_SEASON.active.CRUDEOIL, barEnd + 20_000)?.open) return { i, barEnd };
  }
  return null;
})();

beforeEach(() => {
  pushTradeLogs.mockClear();
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  expect(hit).not.toBeNull();
  candles = all.slice(0, hit!.i + 1);
  vi.useFakeTimers();
  vi.setSystemTime(new Date(hit!.barEnd + 20_000));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function runOnce() {
  const store = kv();
  store.m.set("access_token", "t");
  store.m.set("ntfy_topic", "topic");
  const report = await runTwentyV3CallCheck({ COMMODITY_KV: store } as any, Date.now(), ENGINE_SEASON);
  const body = pushTradeLogs.mock.calls[0]?.[1] as Record<string, { practice?: boolean; openedAt: number; meta?: { label: string } }[]> | undefined;
  return { report, body, entry: body?.["TWENTY20-CRUDEOIL-SEASON"]?.[0] };
}

test("in season: a live call on its own log, pushed as a real call with the season line", async () => {
  season = { resting: false, calls: 9, avgRs: 640 };
  const { report, body, entry } = await runOnce();
  expect(report.join(" ")).toContain("call recorded");
  expect(Object.keys(body!)).toEqual(["TWENTY20-CRUDEOIL-SEASON"]);
  expect(entry?.openedAt).toBe(hit!.barEnd);
  expect(entry?.practice).toBeUndefined();
  expect(entry?.meta?.label).toBe("Ai20-20 · Trend turn, careful at the high");
  const [push] = pushes();
  expect(push.title).toMatch(/^⚡ Ai20-20: Crude Oil \d+ (CE|PE) @ Rs /);
  expect(push.body).toContain("Season: live (last 10 days: 9 test calls, average +Rs 640/lot)");
}, 60_000);

test("resting: the same call is a practice call, and the push says why", async () => {
  season = { resting: true, calls: 7, avgRs: -310 };
  const { entry } = await runOnce();
  expect(entry?.practice).toBe(true);
  expect(entry?.meta?.label).toBe("Ai20-20 · Trend turn, careful at the high (practice)");
  const [push] = pushes();
  expect(push.title).toMatch(/^📝 PRACTICE · Ai20-20:/);
  expect(push.body).toContain("RESTING -- these calls' last 10 trading days lost (7 test calls, average -Rs 310/lot)");
}, 60_000);

test("season unknown (no recent candles): practice, never a live call", async () => {
  season = null;
  const { entry } = await runOnce();
  expect(entry?.practice).toBe(true);
  expect(pushes()[0].body).toContain("Season not known");
}, 60_000);
