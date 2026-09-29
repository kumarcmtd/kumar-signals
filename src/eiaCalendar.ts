// EIA inventory / storage data and the economic calendar.

import { type AffectedMarket, type EiaScoreResult, scoreEiaChange } from "../frontend/src/utils/newsScoring";
import { mcxSessionAt } from "../frontend/src/utils/mcxSession";
import { cachePut, type Env } from "./env";

export interface EiaFetchResult {
  available: boolean;
  crude: EiaScoreResult | null;
  ngStorage: EiaScoreResult | null;
  error?: string;
}

async function fetchEiaSeries(apiKey: string, path: string, seriesId: string): Promise<{ period: string; value: number }[]> {
  const usp = new URLSearchParams({
    api_key: apiKey,
    frequency: "weekly",
    "data[0]": "value",
    "facets[series][]": seriesId,
    "sort[0][column]": "period",
    "sort[0][direction]": "desc",
    length: "2",
  });
  const res = await fetch(`https://api.eia.gov/v2/${path}/data/?${usp.toString()}`);
  if (!res.ok) throw new Error(`EIA returned ${res.status}`);
  const json: any = await res.json();
  const rows = json?.response?.data ?? [];
  return rows.map((r: any) => ({ period: r.period, value: Number(r.value) })).filter((r: any) => Number.isFinite(r.value));
}

// The EIA figures change once a week; 8 minutes most of the week.
// Around the reports themselves (crude Wednesday, gas Thursday, 10:30 AM ET =
// 8:00 PM IST in US summer, 9:00 PM in winter) it drops to 3 minutes so the
// new number shows up promptly.
function eiaCacheTtlSeconds(now: number = Date.now()): number {
  const s = mcxSessionAt(now);
  const reportDay = s.weekday === 3 || s.weekday === 4;
  const nearRelease = s.minutes >= 19 * 60 + 50 && s.minutes <= 21 * 60 + 45;
  return reportDay && nearRelease ? 3 * 60 : 8 * 60;
}
const EIA_CACHE_KV_KEY = "news:eia:v2";

export async function fetchEiaData(env: Env): Promise<EiaFetchResult> {
  if (!env.EIA_API_KEY) return { available: false, crude: null, ngStorage: null, error: "EIA_API_KEY not configured" };
  const cached = await env.COMMODITY_KV.get(EIA_CACHE_KV_KEY);
  if (cached) {
    try {
      return JSON.parse(cached) as EiaFetchResult;
    } catch {
      // fall through and refetch
    }
  }
  try {
    const [crudeRows, ngRows] = await Promise.all([
      fetchEiaSeries(env.EIA_API_KEY, "petroleum/stoc/wstk", "WCESTUS1"),
      fetchEiaSeries(env.EIA_API_KEY, "natural-gas/stor/wkly", "NW2_EPG0_SWO_R48_BCF"),
    ]);
    const crude = crudeRows.length >= 2 ? scoreEiaChange("crude_inventory", crudeRows[0].value, crudeRows[1].value) : null;
    const ngStorage = ngRows.length >= 2 ? scoreEiaChange("ng_storage", ngRows[0].value, ngRows[1].value) : null;
    const result: EiaFetchResult = { available: crude !== null || ngStorage !== null, crude, ngStorage };
    await cachePut(env.COMMODITY_KV, EIA_CACHE_KV_KEY, JSON.stringify(result), { expirationTtl: eiaCacheTtlSeconds() });
    return result;
  } catch (e: any) {
    return { available: false, crude: null, ngStorage: null, error: e.message ?? "EIA fetch failed" };
  }
}

interface EconCalendarEvent {
  name: string;
  date: string;
  actual: number | null;
  previous: number | null;
  affects: AffectedMarket;
  impact: "HIGH" | "MEDIUM" | "LOW";
}

interface CalendarFetchResult {
  available: boolean;
  events: EconCalendarEvent[];
  error?: string;
}

