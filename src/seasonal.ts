// Weekly price history for the seasonal comparison on Price-Alerts:
// "what was the price THIS week of the year, in each of the last few years?"
//
// Natural gas is a seasonal market -- heating demand in winter, power burn in
// summer, storage injection and withdrawal around them -- so the same week
// in past years is a useful reference. Source: Yahoo Finance weekly bars for
// the NYMEX front-month future that MCX tracks (NG=F / CL=F), plus USD/INR
// (INR=X) for the same week, so each week also carries an approximate MCX
// rupee price (NYMEX $ x that week's USD/INR). Cached 6 hours: weekly bars
// change slowly and Yahoo is unofficial.

import { cachePut, type Env } from "./env";

export interface SeasonalWeek {
  date: string; // week start, YYYY-MM-DD (exchange time)
  open: number;
  high: number;
  low: number;
  close: number;
  usdInr: number | null;
}

export interface SeasonalResponse {
  symbol: "NATURALGAS" | "CRUDEOIL";
  source: string;
  unit: string;
  weeks: SeasonalWeek[];
  /** Calendar-month bars (date = first of the month), same shape as weeks. */
  months: SeasonalWeek[];
  fetchedAt: string;
  error?: string;
}

const YAHOO: Record<SeasonalResponse["symbol"], { ticker: string; source: string; unit: string }> = {
  NATURALGAS: { ticker: "NG=F", source: "NYMEX Henry Hub natural gas futures (front month), weekly", unit: "$/mmBtu" },
  CRUDEOIL: { ticker: "CL=F", source: "NYMEX WTI crude oil futures (front month), weekly", unit: "$/bbl" },
};
const CACHE_TTL_SECONDS = 6 * 60 * 60;

interface Bar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

/** Parses Yahoo's v8 chart JSON into dated bars, skipping weeks with no close. */
export function parseYahooChart(json: any): Bar[] {
  const r = json?.chart?.result?.[0];
  const ts: unknown[] = r?.timestamp ?? [];
  const q = r?.indicators?.quote?.[0] ?? {};
  const offset = typeof r?.meta?.gmtoffset === "number" ? r.meta.gmtoffset : 0;
  const out: Bar[] = [];
  ts.forEach((t, i) => {
    const close = q.close?.[i];
    if (typeof t !== "number" || typeof close !== "number" || !Number.isFinite(close)) return;
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : close);
    out.push({
      date: new Date((t + offset) * 1000).toISOString().slice(0, 10),
      open: num(q.open?.[i]),
      high: num(q.high?.[i]),
      low: num(q.low?.[i]),
      close,
    });
  });
  return out;
}

async function yahooBars(ticker: string, interval: "1wk" | "1mo"): Promise<Bar[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=${interval}&range=5y`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; KumarSignalsPro/1.0)", Accept: "application/json" } });
  if (!res.ok) throw new Error(`Yahoo Finance returned ${res.status} for ${ticker}`);
  return parseYahooChart(await res.json());
}

/** The USD/INR close for the week a date falls in (nearest earlier bar within 10 days). */
export function inrFor(date: string, fx: Bar[]): number | null {
  const t = Date.parse(date);
  let best: Bar | null = null;
  for (const b of fx) {
    const bt = Date.parse(b.date);
    if (bt <= t + 3 * 86_400_000 && t - bt <= 10 * 86_400_000) best = b; // fx is oldest-first
  }
  return best ? best.close : null;
}

const r2 = (n: number) => Math.round(n * 1000) / 1000;

export async function computeSeasonal(env: Env, symbol: SeasonalResponse["symbol"]): Promise<SeasonalResponse> {
  const cfg = YAHOO[symbol];
  const cacheKey = `seasonal:v2:${symbol}`;
  const cached = await env.COMMODITY_KV.get(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached) as SeasonalResponse;
    } catch {
      // fall through and refetch
    }
  }
  const base = { symbol, source: cfg.source, unit: cfg.unit, fetchedAt: new Date().toISOString() };
  try {
    const [bars, fx, monthBars, fxMonths] = await Promise.all([
      yahooBars(cfg.ticker, "1wk"),
      yahooBars("INR=X", "1wk").catch(() => [] as Bar[]),
      yahooBars(cfg.ticker, "1mo").catch(() => [] as Bar[]),
      yahooBars("INR=X", "1mo").catch(() => [] as Bar[]),
    ]);
    if (bars.length === 0) return { ...base, weeks: [], months: [], error: "Yahoo Finance returned no weekly history" };
    const weeks: SeasonalWeek[] = bars.map((b) => ({ date: b.date, open: r2(b.open), high: r2(b.high), low: r2(b.low), close: r2(b.close), usdInr: inrFor(b.date, fx) }));
    // Monthly bars can be stamped on the 1st in exchange time or the last day
    // of the previous month in UTC; normalise to YYYY-MM-01 of the month the
    // bar mostly covers (a stamp after the 25th belongs to the next month).
    const months: SeasonalWeek[] = monthBars.map((b) => {
      const [y, m, d] = b.date.split("-").map(Number);
      const first = d > 25 ? new Date(Date.UTC(y, m, 1)) : new Date(Date.UTC(y, m - 1, 1));
      const key = first.toISOString().slice(0, 10);
      const fxBar = fxMonths.find((f) => f.date.slice(0, 7) === key.slice(0, 7)) ?? null;
      return { date: key, open: r2(b.open), high: r2(b.high), low: r2(b.low), close: r2(b.close), usdInr: fxBar ? fxBar.close : inrFor(key, fx) };
    });
    const result: SeasonalResponse = { ...base, weeks, months };
    await cachePut(env.COMMODITY_KV, cacheKey, JSON.stringify(result), { expirationTtl: CACHE_TTL_SECONDS });
    return result;
  } catch (e: any) {
    return { ...base, weeks: [], months: [], error: e?.message ?? "Could not load weekly history" };
  }
}
