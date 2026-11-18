import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { resampleCandles } from "../../frontend/src/utils/candleResample";
import { readLite } from "../../frontend/src/utils/lite/live";
import type { Candle } from "../../frontend/src/types";

// Data sources are mocked; the Ai Lite rules, money rules, strike pick and push texts are real.
const pushTradeLogs = vi.fn(async (_env: unknown, _body: unknown) => undefined);
let stored: unknown[] = [];
vi.mock("../../src/tradeLogStore", () => ({
  pushTradeLogs: (env: unknown, body: unknown) => pushTradeLogs(env, body),
  readTradeLogKey: async () => stored,
}));
let c15: Candle[] = [];
vi.mock("../../src/signals", () => ({
  getCandlesForTF: async (_e: unknown, _t: unknown, _f: unknown, tf: string) => (tf === "15" ? c15 : { error: "not needed" }),
}));
vi.mock("../../src/upstox", () => ({
  getNearestFuture: async () => ({ instrument_key: "MCX_FO|1", trading_symbol: "CRUDEOIL FUT" }),
}));
let expiry = "2026-12-17";
vi.mock("../../src/optionsAnalytics", () => ({
  computeOptionsAnalytics: async () => ({
    symbol: "CRUDEOIL",
    atmStrike: 5400,
    spot: 5400,
    expiry,
    rows: [5350, 5400, 5450].map((strike) => ({ strike, call: { ltp: 180 - (strike - 5400) / 2, delta: 0.5 - (strike - 5400) / 500, oi: 1000, volume: 100 }, put: { ltp: 170 + (strike - 5400) / 2, delta: -0.5 - (strike - 5400) / 500, oi: 1000, volume: 100 } })),
  }),
}));

import { runLiteCallCheck, runLiteStepCheck } from "../../src/liteCron";

const M15 = 15 * 60_000;

