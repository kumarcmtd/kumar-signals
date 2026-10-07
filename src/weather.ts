// Weather demand for natural gas: the same weeks in the last three years
// against this year's observed weather and the 16-day forecast, for the
// regions whose weather moves gas demand the most.
//
// Gas demand follows temperature: heating in winter (heating degree days,
// HDD) and air-conditioning power burn in summer (cooling degree days, CDD).
// A day's HDD = max(0, 65°F - mean temp), CDD = max(0, mean temp - 65°F),
// mean = (max + min) / 2 -- the convention NOAA and EIA use. Each region is a
// weighted average of big gas-consuming cities; the weights are an
// approximation of where the demand is, not an official index.
//
// Source: Open-Meteo (free, no key). History from its ERA5 archive, this
// year's last 4 weeks and the next 16 days from its forecast API. History is
// cached a day, the forecast 3 hours, which keeps well inside the free limits.

import { cachePut, type Env } from "./env";

export interface WeatherDay {
  date: string; // YYYY-MM-DD
  tC: number; // weighted mean temperature, °C
  hdd: number; // °F degree days, base 65°F
  cdd: number;
  forecast?: boolean;
}

export interface WeatherRegion {
  id: "US" | "EU" | "ASIA";
  name: string;
  why: string;
  cities: { name: string; weight: number }[];
  current: WeatherDay[]; // today-28 .. today+15 (forecast from today)
  past: { year: number; days: WeatherDay[] }[]; // the same calendar days, today-28 .. today+83
}

export interface WeatherResponse {
  asOf: string; // today, YYYY-MM-DD
  source: string;
  regions: WeatherRegion[];
  fetchedAt: string;
  error?: string;
}

interface City {
  name: string;
  lat: number;
  lon: number;
  weight: number;
}

const REGIONS: { id: WeatherRegion["id"]; name: string; why: string; cities: City[] }[] = [
  {
    id: "US",
    name: "United States",
    why: "Sets the Henry Hub price that MCX Natural Gas follows. Cold Midwest/Northeast = heating demand; hot Texas/South = power burn.",
    cities: [
      { name: "Chicago", lat: 41.88, lon: -87.63, weight: 0.2 },
      { name: "New York", lat: 40.71, lon: -74.01, weight: 0.2 },
      { name: "Detroit", lat: 42.33, lon: -83.05, weight: 0.1 },
      { name: "Philadelphia", lat: 39.95, lon: -75.17, weight: 0.1 },
      { name: "Boston", lat: 42.36, lon: -71.06, weight: 0.08 },
      { name: "Minneapolis", lat: 44.98, lon: -93.27, weight: 0.08 },
      { name: "Dallas", lat: 32.78, lon: -96.8, weight: 0.09 },
      { name: "Houston", lat: 29.76, lon: -95.37, weight: 0.08 },
      { name: "Atlanta", lat: 33.75, lon: -84.39, weight: 0.07 },
    ],
  },
  {
    id: "EU",
    name: "Europe",
    why: "Largest LNG buyer. A cold Europe pulls US LNG exports, which supports Henry Hub.",
    cities: [
      { name: "Berlin", lat: 52.52, lon: 13.4, weight: 0.3 },
      { name: "London", lat: 51.51, lon: -0.13, weight: 0.25 },
      { name: "Milan", lat: 45.46, lon: 9.19, weight: 0.25 },
      { name: "Paris", lat: 48.86, lon: 2.35, weight: 0.2 },
    ],
  },
  {
    id: "ASIA",
    name: "East Asia",
    why: "Japan, Korea and China compete with Europe for LNG cargoes in winter and summer peaks.",
    cities: [
      { name: "Tokyo", lat: 35.68, lon: 139.69, weight: 0.4 },
      { name: "Seoul", lat: 37.57, lon: 126.98, weight: 0.25 },
      { name: "Shanghai", lat: 31.23, lon: 121.47, weight: 0.2 },
      { name: "Beijing", lat: 39.9, lon: 116.4, weight: 0.15 },
    ],
  },
];

const ALL_CITIES = REGIONS.flatMap((r) => r.cities);
const PAST_YEARS = 3;
const DAYS_BEFORE = 28;
const DAYS_AFTER_PAST = 83; // 12 weeks from today in past years
const FORECAST_DAYS = 16;
const HIST_TTL = 26 * 60 * 60;
const FORECAST_TTL = 3 * 60 * 60;

/** One city's daily max/min temperatures (°C), keyed by date. */
type CitySeries = Map<string, { max: number; min: number }>;

