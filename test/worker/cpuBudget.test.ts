// The free plan gives each invocation 10 ms of CPU. These lock in the changes
// that got the cron back under it, so a later edit cannot quietly undo them:
// the expensive work must be SKIPPED when there is nothing to do, not merely
// be fast.

import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { resampleCandles } from "../../frontend/src/utils/candleResample";

// ---- A KV that supports metadata and records every read --------------------
type Call = { key: string; type?: string };
function makeKv() {
  const store = new Map<string, string>();
  const meta = new Map<string, unknown>();
  const reads: Call[] = [];
  const asType = (v: string | null, type?: string) => (v === null ? null : type === "json" ? JSON.parse(v) : type === "stream" ? new Response(v).body : v);
  return {
    store, meta, reads,
    async get(key: string, type?: string) { reads.push({ key, type }); return asType(store.get(key) ?? null, type); },
    async getWithMetadata(key: string, type?: string) { reads.push({ key, type }); return { value: asType(store.get(key) ?? null, type), metadata: meta.get(key) ?? null }; },
    async put(key: string, value: string, opts?: { metadata?: unknown }) { store.set(key, value); if (opts?.metadata !== undefined) meta.set(key, opts.metadata); },
    async delete(key: string) { store.delete(key); meta.delete(key); },
  };
}
const envWith = (kv: ReturnType<typeof makeKv>) => ({ COMMODITY_KV: kv, AI: {}, ASSETS: {} }) as never;
/** Reads that decoded the body (anything but a stream/metadata peek). */
const bodyReads = (kv: ReturnType<typeof makeKv>, key: string) => kv.reads.filter((r) => r.key === key && r.type !== "stream");

