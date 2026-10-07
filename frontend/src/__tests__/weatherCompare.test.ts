import { expect, test } from "vitest";
import { buildWeatherView, describe, type WeatherDay, type WeatherRegion } from "../utils/weatherCompare";

function days(from: string, n: number, hdd: (i: number) => number, forecastFrom?: string): WeatherDay[] {
  const out: WeatherDay[] = [];
  for (let i = 0; i < n; i++) {
    const date = new Date(Date.parse(`${from}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10);
    const d: WeatherDay = { date, tC: 5, hdd: hdd(i), cdd: 0 };
    if (forecastFrom && date >= forecastFrom) d.forecast = true;
    out.push(d);
  }
  return out;
}

const today = "2026-10-07";
const region: WeatherRegion = {
  id: "US",
  name: "United States",
  why: "",
  cities: [],
  // This year: 10 HDD a day, observed then forecast.
  current: days("2026-09-09", 44, () => 10, today),
  past: [
    { year: 2025, days: days("2025-09-09", 112, () => 8) },
    { year: 2024, days: days("2024-09-09", 112, () => 8) },
    { year: 2023, days: days("2023-09-09", 112, (i) => (i >= 28 ? 12 : 8)) }, // cold from 7 Oct
  ],
};

test("same calendar weeks per year, this year's future flagged as forecast", () => {
  const v = buildWeatherView(region, today)!;
  expect(v.metric).toBe("hdd");
  expect(v.mild).toBe(false);
  expect(v.years).toEqual([2023, 2024, 2025, 2026]);
  expect(v.weeks).toHaveLength(16);
  const w0 = v.weeks.find((w) => w.offset === 0)!;
  expect(w0.cells[2026]).toMatchObject({ value: 70, forecast: true });
  expect(w0.cells[2023]!.value).toBe(84);
  expect(v.weeks.find((w) => w.offset === -1)!.cells[2026]!.forecast).toBe(false);
  expect(v.weeks.find((w) => w.offset === 5)!.cells[2026]).toBeNull(); // beyond the forecast
});

test("next 14 days vs the 3-year average, and what followed in past years", () => {
  const v = buildWeatherView(region, today)!;
  expect(v.next14.now).toBe(140);
  expect(v.next14.avg).toBeCloseTo((112 + 112 + 168) / 3);
  expect(v.next14.diffPct).toBeCloseTo(7.14, 1);
  expect(describe(v.next14, "hdd").tone).toBe("normal");
  expect(v.last28.diffPct).toBeCloseTo(25);
  expect(describe(v.last28, "hdd").text).toContain("25% colder");
  expect(v.next4wkPast.find((p) => p.year === 2023)!.diffPct!).toBeGreaterThan(20);
});

test("a mild season is flagged, and empty data gives no view", () => {
  const mild = { ...region, past: region.past.map((p) => ({ ...p, days: p.days.map((d) => ({ ...d, hdd: 1 })) })) };
  expect(buildWeatherView(mild, today)!.mild).toBe(true);
  expect(buildWeatherView({ ...region, current: [] }, today)).toBeNull();
});