// releaseId = FRED's release-calendar identifier (next scheduled date).
// seriesId = FRED's own observation series (real reported actual/previous
// values -- FRED's free API does not expose analyst consensus-forecast
// numbers, so "actual vs prior release" is shown rather than inventing a
// forecast figure).
const FRED_RELEASES: { name: string; releaseId: number; seriesId: string; affects: AffectedMarket; impact: "HIGH" | "MEDIUM" | "LOW" }[] = [
  { name: "CPI (Inflation)", releaseId: 10, seriesId: "CPIAUCSL", affects: "BOTH", impact: "HIGH" },
  { name: "Employment Situation (Jobs Report)", releaseId: 50, seriesId: "PAYEMS", affects: "BOTH", impact: "HIGH" },
  { name: "PPI", releaseId: 46, seriesId: "PPIACO", affects: "BOTH", impact: "MEDIUM" },
  { name: "GDP", releaseId: 53, seriesId: "GDP", affects: "BOTH", impact: "MEDIUM" },
  { name: "Fed Funds Rate Decision", releaseId: 101, seriesId: "FEDFUNDS", affects: "BOTH", impact: "HIGH" },
];

const CALENDAR_CACHE_TTL_SECONDS = 20 * 60;
const CALENDAR_CACHE_KV_KEY = "news:calendar:v2";

export async function fetchEconCalendar(env: Env): Promise<CalendarFetchResult> {
  if (!env.FRED_API_KEY) return { available: false, events: [], error: "FRED_API_KEY not configured" };
  const cached = await env.COMMODITY_KV.get(CALENDAR_CACHE_KV_KEY);
  if (cached) {
    try {
      return JSON.parse(cached) as CalendarFetchResult;
    } catch {
      // fall through and refetch
    }
  }
  try {
    const now = new Date().toISOString().slice(0, 10);
    const apiKey = env.FRED_API_KEY as string;
    const results = await Promise.all(
      FRED_RELEASES.map(async (rel) => {
        const dateUsp = new URLSearchParams({ release_id: String(rel.releaseId), api_key: apiKey, file_type: "json", realtime_start: now, sort_order: "asc", limit: "1" });
        const obsUsp = new URLSearchParams({ series_id: rel.seriesId, api_key: apiKey, file_type: "json", sort_order: "desc", limit: "2" });
        const [dateRes, obsRes] = await Promise.all([
          fetch(`https://api.stlouisfed.org/fred/release/dates?${dateUsp.toString()}`),
          fetch(`https://api.stlouisfed.org/fred/series/observations?${obsUsp.toString()}`),
        ]);
        if (!dateRes.ok) return null;
        const dateJson: any = await dateRes.json();
        const next = dateJson?.release_dates?.[0]?.date;
        if (!next) return null;
        let actual: number | null = null;
        let previous: number | null = null;
        if (obsRes.ok) {
          const obsJson: any = await obsRes.json();
          const obs = (obsJson?.observations ?? []).filter((o: any) => o?.value && o.value !== ".");
          if (obs[0]) actual = Number(obs[0].value);
          if (obs[1]) previous = Number(obs[1].value);
        }
        const event: EconCalendarEvent = {
          name: rel.name,
          date: next as string,
          actual: Number.isFinite(actual) ? actual : null,
          previous: Number.isFinite(previous) ? previous : null,
          affects: rel.affects,
          impact: rel.impact,
        };
        return event;
      })
    );
    const events = results.filter((e): e is EconCalendarEvent => e !== null).sort((a, b) => a.date.localeCompare(b.date));
    const result: CalendarFetchResult = { available: true, events };
    await cachePut(env.COMMODITY_KV, CALENDAR_CACHE_KV_KEY, JSON.stringify(result), { expirationTtl: CALENDAR_CACHE_TTL_SECONDS });
    return result;
  } catch (e: any) {
    return { available: false, events: [], error: e.message ?? "Economic calendar fetch failed" };
  }
}