const realFetch = globalThis.fetch;
let fetchCalls: string[] = [];
beforeEach(() => {
  fetchCalls = [];
  globalThis.fetch = (async (u: RequestInfo | URL) => {
    fetchCalls.push(String(u));
    return new Response("<rss><channel></channel></rss>");
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.useRealTimers();
});

const openTrade = (id: string) => ({ id, strike: 9000, optSide: "CE", entry: 100, targets: [110, 120, 130], stop: 90, targetsHit: [false, false, false], status: "running", closed: false, openedAt: 1, closedAt: null });
const closedTrade = (id: string) => ({ ...openTrade(id), status: "sl_hit", closed: true, closedAt: 2 });

// ---------------------------------------------------------------------------
// Trade logs: open count and revision travel in metadata
// ---------------------------------------------------------------------------

test("saving the trade log records how many trades are open, without a second write", async () => {
  const { saveTradeLogsToKv, openTradeCountFromKv } = await import("../../src/storage");
  const kv = makeKv();
  await saveTradeLogsToKv(envWith(kv), { A: [closedTrade("a1"), openTrade("a2")], B: [closedTrade("b1")], C: [openTrade("c1")] });
  expect(await openTradeCountFromKv(envWith(kv))).toBe(2);
  expect(bodyReads(kv, "trade_logs_v1")).toHaveLength(0);
});

test("a log written before metadata existed reports 'unknown', so the cron falls back safely", async () => {
  const { openTradeCountFromKv } = await import("../../src/storage");
  const kv = makeKv();
  kv.store.set("trade_logs_v1", JSON.stringify({ A: [openTrade("a")] })); // no metadata
  expect(await openTradeCountFromKv(envWith(kv))).toBeNull();
});

test("no log at all counts as nothing open", async () => {
  const { openTradeCountFromKv } = await import("../../src/storage");
  expect(await openTradeCountFromKv(envWith(makeKv()))).toBe(0);
});

test("with nothing open, the trade cron never reads or parses the log", async () => {
  vi.useFakeTimers({ now: new Date("2026-09-26T03:00:00+05:30"), toFake: ["Date"] }); // Saturday night
  const { saveTradeLogsToKv } = await import("../../src/storage");
  const { runTradeLogAdvanceCheck } = await import("../../src/tradeLogCron");
  const kv = makeKv();
  kv.store.set("access_token", "tok");
  await saveTradeLogsToKv(envWith(kv), { A: [closedTrade("a1")], B: [closedTrade("b1")] });
  kv.reads.length = 0;
  await runTradeLogAdvanceCheck(envWith(kv));
  expect(bodyReads(kv, "trade_logs_v1")).toHaveLength(0);
  expect(fetchCalls.filter((u) => u.includes("upstox"))).toHaveLength(0);
});

test("every save gets a new revision, and it can be read without the body", async () => {
  const { saveTradeLogsToKv, tradeLogRevision, getTradeLogsWithRev } = await import("../../src/storage");
  const kv = makeKv();
  await saveTradeLogsToKv(envWith(kv), { A: [openTrade("a")] });
  const r1 = await tradeLogRevision(envWith(kv));
  await saveTradeLogsToKv(envWith(kv), { A: [openTrade("a")] });
  const r2 = await tradeLogRevision(envWith(kv));
  expect(r1).toBeTruthy();
  expect(r2).not.toBe(r1);
  expect((await getTradeLogsWithRev(envWith(kv))).rev).toBe(r2);
});

// ---------------------------------------------------------------------------
// News: one rotating third of the feeds per run
// ---------------------------------------------------------------------------

const feedXml = (u: string) =>
  `<rss><channel><item><title>Oil story from ${u}</title><link>${u}#1</link><pubDate>${new Date().toUTCString()}</pubDate><description>crude oil</description></item></channel></rss>`;

const countFeeds = async () => (await import("../../src/news")).TRUSTED_FEED_COUNT;

test("from an empty cache, three runs fetch every feed exactly once and fill the cache", async () => {
  vi.useFakeTimers({ now: new Date("2026-09-23T14:00:00+05:30"), toFake: ["Date"] });
  globalThis.fetch = (async (u: RequestInfo | URL) => { fetchCalls.push(String(u)); return new Response(feedXml(String(u))); }) as typeof fetch;
  const { warmEnergyNews, fetchEnergyNews } = await import("../../src/news");
  const feeds = await countFeeds();
  const kv = makeKv();
  const perRun: number[] = [];
  for (let i = 0; i < 3; i++) {
    const before = fetchCalls.length;
    await warmEnergyNews(envWith(kv));
    perRun.push(fetchCalls.length - before);
    vi.setSystemTime(Date.now() + 10 * 60_000);
  }
  for (const n of perRun) expect(n).toBeLessThanOrEqual(Math.ceil(feeds / 3));
  expect(new Set(fetchCalls).size).toBe(feeds);
  expect(fetchCalls).toHaveLength(feeds);
  const cached = await fetchEnergyNews(envWith(kv));
  expect(new Set(cached.articles.map((a) => a.source)).size).toBe(feeds);
  expect(cached.sourceStatus).toHaveLength(feeds);
});

test("once full, a run refreshes a third and carries every other source forward", async () => {
  vi.useFakeTimers({ now: new Date("2026-09-23T14:00:00+05:30"), toFake: ["Date"] });
  globalThis.fetch = (async (u: RequestInfo | URL) => { fetchCalls.push(String(u)); return new Response(feedXml(String(u))); }) as typeof fetch;
  const { warmEnergyNews, fetchEnergyNews } = await import("../../src/news");
  const kv = makeKv();
  for (let i = 0; i < 3; i++) { await warmEnergyNews(envWith(kv)); vi.setSystemTime(Date.now() + 10 * 60_000); }
  const full = await fetchEnergyNews(envWith(kv));
  fetchCalls.length = 0;
  await warmEnergyNews(envWith(kv));
  expect(fetchCalls.length).toBeLessThanOrEqual(Math.ceil((await countFeeds()) / 3));
  const after = await fetchEnergyNews(envWith(kv));
  expect(new Set(after.articles.map((a) => a.source))).toEqual(new Set(full.articles.map((a) => a.source)));
  expect(after.sourceStatus.map((s) => s.source)).toEqual(full.sourceStatus.map((s) => s.source));
});

test("a page request on an empty cache fetches one batch, not every feed", async () => {
  const { fetchEnergyNews } = await import("../../src/news");
  globalThis.fetch = (async (u: RequestInfo | URL) => { fetchCalls.push(String(u)); return new Response(feedXml(String(u))); }) as typeof fetch;
  await fetchEnergyNews(envWith(makeKv()));
  expect(fetchCalls.length).toBeLessThanOrEqual(Math.ceil((await countFeeds()) / 3));
  expect(fetchCalls.length).toBeGreaterThan(0);
});

// ---------------------------------------------------------------------------
// Candles: pre-bucketed prior days give the same bars as bucketing everything
// ---------------------------------------------------------------------------

test("pre-bucketed history produces exactly the bars a full re-bucket would", async () => {
  vi.useFakeTimers({ now: new Date("2026-09-23T14:00:00+05:30"), toFake: ["Date"] });
  const pad = (n: number) => String(n).padStart(2, "0");
  const day = (d: number, toMin: number, start: number) => {
    const rows: unknown[][] = [];
    let p = start;
    for (let m = 540; m < toMin; m++) { const o = p; p += Math.sin(m + d) * 3; rows.push([`2026-09-${pad(d)}T${pad(Math.floor(m / 60))}:${pad(m % 60)}:00+05:30`, o, Math.max(o, p) + 1, Math.min(o, p) - 1, p, 10, 5000 + m]); }
    return rows;
  };
  const prior = [...day(17, 1410, 9000), ...day(18, 1410, 9050), ...day(21, 1410, 9100), ...day(22, 1410, 9080)];
  const today = day(23, 840, 9120);
  globalThis.fetch = (async (u: RequestInfo | URL) => {
    const url = String(u);
    const rows = url.includes("/intraday/") ? today : prior;
    return new Response(JSON.stringify({ status: "success", data: { candles: [...rows].reverse() } }));
  }) as typeof fetch;
  const { getCandlesForTF } = await import("../../src/signals");
  const toCandle = (r: unknown[]) => ({ date: r[0] as string, open: r[1] as number, high: r[2] as number, low: r[3] as number, close: r[4] as number, volume: r[5] as number, oi: r[6] as number });
  const all = [...prior, ...today].map(toCandle);
  const fut = { instrument_key: `MCX_FO|EQ-${Math.random()}`, expiry: "2026-10-19", trading_symbol: "X" };
  for (const tf of [5, 15, 30, 60, 240]) {
    const got = await getCandlesForTF(envWith(makeKv()), "tok", fut, String(tf));
    expect(got).toEqual(resampleCandles(all, tf));
  }
});

// ---------------------------------------------------------------------------
// The split cron
// ---------------------------------------------------------------------------

test("each trigger runs only its own jobs, and Best Call is not scheduled at all", async () => {
  vi.resetModules();
  const calls: string[] = [];
  vi.doMock("../../src/notify", () => ({
    runTwentyTwentyNotificationCheck: async () => { calls.push("twenty"); },
    runBestCallNotificationCheck: async () => { calls.push("bestcall"); },
  }));
  vi.doMock("../../src/expiryAlerts", () => ({ runExpiryAlertCheck: async () => { calls.push("expiry"); } }));
  vi.doMock("../../src/globalMarkets", () => ({ captureOvernightAnchor: async () => { calls.push("anchor"); } }));
  let tradesOpen = true;
  vi.doMock("../../src/tradeLogCron", () => ({ runTradeLogAdvanceCheck: async () => { calls.push("trades"); return tradesOpen; } }));
  vi.doMock("../../src/news", () => ({ warmEnergyNews: async () => { calls.push("news"); } }));
  vi.doMock("../../src/profiles", () => ({ warmTimeProfiles: async () => { calls.push("profile"); } }));
  const cron = await import("../../src/cron");
  const waits: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => waits.push(p) } as never;
  const run = async (c: string) => { calls.length = 0; waits.length = 0; await cron.runScheduled(envWith(makeKv()), ctx, c); await Promise.all(waits); return [...calls].sort(); };

  expect(await run(cron.CRON_FAST)).toEqual(["anchor", "expiry", "twenty"]);
  // Trades open -> the run's CPU goes to them, and the profile waits.
  expect(await run(cron.CRON_TRADES)).toEqual(["trades"]);
  tradesOpen = false;
  expect(await run(cron.CRON_TRADES)).toEqual(["profile", "trades"]);
  expect(await run(cron.CRON_WARM)).toEqual(["news"]);
  vi.doUnmock("../../src/notify"); vi.doUnmock("../../src/expiryAlerts"); vi.doUnmock("../../src/globalMarkets");
  vi.doUnmock("../../src/tradeLogCron"); vi.doUnmock("../../src/news"); vi.doUnmock("../../src/profiles");
  vi.resetModules();
});

test("wrangler.jsonc declares exactly the three triggers the dispatcher knows", async () => {
  // Loaded through a variable so the Workers typecheck (which has no Node
  // types) does not try to resolve it; vitest runs this from the repo root.
  const fsModule = "node:fs";
  const fs: { readFileSync(path: string, enc: string): string } = await import(fsModule);
  const cron = await import("../../src/cron");
  const text = fs.readFileSync("wrangler.jsonc", "utf8");
  const crons = JSON.parse(/"crons":\s*(\[[^\]]*\])/.exec(text)![1]);
  expect(crons.sort()).toEqual([cron.CRON_FAST, cron.CRON_TRADES, cron.CRON_WARM].sort());
});
