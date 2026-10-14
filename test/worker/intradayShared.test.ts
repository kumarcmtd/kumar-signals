import { afterEach, expect, test, vi } from "vitest";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.resetModules(); });

const rows = [["2026-10-14T09:00:00+05:30", 100, 101, 99, 100.5, 10, 5000], ["2026-10-14T09:01:00+05:30", 100.5, 101, 100, 100.8, 10, 5000]];
const ok = () => new Response(JSON.stringify({ status: "success", data: { candles: rows } }));
const rateLimited = () => new Response("<html>error code: 1015</html>", { status: 429 });
function makeKv() {
  const store = new Map<string, string>();
  return { get: async (k: string) => store.get(k) ?? null, put: async (k: string, v: string) => void store.set(k, v) } as unknown as KVNamespace;
}
/** A fresh module instance = another isolate (empty in-memory cache), same KV. */
async function isolate(kv: KVNamespace) {
  vi.resetModules();
  const m = await import("../../src/upstox");
  m.bindSharedCache({ COMMODITY_KV: kv } as never);
  return m;
}

test("another isolate reuses the shared copy instead of calling Upstox again", async () => {
  vi.useFakeTimers({ now: new Date("2026-10-14T10:00:00+05:30"), toFake: ["Date"] });
  const kv = makeKv();
  let calls = 0;
  vi.stubGlobal("fetch", vi.fn(async () => { calls++; return ok(); }));
  expect(await (await isolate(kv)).getIntradayCandles("t", "K")).toHaveLength(2);
  expect(await (await isolate(kv)).getIntradayCandles("t", "K")).toHaveLength(2);
  expect(calls).toBe(1);
  vi.setSystemTime(Date.now() + 20_000); // older than 15 s: refreshed
  await (await isolate(kv)).getIntradayCandles("t", "K");
  expect(calls).toBe(2);
});

test("when Upstox rate-limits, a recent copy is served instead of an error", async () => {
  vi.useFakeTimers({ now: new Date("2026-10-14T10:00:00+05:30"), toFake: ["Date"] });
  const kv = makeKv();
  vi.stubGlobal("fetch", vi.fn(async () => ok()));
  await (await isolate(kv)).getIntradayCandles("t", "K");
  vi.setSystemTime(Date.now() + 2 * 60_000);
  vi.stubGlobal("fetch", vi.fn(async () => rateLimited()));
  expect(await (await isolate(kv)).getIntradayCandles("t", "K")).toHaveLength(2);
  // With nothing recent to fall back on, the rate limit is still reported.
  vi.setSystemTime(Date.now() + 20 * 60_000);
  await expect((await isolate(kv)).getIntradayCandles("t", "K")).rejects.toThrow(/1015/);
});
