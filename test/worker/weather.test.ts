import { afterEach, expect, test, vi } from "vitest";
import { addDays, computeWeather, degreeDays, parseOpenMeteo, regionDays, shiftYears } from "../../src/weather";

afterEach(() => vi.unstubAllGlobals());

test("degree days use the 65°F base", () => {
  expect(degreeDays(0).hdd).toBeCloseTo(33); // 32°F
  expect(degreeDays(0).cdd).toBe(0);
  expect(degreeDays(30).cdd).toBeCloseTo(21); // 86°F
  expect(degreeDays(18.33).hdd).toBeCloseTo(0, 1);
});

test("parses one location or several, skipping days with no reading", () => {
  const loc = { daily: { time: ["2026-10-01", "2026-10-02"], temperature_2m_max: [10, null], temperature_2m_min: [0, 2] } };
  expect(parseOpenMeteo(loc)[0].get("2026-10-01")).toEqual({ max: 10, min: 0 });
  const two = parseOpenMeteo([loc, loc]);
  expect(two).toHaveLength(2);
  expect(two[1].has("2026-10-02")).toBe(false);
  expect(parseOpenMeteo({})[0].size).toBe(0);
});

test("region day is the weighted average, and a thin day is dropped", () => {
  const a = new Map([["d1", { max: 0, min: 0 }], ["d2", { max: 0, min: 0 }]]);
  const b = new Map([["d1", { max: 20, min: 20 }]]);
  const days = regionDays([{ weight: 0.75, series: a }, { weight: 0.25, series: b }], ["d1", "d2", "d3"], "d2");
  expect(days[0].tC).toBe(5);
  expect(days[1]).toMatchObject({ date: "d2", tC: 0, forecast: true }); // b missing: a alone (75%)
  expect(days).toHaveLength(2); // d3 has no data
});

test("date helpers", () => {
  expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
  expect(shiftYears("2028-02-29", 1)).toBe("2027-02-28");
  expect(shiftYears("2026-10-07", 3)).toBe("2023-10-07");
});

test("computeWeather builds three regions with three past years, and caches", async () => {
  const put = vi.fn(async () => undefined);
  const env = { COMMODITY_KV: { get: async () => null, put } } as any;
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    calls.push(url);
    const u = new URL(url);
    const n = u.searchParams.get("latitude")!.split(",").length;
    const start = u.searchParams.get("start_date") ?? "2026-09-09";
    const end = u.searchParams.get("end_date") ?? "2026-10-22";
    const time: string[] = [];
    for (let d = start; d <= end; d = addDays(d, 1)) time.push(d);
    const loc = { daily: { time, temperature_2m_max: time.map(() => 10), temperature_2m_min: time.map(() => 0) } };
    return new Response(JSON.stringify(Array.from({ length: n }, () => loc)));
  });
  const w = await computeWeather(env, new Date("2026-10-07T06:00:00Z"));
  expect(w.error).toBeUndefined();
  expect(w.regions.map((r) => r.id)).toEqual(["US", "EU", "ASIA"]);
  const us = w.regions[0];
  expect(us.past.map((p) => p.year)).toEqual([2025, 2024, 2023]);
  expect(us.past[2].days[0].date).toBe("2023-09-09");
  expect(us.current.find((d) => d.date === "2026-10-07")!.forecast).toBe(true);
  expect(us.current.find((d) => d.date === "2026-10-06")!.forecast).toBeUndefined();
  expect(us.current[0].hdd).toBeCloseTo(24); // mean 5°C = 41°F
  expect(calls).toHaveLength(4);
  expect(put).toHaveBeenCalledTimes(4);
});

test("an API failure is reported, not thrown", async () => {
  const env = { COMMODITY_KV: { get: async () => null, put: async () => undefined } } as any;
  vi.stubGlobal("fetch", async () => new Response("busy", { status: 429 }));
  const w = await computeWeather(env, new Date("2026-10-07T06:00:00Z"));
  expect(w.regions).toEqual([]);
  expect(w.error).toContain("429");
});
