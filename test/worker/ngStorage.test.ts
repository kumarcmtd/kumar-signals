import { afterEach, expect, test, vi } from "vitest";
import { computeNgStorage, parseEiaWeeks, storageCacheTtl } from "../../src/ngStorage";

afterEach(() => vi.unstubAllGlobals());

test("parses EIA rows oldest-first, dropping bad values and duplicates", () => {
  const json = {
    response: {
      data: [
        { period: "2026-10-02", value: "3812" },
        { period: "2026-09-25", value: 3732 },
        { period: "2026-09-25", value: 3732 },
        { period: "2026-09-18", value: null },
        { period: "bad", value: 1 },
      ],
    },
  };
  expect(parseEiaWeeks(json)).toEqual([
    { period: "2026-09-25", value: 3732 },
    { period: "2026-10-02", value: 3812 },
  ]);
  expect(parseEiaWeeks({})).toEqual([]);
});

test("cache is short only around the Thursday release", () => {
  expect(storageCacheTtl(Date.parse("2026-10-08T14:40:00Z"))).toBe(180); // Thu 20:10 IST
  expect(storageCacheTtl(Date.parse("2026-10-08T06:00:00Z"))).toBe(1800); // Thu 11:30 IST
  expect(storageCacheTtl(Date.parse("2026-10-07T14:40:00Z"))).toBe(1800); // Wednesday
});

test("no key: a clear error and no fetch", async () => {
  const f = vi.fn();
  vi.stubGlobal("fetch", f);
  const r = await computeNgStorage({ COMMODITY_KV: { get: async () => null } } as any);
  expect(r.error).toContain("EIA_API_KEY");
  expect(f).not.toHaveBeenCalled();
});

test("fetches ~6 years in one call and caches it", async () => {
  const data = Array.from({ length: 330 }, (_, i) => ({ period: new Date(Date.UTC(2026, 9, 2) - i * 7 * 86_400_000).toISOString().slice(0, 10), value: 3000 + i }));
  let url = "";
  vi.stubGlobal("fetch", async (u: string) => {
    url = u;
    return new Response(JSON.stringify({ response: { data } }));
  });
  const put = vi.fn(async () => undefined);
  const r = await computeNgStorage({ EIA_API_KEY: "k", COMMODITY_KV: { get: async () => null, put } } as any);
  expect(r.error).toBeUndefined();
  expect(r.weeks).toHaveLength(330);
  expect(r.weeks[0].period < r.weeks[329].period).toBe(true);
  expect(url).toContain("NW2_EPG0_SWO_R48_BCF");
  expect(url).toContain("length=330");
  expect(put).toHaveBeenCalledOnce();
});
