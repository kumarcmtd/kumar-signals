// Upstox market data: the cached futures-contract list (nearest and
// upcoming, memory + KV) and daily / intraday / stitched-history candles.

import { expiryStillLive } from "../frontend/src/utils/mcxSession";
import { resampleCandles } from "../frontend/src/utils/candleResample";
import { type Candle, type Env, type FutureInfo, UPSTOX_HIST_URL, UPSTOX_INTRADAY_URL, UPSTOX_SEARCH_URL, upstoxJson } from "./env";

// ---- Futures contract list ----
// The nearest future was being looked up on EVERY request -- candles, options,
// depth, prices, the gap study -- to resolve a contract that only changes when
// one expires. And getUpcomingFutures ran the IDENTICAL search a second time,
// uncached, whenever the option-chain fallback needed the next contracts.
//
// Now there is one list per symbol, fetched once and read two ways, cached in
// two layers:
//   * isolate memory, 15 minutes -- free, and absorbs the per-poll traffic;
//   * KV, 6 hours -- shared across every isolate AND the cron, so a cold
//     isolate or the 5-minute cron does not each go back to Upstox.
// The Cache API would be the obvious shared layer, but it is a no-op on
// *.workers.dev deployments, which is where this app runs.
//
// A long TTL is safe because contracts that have EXPIRED are dropped when the
// list is read (expiryStillLive), so on expiry evening the cached list's first
// entry simply becomes next month -- no refetch needed to roll.
const FUTURES_MEM_TTL_MS = 15 * 60 * 1000;
const FUTURES_KV_TTL_S = 6 * 60 * 60;
const futuresListCache = new Map<string, { at: number; list: FutureInfo[] }>();

// The KV namespace for the shared caches, bound at each entry point (fetch and
// scheduled). An isolate only ever has one binding, so this is the same object
// for every request it serves -- it exists so thirteen call sites of
// getNearestFuture do not each need env threaded through them.
/**
 * Oldest first. Each stamp is parsed once, not once per comparison: the old
 * comparator parsed two dates per compare, ~40,000 parses for 90 days of bars,
 * which alone was several ms of the free plan's 10. Upstox sends newest first,
 * so the usual case is a plain reverse.
 */
export function sortByTime(candles: Candle[]): void {
  const t = candles.map((c) => +new Date(c.date));
  let descending = true;
  let ascending = true;
  for (let i = 1; i < t.length && (descending || ascending); i++) {
    if (!(t[i] < t[i - 1])) descending = false;
    if (!(t[i] >= t[i - 1])) ascending = false;
  }
  if (ascending) return;
  if (descending) {
    candles.reverse();
    return;
  }
  const order = candles.map((c, i) => [c, t[i]] as const).sort((x, y) => x[1] - y[1]);
  for (let i = 0; i < order.length; i++) candles[i] = order[i][0];
}

export let sharedKv: KVNamespace | null = null;
export function bindSharedCache(env: Env): void {
  sharedKv = env.COMMODITY_KV;
}

function liveFutures(list: FutureInfo[]): FutureInfo[] {
  const now = Date.now();
  return list.filter((f) => expiryStillLive(f.expiry, now));
}

