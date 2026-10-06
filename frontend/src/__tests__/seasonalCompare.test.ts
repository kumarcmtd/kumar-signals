import { expect, test } from "vitest";
import { buildSeasonal, isoWeekOf, seasonGrid, type WeekBar } from "../utils/seasonalCompare";

test("ISO week numbers, including the year-boundary cases", () => {
  expect(isoWeekOf("2026-10-05")).toEqual({ year: 2026, week: 41 });
  expect(isoWeekOf("2025-12-29")).toEqual({ year: 2026, week: 1 }); // Monday belongs to 2026's week 1
  expect(isoWeekOf("2021-01-03")).toEqual({ year: 2020, week: 53 });
});

/** Weekly bars from Mon 2022-10-03 to Mon 2026-10-05; price = f(week index). */
function series(price: (i: number, date: Date) => number): WeekBar[] {
  const out: WeekBar[] = [];
  for (let t = Date.UTC(2022, 9, 3), i = 0; t <= Date.UTC(2026, 9, 5); t += 7 * 86_400_000, i++) {
    const d = new Date(t);
    const p = price(i, d);
    out.push({ date: d.toISOString().slice(0, 10), close: p, high: p, low: p, usdInr: 85 });
  }
  return out;
}

test("same ISO week each year, with the moves that followed", () => {
  // Price rises 0.1 every week of October-December, flat otherwise.
  const bars = series((i, d) => 3 + (d.getUTCMonth() >= 9 ? 0.1 * (i % 52) : 0));
  const v = buildSeasonal(bars)!;
  expect(v.week).toBe(41);
  expect(v.rows.map((r) => r.year)).toEqual([2026, 2025, 2024, 2023]);
  for (const r of v.rows) expect(isoWeekOf(r.date).week).toBe(41);
  const cur = v.rows[0];
  expect(cur.isCurrent).toBe(true);
  expect(cur.forwardPct[4]).toBeNull(); // the future is unknown
  expect(cur.inr).toBeCloseTo(cur.close * 85);
  // Every past year rose over the next 4 weeks in this series.
  const four = v.tendencies.find((t) => t.weeks === 4)!;
  expect(four).toMatchObject({ up: 3, down: 0, years: 3 });
  expect(four.avgPct!).toBeGreaterThan(0);
});

test("chart has one column per year, by week of year", () => {
  const v = buildSeasonal(series(() => 3))!;
  expect(v.chartYears).toEqual([2023, 2024, 2025, 2026]);
  const w41 = v.chart.find((p) => p.week === 41)!;
  expect(w41["2024"]).toBe(3);
});

test("too little history gives no view", () => {
  expect(buildSeasonal(series(() => 3).slice(-5))).toBeNull();
});

test("week-by-week grid keeps each season in its own column, across New Year", () => {
  const bars = series((i) => 3 + i * 0.01);
  const v = buildSeasonal(bars)!;
  const g = seasonGrid(bars, v, 14);
  expect(g).toHaveLength(15);
  const y2024 = g.map((r) => r.cells.find((c) => c.year === 2024)!);
  // 14 weeks after week 41 of 2024 is in January 2025 -- same column.
  expect(y2024[14].date!.startsWith("2025-01")).toBe(true);
  expect(y2024[1].close).toBeGreaterThan(y2024[0].close!);
  // The current year has no future weeks.
  expect(g[3].cells.find((c) => c.year === 2026)!.close).toBeNull();
});
