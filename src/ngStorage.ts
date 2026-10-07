// US natural gas storage history for the "storage vs past years" card.
//
// The EIA's Weekly Natural Gas Storage Report (Lower 48 working gas, Bcf) is
// the other big driver of Henry Hub after weather: more gas in storage than
// usual for the time of year tends to weigh on price, less tends to support
// it. This returns about six years of weekly levels so the page can compare
// with last year, the last three years and the EIA's own yardstick, the
// five-year average. Uses the same EIA_API_KEY secret as the EIA inventory
// card.

import { mcxSessionAt } from "../frontend/src/utils/mcxSession";
import { cachePut, type Env } from "./env";

export interface StorageWeek {
  period: string; // week ending (Friday), YYYY-MM-DD
  value: number; // Bcf
}

export interface StorageResponse {
  source: string;
  weeks: StorageWeek[]; // oldest -> newest
  fetchedAt: string;
  error?: string;
}

const SERIES = "NW2_EPG0_SWO_R48_BCF";
const CACHE_KEY = "ngstorage:v1";
const WEEKS = 330; // ~6.3 years: five full past years for the 5-yr average, plus this year

/** Parses the EIA v2 response into oldest-first weeks, dropping bad rows and duplicates. */
export function parseEiaWeeks(json: any): StorageWeek[] {
  const rows: any[] = json?.response?.data ?? [];
  const byPeriod = new Map<string, number>();
  for (const r of rows) {
    const value = Number(r?.value);
    if (typeof r?.period === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.period) && Number.isFinite(value) && r.value !== null) byPeriod.set(r.period, value);
  }
  return [...byPeriod].map(([period, value]) => ({ period, value })).sort((a, b) => a.period.localeCompare(b.period));
}

/**
 * 30 minutes most of the week; 3 minutes on Thursday evening IST around the
 * 10:30 AM ET release (8:00 PM IST in US summer time, 9:00 PM in winter), so
 * the new week shows up promptly.
 */
export function storageCacheTtl(now: number = Date.now()): number {
  const s = mcxSessionAt(now);
  const near = s.weekday === 4 && s.minutes >= 19 * 60 + 50 && s.minutes <= 22 * 60;
  return near ? 3 * 60 : 30 * 60;
}

export async function computeNgStorage(env: Env): Promise<StorageResponse> {
  const base = { source: "U.S. EIA Weekly Natural Gas Storage Report (Lower 48 working gas)", fetchedAt: new Date().toISOString() };
  if (!env.EIA_API_KEY) return { ...base, weeks: [], error: "EIA_API_KEY not configured" };
  const hit = await env.COMMODITY_KV.get(CACHE_KEY);
  if (hit) {
    try {
      return JSON.parse(hit) as StorageResponse;
    } catch {
      // refetch
    }
  }
  try {
    const usp = new URLSearchParams({
      api_key: env.EIA_API_KEY,
      frequency: "weekly",
      "data[0]": "value",
      "facets[series][]": SERIES,
      "sort[0][column]": "period",
      "sort[0][direction]": "desc",
      length: String(WEEKS),
    });
    const res = await fetch(`https://api.eia.gov/v2/natural-gas/stor/wkly/data/?${usp.toString()}`);
    if (!res.ok) throw new Error(`EIA returned ${res.status}`);
    const weeks = parseEiaWeeks(await res.json());
    if (weeks.length < 60) return { ...base, weeks, error: "EIA returned too little storage history" };
    const result: StorageResponse = { ...base, weeks };
    await cachePut(env.COMMODITY_KV, CACHE_KEY, JSON.stringify(result), { expirationTtl: storageCacheTtl() });
    return result;
  } catch (e: any) {
    return { ...base, weeks: [], error: e?.message ?? "Could not load EIA storage" };
  }
}
