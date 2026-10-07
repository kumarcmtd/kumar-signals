import { expect, test } from "vitest";
import { buildStorage, readChange, readLevel, type StorageWeek } from "../utils/storageCompare";

/** Fridays from Jan 2020 to 2 Oct 2026; a seasonal curve plus `bump` Bcf in the given year. */
function series(bump: (year: number) => number): StorageWeek[] {
  const out: StorageWeek[] = [];
  for (let x = Date.UTC(2020, 0, 3); x <= Date.UTC(2026, 9, 2); x += 7 * 86_400_000) {
    const d = new Date(x);
    const doy = (x - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86_400_000;
    // Low ~1800 in early May, peak ~3800 in early November.
    const value = 2800 - 1000 * Math.cos(((doy - 128) / 365) * 2 * Math.PI) + bump(d.getUTCFullYear());
    out.push({ period: d.toISOString().slice(0, 10), value: Math.round(value) });
  }
  return out;
}

test("level vs last year and the 5-year average, matched by calendar date", () => {
  const v = buildStorage(series((y) => (y === 2026 ? 200 : 0)))!;
  expect(v.latest.period).toBe("2026-10-02");
  expect(v.latest.avg5).not.toBeNull();
  expect(v.latest.vs5Bcf!).toBeGreaterThan(170);
  expect(v.latest.vs5Bcf!).toBeLessThan(230);
  expect(v.latest.vsLyPct!).toBeGreaterThan(0);
  expect(v.pastSameWeek.map((p) => p.year)).toEqual([2025, 2024, 2023, 2022, 2021]);
  for (const p of v.pastSameWeek) expect(p.period.slice(5, 7)).toMatch(/09|10/);
  expect(readLevel(v.latest.vs5Pct).tone).toBe("bearish");
  expect(v.recent).toHaveLength(8);
  expect(v.recent[0].period).toBe("2026-10-02");
});

test("weekly change is an injection in autumn, and close to the usual one", () => {
  const v = buildStorage(series(() => 0))!;
  expect(v.latest.change!).toBeGreaterThan(0);
  expect(readChange(v.latest.change, v.latest.avg5Change).tone).toBe("neutral");
  expect(readChange(v.latest.change, v.latest.change! + 20).tone).toBe("bullish");
});

test("next 4 weeks: the usual change and the arithmetic projection", () => {
  const v = buildStorage(series(() => 0))!;
  expect(v.next4.byYear).toHaveLength(5);
  expect(v.next4.avg5!).toBeGreaterThan(0); // still injecting into early November
  expect(v.next4.projected).toBeCloseTo(v.latest.value + v.next4.avg5!);
});

test("season lows and peaks, next report time", () => {
  const v = buildStorage(series(() => 0))!;
  expect(v.seasons.map((s) => s.year)).toEqual([2023, 2024, 2025, 2026]);
  const s25 = v.seasons[2];
  expect(s25.peak!).toBeGreaterThan(3700);
  expect(s25.low!).toBeLessThan(1900);
  expect(v.seasons[3].peakPartial).toBe(true);
  expect(v.nextReport).toEqual({ date: "2026-10-15", istTime: "8:00 PM IST" });
  expect(v.chartYears).toEqual([2023, 2024, 2025, 2026]);
  expect(v.chart.find((p) => p.week === 10)!.min5).not.toBeNull();
});

test("too little history gives no view", () => {
  expect(buildStorage(series(() => 0).slice(-30))).toBeNull();
});