/** Parses Open-Meteo daily JSON (one object, or an array for several locations). */
export function parseOpenMeteo(json: unknown): CitySeries[] {
  const list = Array.isArray(json) ? json : [json];
  return list.map((loc: any) => {
    const out: CitySeries = new Map();
    const d = loc?.daily ?? {};
    const time: unknown[] = d.time ?? [];
    time.forEach((t, i) => {
      const max = d.temperature_2m_max?.[i];
      const min = d.temperature_2m_min?.[i];
      if (typeof t === "string" && typeof max === "number" && typeof min === "number") out.set(t, { max, min });
    });
    return out;
  });
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** HDD/CDD in °F degree days from a mean temperature in °C. */
export function degreeDays(meanC: number): { hdd: number; cdd: number } {
  const f = meanC * 1.8 + 32;
  return { hdd: Math.max(0, 65 - f), cdd: Math.max(0, f - 65) };
}

/**
 * The region's weighted day for each date. A city missing a day is left out
 * and the remaining weights rescaled; a day with under half the weight
 * present is dropped rather than guessed.
 */
export function regionDays(cities: { weight: number; series: CitySeries }[], dates: string[], forecastFrom: string | null): WeatherDay[] {
  const out: WeatherDay[] = [];
  for (const date of dates) {
    let w = 0;
    let t = 0;
    let hdd = 0;
    let cdd = 0;
    for (const c of cities) {
      const v = c.series.get(date);
      if (!v) continue;
      const mean = (v.max + v.min) / 2;
      const dd = degreeDays(mean);
      w += c.weight;
      t += c.weight * mean;
      hdd += c.weight * dd.hdd;
      cdd += c.weight * dd.cdd;
    }
    const total = cities.reduce((s, c) => s + c.weight, 0);
    if (w < total / 2) continue;
    const day: WeatherDay = { date, tC: r1(t / w), hdd: r1(hdd / w), cdd: r1(cdd / w) };
    if (forecastFrom && date >= forecastFrom) day.forecast = true;
    out.push(day);
  }
  return out;
}

export function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** The same month-day in an earlier year (29 Feb becomes 28 Feb). */
export function shiftYears(date: string, years: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dd = m === 2 && d === 29 ? 28 : d;
  return `${y - years}-${String(m).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

const coords = () => `latitude=${ALL_CITIES.map((c) => c.lat).join(",")}&longitude=${ALL_CITIES.map((c) => c.lon).join(",")}`;

async function openMeteo(url: string): Promise<CitySeries[]> {
  const res = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "KumarSignalsPro/1.0" } });
  if (!res.ok) throw new Error(`Open-Meteo returned ${res.status}`);
  const series = parseOpenMeteo(await res.json());
  if (series.length !== ALL_CITIES.length) throw new Error("Open-Meteo returned an unexpected number of locations");
  return series;
}

async function cached<T>(env: Env, key: string, ttl: number, load: () => Promise<T>): Promise<T> {
  const hit = await env.COMMODITY_KV.get(key);
  if (hit) {
    try {
      return JSON.parse(hit) as T;
    } catch {
      // refetch
    }
  }
  const value = await load();
  await cachePut(env.COMMODITY_KV, key, JSON.stringify(value), { expirationTtl: ttl });
  return value;
}

/** Splits the flat per-city list back into regions. */
function byRegion(series: CitySeries[]) {
  let i = 0;
  return REGIONS.map((r) => r.cities.map((c) => ({ weight: c.weight, series: series[i++] })));
}

export async function computeWeather(env: Env, now = new Date()): Promise<WeatherResponse> {
  const today = now.toISOString().slice(0, 10);
  const base = { asOf: today, source: "Open-Meteo (ERA5 history + forecast models)", fetchedAt: now.toISOString() };
  const daily = "daily=temperature_2m_max,temperature_2m_min&timezone=auto";
  try {
    const [forecast, ...history] = await Promise.all([
      cached(env, `weather:fc:v1:${today}:${now.getUTCHours() >> 2}`, FORECAST_TTL, async () => {
        const s = await openMeteo(`https://api.open-meteo.com/v1/forecast?${coords()}&${daily}&past_days=${DAYS_BEFORE}&forecast_days=${FORECAST_DAYS}`);
        return regionDaysAll(s, dateRange(addDays(today, -DAYS_BEFORE), addDays(today, FORECAST_DAYS - 1)), today);
      }),
      ...Array.from({ length: PAST_YEARS }, (_, k) => {
        const from = shiftYears(addDays(today, -DAYS_BEFORE), k + 1);
        const to = shiftYears(addDays(today, DAYS_AFTER_PAST), k + 1);
        return cached(env, `weather:hist:v1:${today}:${k + 1}`, HIST_TTL, async () => {
          const s = await openMeteo(`https://archive-api.open-meteo.com/v1/archive?${coords()}&${daily}&start_date=${from}&end_date=${to}`);
          return regionDaysAll(s, dateRange(from, to), null);
        });
      }),
    ]);
    const regions: WeatherRegion[] = REGIONS.map((r, ri) => ({
      id: r.id,
      name: r.name,
      why: r.why,
      cities: r.cities.map((c) => ({ name: c.name, weight: c.weight })),
      current: forecast[ri],
      past: history.map((h, k) => ({ year: now.getUTCFullYear() - (k + 1), days: h[ri] })),
    }));
    return { ...base, regions };
  } catch (e: any) {
    return { ...base, regions: [], error: e?.message ?? "Could not load weather" };
  }
}

function regionDaysAll(series: CitySeries[], dates: string[], forecastFrom: string | null): WeatherDay[][] {
  return byRegion(series).map((cities) => regionDays(cities, dates, forecastFrom));
}