async function fetchFuturesList(token: string, query: string): Promise<FutureInfo[]> {
  const usp = new URLSearchParams({ query, exchanges: "MCX", instrument_types: "FUT", records: "10" });
  const res = await fetch(`${UPSTOX_SEARCH_URL}?${usp.toString()}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  const json: any = await upstoxJson(res, "the futures contract list");
  if (json.status !== "success" || !json.data || !json.data.length) return [];
  return [...json.data]
    .sort((a: any, b: any) => +new Date(a.expiry) - +new Date(b.expiry))
    .map((c: any) => ({ instrument_key: c.instrument_key, expiry: c.expiry, trading_symbol: c.trading_symbol }));
}

async function getFuturesList(token: string, query: string): Promise<FutureInfo[]> {
  const mem = futuresListCache.get(query);
  if (mem && Date.now() - mem.at < FUTURES_MEM_TTL_MS) {
    const live = liveFutures(mem.list);
    if (live.length) return live;
  }

  const kvKey = `futures:list:v1:${query}`;
  if (sharedKv) {
    const raw = await sharedKv.get(kvKey).catch(() => null);
    if (raw) {
      try {
        const live = liveFutures(JSON.parse(raw) as FutureInfo[]);
        if (live.length) {
          futuresListCache.set(query, { at: Date.now(), list: live });
          return live;
        }
      } catch {
        // corrupt entry -- fall through and refetch
      }
    }
  }

  const list = liveFutures(await fetchFuturesList(token, query));
  // An empty result is never cached: caching nothing would keep the whole app
  // dark for the full TTL after a single blip.
  if (list.length) {
    futuresListCache.set(query, { at: Date.now(), list });
    if (sharedKv) await sharedKv.put(kvKey, JSON.stringify(list), { expirationTtl: FUTURES_KV_TTL_S }).catch(() => undefined);
  }
  return list;
}

export async function getNearestFuture(token: string, query: string): Promise<FutureInfo | null> {
  return (await getFuturesList(token, query))[0] ?? null;
}

// The next few upcoming futures contracts (nearest first), for when the
// NEAREST one's own option series has nothing listed at all (seen live: MCX
// Natural Gas returning zero contracts AND zero discoverable expiries for
// its nearest future the day before that future's own expiry -- its options
// had already stopped listing even though the future itself hadn't expired
// yet). Same cached list as getNearestFuture, so this costs no extra call.
export async function getUpcomingFutures(token: string, query: string, count: number): Promise<FutureInfo[]> {
  return (await getFuturesList(token, query)).slice(0, count);
}

const DAILY_CANDLE_CACHE_TTL_SECONDS = 30 * 60;

export async function getHistoricalCandles(env: Env, token: string, instrumentKey: string): Promise<Candle[] | null> {
  const cacheKey = `daily:${instrumentKey}:${new Date().toISOString().slice(0, 10)}`;
  const cached = await env.COMMODITY_KV.get(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached) as Candle[];
    } catch {
      // fall through and refetch on a corrupt cache entry
    }
  }
  const fresh = await fetchHistoricalCandles(token, instrumentKey);
  // Only a real result is cached -- caching a null would blank out every
  // daily-candle consumer for the whole TTL after one bad response.
  if (fresh) await env.COMMODITY_KV.put(cacheKey, JSON.stringify(fresh), { expirationTtl: DAILY_CANDLE_CACHE_TTL_SECONDS });
  return fresh;
}

async function fetchHistoricalCandles(token: string, instrumentKey: string): Promise<Candle[] | null> {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 270);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const url = `${UPSTOX_HIST_URL}/${encodeURIComponent(instrumentKey)}/day/${fmt(to)}/${fmt(from)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
  const json: any = await upstoxJson(res, "price history");
  if (json.status !== "success" || !json.data || !json.data.candles) return null;
  const candles: Candle[] = json.data.candles.map((c: any[]) => ({
    date: c[0],
    open: c[1],
    high: c[2],
    low: c[3],
    close: c[4],
    volume: c[5] ?? 0,
    oi: c[6] ?? 0,
  }));
  sortByTime(candles);
  return candles;
}

// Every timeframe on a page (15m, 30m, 60m, 240m) is built by RESAMPLING the
// same 1-minute intraday feed -- see getCandlesForTF. React Query fires those
// four requests simultaneously per symbol, so one poll was making four
// byte-identical Upstox calls, eight across both symbols, roughly thirty-two a
// minute for a single payload. That is the largest single source of upstream
// traffic in the app and the most likely reason the 1015 rate limit keeps
// being hit.
//
// The IN-FLIGHT PROMISE is cached, not just the result: the four requests
// arrive together, so a result-only cache would still let all four miss and
// fetch in parallel. Sharing the promise means they await one call. The TTL is
// deliberately tiny -- shorter than the client's own 15s poll -- so this
// collapses the fan-out without making any timeframe staler than it already
// was. A failed fetch is evicted immediately so the next poll retries.
const INTRADAY_CACHE_TTL_MS = 8_000;
const intradayCache = new Map<string, { at: number; promise: Promise<Candle[] | null> }>();

export async function getIntradayCandles(token: string, instrumentKey: string): Promise<Candle[] | null> {
  const hit = intradayCache.get(instrumentKey);
  if (hit && Date.now() - hit.at < INTRADAY_CACHE_TTL_MS) return hit.promise;

  const promise = fetchIntradayCandles(token, instrumentKey);
  intradayCache.set(instrumentKey, { at: Date.now(), promise });
  promise
    .then((v) => {
      if (!v) intradayCache.delete(instrumentKey);
    })
    .catch(() => intradayCache.delete(instrumentKey));
  return promise;
}

async function fetchIntradayCandles(token: string, instrumentKey: string): Promise<Candle[] | null> {
  const url = `${UPSTOX_INTRADAY_URL}/${encodeURIComponent(instrumentKey)}/1minute`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
  const json: any = await upstoxJson(res, "price history");
  if (json.status !== "success" || !json.data || !json.data.candles) return null;
  const candles: Candle[] = json.data.candles.map((c: any[]) => ({
    date: c[0],
    open: c[1],
    high: c[2],
    low: c[3],
    close: c[4],
    volume: c[5] ?? 0,
    oi: c[6] ?? 0,
  }));
  sortByTime(candles);
  return candles;
}

const HIST_INTRADAY_CACHE_TTL_SECONDS = 4 * 60 * 60;

// Prior-days history, PRE-BUCKETED.
//
// This used to cache the raw 1-minute candles for the last 20 days -- about
// 12,000 bars, 1.9 MB of JSON -- and every candle request (8 per Best Call
// tick in the cron, plus every chart poll from the app) re-read and re-parsed
// all of it, parsed a date on every bar, and re-bucketed the lot. Measured:
// ~20 ms of CPU per request, twice the free plan's entire 10 ms budget.
//
// Those past days never change. So they are fetched once, bucketed ONCE into
// every timeframe the app uses, and kept in isolate memory with a small KV copy
// (~230 KB) behind it; a request then only buckets today's minutes (~870 bars at
// most) and appends them. Measured: ~1.6 ms for all four cron timeframes of one
// symbol instead of ~80 ms, with output byte-identical to the old full
// re-bucketing (session-anchored buckets never span two days, so bucketing the
// days separately and joining them is exact).
//
// A failure degrades to null, and the caller falls back to today-only data,
// exactly as the old code did on an empty result.
export const PREBUCKETED_TFS = new Set([5, 15, 30, 60, 240]);
const HIST_BARS_MEM_TTL_MS = HIST_INTRADAY_CACHE_TTL_SECONDS * 1000;
const priorBarsMem = new Map<string, { at: number; bars: Record<string, Candle[]> }>();

async function fetchPriorMinutes(token: string, instrumentKey: string, toStr: string, fromStr: string): Promise<Candle[]> {
  const url = `${UPSTOX_HIST_URL}/${encodeURIComponent(instrumentKey)}/1minute/${toStr}/${fromStr}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
  const json: any = await upstoxJson(res, "prior-day price history");
  if (json.status !== "success" || !json.data || !json.data.candles) return [];
  const candles: Candle[] = json.data.candles.map((c: any[]) => ({
    date: c[0],
    open: c[1],
    high: c[2],
    low: c[3],
    close: c[4],
    volume: c[5] ?? 0,
    oi: c[6] ?? 0,
  }));
  sortByTime(candles);
  return candles;
}

/**
 * The days BEFORE today, already bucketed to `tfMinutes`. Null when the
 * timeframe is not pre-bucketed, or when history could not be loaded.
 */
export async function getPriorDayBars(env: Env, token: string, instrumentKey: string, days: number, tfMinutes: number): Promise<Candle[] | null> {
  if (!PREBUCKETED_TFS.has(tfMinutes)) return null;
  const to = new Date();
  to.setDate(to.getDate() - 1);
  const from = new Date();
  from.setDate(from.getDate() - days);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const toStr = fmt(to);
  const cacheKey = `hist1m-bars:v1:${instrumentKey}:${toStr}:${days}`;

  const mem = priorBarsMem.get(cacheKey);
  if (mem && Date.now() - mem.at < HIST_BARS_MEM_TTL_MS) return mem.bars[tfMinutes] ?? null;

  const cached = await env.COMMODITY_KV.get(cacheKey);
  if (cached) {
    try {
      const bars = JSON.parse(cached) as Record<string, Candle[]>;
      priorBarsMem.set(cacheKey, { at: Date.now(), bars });
      return bars[tfMinutes] ?? null;
    } catch {
      // fall through and rebuild on a corrupt cache entry
    }
  }

  try {
    const minutes = await fetchPriorMinutes(token, instrumentKey, toStr, fmt(from));
    if (!minutes.length) return null;
    const bars: Record<string, Candle[]> = {};
    for (const tf of PREBUCKETED_TFS) bars[tf] = resampleCandles(minutes, tf);
    priorBarsMem.set(cacheKey, { at: Date.now(), bars });
    await env.COMMODITY_KV.put(cacheKey, JSON.stringify(bars), { expirationTtl: HIST_INTRADAY_CACHE_TTL_SECONDS });
    return bars[tfMinutes] ?? null;
  } catch {
    return null;
  }
}

/**
 * Raw prior-days 1-minute candles, for a timeframe that is not pre-bucketed.
 * Nothing in the app requests one today; kept so an unusual timeframe still
 * works exactly as before rather than silently losing its history.
 */
export async function getHistoricalIntradayCandles(env: Env, token: string, instrumentKey: string, days: number): Promise<Candle[]> {
  const to = new Date();
  to.setDate(to.getDate() - 1);
  const from = new Date();
  from.setDate(from.getDate() - days);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  try {
    return await fetchPriorMinutes(token, instrumentKey, fmt(to), fmt(from));
  } catch {
    return [];
  }
}