/** A seeded random walk of 5-minute candles with trending spells, weekdays 9:00-23:55 IST (US winter). */
function walk(days: number, seed: number): Candle[] {
  let s = seed;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const out: Candle[] = [];
  let px = 5400;
  let drift = 0;
  const start = Date.parse("2026-11-16T00:00:00Z") - 5.5 * 3600_000;
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

/** The latest 15-minute candle where the Ai Lite rules call, and the candles the server would see 20 s later. */
function findCall() {
  const all = resampleCandles(walk(4, 11), 15);
  for (let i = all.length - 2; i >= 40; i--) {
    const barEnd = Date.parse(all[i].date) + M15;
    const now = barEnd + 20_000;
    const seen = all.slice(0, i + 2); // the new candle has just started
    const read = readLite(seen, now);
    if (read.state === "call") return { now, barEnd, seen, side: read.signal!.side! };
  }
  return null;
}

function kv() {
  const m = new Map<string, string>();
  return { get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => void m.set(k, v), m };
}

const fetchMock = vi.fn(async (_url: unknown, _init?: unknown) => new Response("ok", { status: 200 }));
const ntfyBodies = () => fetchMock.mock.calls.filter((c) => String(c[0]).includes("ntfy")).map((c) => String((c[1] as RequestInit | undefined)?.body ?? ""));

beforeEach(() => {
  pushTradeLogs.mockClear();
  fetchMock.mockClear();
  stored = [];
  expiry = "2026-12-17";
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function setup() {
  const hit = findCall();
  expect(hit).not.toBeNull();
  c15 = hit!.seen;
  vi.useFakeTimers();
  vi.setSystemTime(new Date(hit!.now));
  const store = kv();
  store.m.set("access_token", "t");
  store.m.set("ntfy_topic", "topic");
  return { hit: hit!, store, env: { COMMODITY_KV: store, NTFY_TOKEN: undefined } as any };
}

test("an Ai Lite call is recorded as the page records it, pushed with its Rs 2,000 plan, and never twice for one candle", async () => {
  const { hit, env } = setup();
  const first = await runLiteCallCheck(env);
  expect(first.join(" ")).toContain("call recorded");
  // Both markets read the same mocked candles here, so both call.
  expect(pushTradeLogs).toHaveBeenCalledTimes(2);
  const body = pushTradeLogs.mock.calls[0][1] as Record<string, { id: string; openedAt: number; optSide: string; meta?: { label: string } }[]>;
  expect(Object.keys(body)).toEqual(["LITE-CRUDEOIL"]);
  const e = body["LITE-CRUDEOIL"][0];
  expect(e.openedAt).toBe(hit.barEnd);
  expect(e.optSide).toBe(hit.side);
  expect(e.id).toMatch(new RegExp(`-${hit.side}-${hit.barEnd}$`));
  expect(e.meta?.label).toMatch(/^Ai Lite · (Pullback|Breakout) (CE|PE)$/);
  expect(Object.keys(pushTradeLogs.mock.calls[1][1] as object)).toEqual(["LITE-NATURALGAS"]);
  const bodies = ntfyBodies();
  expect(bodies).toHaveLength(2);
  expect(bodies[0]).toContain("(+Rs 2,000/lot)");
  expect(bodies[0]).toContain("(-Rs 1,000/lot)");

  const again = await runLiteCallCheck(env);
  expect(again.join(" ")).toContain("already handled");
  expect(pushTradeLogs).toHaveBeenCalledTimes(2);
  expect(ntfyBodies()).toHaveLength(2);
}, 60_000);

test("the money rules skip the call (2 stop-losses today) and mark the candle handled", async () => {
  const { hit, env, store } = setup();
  const stop = { strike: 5400, optSide: "CE", entry: 150, targets: [160, 165, 170], stop: 140, targetsHit: [false, false, false], status: "sl_hit", closed: true, openedAt: hit.now - 3 * 3600_000, closedAt: hit.now - 2 * 3600_000 };
  stored = [
    { ...stop, id: "a" },
    { ...stop, id: "b" },
  ];
  const report = await runLiteCallCheck(env);
  expect(report.join(" ")).toContain("2 stop-losses today");
  expect(pushTradeLogs).not.toHaveBeenCalled();
  expect(ntfyBodies()).toHaveLength(0);
  expect(store.m.get("notified:LITE-CRUDEOIL")).toBe(String(hit.barEnd));
}, 60_000);

test("a call the app already recorded on this candle is still pushed to the phone, once, and not recorded twice", async () => {
  const { hit, env } = setup();
  stored = [{ id: `5400-${hit.side}-${hit.barEnd}`, strike: 5400, optSide: hit.side, entry: 180, targets: [190, 195, 200], stop: 170, targetsHit: [false, false, false], status: "running", closed: false, openedAt: hit.barEnd, closedAt: null }];
  const report = await runLiteCallCheck(env);
  expect(report.join(" ")).toContain("already recorded by the app; pushed.");
  expect(pushTradeLogs).not.toHaveBeenCalled();
  expect(ntfyBodies()).toHaveLength(2); // crude and gas both read the same mocked candles
  expect(ntfyBodies()[0]).toContain("Stop Rs 170 (-Rs 1,000/lot)");
  expect((await runLiteCallCheck(env)).join(" ")).toContain("already handled");
  expect(ntfyBodies()).toHaveLength(2);
}, 60_000);

test("no call on the option's expiry day", async () => {
  const { hit, env } = setup();
  expiry = new Date(hit.now + 5.5 * 3600_000).toISOString().slice(0, 10);
  const report = await runLiteCallCheck(env);
  expect(report.join(" ")).toContain("option expires today");
  expect(pushTradeLogs).not.toHaveBeenCalled();
}, 60_000);

test("closed market: no reads, no calls", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-21T12:00:00+05:30")); // Saturday
  const report = await runLiteCallCheck({ COMMODITY_KV: kv() } as any);
  expect(report.join(" ")).toContain("MCX is closed");
  expect(pushTradeLogs).not.toHaveBeenCalled();
});

test("each step of a running Ai Lite call is pushed once: T1, then the close", async () => {
  const now = Date.parse("2026-11-16T15:40:00+05:30");
  vi.useFakeTimers();
  vi.setSystemTime(new Date(now));
  const store = kv();
  store.m.set("ntfy_topic", "topic");
  const env = { COMMODITY_KV: store } as any;
  const base = { id: "c1", strike: 5400, optSide: "CE", entry: 150, targets: [160, 165, 170], stop: 140, openedAt: now - 30 * 60_000, closedAt: null };
  stored = [{ ...base, targetsHit: [true, false, false], status: "running", closed: false }];
  expect((await runLiteStepCheck(env)).join(" ")).toContain("t1 pushed");
  expect(await runLiteStepCheck(env)).toEqual([]);
  stored = [{ ...base, targetsHit: [true, true, true], status: "target3_hit", closed: true, closedAt: now, exitPrice: 170 }];
  expect((await runLiteStepCheck(env)).join(" ")).toContain("closed pushed");
  const bodies = ntfyBodies();
  expect(bodies.some((b) => b.includes("MOVE YOUR STOP UP TO YOUR ENTRY"))).toBe(true);
  expect(bodies.some((b) => b.includes("+Rs 2,000"))).toBe(true);
});
