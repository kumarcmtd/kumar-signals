import { afterEach, expect, test, vi } from "vitest";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.resetModules(); });

const feedXml = (u: string) => `<rss><channel><item><title>Oil story from ${u}</title><link>${u}#1</link><pubDate>${new Date().toUTCString()}</pubDate><description>crude oil</description></item></channel></rss>`;
function makeKv() {
  const store = new Map<string, string>();
  return { store, get: async (k: string) => store.get(k) ?? null, put: async (k: string, v: string) => void store.set(k, v) };
}

test("Scan now rebuilds every source, records the scan, and is not repeated within 45 s", async () => {
  vi.useFakeTimers({ now: new Date("2026-10-14T06:00:00+05:30"), toFake: ["Date"] });
  let calls = 0;
  vi.stubGlobal("fetch", vi.fn(async (u: string) => { calls++; return new Response(feedXml(String(u))); }));
  const { scanNewsNow, fetchEnergyNews, TRUSTED_FEED_COUNT } = await import("../../src/news");
  const kv = makeKv();
  const env = { COMMODITY_KV: kv } as any;
  const first = await scanNewsNow(env);
  expect(first.lastScan).toMatchObject({ ok: true, trigger: "manual", sourcesOk: TRUSTED_FEED_COUNT });
  const after = calls;
  await scanNewsNow(env); // 0 s later: served from the fresh cache
  expect(calls).toBe(after);
  vi.setSystemTime(Date.now() + 60_000);
  await scanNewsNow(env);
  expect(calls).toBeGreaterThan(after);
  expect((await fetchEnergyNews(env)).lastScan?.trigger).toBe("manual");
});

test("the automatic scan is recorded too", async () => {
  vi.useFakeTimers({ now: new Date("2026-10-14T06:00:00+05:30"), toFake: ["Date"] });
  vi.stubGlobal("fetch", vi.fn(async (u: string) => new Response(feedXml(String(u)))));
  const { warmEnergyNews, fetchEnergyNews } = await import("../../src/news");
  const env = { COMMODITY_KV: makeKv() } as any;
  await warmEnergyNews(env);
  const n = await fetchEnergyNews(env);
  expect(n.lastScan).toMatchObject({ ok: true, trigger: "auto" });
  expect(n.builtAt).toBeTruthy();
});
