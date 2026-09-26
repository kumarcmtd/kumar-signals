// Kumar Signals Pro API worker.
// Serves JSON under /api/* and falls back to the built React SPA (frontend/dist)
// for everything else via the ASSETS binding.
//
// These are the exact same pure, React-free scoring engines the frontend
// itself imports for the Best Call page -- reused here (not reimplemented)
// so the Cron-triggered background notification check can never drift from
// what the app actually displays.
import { analyzeTimeframe } from "./frontend/src/utils/timeframeEngine";
import { findEliteSignal } from "./frontend/src/utils/eliteSignal";
import { evaluateDirectionalGate } from "./frontend/src/utils/directionalGateEngine";
import { scanAllSetups } from "./frontend/src/utils/kimiScanner";
import { eliteToBestCallPick, gateToBestCallPick, kimiToBestCallPick, pickBestCall, type BestCallPick } from "./frontend/src/utils/bestCallSelector";
import { scoreArticles, scoreEiaChange, clusterEvents, stripPublisherSuffix, type RawNewsArticle, type ScoredNewsArticle, type EiaScoreResult, type NewsEvent, type AffectedMarket } from "./frontend/src/utils/newsScoring";
import { advanceOpenEntry, mergeTradeLogs, symbolOfTradeLogKey, TRADE_LOG_SYMBOLS, runningBeforeClose, closeRunningAtSessionEnd, type TradeLogEntry } from "./frontend/src/utils/tradeLogCore";
import { resolvePrevClose } from "./frontend/src/utils/globalMarketHours";
import { analyzeImmediate, scanForAiTwenty, projectPremium20, LOT_SIZE as TWENTY_LOT_SIZE } from "./frontend/src/utils/aiTwentyTwentyEngine";
import { classifyNewsDuration, leanFromScore, type WhyDriver, type WhyCommodity } from "./frontend/src/utils/whyTodaySummary";
import { buildSlotSessions, buildTimeProfile, testClaims, scheduledEvents, eventProfile, type ClaimResult, type ScheduledEvent, type EventProfile } from "./frontend/src/utils/timeProfileEngine";
import { evaluatePullbackReversal, type PullbackResult, type TfKey, type ExternalSignal } from "./frontend/src/utils/pullbackReversalEngine";
import { mcxSessionAt, lastMcxClose, expiryStillLive, mcxCloseInstant, istParts } from "./frontend/src/utils/mcxSession";
import { resampleCandles } from "./frontend/src/utils/candleResample";
import { analyzeCommodity, type PatternResult } from "./frontend/src/utils/chartPatterns";

export interface Env {
  COMMODITY_KV: KVNamespace;
  ASSETS: Fetcher;
  AI: Ai;
  // All three optional -- News Based Trade AI degrades gracefully per
  // source when a key isn't configured (see fetchEnergyNews/fetchEiaData/
  // fetchEconCalendar below), never fabricating data to fill the gap.
  NEWSAPI_KEY?: string;
  EIA_API_KEY?: string;
  FRED_API_KEY?: string;
}

// The TradingView widget (frontend/src/components/TradingViewWidget.tsx) is
// the only third-party origin this app ever loads anything from -- its
// script dynamically creates its own embed iframe/data connections on
// whichever tradingview.com subdomain it currently uses internally, which
// isn't pinned down in their public docs, so this allows the whole domain
// rather than guessing a specific subdomain and having it silently break.
// Every other resource (JS bundle, CSS, fonts, images, API calls) is
// same-origin. Everything below is additive to what Workers Assets already
// serves, applied to every response this Worker returns.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' https://s3.tradingview.com",
  // React sets color/layout via the inline `style` DOM attribute on
  // thousands of elements throughout this app -- CSP has no nonce/hash
  // mechanism for the style="" attribute itself (only for <style> blocks),
  // so avoiding 'unsafe-inline' here would mean rewriting every dynamic
  // color in the app into static stylesheet classes, a large UI-risking
  // change well beyond a headers hardening pass. script-src (the actual
  // XSS vector) stays fully locked down with no 'unsafe-inline'/'unsafe-eval'.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://*.tradingview.com",
  "font-src 'self' data:",
  "connect-src 'self' https://*.tradingview.com wss://*.tradingview.com",
  "frame-src https://*.tradingview.com",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");

const SECURITY_HEADERS: Record<string, string> = {
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), accelerometer=(), gyroscope=(), magnetometer=()",
  "Content-Security-Policy": CONTENT_SECURITY_POLICY,
};

// Applied to every response this Worker returns -- API JSON, the SPA's
// index.html, and every static asset -- so there's exactly one place that
// defines this app's security posture instead of it depending on every
// individual route remembering to set headers correctly.
function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

const UPSTOX_SEARCH_URL = "https://api.upstox.com/v2/instruments/search";
const UPSTOX_HIST_URL = "https://api.upstox.com/v2/historical-candle";
const UPSTOX_INTRADAY_URL = "https://api.upstox.com/v2/historical-candle/intraday";
const UPSTOX_OPTION_CHAIN_URL = "https://api.upstox.com/v2/option/chain";

// All price-card instruments. Only CRUDEOIL/NATURALGAS have the options-based
// BUY/SELL signal logic wired up so far (OPTION_SYMBOLS) -- Gold/Silver/Copper/
// Aluminium show live price data only until that's extended.
const ALL_SYMBOLS = ["CRUDEOIL", "NATURALGAS", "GOLD", "SILVER"] as const;
const OPTION_SYMBOLS = ["CRUDEOIL", "NATURALGAS"] as const;
type Symbol = (typeof ALL_SYMBOLS)[number];

type Direction = "bullish" | "bearish" | "neutral";

interface Candle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  oi: number;
}

// MCX commodity trading session. The close is DST-aware (23:30 IST while the US
// is on daylight time, 23:55 while it is on standard time) and comes from the
// same mcxSession helper the EOD force-close and the overnight anchor use, so
// "is MCX open" can never have two answers. Holidays are not known.
function getMarketStatus() {
  const s = mcxSessionAt();
  const { isOpen, isPreOpen } = s;
  const session: "OPEN" | "CLOSED" | "PRE_OPEN" = isOpen ? "OPEN" : isPreOpen ? "PRE_OPEN" : "CLOSED";
  const hh = String(Math.floor(s.minutes / 60)).padStart(2, "0");
  const mm = String(s.minutes % 60).padStart(2, "0");
  return {
    isOpen,
    session,
    timeLabel: `${hh}:${mm} IST`,
    closeLabel: s.closeLabel,
    mcxStatus: isOpen
      ? `MCX session is live until ${s.closeLabel} IST.`
      : isPreOpen
        ? "MCX pre-open session -- trading resumes shortly."
        : "MCX session resumes ~9:00 AM IST on the next trading day. News monitoring remains active.",
  };
}

// Chart-pattern detection lives in frontend/src/utils/chartPatterns.ts, which
// adds recency, already-broke/target/stop checks and best-match ranking on top
// of the original detectors. See that file.

function r2(x: number) {
  return Math.round(x * 100) / 100;
}

interface FutureInfo {
  instrument_key: string;
  expiry: string;
  trading_symbol: string;
}

// Cloudflare serves its own error pages as PLAIN TEXT, not JSON -- most
// importantly "error code: 1015", which means "you are being rate limited".
// Upstox sits behind Cloudflare, so calling res.json() on that response threw
// a SyntaxError whose message ("Unexpected token 'e', \"error code: 1015 \" is
// not valid JSON") was then surfaced to the trader verbatim, dressed up as a
// market-data gap. The rate limit was real; the message was gibberish.
// Parsing through here names the actual cause instead.
// A Cloudflare 1015 from Upstox, as its own type so callers can tell "you are
// being rate limited, STOP calling" apart from "this request failed, try the
// next candidate". Treating the two the same is what made every fallback loop
// fire more doomed calls into an active rate limit and prolong it.
class UpstoxRateLimitError extends Error {
  readonly rateLimited = true;
}

function isRateLimit(e: unknown): boolean {
  return e instanceof UpstoxRateLimitError;
}

async function upstoxJson(res: Response, what: string): Promise<any> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    const code = /error code:\s*(\d+)/i.exec(text)?.[1];
    if (code === "1015") {
      throw new UpstoxRateLimitError(`Upstox is rate-limiting this app right now (Cloudflare 1015) while loading ${what}. Nothing is broken -- it clears on its own and the data refills on the next refresh.`);
    }
    if (code) throw new Error(`Upstox returned Cloudflare error ${code} while loading ${what}.`);
    throw new Error(`Upstox sent a non-JSON reply (HTTP ${res.status}) while loading ${what}.`);
  }
}

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
let sharedKv: KVNamespace | null = null;
function bindSharedCache(env: Env): void {
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

async function getNearestFuture(token: string, query: string): Promise<FutureInfo | null> {
  return (await getFuturesList(token, query))[0] ?? null;
}

// The next few upcoming futures contracts (nearest first), for when the
// NEAREST one's own option series has nothing listed at all (seen live: MCX
// Natural Gas returning zero contracts AND zero discoverable expiries for
// its nearest future the day before that future's own expiry -- its options
// had already stopped listing even though the future itself hadn't expired
// yet). Same cached list as getNearestFuture, so this costs no extra call.
async function getUpcomingFutures(token: string, query: string, count: number): Promise<FutureInfo[]> {
  return (await getFuturesList(token, query)).slice(0, count);
}

const DAILY_CANDLE_CACHE_TTL_SECONDS = 30 * 60;

async function getHistoricalCandles(env: Env, token: string, instrumentKey: string): Promise<Candle[] | null> {
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
  candles.sort((a, b) => +new Date(a.date) - +new Date(b.date));
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

async function getIntradayCandles(token: string, instrumentKey: string): Promise<Candle[] | null> {
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
  candles.sort((a, b) => +new Date(a.date) - +new Date(b.date));
  return candles;
}

const HIST_INTRADAY_CACHE_TTL_SECONDS = 4 * 60 * 60;

// 1-minute candles for the days BEFORE today, fetched from the historical
// (not intraday) endpoint and cached in KV -- this data is frozen the
// moment the trading day ends, so there is no reason to re-fetch it from
// Upstox on every poll. Only today's slice (getIntradayCandles) needs to
// stay live. A cache miss or an Upstox error here degrades gracefully to an
// empty array rather than failing the whole request, so the caller falls
// back to today-only behavior instead of breaking.
async function getHistoricalIntradayCandles(env: Env, token: string, instrumentKey: string, days: number): Promise<Candle[]> {
  const to = new Date();
  to.setDate(to.getDate() - 1);
  const from = new Date();
  from.setDate(from.getDate() - days);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const toStr = fmt(to);
  const cacheKey = `hist1m:${instrumentKey}:${toStr}`;

  const cached = await env.COMMODITY_KV.get(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached) as Candle[];
    } catch {
      // fall through and refetch on a corrupt cache entry
    }
  }

  try {
    const url = `${UPSTOX_HIST_URL}/${encodeURIComponent(instrumentKey)}/1minute/${toStr}/${fmt(from)}`;
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
    candles.sort((a, b) => +new Date(a.date) - +new Date(b.date));
    await env.COMMODITY_KV.put(cacheKey, JSON.stringify(candles), { expirationTtl: HIST_INTRADAY_CACHE_TTL_SECONDS });
    return candles;
  } catch {
    return [];
  }
}

// Upstox's intraday endpoint only serves 1-minute (or 30-minute) candles, so
// 5m/15m/30m scans are built by bucketing 1-minute candles ourselves.
// resampleCandles lives in frontend/src/utils/candleResample.ts: session-
// anchored at 09:00 IST, last-OI, and +05:30 stamps. See that file.

// MCX commodity options commonly expire a few trading days *before* the
// underlying futures contract they're written on, so the futures contract's
// own expiry date is not a safe stand-in for the options series' expiry --
// querying with the wrong date returns a valid response with zero strikes.
// This discovers the real listed option expiry dates for an underlying via
// Upstox's option/contract endpoint.
// Expiry discovery pulls the FULL unfiltered contract list for an instrument
// -- the single heaviest option call -- to read a set of dates that changes
// about once a month. It ran on every options poll alongside the chain fetch.
const OPTION_EXPIRY_CACHE_TTL_MS = 30 * 60 * 1000;
const optionExpiryCache = new Map<string, { at: number; expiries: string[] }>();

// Two cache layers, like the futures list: isolate memory for the per-poll
// traffic, KV so every isolate and the cron share one result. Expired dates
// are filtered by the caller (resolveOptionExpiryCandidates), so a long KV TTL
// cannot hand out a dead expiry.
const OPTION_EXPIRY_KV_TTL_S = 6 * 60 * 60;

async function getOptionExpiries(token: string, instrumentKey: string): Promise<string[] | null> {
  const cached = optionExpiryCache.get(instrumentKey);
  if (cached && Date.now() - cached.at < OPTION_EXPIRY_CACHE_TTL_MS) return cached.expiries;

  const kvKey = `options:expiries:v1:${instrumentKey}`;
  if (sharedKv) {
    const raw = await sharedKv.get(kvKey).catch(() => null);
    if (raw) {
      try {
        const expiries = JSON.parse(raw) as string[];
        if (Array.isArray(expiries) && expiries.length) {
          optionExpiryCache.set(instrumentKey, { at: Date.now(), expiries });
          return expiries;
        }
      } catch {
        // corrupt entry -- fall through and refetch
      }
    }
  }

  const usp = new URLSearchParams({ instrument_key: instrumentKey });
  const res = await fetch(`https://api.upstox.com/v2/option/contract?${usp.toString()}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  let json: any;
  try {
    // Through upstoxJson, not res.json(). A 1015 arrives as an HTML page, so
    // res.json() threw, this returned null, and the caller fell back to the
    // future's own expiry -- which lists zero strikes. A rate limit therefore
    // showed up as "no option contracts", pointing at the wrong problem.
    json = await upstoxJson(res, "the option expiry list");
  } catch (e) {
    if (isRateLimit(e)) throw e;
    return null;
  }
  if (json.status !== "success" || !Array.isArray(json.data) || !json.data.length) return null;
  const expiries = Array.from(new Set<string>(json.data.map((c: any) => c.expiry).filter(Boolean))).sort(
    (a, b) => +new Date(a) - +new Date(b)
  );
  if (!expiries.length) return null;
  // Only a real result is cached -- a null would keep the chain dark for the
  // whole TTL after one bad response.
  optionExpiryCache.set(instrumentKey, { at: Date.now(), expiries });
  if (sharedKv) await sharedKv.put(kvKey, JSON.stringify(expiries), { expirationTtl: OPTION_EXPIRY_KV_TTL_S }).catch(() => undefined);
  return expiries;
}

// Every upcoming real option expiry for a future, nearest first; falls back
// to a single-entry list with the future's own expiry if the
// contract-discovery lookup fails or returns nothing, so an unexpected
// response shape doesn't regress prior behavior.
async function resolveOptionExpiryCandidates(token: string, fut: FutureInfo): Promise<string[]> {
  const expiries = await getOptionExpiries(token, fut.instrument_key);
  if (!expiries) return [fut.expiry];
  // Live until MCX closes on the expiry date. `+new Date("YYYY-MM-DD") >= now`
  // parsed the date as UTC midnight (05:30 IST) and dropped the contract from
  // breakfast time on the very day it was still trading.
  const now = Date.now();
  const upcoming = expiries.filter((e) => expiryStillLive(e, now));
  return upcoming.length ? upcoming : [expiries[expiries.length - 1]];
}

// Confirmed via a live diagnostic call that Upstox's /v2/option/chain
// endpoint returns HTTP 200 "success" with an always-empty data array for
// MCX, regardless of instrument_key/expiry -- it just doesn't support this
// exchange. option/contract (strikes + per-contract instrument_key) and
// market-quote/quotes (live LTP/OI/volume, keyed by each object's own
// instrument_token) both work fine for MCX, so the chain is assembled from
// those two instead, into the same { strike_price, call_options: { market_data
// }, put_options: { market_data } } row shape the rest of this file already
// expects -- so analyzeChain/nearestStrikes/computeMaxPain/Greeks are
// untouched.
// The option CONTRACT list (which strikes exist for an expiry) was refetched
// on every options poll -- every 20 seconds per symbol -- to read something
// that only changes when contracts are listed or expire. The live QUOTES
// below still run every poll, because those are the actual prices; this
// caches only the strike inventory around them.
const OPTION_CONTRACT_CACHE_TTL_MS = 30 * 60 * 1000;
const optionContractCache = new Map<string, { at: number; contracts: any[] }>();

type ChainResult = { chain?: any[]; error?: string; rateLimited?: boolean };

async function getOptionChain(token: string, instrumentKey: string, expiryDate: string, spot: number | null, pinnedStrikes: number[] = []): Promise<ChainResult> {
  const contractCacheKey = `${instrumentKey}|${expiryDate}`;
  const cachedContracts = optionContractCache.get(contractCacheKey);
  if (cachedContracts && Date.now() - cachedContracts.at < OPTION_CONTRACT_CACHE_TTL_MS) {
    return buildChainFromContracts(token, cachedContracts.contracts, spot, pinnedStrikes);
  }

  const contractUsp = new URLSearchParams({ instrument_key: instrumentKey, expiry_date: expiryDate });
  const contractRes = await fetch(`https://api.upstox.com/v2/option/contract?${contractUsp.toString()}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });

  let contractJson: any;
  try {
    contractJson = await upstoxJson(contractRes, "the option chain");
  } catch (e: any) {
    // upstoxJson already names a Cloudflare rate limit (1015) explicitly --
    // pass that through rather than flattening it back to "not valid JSON",
    // which is what hid the real cause the first time.
    return { error: e?.message ?? `Option contract request failed (HTTP ${contractRes.status} ${contractRes.statusText})`, rateLimited: isRateLimit(e) };
  }
  if (contractJson.errors && contractJson.errors.length) {
    const msg = contractJson.errors.map((e: any) => e.message || e.errorCode || JSON.stringify(e)).join("; ");
    return { error: `Upstox rejected the option-contract request (HTTP ${contractRes.status}): ${msg} -- if this mentions auth/token, the Upstox access token likely needs a fresh login` };
  }
  if (contractJson.status !== "success" || !Array.isArray(contractJson.data) || !contractJson.data.length) {
    return { error: `Upstox returned no option contracts for expiry ${expiryDate} (HTTP ${contractRes.status})` };
  }

  const allContracts: any[] = contractJson.data;
  optionContractCache.set(contractCacheKey, { at: Date.now(), contracts: allContracts });
  return buildChainFromContracts(token, allContracts, spot, pinnedStrikes);
}

// Quote-fetching half, split out so a cached contract list can reuse it.
async function buildChainFromContracts(token: string, allContracts: any[], spot: number | null, pinnedStrikes: number[]): Promise<ChainResult> {
  const allStrikes = Array.from(new Set<number>(allContracts.map((c) => c.strike_price))).sort((a, b) => a - b);

  // Narrow to strikes near spot before fetching quotes -- MCX chains can
  // list 100+ strikes across a huge range, and there's no reason to spend
  // subrequest/rate-limit budget quoting deep ITM/OTM strikes nobody trades.
  const WINDOW = 10;
  let keepStrikes = new Set(allStrikes);
  if (spot !== null && allStrikes.length > WINDOW * 2 + 1) {
    const nearestIdx = allStrikes.reduce((best, s, i) => (Math.abs(s - spot) < Math.abs(allStrikes[best] - spot) ? i : best), 0);
    keepStrikes = new Set(allStrikes.slice(Math.max(0, nearestIdx - WINDOW), nearestIdx + WINDOW + 1));
  }
  // A strike the client already has an open trade tracked against must never
  // silently stop getting live quotes just because the underlying has since
  // moved far enough that it falls outside the spot-centered window -- pin
  // it back in regardless of distance, or that trade's premium (and target
  // hit/close detection, which reads this same quote) freezes forever.
  for (const s of pinnedStrikes) if (allStrikes.includes(s)) keepStrikes.add(s);
  const contracts = allContracts.filter((c) => keepStrikes.has(c.strike_price));

  const quotesByToken = new Map<string, any>();
  const CHUNK = 200;
  const instrumentKeys = contracts.map((c) => c.instrument_key);
  for (let i = 0; i < instrumentKeys.length; i += CHUNK) {
    const chunk = instrumentKeys.slice(i, i + CHUNK);
    const quoteUsp = new URLSearchParams({ instrument_key: chunk.join(",") });
    const quoteRes = await fetch(`https://api.upstox.com/v2/market-quote/quotes?${quoteUsp.toString()}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    let quoteJson: any;
    try {
      quoteJson = await upstoxJson(quoteRes, "live option quotes");
    } catch (e: any) {
      // A rate limit here means EVERY strike would come back priceless, which
      // renders as a chain full of blanks. Surface it instead of silently
      // returning an empty chain that looks like a dead market.
      if (isRateLimit(e)) return { error: e.message, rateLimited: true };
      continue; // any other blip is best-effort -- those contracts just get no market_data
    }
    if (quoteJson.status === "success" && quoteJson.data) {
      for (const q of Object.values(quoteJson.data) as any[]) {
        if (q?.instrument_token) quotesByToken.set(q.instrument_token, q);
      }
    }
  }

  const rowsByStrike = new Map<number, any>();
  for (const c of contracts) {
    if (!rowsByStrike.has(c.strike_price)) rowsByStrike.set(c.strike_price, { strike_price: c.strike_price, call_options: null, put_options: null });
    const row = rowsByStrike.get(c.strike_price);
    const quote = quotesByToken.get(c.instrument_key);
    const marketData = quote
      ? { ltp: quote.last_price ?? null, oi: quote.oi ?? null, volume: quote.volume ?? null, close_price: quote.ohlc?.close ?? null }
      : {};
    if (c.instrument_type === "CE") row.call_options = { market_data: marketData };
    else if (c.instrument_type === "PE") row.put_options = { market_data: marketData };
  }

  return { chain: Array.from(rowsByStrike.values()) };
}

// Upstox's expiry-discovery call (getOptionExpiries, no expiry_date filter)
// and its per-expiry contract lookup (getOptionChain, with expiry_date set)
// can disagree right around a rollover -- discovery lists an expiry as
// available, but querying that exact expiry_date comes back with zero
// contracts (seen live: MCX Natural Gas's near-month expiry returning empty
// at market open while the next expiry already had live contracts). Rather
// than surface that as a dead end, this tries every candidate expiry
// (nearest first) until one actually has contracts, and reports whichever
// expiry it actually used -- not just the first guess -- so downstream
// Greeks/expiry display stay consistent with the chain that was returned.
async function resolveOptionChain(token: string, fut: FutureInfo, spot: number | null, pinnedStrikes: number[] = []): Promise<{ expiry: string } & ChainResult> {
  let candidates: string[];
  try {
    candidates = await resolveOptionExpiryCandidates(token, fut);
  } catch (e) {
    if (isRateLimit(e)) return { expiry: fut.expiry, error: (e as Error).message, rateLimited: true };
    throw e;
  }
  let lastError: string | undefined;
  for (const expiry of candidates) {
    const res = await getOptionChain(token, fut.instrument_key, expiry, spot, pinnedStrikes);
    if (res.chain) return { expiry, chain: res.chain };
    // A rate limit fails every remaining candidate identically, and each
    // extra call extends the limit. Stop at the first one.
    if (res.rateLimited) return { expiry, error: res.error, rateLimited: true };
    lastError = res.error;
  }
  return { expiry: candidates[0], error: lastError };
}

// When the nearest future's own option series has NOTHING discoverable at
// all (getOptionExpiries found zero expiries, so resolveOptionChain only had
// the future's own -- often wrong -- expiry date to try), there is no
// expiry left to fall back to within that one future. This widens the
// search to the next couple of upcoming futures contracts and tries each
// one's own option chain in turn, so a near-month future whose options
// already stopped listing a day or two before its own expiry doesn't leave
// the page with nothing. Falls back to the primary future's own result
// (including its error) if every alternative also comes up empty, so the
// error message still describes a real attempt.
async function resolveOptionChainAcrossFutures(
  token: string,
  query: string,
  primaryFut: FutureInfo,
  spot: number | null,
  pinnedStrikes: number[] = []
): Promise<{ fut: FutureInfo; expiry: string } & ChainResult> {
  const primary = await resolveOptionChain(token, primaryFut, spot, pinnedStrikes);
  // Rate limited: do NOT widen the search. Every alternative future would cost
  // an expiry lookup plus a chain attempt per expiry, all guaranteed to fail
  // -- roughly ten more calls fired straight into the limit, extending it.
  if (primary.chain || primary.rateLimited) return { fut: primaryFut, ...primary };

  let upcoming: FutureInfo[];
  try {
    upcoming = await getUpcomingFutures(token, query, 3);
  } catch (e) {
    if (isRateLimit(e)) return { fut: primaryFut, ...primary, error: (e as Error).message, rateLimited: true };
    throw e;
  }
  for (const altFut of upcoming) {
    if (altFut.instrument_key === primaryFut.instrument_key) continue;
    const alt = await resolveOptionChain(token, altFut, spot, pinnedStrikes);
    if (alt.chain) return { fut: altFut, ...alt };
    if (alt.rateLimited) return { fut: primaryFut, ...primary, error: alt.error, rateLimited: true };
  }
  return { fut: primaryFut, ...primary };
}

function nearestStrikes(chain: any[], spot: number, sideCount = 6, pinnedStrikes: number[] = []) {
  const sorted = [...chain].sort((a, b) => a.strike_price - b.strike_price);
  let atmIdx = 0;
  let atmDiff = Infinity;
  sorted.forEach((row, i) => {
    const diff = Math.abs(row.strike_price - spot);
    if (diff < atmDiff) {
      atmDiff = diff;
      atmIdx = i;
    }
  });
  const start = Math.max(0, atmIdx - sideCount);
  const end = Math.min(sorted.length, atmIdx + sideCount + 1);
  const windowRows = sorted.slice(start, end);

  // A strike the client has an open trade tracked against must always come
  // back, even once the underlying has moved far enough that it falls
  // outside the normal ATM-centered display window -- otherwise that one
  // trade's live premium (and its target-hit/close detection) silently
  // freezes at whatever it last was while everything else keeps updating.
  const windowStrikes = new Set(windowRows.map((r) => r.strike_price));
  const pinnedRows = pinnedStrikes.length ? sorted.filter((r) => pinnedStrikes.includes(r.strike_price) && !windowStrikes.has(r.strike_price)) : [];
  const rows = pinnedRows.length ? [...windowRows, ...pinnedRows].sort((a, b) => a.strike_price - b.strike_price) : windowRows;

  return { rows, atmStrike: sorted.length ? sorted[atmIdx].strike_price : null };
}

function analyzeChain(chain: any[]) {
  let maxCallOI: { strike: number; oi: number } | null = null;
  let maxPutOI: { strike: number; oi: number } | null = null;
  let totalCallOI = 0;
  let totalPutOI = 0;
  for (const r of chain) {
    const callOI = r.call_options?.market_data?.oi || 0;
    const putOI = r.put_options?.market_data?.oi || 0;
    totalCallOI += callOI;
    totalPutOI += putOI;
    if (!maxCallOI || callOI > maxCallOI.oi) maxCallOI = { strike: r.strike_price, oi: callOI };
    if (!maxPutOI || putOI > maxPutOI.oi) maxPutOI = { strike: r.strike_price, oi: putOI };
  }
  const pcr = totalCallOI > 0 ? r2(totalPutOI / totalCallOI) : null;
  const bias: Direction = pcr == null ? "neutral" : pcr > 1.2 ? "bullish" : pcr < 0.8 ? "bearish" : "neutral";
  return {
    pcr,
    resistance: maxCallOI ? maxCallOI.strike : null,
    support: maxPutOI ? maxPutOI.strike : null,
    bias,
  };
}

// ---- Options Greeks (Black-76, for options on futures) ----
// MCX commodity options are options on the futures contract (not the spot),
// so Black-76 is the correct model (vs. plain Black-Scholes, which assumes
// a spot underlying with a dividend yield). r is a flat approximation of
// India's risk-free rate; it mainly affects discounting, not direction.
const RISK_FREE_RATE = 0.065;

function erf(x: number): number {
  // Abramowitz & Stegun 7.1.26 approximation, accurate to ~1.5e-7.
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const t = 1 / (1 + p * ax);
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return sign * y;
}
function normCDF(x: number) {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}
function normPDF(x: number) {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

interface Greeks {
  delta: number;
  gamma: number;
  theta: number; // per calendar day
  vega: number; // per 1 vol point (1%)
  rho: number; // per 1 rate point (1%)
}

function black76Price(F: number, K: number, T: number, r: number, sigma: number, isCall: boolean): number {
  if (T <= 0 || sigma <= 0) return isCall ? Math.max(F - K, 0) : Math.max(K - F, 0);
  const d1 = (Math.log(F / K) + (sigma * sigma * T) / 2) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);
  const df = Math.exp(-r * T);
  return isCall ? df * (F * normCDF(d1) - K * normCDF(d2)) : df * (K * normCDF(-d2) - F * normCDF(-d1));
}

function black76Greeks(F: number, K: number, T: number, r: number, sigma: number, isCall: boolean): Greeks {
  if (T <= 0 || sigma <= 0) {
    return { delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0 };
  }
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(F / K) + (sigma * sigma * T) / 2) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  const df = Math.exp(-r * T);
  const price = black76Price(F, K, T, r, sigma, isCall);

  const delta = isCall ? df * normCDF(d1) : -df * normCDF(-d1);
  const gamma = (df * normPDF(d1)) / (F * sigma * sqrtT);
  const vega = (F * df * normPDF(d1) * sqrtT) / 100; // per 1 vol point
  const thetaAnnual = isCall
    ? -((F * df * normPDF(d1) * sigma) / (2 * sqrtT)) + r * df * (F * normCDF(d1)) - r * df * (K * normCDF(d2))
    : -((F * df * normPDF(d1) * sigma) / (2 * sqrtT)) - r * df * (F * normCDF(-d1)) + r * df * (K * normCDF(-d2));
  const theta = thetaAnnual / 365;
  const rho = (-T * price) / 100; // per 1 rate point

  // Gamma especially needs more than 2 decimal places at these underlying
  // price scales (often 0.0001-0.001) -- r2 would round it straight to 0.
  const r6 = (x: number) => Math.round(x * 1e6) / 1e6;
  return { delta: r6(delta), gamma: r6(gamma), theta: r6(theta), vega: r6(vega), rho: r6(rho) };
}

// Solves for implied volatility from a market premium via bisection --
// slower than Newton-Raphson but immune to the divergence issues Newton's
// method has near expiry / deep ITM-OTM strikes, which matters more here
// than raw speed for a handful of strikes per request.
function impliedVolatility(marketPrice: number, F: number, K: number, T: number, r: number, isCall: boolean): number | null {
  if (marketPrice <= 0 || T <= 0) return null;
  let lo = 0.001;
  let hi = 5.0;
  const intrinsic = isCall ? Math.max(F - K, 0) : Math.max(K - F, 0);
  if (marketPrice < intrinsic * Math.exp(-r * T)) return null; // below intrinsic, no valid IV
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const price = black76Price(F, K, T, r, mid, isCall);
    if (Math.abs(price - marketPrice) < 1e-4) return r2(mid * 100);
    if (price > marketPrice) hi = mid;
    else lo = mid;
  }
  return r2(((lo + hi) / 2) * 100);
}

// Measured to MCX's close on the expiry date, not to "YYYY-MM-DD" parsed as UTC
// midnight. The old form hit zero at 05:30 IST on expiry day -- a whole
// trading session early -- and Black-Scholes with T = 0 has no IV to solve
// for and Greeks that divide by zero, so the final day's numbers were junk.
// It also understated T by roughly 18 hours on every other day.
function yearsToExpiry(expiry: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(expiry);
  const endMs = m ? mcxCloseInstant(Number(m[1]), Number(m[2]), Number(m[3])) : new Date(expiry).getTime();
  const ms = endMs - Date.now();
  return Math.max(ms / (365 * 24 * 60 * 60 * 1000), 0);
}

// The strike where option writers (sellers) collectively owe the least if
// the underlying settles there at expiry -- a common (not guaranteed) magnet
// for price to drift toward as expiry approaches, since option sellers are
// typically the better-capitalized side of the trade.
function computeMaxPain(chain: any[]): number | null {
  if (!chain.length) return null;
  const strikes = chain.map((r) => r.strike_price);
  let bestStrike: number | null = null;
  let bestPain = Infinity;
  for (const settle of strikes) {
    let pain = 0;
    for (const r of chain) {
      const callOI = r.call_options?.market_data?.oi || 0;
      const putOI = r.put_options?.market_data?.oi || 0;
      pain += callOI * Math.max(settle - r.strike_price, 0);
      pain += putOI * Math.max(r.strike_price - settle, 0);
    }
    if (pain < bestPain) {
      bestPain = pain;
      bestStrike = settle;
    }
  }
  return bestStrike;
}

interface TradeSignal {
  action: string;
  optSide?: "CE" | "PE";
  strike?: number;
  premiumEntry?: number;
  premiumTarget?: number;
  premiumStop?: number;
  confidence?: string;
  pcr?: number | null;
  note: string;
}

// Combines the chart-pattern direction (from the future's price action) with
// the option chain's PCR/OI bias into one actionable ATM option buy call.
// Premium target/stop are a rough delta≈0.5 (ATM) projection off the pattern's
// underlying target/stop -- not a pricing model. Theta decay & IV moves mean
// actual premiums can diverge; always track the live quote.
function buildTradeSignal(pattern: PatternResult, spot: number, chainAnalysis: ReturnType<typeof analyzeChain>, atmRow: any): TradeSignal {
  if (pattern.direction === "neutral" || typeof pattern.entry !== "number" || typeof pattern.stop !== "number" || typeof pattern.target !== "number") {
    return { action: "NO TRADE", note: "No clear directional pattern yet — wait for a breakout before buying an option." };
  }
  if (!atmRow) {
    return { action: "NO TRADE", note: "Option chain strikes unavailable near spot." };
  }

  const isBullish = pattern.direction === "bullish";
  const optSide: "CE" | "PE" = isBullish ? "CE" : "PE";
  const optData = isBullish ? atmRow.call_options?.market_data : atmRow.put_options?.market_data;
  const premium = optData?.ltp;
  if (!premium || premium <= 0) {
    return { action: "NO TRADE", note: "No live premium quote for the ATM strike right now." };
  }

  // A pattern match with the option chain's own OI/PCR bias actively
  // pointing the OTHER way is a real contradiction, not just "no extra
  // confirmation" -- previously this only downgraded a caption ("Low
  // confidence") while still returning the exact same clickable BUY action
  // as a fully-agreeing signal. Block it outright instead, matching how
  // AI Elite treats a contradicting veto: no trade shown at all rather than
  // a weak one with full-strength UI.
  if (chainAnalysis.bias !== "neutral" && chainAnalysis.bias !== pattern.direction) {
    return {
      action: "NO TRADE",
      pcr: chainAnalysis.pcr,
      note: `${pattern.pattern} suggests ${pattern.direction}, but the option chain's OI/PCR bias points ${chainAnalysis.bias} instead -- pattern and positioning disagree, so no trade is issued until they align.`,
    };
  }

  const favMove = isBullish ? pattern.target - spot : spot - pattern.target;
  const riskMove = isBullish ? spot - pattern.stop : pattern.stop - spot;
  const DELTA = 0.5;
  const premiumTarget = r2(premium + DELTA * favMove);
  const premiumStop = r2(Math.max(premium * 0.35, premium - DELTA * riskMove));

  const confidence = chainAnalysis.bias === pattern.direction ? "High (pattern + OI agree)" : "Medium (pattern only, OI neutral)";

  return {
    action: `BUY ${atmRow.strike_price} ${optSide}`,
    optSide,
    strike: atmRow.strike_price,
    premiumEntry: premium,
    premiumTarget,
    premiumStop,
    confidence,
    note: `${isBullish ? "Call" : "Put"} bought near ATM strike ${atmRow.strike_price}, premium ~₹${premium}. Premium target/SL are a rough delta-based estimate off the ${pattern.pattern} target/stop — track the live premium, don't rely on this alone.`,
  };
}

interface SignalCard {
  symbol: Symbol;
  tradingSymbol: string;
  expiry: string;
  currentPrice: number;
  lastDate: string;
  pattern: PatternResult;
  trade: TradeSignal;
  error?: string;
}

async function buildSignalCard(token: string, symbol: Symbol, fut: FutureInfo, candles: Candle[]): Promise<SignalCard> {
  const pattern = analyzeCommodity(candles);
  const spot = candles[candles.length - 1].close;

  let trade: TradeSignal = { action: "NO TRADE", note: "Option chain unavailable." };
  const { fut: optionFut, expiry: optionExpiry, chain, error } = await resolveOptionChainAcrossFutures(token, symbol, fut, spot);
  const chainRes = { chain, error };
  if (!chainRes.error && chainRes.chain) {
    const chainAnalysis = analyzeChain(chainRes.chain);
    const { atmStrike } = nearestStrikes(chainRes.chain, spot, 1);
    const atmRow = chainRes.chain.find((r) => r.strike_price === atmStrike);
    trade = buildTradeSignal(pattern, spot, chainAnalysis, atmRow);
    trade.pcr = chainAnalysis.pcr;
  } else {
    trade = { action: "NO TRADE", note: chainRes.error ?? "Option chain unavailable." };
  }

  return {
    symbol,
    tradingSymbol: optionFut.trading_symbol,
    expiry: optionExpiry,
    currentPrice: spot,
    lastDate: candles[candles.length - 1].date,
    pattern,
    trade,
  };
}

async function computeSignal(env: Env, token: string, symbol: Symbol): Promise<SignalCard> {
  const fut = await getNearestFuture(token, symbol);
  if (!fut) {
    return {
      symbol,
      tradingSymbol: "",
      expiry: "",
      currentPrice: 0,
      lastDate: "",
      pattern: { pattern: "-", direction: "neutral", entry: "-", stop: "-", target: "-", note: "", reliability: null },
      trade: { action: "NO TRADE", note: "No instrument found" },
      error: "No instrument found",
    };
  }
  const candles = await getHistoricalCandles(env, token, fut.instrument_key);
  if (!candles || candles.length < 40) {
    return {
      symbol,
      tradingSymbol: fut.trading_symbol,
      expiry: fut.expiry,
      currentPrice: 0,
      lastDate: "",
      pattern: { pattern: "-", direction: "neutral", entry: "-", stop: "-", target: "-", note: "", reliability: null },
      trade: { action: "NO TRADE", note: "Not enough historical data yet" },
      error: "Not enough historical data yet",
    };
  }
  return buildSignalCard(token, symbol, fut, candles);
}

async function computeSignals(env: Env, token: string): Promise<SignalCard[]> {
  const out: SignalCard[] = [];
  for (const symbol of OPTION_SYMBOLS) {
    try {
      out.push(await computeSignal(env, token, symbol));
    } catch (e: any) {
      out.push({
        symbol,
        tradingSymbol: "",
        expiry: "",
        currentPrice: 0,
        lastDate: "",
        pattern: { pattern: "-", direction: "neutral", entry: "-", stop: "-", target: "-", note: "", reliability: null },
        trade: { action: "NO TRADE", note: e.message },
        error: e.message,
      });
    }
  }
  return out;
}

// Shared by /api/scan and /api/candles: tf is "1D" (daily candles) or a
// minute count (5/15/30) resampled from 1-minute intraday candles, which
// only exist for the current session.
// Days of prior 1-minute history to stitch onto today's live feed. 30 bars
// at 4 hours each needs 5 trading days' worth; 20 calendar days comfortably
// covers that even accounting for weekends/holidays.
const PRIOR_HISTORY_DAYS = 20;

async function getCandlesForTF(env: Env, token: string, fut: FutureInfo, tf: string): Promise<Candle[] | { error: string }> {
  if (tf === "1D") {
    const candles = await getHistoricalCandles(env, token, fut.instrument_key);
    if (!candles || candles.length < 40) return { error: "Not enough historical data yet" };
    return candles;
  }
  const tfMinutes = parseInt(tf, 10);
  const oneMinToday = await getIntradayCandles(token, fut.instrument_key);
  if (!oneMinToday || oneMinToday.length < 20) return { error: "Not enough intraday data yet — market may be closed" };

  // Higher timeframes (30m/60m/240m especially) can't accumulate 30 bars
  // from a single session alone -- 30 bars of 4-hour candles would need 5
  // trading days. Stitch recent 1-minute history from prior days onto
  // today's live feed so every timeframe has real multi-day context, the
  // way an actual chart works, instead of restarting from zero every
  // morning. A failure here just falls back to today-only data, same as
  // the previous behavior, rather than breaking the request.
  const priorDays = await getHistoricalIntradayCandles(env, token, fut.instrument_key, PRIOR_HISTORY_DAYS);
  const todayStart = oneMinToday.length ? +new Date(oneMinToday[0].date) : Infinity;
  const combined = [...priorDays.filter((c) => +new Date(c.date) < todayStart), ...oneMinToday];

  const candles = tfMinutes === 1 ? combined : resampleCandles(combined, tfMinutes);
  if (candles.length < 15) return { error: "Not enough bars yet at this timeframe — try again later in the session" };
  return candles;
}

async function computeScan(env: Env, token: string, symbol: Symbol, tf: string): Promise<(SignalCard & { timeframe: string }) | { error: string }> {
  const fut = await getNearestFuture(token, symbol);
  if (!fut) return { error: "No instrument found" };
  const candles = await getCandlesForTF(env, token, fut, tf);
  if ("error" in candles) return candles;
  const signal = await buildSignalCard(token, symbol, fut, candles);
  return { ...signal, timeframe: tf };
}

async function computeCandles(env: Env, token: string, symbol: Symbol, tf: string): Promise<{ tradingSymbol: string; timeframe: string; candles: Candle[] } | { error: string }> {
  const fut = await getNearestFuture(token, symbol);
  if (!fut) return { error: "No instrument found" };
  const candles = await getCandlesForTF(env, token, fut, tf);
  if ("error" in candles) return candles;
  return { tradingSymbol: fut.trading_symbol, timeframe: tf, candles };
}

// ---- Morning-window gap study (9:00-11:00 AM IST) ----
// The overnight-impact card originally scored a gap by where the session
// CLOSED, ~14 hours after the open. That answered the wrong question for an
// options trader who is in and out in the morning, so this measures only the
// first two hours: open at 9:00 against the price at 11:00.
//
// That window cannot come from daily candles, which carry a single OHLC for
// the whole session, so this pulls 30-minute history -- exactly four bars
// (9:00, 9:30, 10:00, 10:30) span 9:00 to 11:00. Upstox allows a wider date
// range at 30-minute resolution than at 1-minute, which is what makes a
// usable sample affordable in one request.
//
// Note the real limit on sample size is not this range: MCX futures roll
// monthly, so a contract only ever has as much history as it has existed.
// The response reports how many sessions were actually found and the client
// shows that number rather than implying a fixed lookback.
const GAP_STUDY_DAYS = 90;
const GAP_STUDY_CACHE_TTL_SECONDS = 6 * 60 * 60;
const MORNING_START_HOUR = 9;
const MORNING_END_HOUR = 11;

interface MorningGapSession {
  date: string;
  gapPct: number;
  openPrice: number;
  closePrice: number;
  movePct: number;
  highPct: number;
  lowPct: number;
}

interface GapStudyResponse {
  available: boolean;
  windowLabel: string;
  latest: { date: string; gapPct: number; open: number; prevClose: number; live: boolean } | null;
  /** The global benchmark this symbol tracks, for a like-for-like comparison. */
  global: { name: string; changePct: number | null } | null;
  sessions: MorningGapSession[];
  error?: string;
}

// Exchange-local hour straight off Upstox's own +05:30 stamp -- the Worker
// runs in UTC, so parsing to a Date and reading getHours() would silently
// shift every bar by 5.5 hours and put the whole morning in the wrong window.
function istHourOfStamp(date: string): number | null {
  const m = /T(\d{2}):(\d{2})/.exec(date);
  if (!m) return null;
  return Number(m[1]) + Number(m[2]) / 60;
}

async function getHistorical30mCandles(env: Env, token: string, instrumentKey: string, days: number): Promise<Candle[]> {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - days);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const toStr = fmt(to);
  const cacheKey = `hist30m:${instrumentKey}:${toStr}`;

  const cached = await env.COMMODITY_KV.get(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached) as Candle[];
    } catch {
      // fall through and refetch on a corrupt cache entry
    }
  }

  try {
    const url = `${UPSTOX_HIST_URL}/${encodeURIComponent(instrumentKey)}/30minute/${toStr}/${fmt(from)}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
    const json: any = await upstoxJson(res, "prior-day price history");
    if (json.status !== "success" || !json.data || !json.data.candles) return [];
    const candles: Candle[] = json.data.candles.map((c: any[]) => ({
      date: c[0], open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5] ?? 0, oi: c[6] ?? 0,
    }));
    candles.sort((a, b) => +new Date(a.date) - +new Date(b.date));
    await env.COMMODITY_KV.put(cacheKey, JSON.stringify(candles), { expirationTtl: GAP_STUDY_CACHE_TTL_SECONDS });
    return candles;
  } catch {
    return [];
  }
}

function buildMorningSessions(daily: Candle[], bars30m: Candle[]): MorningGapSession[] {
  // Previous session's close, keyed by the session it gaps into.
  const prevCloseByDate = new Map<string, number>();
  for (let i = 1; i < daily.length; i++) {
    prevCloseByDate.set(daily[i].date.slice(0, 10), daily[i - 1].close);
  }

  const morningByDate = new Map<string, Candle[]>();
  for (const c of bars30m) {
    const hour = istHourOfStamp(c.date);
    if (hour === null || hour < MORNING_START_HOUR || hour >= MORNING_END_HOUR) continue;
    const day = c.date.slice(0, 10);
    const list = morningByDate.get(day);
    if (list) list.push(c);
    else morningByDate.set(day, [c]);
  }

  const out: MorningGapSession[] = [];
  for (const [date, bars] of morningByDate) {
    const prevClose = prevCloseByDate.get(date);
    if (prevClose === undefined || !(prevClose > 0) || bars.length === 0) continue;
    const openPrice = bars[0].open;
    if (!(openPrice > 0)) continue;
    const closePrice = bars[bars.length - 1].close;
    const high = Math.max(...bars.map((b) => b.high));
    const low = Math.min(...bars.map((b) => b.low));
    out.push({
      date,
      gapPct: Number((((openPrice - prevClose) / prevClose) * 100).toFixed(2)),
      openPrice,
      closePrice,
      movePct: Number((((closePrice - openPrice) / openPrice) * 100).toFixed(2)),
      highPct: Number((((high - openPrice) / openPrice) * 100).toFixed(2)),
      lowPct: Number((((openPrice - low) / openPrice) * 100).toFixed(2)),
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

async function computeGapStudy(env: Env, token: string, symbol: Symbol): Promise<GapStudyResponse> {
  const empty = { available: false, windowLabel: "9:00-11:00 AM", latest: null, global: null, sessions: [] as MorningGapSession[] };
  const fut = await getNearestFuture(token, symbol);
  if (!fut) return { ...empty, error: "No instrument found" };

  const daily = await getCandlesForTF(env, token, fut, "1D");
  if ("error" in daily) return { ...empty, error: daily.error };

  const bars30m = await getHistorical30mCandles(env, token, fut.instrument_key, GAP_STUDY_DAYS);
  const sessions = buildMorningSessions(daily, bars30m);

  // Upstox's historical DAILY endpoint only returns completed sessions, so at
  // 9:18 AM the newest daily candle is still yesterday's -- which made the card
  // show yesterday's gap at exactly the moment the overnight move matters most.
  // Today's real open comes from the live intraday feed instead: its first
  // 1-minute bar IS the 9:00 open, measured against the last completed daily
  // close. The daily-only path stays as the fallback for outside market hours.
  let latest: GapStudyResponse["latest"] = null;
  const lastDaily = daily.length ? daily[daily.length - 1] : null;
  const todayBars = await getIntradayCandles(token, fut.instrument_key);
  const firstBar = todayBars && todayBars.length ? todayBars[0] : null;

  if (firstBar && lastDaily && lastDaily.close > 0 && firstBar.open > 0 && firstBar.date.slice(0, 10) !== lastDaily.date.slice(0, 10)) {
    latest = {
      date: firstBar.date,
      gapPct: Number((((firstBar.open - lastDaily.close) / lastDaily.close) * 100).toFixed(2)),
      open: firstBar.open,
      prevClose: lastDaily.close,
      live: true,
    };
  } else if (daily.length >= 2) {
    const prev = daily[daily.length - 2];
    const cur = daily[daily.length - 1];
    if (prev.close > 0 && cur.open > 0) {
      latest = { date: cur.date, gapPct: Number((((cur.open - prev.close) / prev.close) * 100).toFixed(2)), open: cur.open, prevClose: prev.close, live: false };
    }
  }

  // The global benchmark MCX is following. Yahoo reports this against the
  // benchmark's OWN previous close, which is a near but not identical window
  // to "since MCX shut" -- the card says so rather than implying they are the
  // same measurement.
  const wanted = symbol === "CRUDEOIL" ? "CL=F" : "NG=F";
  const inst = GLOBAL_INSTRUMENTS.find((g) => g.symbol === wanted);
  let globalQuote: GapStudyResponse["global"] = null;
  if (inst) {
    try {
      const q = await getYahooQuote(inst.symbol, inst.name, inst.tracksMCX);
      globalQuote = { name: inst.name, changePct: q.changePercent };
    } catch {
      globalQuote = null;
    }
  }

  return {
    available: sessions.length > 0,
    windowLabel: "9:00-11:00 AM",
    latest,
    global: globalQuote,
    sessions,
    error: sessions.length === 0 ? "No 30-minute morning history available for this contract yet" : undefined,
  };
}

interface PriceCard {
  symbol: Symbol;
  tradingSymbol: string;
  ltp: number;
  change: number;
  changePercent: number;
  volume: number | null;
  oi: number | null;
  high: number | null;
  low: number | null;
  lastUpdated: string;
}

async function computePriceCard(env: Env, token: string, symbol: Symbol): Promise<PriceCard | { symbol: Symbol; error: string }> {
  const fut = await getNearestFuture(token, symbol);
  if (!fut) return { symbol, error: "No instrument found" };
  const candles = await getHistoricalCandles(env, token, fut.instrument_key);
  if (!candles || candles.length < 2) return { symbol, error: "Not enough historical data yet" };
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const change = r2(last.close - prev.close);
  const changePercent = r2((change / prev.close) * 100);
  return {
    symbol,
    tradingSymbol: fut.trading_symbol,
    ltp: last.close,
    change,
    changePercent,
    volume: last.volume || null,
    oi: last.oi || null,
    high: last.high,
    low: last.low,
    lastUpdated: last.date,
  };
}

async function computePrices(env: Env, token: string) {
  const out = [];
  for (const symbol of ALL_SYMBOLS) {
    try {
      out.push(await computePriceCard(env, token, symbol));
    } catch (e: any) {
      out.push({ symbol, error: e.message });
    }
  }
  return out;
}

// ---- Global reference markets (overseas benchmarks MCX contracts track) ----
// MCX Crude Oil settles off a basket referencing WTI/Brent; MCX Natural Gas
// settles off Henry Hub. Those overseas markets trade on NYMEX/ICE well past
// MCX's ~23:30 IST close, so this is how a trader sees which way things are
// likely to gap when MCX reopens. Uses Yahoo Finance's public (unofficial,
// unauthenticated) chart endpoint, independent of the Upstox/KV token -- this
// works even when the user hasn't logged in via the main worker.
const GLOBAL_INSTRUMENTS: { symbol: string; name: string; tracksMCX: string }[] = [
  { symbol: "CL=F", name: "WTI Crude Oil (NYMEX)", tracksMCX: "CRUDEOIL" },
  { symbol: "BZ=F", name: "Brent Crude Oil (ICE)", tracksMCX: "CRUDEOIL" },
  { symbol: "NG=F", name: "Henry Hub Natural Gas (NYMEX)", tracksMCX: "NATURALGAS" },
];

interface GlobalQuote {
  symbol: string;
  name: string;
  tracksMCX: string;
  price: number | null;
  change: number | null;
  changePercent: number | null;
  currency: string | null;
  marketState: string | null;
  asOf: string | null;
  error?: string;
}

async function getYahooQuote(symbol: string, name: string, tracksMCX: string): Promise<GlobalQuote> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; KumarSignalsPro/1.0)",
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    return { symbol, name, tracksMCX, price: null, change: null, changePercent: null, currency: null, marketState: null, asOf: null, error: `Yahoo Finance returned ${res.status}` };
  }
  const json: any = await res.json();
  const result = json?.chart?.result?.[0];
  const meta = result?.meta;
  if (!meta || typeof meta.regularMarketPrice !== "number") {
    const errMsg = json?.chart?.error?.description || "No quote data returned";
    return { symbol, name, tracksMCX, price: null, change: null, changePercent: null, currency: null, marketState: null, asOf: null, error: errMsg };
  }
  const price = meta.regularMarketPrice;
  // Daily change vs the true PRIOR-DAY close -- not chartPreviousClose, which
  // over a multi-day range is ~6 days old and can flip the sign (a red crude
  // day was reading "bullish" because the week was green). See resolvePrevClose.
  const dailyCloses: number[] = (result?.indicators?.quote?.[0]?.close ?? []).filter((c: any) => typeof c === "number");
  const secondLastDailyClose = dailyCloses.length >= 2 ? dailyCloses[dailyCloses.length - 2] : null;
  const prevClose = resolvePrevClose({
    previousClose: typeof meta.previousClose === "number" ? meta.previousClose : null,
    secondLastDailyClose,
    chartPreviousClose: typeof meta.chartPreviousClose === "number" ? meta.chartPreviousClose : null,
  });
  const change = prevClose !== null ? r2(price - prevClose) : null;
  const changePercent = prevClose ? r2(((price - prevClose) / prevClose) * 100) : null;
  return {
    symbol,
    name,
    tracksMCX,
    price: r2(price),
    change,
    changePercent,
    currency: meta.currency ?? null,
    marketState: meta.marketState ?? null,
    asOf: meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : null,
  };
}

async function computeGlobalMarketsUncached(): Promise<GlobalQuote[]> {
  const results = await Promise.all(
    GLOBAL_INSTRUMENTS.map(async (inst) => {
      try {
        return await getYahooQuote(inst.symbol, inst.name, inst.tracksMCX);
      } catch (e: any) {
        return { symbol: inst.symbol, name: inst.name, tracksMCX: inst.tracksMCX, price: null, change: null, changePercent: null, currency: null, marketState: null, asOf: null, error: e.message };
      }
    })
  );
  return results;
}

// Three Yahoo fetches per call, and now wanted by two pages plus the cron.
// Module-memory memo with an IN-FLIGHT promise, the same shape used for the
// option chain: without it, two requests landing together each start their own
// three fetches, and the duplicate pair is pure waste.
const GLOBAL_CACHE_TTL_MS = 60_000;
let globalCache: { at: number; promise: Promise<GlobalQuote[]> } | null = null;

async function computeGlobalMarkets(): Promise<GlobalQuote[]> {
  const now = Date.now();
  if (globalCache && now - globalCache.at < GLOBAL_CACHE_TTL_MS) return globalCache.promise;
  const promise = computeGlobalMarketsUncached();
  globalCache = { at: now, promise };
  // A failed fetch must not be cached for a minute, or one Yahoo blip freezes
  // the page for everyone who asks during that window.
  promise.catch(() => {
    if (globalCache?.promise === promise) globalCache = null;
  });
  return promise;
}

// ---- Overnight anchor: where the world was when MCX shut ----
//
// The change percentage Yahoo reports is measured from the previous US SESSION
// close, which is not the window a MCX trader cares about. "WTI is down 5.96%"
// can span a period that starts well before MCX shut, so reading it as "what
// happened overnight" silently double-counts a move MCX already priced in
// before its own close.
//
// There is no way to look this up after the fact -- the app holds only the
// CURRENT quote, with no historical intraday record of where WTI was at 11:30
// PM on a past date. So it is RECORDED at the time instead: the cron takes one
// snapshot just after MCX closes, and "since MCX closed" is then measured
// against a real observed price rather than estimated from a US chart.
//
// Cost: normally one KV write per trading day. The capture window is the hour
// after the (DST-aware) close -- twelve cron ticks; the first writes and the
// rest see that session's date already stored and do nothing.
const OVERNIGHT_ANCHOR_KEY = "overnight:anchor:v1";

interface OvernightAnchor {
  /** When the snapshot was actually taken. */
  takenAt: string;
  /** The IST trading date it belongs to, so it is written only once per day. */
  istDate: string;
  /** Symbol -> price at MCX close. */
  prices: Record<string, number>;
}

/** How long after the close a snapshot still counts as "at the close". */
const ANCHOR_CAPTURE_WINDOW_MS = 60 * 60 * 1000;

async function captureOvernightAnchor(env: Env): Promise<void> {
  const now = Date.now();
  if (mcxSessionAt(now).isOpen) return;
  // Keyed by the session that CLOSED, from the shared DST-aware clock. The
  // first version hard-coded a 23:30-23:59 window, which in winter (23:55
  // close) would have snapshotted while MCX was still trading and left a
  // single tick after the real bell. The window now starts at the actual
  // close and runs an hour -- twelve ticks -- and may cross midnight, which is
  // why the date comes from the close rather than from the clock.
  //
  // Weekends need no special case: on Saturday the last close is Friday's, so
  // the Friday anchor stands until Monday's close, which is exactly the
  // reference Monday's gap should be measured from.
  const { date, closeAt } = lastMcxClose(now);
  // Hours after the bell, the global price has moved on; a snapshot then would
  // make "since MCX closed" read as nearly flat and understate the real move.
  if (now - closeAt > ANCHOR_CAPTURE_WINDOW_MS) return;

  const existing = await env.COMMODITY_KV.get(OVERNIGHT_ANCHOR_KEY, "json").catch(() => null) as OvernightAnchor | null;
  const alreadyToday = existing?.istDate === date;
  // Done for tonight only once every leg is recorded. An all-or-nothing rule
  // was the first version and it was too brittle: one bad Yahoo response for
  // Brent threw away the Crude AND Gas anchors too, and the whole next morning
  // lost its overnight figure over a leg nobody was looking at. Now whatever
  // arrives is kept, and the remaining ticks in the post-close window get a
  // chance to fill the gap.
  if (alreadyToday && Object.keys(existing!.prices).length >= GLOBAL_INSTRUMENTS.length) return;

  const quotes = await computeGlobalMarkets();
  const prices: Record<string, number> = alreadyToday ? { ...existing!.prices } : {};
  for (const q of quotes) {
    if (typeof q.price === "number" && q.price > 0) prices[q.symbol] = q.price;
  }
  // Nothing usable came back -- leave the previous anchor alone rather than
  // overwriting it with an empty one, which would destroy a good reference
  // point in exchange for nothing.
  if (Object.keys(prices).length === 0) return;
  // Nothing new either: writing an identical record would spend a KV write to
  // change nothing.
  if (alreadyToday && Object.keys(prices).length === Object.keys(existing!.prices).length) return;

  const anchor: OvernightAnchor = { takenAt: new Date().toISOString(), istDate: date, prices };
  await env.COMMODITY_KV.put(OVERNIGHT_ANCHOR_KEY, JSON.stringify(anchor)).catch(() => undefined);
}

interface OvernightMove {
  symbol: string;
  name: string;
  tracksMCX: string;
  anchorPrice: number | null;
  price: number | null;
  changePct: number | null;
  /** Yahoo's own day change, which covers a DIFFERENT window. Labelled as such. */
  dayChangePct: number | null;
  error?: string;
}

async function computeOvernightTracker(env: Env): Promise<{
  anchor: { takenAt: string; istDate: string } | null;
  moves: OvernightMove[];
  marketStatus: ReturnType<typeof getMarketStatus>;
}> {
  const [anchor, quotes] = await Promise.all([
    env.COMMODITY_KV.get(OVERNIGHT_ANCHOR_KEY, "json").catch(() => null) as Promise<OvernightAnchor | null>,
    computeGlobalMarkets(),
  ]);

  const moves: OvernightMove[] = quotes.map((q) => {
    const anchorPrice = anchor?.prices?.[q.symbol] ?? null;
    const changePct = anchorPrice && anchorPrice > 0 && typeof q.price === "number" ? r2(((q.price - anchorPrice) / anchorPrice) * 100) : null;
    return {
      symbol: q.symbol,
      name: q.name,
      tracksMCX: q.tracksMCX,
      anchorPrice,
      price: q.price,
      changePct,
      dayChangePct: q.changePercent,
      error: q.error,
    };
  });

  return {
    anchor: anchor ? { takenAt: anchor.takenAt, istDate: anchor.istDate } : null,
    moves,
    marketStatus: getMarketStatus(),
  };
}

// ---- Pullback vs Reversal ----
// Computed HERE rather than on the phone, for two reasons. The six main tabs
// all want this card, and doing it client-side would mean each of them fetching
// 4H + 1H + 30M + 15M candles on an always-live page -- exactly the upstream
// load we spent days removing. And the candle data this needs is already in the
// Worker's own KV caches, so computing it here is nearly free.
//
// Memoised in module memory (not KV) on purpose: a 60-second KV cache would be
// 1,440 writes a day against a 1,000/day free limit. Isolate memory costs
// nothing and a cold isolate simply recomputes.
const PULLBACK_MEMO_MS = 60_000;
const pullbackMemo = new Map<string, { at: number; value: PullbackResult }>();

/**
 * Turns the already-cached news into ONE bullish/bearish reading for a
 * commodity. Returns `available: false` when there is genuinely no news rather
 * than a zero, so the engine can lower its confidence honestly instead of
 * pretending it looked and found nothing.
 */
function newsSignalFor(news: NewsFetchResult, symbol: Symbol, now: number): ExternalSignal {
  if (!news.available || !news.articles?.length) return { available: false, score: 0 };
  const want = symbol === "CRUDEOIL" ? "CRUDE" : "NG";
  const relevant = news.articles.filter((a) => a.affectedMarket === want || a.affectedMarket === "BOTH");
  if (relevant.length === 0) return { available: false, score: 0 };

  // Weight by source quality and freshness, so one loud blog cannot swing it.
  let mass = 0;
  let net = 0;
  let newestMinutes = Number.POSITIVE_INFINITY;
  for (const a of relevant) {
    const ageMin = Math.max(0, (now - new Date(a.publishedAt).getTime()) / 60_000);
    if (!Number.isFinite(ageMin)) continue;
    newestMinutes = Math.min(newestMinutes, ageMin);
    const w = (a.sourceQualityPct / 100) * (a.recencyPct / 100);
    mass += w;
    net += w * (a.bullishScore - a.bearishScore);
  }
  if (mass <= 0) return { available: false, score: 0 };
  const score = Math.max(-100, Math.min(100, Math.round(net / mass)));
  return {
    available: true,
    score,
    ageMinutes: Number.isFinite(newestMinutes) ? newestMinutes : undefined,
    note: `${relevant.length} ${want === "CRUDE" ? "crude" : "gas"} stories, weighted by source and freshness.`,
  };
}

/** The EIA's own reported weekly change -- an official figure, not a headline. */
function fundamentalSignalFor(eia: EiaFetchResult, symbol: Symbol): ExternalSignal {
  const row = symbol === "CRUDEOIL" ? eia.crude : eia.ngStorage;
  if (!eia.available || !row) return { available: false, score: 0 };
  const score = Math.max(-100, Math.min(100, row.bullishScore - row.bearishScore));
  return { available: true, score, ageMinutes: 0, note: row.label };
}

async function computePullback(env: Env, token: string, symbol: Symbol): Promise<PullbackResult> {
  const memo = pullbackMemo.get(symbol);
  if (memo && Date.now() - memo.at < PULLBACK_MEMO_MS) return memo.value;

  const fut = await getNearestFuture(token, symbol);
  const now = Date.now();
  if (!fut) {
    return evaluatePullbackReversal({ commodity: symbol as "CRUDEOIL" | "NATURALGAS", timeframes: {}, now });
  }

  // Every one of these is already KV-cached by other pages, so this is mostly
  // cache reads. A timeframe that fails is simply absent -- the engine
  // renormalises its weights and reports lower data quality.
  const tfs: TfKey[] = ["240", "60", "30", "15"];
  const timeframes: Partial<Record<TfKey, Candle[]>> = {};
  for (const tf of tfs) {
    try {
      const c = await getCandlesForTF(env, token, fut, tf);
      if (!("error" in c)) timeframes[tf] = c;
    } catch {
      // absent, deliberately
    }
  }
  let dailyCandles: Candle[] | undefined;
  try {
    const d = await getCandlesForTF(env, token, fut, "1D");
    if (!("error" in d)) dailyCandles = d;
  } catch {
    dailyCandles = undefined;
  }

  const [news, eia] = await Promise.all([fetchEnergyNews(env), fetchEiaData(env)]);
  const hourly = timeframes["60"] ?? timeframes["30"] ?? timeframes["240"];
  const currentPrice = hourly && hourly.length ? hourly[hourly.length - 1].close : null;

  const value = evaluatePullbackReversal({
    commodity: symbol as "CRUDEOIL" | "NATURALGAS",
    timeframes,
    dailyCandles,
    currentPrice,
    news: newsSignalFor(news, symbol, now),
    fundamentals: fundamentalSignalFor(eia, symbol),
    // No weather source is connected. Saying so costs data quality and caps
    // confidence, which is the honest outcome -- see Part 49 of the spec.
    weather: { available: false, score: 0 },
    previousState: memo?.value.state,
    previousStateAt: memo?.at,
    now,
  });

  pullbackMemo.set(symbol, { at: now, value });
  return value;
}

// ---- Price-Alerts: time-of-day movement profile ----
// Answers "which half hours of the MCX session actually move" from the
// contract's own 30-minute history, and tests a specific list of claims the
// trader was told, rather than repeating them.
//
// This deliberately calls getHistorical30mCandles with the SAME day count the
// gap study uses, so both features share one KV cache entry and one Upstox
// request. Opening Price-Alerts therefore costs nothing upstream beyond what
// the app already fetches. The computed profile is cached separately because
// folding ~1,200 half-hour bars into statistics on every request would push
// CPU time up, and this result only changes once a session anyway.
const TIME_PROFILE_CACHE_TTL_SECONDS = 20 * 60 * 60;

interface TimeProfileResponse {
  available: boolean;
  symbol: string;
  tradingSymbol: string | null;
  profile: ReturnType<typeof buildTimeProfile> | null;
  claims: ClaimResult[];
  events: ScheduledEvent[];
  eventProfiles: EventProfile[];
  /** Sessions actually found, and the window they span. */
  sessionsAnalyzed: number;
  firstDate: string | null;
  lastDate: string | null;
  contractNote: string;
  computedAt: string;
  error?: string;
}

/**
 * Serves the profile. Reads the cache first and ONLY builds it inline when the
 * cache is cold -- building it is the single most CPU-expensive thing this
 * Worker does (folding ~1,700 half-hour bars into statistics), and the free
 * plan allows 10 ms of CPU per request. The Cron warms this once a day so a
 * real user should essentially never pay for the build.
 *
 * A failure here degrades to "unavailable" with the reason rather than
 * throwing: a 500 on this route would be counted as a Worker error and would
 * blank the page, when the honest answer is simply that the profile is not
 * ready yet.
 */
async function serveTimeProfile(env: Env, token: string, symbol: Symbol): Promise<TimeProfileResponse> {
  try {
    return await computeTimeProfile(env, token, symbol);
  } catch (e: any) {
    return {
      available: false, symbol, tradingSymbol: null, profile: null, claims: [], events: scheduledEvents(),
      eventProfiles: [], sessionsAnalyzed: 0, firstDate: null, lastDate: null, contractNote: "",
      computedAt: new Date().toISOString(),
      error: e?.message ?? "Could not build the time profile",
    };
  }
}

/**
 * Builds today's profile if it is not already cached, and stores it. Called
 * from the Cron, so the expensive path runs on a schedule rather than while a
 * trader waits. Cheap on a warm day: one KV read and nothing else.
 */
async function warmTimeProfiles(env: Env): Promise<void> {
  const token = await env.COMMODITY_KV.get("access_token");
  if (!token) return;
  for (const symbol of OPTION_SYMBOLS) {
    try {
      await computeTimeProfile(env, token, symbol as Symbol);
    } catch {
      // A warm failure is not worth surfacing anywhere -- the next tick retries.
    }
  }
}

async function computeTimeProfile(env: Env, token: string, symbol: Symbol): Promise<TimeProfileResponse> {
  const empty: TimeProfileResponse = {
    available: false, symbol, tradingSymbol: null, profile: null, claims: [], events: scheduledEvents(),
    eventProfiles: [], sessionsAnalyzed: 0, firstDate: null, lastDate: null,
    contractNote: "", computedAt: new Date().toISOString(),
  };

  const fut = await getNearestFuture(token, symbol);
  if (!fut) return { ...empty, error: "No instrument found" };

  const cacheKey = `timeprofile:v2:${fut.instrument_key}:${new Date().toISOString().slice(0, 10)}`;
  const cached = await env.COMMODITY_KV.get(cacheKey);
  if (cached) {
    try {
      const hit = JSON.parse(cached) as TimeProfileResponse;
      // Event countdowns are clock-dependent, so they are always recomputed
      // even on a cache hit -- a cached "in 40 minutes" would be a lie.
      return { ...hit, events: scheduledEvents() };
    } catch {
      // fall through and recompute on a corrupt entry
    }
  }

  const bars30m = await getHistorical30mCandles(env, token, fut.instrument_key, GAP_STUDY_DAYS);
  if (bars30m.length === 0) {
    return { ...empty, tradingSymbol: fut.trading_symbol, error: "No 30-minute history available for this contract yet" };
  }

  const slotSessions = buildSlotSessions(bars30m);
  const profile = buildTimeProfile(slotSessions);

  // The gap-continuation claim needs the morning gap sessions the gap study
  // already knows how to build; daily candles are cached, so this is cheap.
  // Wrapped: this is a second KV read and a second pass purely to answer the
  // gap-continuation claim. If it fails, that ONE claim reports "not enough
  // days" and the rest of the page is unaffected.
  let gapSessions: { date: string; gapPct: number; movePct: number }[] = [];
  try {
    const daily = await getCandlesForTF(env, token, fut, "1D");
    if (!("error" in daily)) gapSessions = buildMorningSessions(daily, bars30m);
  } catch {
    gapSessions = [];
  }

  const events = scheduledEvents();
  const eventProfiles = events
    .filter((e) => e.affects === symbol)
    .map((e) => eventProfile(slotSessions, e, e.id === "eia-crude" ? 3 : 4));

  const result: TimeProfileResponse = {
    available: profile.sessionsAnalyzed > 0,
    symbol,
    tradingSymbol: fut.trading_symbol,
    profile,
    claims: testClaims(profile, slotSessions, gapSessions),
    events,
    eventProfiles,
    sessionsAnalyzed: profile.sessionsAnalyzed,
    firstDate: profile.firstDate,
    lastDate: profile.lastDate,
    // The single most important caveat on the whole page, carried in the payload
    // so the UI cannot forget to show it.
    contractNote: `${profile.sessionsAnalyzed} sessions of ${fut.trading_symbol}. MCX futures roll every month, so this is one contract's life — not years of history. Patterns found in a sample this size can be luck.`,
    computedAt: new Date().toISOString(),
  };

  if (result.available) {
    await env.COMMODITY_KV.put(cacheKey, JSON.stringify(result), { expirationTtl: TIME_PROFILE_CACHE_TTL_SECONDS });
  }
  return result;
}

// ---- GPT News macro backdrop (dollar, rates, gold) ----
// GPT News asks for the macro context that sits behind every energy move:
// USD/INR (what an MCX rupee contract actually settles in), the dollar index
// and US 10-year yield (both push dollar-priced commodities around), and gold
// as the other big risk-sentiment commodity. These are DELIBERATELY a separate
// endpoint from /api/global-markets rather than extra entries in
// GLOBAL_INSTRUMENTS -- the Global Markets page renders every quote that route
// returns, so adding rows there would silently redesign an existing page.
//
// Same public Yahoo chart endpoint as the energy benchmarks, but over a 1-month
// daily range so each card can draw a REAL sparkline from actual closes. No
// point is ever interpolated or invented; a series that comes back short just
// draws a shorter line.
const MACRO_INSTRUMENTS: { symbol: string; name: string; short: string; unit: "usd" | "inr" | "index" | "pct" }[] = [
  { symbol: "INR=X", name: "US Dollar / Indian Rupee", short: "USD/INR", unit: "inr" },
  { symbol: "DX-Y.NYB", name: "US Dollar Index", short: "DXY", unit: "index" },
  { symbol: "GC=F", name: "Gold (COMEX)", short: "Gold", unit: "usd" },
  { symbol: "^TNX", name: "US 10-Year Treasury Yield", short: "US 10Y", unit: "pct" },
];

interface MacroQuote {
  symbol: string;
  name: string;
  short: string;
  unit: "usd" | "inr" | "index" | "pct";
  price: number | null;
  change: number | null;
  changePercent: number | null;
  /** Real daily closes, oldest first -- for the sparkline. Never synthesized. */
  spark: number[];
  asOf: string | null;
  error?: string;
}

const MACRO_CACHE_TTL_SECONDS = 120;
const MACRO_CACHE_KV_KEY = "gptnews:macro:v1";

async function getYahooMacroQuote(inst: (typeof MACRO_INSTRUMENTS)[number]): Promise<MacroQuote> {
  const base: MacroQuote = { ...inst, price: null, change: null, changePercent: null, spark: [], asOf: null };
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(inst.symbol)}?interval=1d&range=1mo`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; KumarSignalsPro/1.0)", Accept: "application/json" } });
  if (!res.ok) return { ...base, error: `Yahoo Finance returned ${res.status}` };
  const json: any = await res.json();
  const result = json?.chart?.result?.[0];
  const meta = result?.meta;
  if (!meta || typeof meta.regularMarketPrice !== "number") {
    return { ...base, error: json?.chart?.error?.description || "No quote data returned" };
  }
  const closes: number[] = (result?.indicators?.quote?.[0]?.close ?? []).filter((c: any) => typeof c === "number");
  const price = meta.regularMarketPrice;
  const prevClose = resolvePrevClose({
    previousClose: typeof meta.previousClose === "number" ? meta.previousClose : null,
    secondLastDailyClose: closes.length >= 2 ? closes[closes.length - 2] : null,
    chartPreviousClose: typeof meta.chartPreviousClose === "number" ? meta.chartPreviousClose : null,
  });
  return {
    ...base,
    price: r2(price),
    change: prevClose !== null ? r2(price - prevClose) : null,
    changePercent: prevClose ? r2(((price - prevClose) / prevClose) * 100) : null,
    spark: closes.slice(-30).map((c) => r2(c)),
    asOf: meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : null,
  };
}

async function computeMacroMarkets(env: Env): Promise<{ quotes: MacroQuote[]; fetchedAt: string }> {
  const cached = await env.COMMODITY_KV.get(MACRO_CACHE_KV_KEY);
  if (cached) {
    try {
      return JSON.parse(cached) as { quotes: MacroQuote[]; fetchedAt: string };
    } catch {
      // fall through and refetch
    }
  }
  const quotes = await Promise.all(
    MACRO_INSTRUMENTS.map(async (inst) => {
      try {
        return await getYahooMacroQuote(inst);
      } catch (e: any) {
        return { ...inst, price: null, change: null, changePercent: null, spark: [], asOf: null, error: e.message ?? "fetch failed" } as MacroQuote;
      }
    })
  );
  const payload = { quotes, fetchedAt: new Date().toISOString() };
  // Only cache a generation that actually carries data -- caching an all-failed
  // response would pin the page to "unavailable" for the full TTL.
  if (quotes.some((q) => q.price !== null)) {
    await env.COMMODITY_KV.put(MACRO_CACHE_KV_KEY, JSON.stringify(payload), { expirationTtl: MACRO_CACHE_TTL_SECONDS });
  }
  return payload;
}

// ---- News Based Trade AI: news + EIA inventory/storage + econ calendar ----
// The app must be fully useful with ZERO secrets configured: news comes
// from a curated allowlist of official/public RSS feeds by default, and
// NEWSAPI_KEY (when present) only ADDS to that feed, it never gates it.
// EIA_API_KEY/FRED_API_KEY unlock their own extra panels but their absence
// never breaks news or the rest of the page. Everything here fails
// gracefully per-source (never throws past its own function) and never
// fabricates a headline, price, or date -- a source that's down just
// contributes nothing rather than being backfilled with invented data.
// Series/release IDs below are EIA's and FRED's own documented identifiers.

interface NewsFetchResult {
  available: boolean;
  articles: ScoredNewsArticle[];
  events: NewsEvent[];
  sourceStatus: { source: string; ok: boolean; count: number; error?: string }[];
  /** When the Cron last rebuilt this payload. Absent on an all-sources-down result. */
  builtAt?: string;
  error?: string;
}

// Only these exact, hand-verified official/public RSS endpoints are ever
// fetched -- the frontend can never submit an arbitrary URL for the Worker
// to fetch (no such endpoint exists), which closes off SSRF entirely.
// Deliberately spans more than one domain: eia.gov alone is a single point
// of failure (a WAF/bot-protection block on that one domain would silently
// zero out the entire feed, which is exactly what production showed --
// every eia.gov feed failing together), so oilprice.com is included as an
// independent Tier-3 fallback source.
// AI Flash's whole premise is that a headline reaches the trader while the
// move is still tradable, and the four EIA feeds below -- authoritative as
// they are -- publish on a government cadence (daily/weekly), so on their own
// they are structurally incapable of being fast. The fast market wires below
// are what actually make an intraday flash feed possible; EIA remains the
// Tier-1 anchor for accuracy. Every feed is independently optional: a source
// that 404s, rate-limits, or changes its URL contributes zero articles and
// reports its own failure in sourceStatus (surfaced on the AI Flash page), so
// a dead feed degrades the page rather than breaking it.
interface RssFeedConfig {
  url: string;
  source: string;
  /** Strip Google News's " - Publisher" headline suffix. See stripPublisherSuffix. */
  stripPublisherSuffix?: boolean;
}

const TRUSTED_RSS_FEEDS: RssFeedConfig[] = [
  // Tier 1 -- official/government. Slow but authoritative.
  { url: "https://www.eia.gov/rss/todayinenergy.xml", source: "EIA - Today in Energy" },
  { url: "https://www.eia.gov/rss/petroleum.xml", source: "EIA - This Week in Petroleum" },
  { url: "https://www.eia.gov/rss/natural_gas.xml", source: "EIA - Natural Gas Weekly" },
  { url: "https://www.eia.gov/rss/press_rss.xml", source: "EIA - Press Releases" },
  // Tier 2 -- major financial wires, the fast movers.
  { url: "https://feeds.finance.yahoo.com/rss/2.0/headline?s=CL%3DF&region=US&lang=en-US", source: "Yahoo Finance - WTI Crude" },
  { url: "https://feeds.finance.yahoo.com/rss/2.0/headline?s=NG%3DF&region=US&lang=en-US", source: "Yahoo Finance - Natural Gas" },
  { url: "https://feeds.finance.yahoo.com/rss/2.0/headline?s=BZ%3DF&region=US&lang=en-US", source: "Yahoo Finance - Brent Crude" },
  { url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=19836134", source: "CNBC - Energy" },
  // MarketWatch is Dow Jones-owned and carries the same "Market Talk" desk
  // copy that shows up on broker terminals, which is the closest a free feed
  // gets to Dow Jones Newswires itself (a licensed, paywalled wire).
  { url: "https://feeds.marketwatch.com/marketwatch/marketpulse/", source: "MarketWatch - Market Pulse" },
  { url: "https://feeds.marketwatch.com/marketwatch/realtimeheadlines/", source: "MarketWatch - Real-time Headlines" },
  { url: "https://feeds.marketwatch.com/marketwatch/topstories/", source: "MarketWatch - Top Stories" },
  // Trading Economics publishes an RSS index at /rss/feeds.aspx; these are its
  // documented news endpoints. If the query-string form is wrong they simply
  // report as down in the page's source-health panel rather than breaking it.
  { url: "https://tradingeconomics.com/rss/news.aspx", source: "Trading Economics - News" },
  { url: "https://tradingeconomics.com/rss/news.aspx?i=crude+oil", source: "Trading Economics - Crude Oil" },
  { url: "https://tradingeconomics.com/rss/news.aspx?i=natural+gas", source: "Trading Economics - Natural Gas" },
  // Reuters retired its public RSS feeds in 2020 and offers no free
  // replacement; the remaining options are paid third-party feed generators
  // (an extra dependency and an extra point of failure in the hot path) or
  // Google News, which is itself a free public RSS endpoint and indexes
  // Reuters within minutes. site: narrows it to Reuters only, when:2d bounds
  // it to the same 48h window the scorer already discards past.
  {
    url: "https://news.google.com/rss/search?q=%28oil+OR+crude+OR+WTI+OR+Brent+OR+OPEC%29+site%3Areuters.com+when%3A2d&hl=en-US&gl=US&ceid=US%3Aen",
    source: "Reuters - Oil (via Google News)",
    stripPublisherSuffix: true,
  },
  {
    url: "https://news.google.com/rss/search?q=%28%22natural+gas%22+OR+LNG+OR+%22Henry+Hub%22%29+site%3Areuters.com+when%3A2d&hl=en-US&gl=US&ceid=US%3Aen",
    source: "Reuters - Natural Gas (via Google News)",
    stripPublisherSuffix: true,
  },
  { url: "https://www.investing.com/rss/commodities_Oil.rss", source: "Investing.com - Crude Oil" },
  { url: "https://www.investing.com/rss/commodities_Gas.rss", source: "Investing.com - Natural Gas" },
  { url: "https://www.investing.com/rss/news_11.rss", source: "Investing.com - Commodities" },
  // Tier 3 -- energy trade press. Often first on outages/pipeline/LNG news.
  { url: "https://oilprice.com/rss/main", source: "OilPrice.com" },
  { url: "https://www.rigzone.com/news/rss/rigzone_latest.aspx", source: "Rigzone" },
  { url: "https://www.naturalgasintel.com/feed/", source: "Natural Gas Intelligence" },
  { url: "https://www.hellenicshippingnews.com/feed/", source: "Hellenic Shipping News" },
  { url: "https://worldoil.com/rss?feed=news", source: "World Oil" },
  { url: "https://www.spglobal.com/commodity-insights/en/news-research/rss-feed", source: "S&P Global Commodity Insights" },
  { url: "https://www.offshore-energy.biz/feed/", source: "Offshore Energy" },
  { url: "https://lngprime.com/feed/", source: "LNG Prime" },
  { url: "https://www.naturalgasworld.com/rss", source: "Natural Gas World" },
  { url: "https://www.opec.org/opec_web/en/press_room/28.htm?rss=1", source: "OPEC - Press Releases" },

  // ---------------------------------------------------------------------
  // Aggregated topic feeds. These matter more than they look.
  //
  // Most energy trade sites either never published RSS, moved it, or sit
  // behind bot protection that answers a datacentre IP with a 403 -- which
  // is indistinguishable from a dead URL from in here. Google News is a
  // single well-known endpoint that indexes ALL of those publishers within
  // minutes, so one feed that works is worth more than six site feeds that
  // might not. The site:-restricted ones below name the publishers the
  // trader specifically asked for; the unrestricted ones are the safety net
  // that keeps the page populated even when every direct feed is blocked.
  //
  // when:1d bounds each query to the last 24h, inside the 48h window the
  // scorer already discards past, so nothing stale is pulled in.
  // ---------------------------------------------------------------------
  {
    url: "https://news.google.com/rss/search?q=%28%22crude+oil%22+OR+WTI+OR+Brent+OR+OPEC%29+when%3A1d&hl=en-US&gl=US&ceid=US%3Aen",
    source: "Crude Oil headlines (via Google News)",
    stripPublisherSuffix: true,
  },
  {
    url: "https://news.google.com/rss/search?q=%28%22natural+gas%22+OR+LNG+OR+%22Henry+Hub%22%29+when%3A1d&hl=en-US&gl=US&ceid=US%3Aen",
    source: "Natural Gas headlines (via Google News)",
    stripPublisherSuffix: true,
  },
  {
    url: "https://news.google.com/rss/search?q=%28%22crude+inventories%22+OR+%22oil+inventories%22+OR+%22gas+storage%22+OR+EIA%29+when%3A2d&hl=en-US&gl=US&ceid=US%3Aen",
    source: "Inventory & storage (via Google News)",
    stripPublisherSuffix: true,
  },
  {
    url: "https://news.google.com/rss/search?q=site%3Aoilprice.com+when%3A2d&hl=en-US&gl=US&ceid=US%3Aen",
    source: "OilPrice.com (via Google News)",
    stripPublisherSuffix: true,
  },
  {
    url: "https://news.google.com/rss/search?q=site%3Aworldoil.com+when%3A2d&hl=en-US&gl=US&ceid=US%3Aen",
    source: "World Oil (via Google News)",
    stripPublisherSuffix: true,
  },
  {
    url: "https://news.google.com/rss/search?q=site%3Aspglobal.com+%28oil+OR+gas+OR+LNG+OR+crude%29+when%3A2d&hl=en-US&gl=US&ceid=US%3Aen",
    source: "S&P Global (via Google News)",
    stripPublisherSuffix: true,
  },
  {
    url: "https://news.google.com/rss/search?q=%28%22Strait+of+Hormuz%22+OR+%22Red+Sea%22+OR+sanctions+OR+refinery+OR+pipeline%29+%28oil+OR+gas%29+when%3A2d&hl=en-US&gl=US&ceid=US%3Aen",
    source: "Supply disruption watch (via Google News)",
    stripPublisherSuffix: true,
  },
];

// Per-feed item cap. An aggregator feed can return 100 items; parsing and
// scoring all of them across ~35 feeds is CPU this Worker does not have.
// The scorer sorts by recency anyway, so the tail is discarded regardless.
const MAX_ITEMS_PER_FEED = 25;
// Tightened from 8s: with a wider feed list these run in parallel, so the
// slowest single feed sets the floor on how fast a flash can surface.
const RSS_FETCH_TIMEOUT_MS = 6000;

function xmlUnescape(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&")
    .replace(/<[^>]+>/g, "")
    .trim();
}

// Minimal, tolerant RSS 2.0 / Atom item extractor -- Workers have no DOM
// parser, and pulling in a full XML library for this would be overkill.
// Regex-based on purpose: malformed/partial XML just yields fewer or zero
// matched items rather than throwing, which is exactly the "never crash
// the whole dashboard on a bad feed" behavior this needs.
function parseRssFeed(xml: string, sourceName: string, stripSuffix = false): RawNewsArticle[] {
  const items: RawNewsArticle[] = [];
  const itemBlocks = xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? xml.match(/<entry\b[\s\S]*?<\/entry>/gi) ?? [];
  for (const block of itemBlocks) {
    const title = block.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
    if (!title) continue;
    const desc = block.match(/<description\b[^>]*>([\s\S]*?)<\/description>/i)?.[1] ?? block.match(/<summary\b[^>]*>([\s\S]*?)<\/summary>/i)?.[1] ?? "";
    const link =
      block.match(/<link\b[^>]*>([\s\S]*?)<\/link>/i)?.[1] ??
      block.match(/<link\b[^>]*href="([^"]+)"/i)?.[1] ??
      "";
    const pubDate = block.match(/<pubDate\b[^>]*>([\s\S]*?)<\/pubDate>/i)?.[1] ?? block.match(/<(?:published|updated)\b[^>]*>([\s\S]*?)<\/(?:published|updated)>/i)?.[1] ?? "";
    const parsedDate = pubDate ? new Date(pubDate) : new Date();
    const cleanTitle = xmlUnescape(title);
    items.push({
      headline: stripSuffix ? stripPublisherSuffix(cleanTitle) : cleanTitle,
      summary: xmlUnescape(desc).slice(0, 400),
      source: sourceName,
      publishedAt: Number.isFinite(parsedDate.getTime()) ? parsedDate.toISOString() : new Date().toISOString(),
      url: xmlUnescape(link),
    });
  }
  return items;
}

async function fetchOneRssFeed(feed: RssFeedConfig): Promise<{ source: string; ok: boolean; count: number; error?: string; articles: RawNewsArticle[] }> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), RSS_FETCH_TIMEOUT_MS);
    // A generic-looking, standards-compliant browser UA -- some public feeds
    // sit behind bot-protection that blocks unfamiliar/non-browser UA
    // strings outright, which reads identically to a dead URL from here
    // (both come back non-ok) unless the UA itself is ruled out first.
    const res = await fetch(feed.url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        Accept: "application/rss+xml, application/xml, text/xml, */*",
      },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return { source: feed.source, ok: false, count: 0, error: `HTTP ${res.status} ${res.statusText}`.trim(), articles: [] };
    const xml = await res.text();
    const articles = parseRssFeed(xml, feed.source, feed.stripPublisherSuffix === true).slice(0, MAX_ITEMS_PER_FEED);
    return { source: feed.source, ok: true, count: articles.length, articles };
  } catch (e: any) {
    return { source: feed.source, ok: false, count: 0, error: e?.name === "AbortError" ? "Timed out" : (e?.message ?? "Fetch failed"), articles: [] };
  }
}

async function fetchNewsApiArticles(apiKey: string): Promise<{ source: string; ok: boolean; count: number; error?: string; articles: RawNewsArticle[] }> {
  const ENERGY_NEWS_QUERY =
    '(crude OR "oil price" OR OPEC OR "natural gas" OR "Henry Hub" OR WTI OR Brent OR "Strait of Hormuz" OR "Red Sea" OR pipeline OR refinery OR "EIA storage" OR "EIA inventory") AND (oil OR gas OR energy OR crude)';
  try {
    const usp = new URLSearchParams({ q: ENERGY_NEWS_QUERY, language: "en", sortBy: "publishedAt", pageSize: "40" });
    const res = await fetch(`https://newsapi.org/v2/everything?${usp.toString()}`, { headers: { "X-Api-Key": apiKey, "User-Agent": "KumarSignalsPro/1.0" } });
    if (!res.ok) return { source: "NewsAPI", ok: false, count: 0, error: `HTTP ${res.status}`, articles: [] };
    const json: any = await res.json();
    const articles: RawNewsArticle[] = (json?.articles ?? [])
      .filter((a: any) => a?.title && a.title !== "[Removed]")
      .map((a: any) => ({
        headline: a.title as string,
        summary: (a.description ?? "") as string,
        source: (a.source?.name ?? "Unknown") as string,
        publishedAt: (a.publishedAt ?? new Date().toISOString()) as string,
        url: (a.url ?? "") as string,
      }));
    return { source: "NewsAPI (additive)", ok: true, count: articles.length, articles };
  } catch (e: any) {
    return { source: "NewsAPI (additive)", ok: false, count: 0, error: e.message ?? "Fetch failed", articles: [] };
  }
}

// 60s is Cloudflare KV's hard minimum for expirationTtl -- anything lower is
// rejected outright -- so this is as fresh as a KV-cached feed can legally be,
// which is what AI Flash wants. The key is versioned because the feed list
// above changed: a v2 payload cached from the old five-source list would
// otherwise keep serving until it aged out.
// The Cron fires every 5 minutes and refreshes this, so a 30-minute TTL keeps
// the key warm with a wide safety margin while a request-path rebuild becomes
// the rare exception rather than the norm.
//
// WHY THIS IS NOT 60 SECONDS ANY MORE. A 60s TTL meant a browser polling the
// news was, most minutes, the thing that paid for rebuilding it: ~35 parallel
// feed fetches plus regex-parsing every one of their XML bodies, inside a
// request that gets 10ms of CPU on this plan. That is how a news page ends up
// showing nothing -- not because the feeds are dead, but because the request
// rebuilding them runs out of CPU and fails. It also wrote KV ~1,440 times a
// day against a 1,000/day free limit. Cron-warming at 5 minutes costs ~288
// writes a day and moves the expensive part somewhere it has room to run.
const NEWS_CACHE_TTL_SECONDS = 30 * 60;
const NEWS_CACHE_KV_KEY = "news:combined:v6";

/**
 * Rebuilds the news cache from every feed. Expensive by nature -- call it
 * from scheduled(), not from a request, unless the cache is genuinely empty.
 */
async function buildEnergyNews(env: Env): Promise<NewsFetchResult> {
  const rssResults = await Promise.all(TRUSTED_RSS_FEEDS.map(fetchOneRssFeed));
  const sourceStatus = rssResults.map(({ articles, ...status }) => status);
  const rawArticles: RawNewsArticle[] = rssResults.flatMap((r) => r.articles);

  if (env.NEWSAPI_KEY) {
    const napi = await fetchNewsApiArticles(env.NEWSAPI_KEY);
    sourceStatus.push({ source: napi.source, ok: napi.ok, count: napi.count, error: napi.error });
    rawArticles.push(...napi.articles);
  }

  const anySourceOk = sourceStatus.some((s) => s.ok);
  if (!anySourceOk) {
    const result: NewsFetchResult = { available: false, articles: [], events: [], sourceStatus, error: "All news sources are temporarily unavailable" };
    return result;
  }

  // De-dupe identical URLs (the same wire story often appears verbatim
  // across two of our own RSS feeds) before scoring/clustering.
  const seenUrls = new Set<string>();
  const deduped = rawArticles.filter((a) => {
    const key = a.url || a.headline;
    if (seenUrls.has(key)) return false;
    seenUrls.add(key);
    return true;
  });

  const now = Date.now();
  const scored = scoreArticles(deduped, now).filter((a) => now - new Date(a.publishedAt).getTime() < 48 * 60 * 60 * 1000);
  const events = clusterEvents(scored);
  const result: NewsFetchResult = { available: true, articles: scored, events, sourceStatus, builtAt: new Date(now).toISOString() };
  await env.COMMODITY_KV.put(NEWS_CACHE_KV_KEY, JSON.stringify(result), { expirationTtl: NEWS_CACHE_TTL_SECONDS });
  return result;
}

/**
 * What every request path calls. Reads the cache the Cron keeps warm and only
 * rebuilds inline when there is genuinely nothing cached (first request after
 * a deploy, or after a 30-minute gap in Cron delivery) -- so the 10ms-CPU
 * request path almost never does the expensive work.
 */
async function fetchEnergyNews(env: Env): Promise<NewsFetchResult> {
  const cached = await env.COMMODITY_KV.get(NEWS_CACHE_KV_KEY);
  if (cached) {
    try {
      return JSON.parse(cached) as NewsFetchResult;
    } catch {
      // fall through and rebuild on a corrupt cache entry
    }
  }
  return buildEnergyNews(env);
}

/**
 * Cron entry point. Refreshes the news cache every tick so the feeds are at
 * most ~5 minutes old and no browser request ever pays to rebuild them.
 * Failures are swallowed: a bad tick leaves the previous cache in place.
 */
async function warmEnergyNews(env: Env): Promise<void> {
  try {
    await buildEnergyNews(env);
  } catch {
    // A failed warm is not worth failing the whole Cron run for -- the
    // previous cached payload keeps serving until the next tick.
  }
}

// ---- "Why Today": a grounded, plain-language read of why crude / NG is
// moving, built from the SAME scored news the News AI page uses. The drivers
// (real headlines) and the direction/duration are deterministic; the AI only
// writes the prose, strictly from those headlines -- it can never introduce an
// event, price, or number that isn't in the fetched news.
const WHYTODAY_CACHE_KV_KEY = "whytoday:v1";
const WHYTODAY_CACHE_TTL_SECONDS = 300;

function buildWhyDrivers(articles: ScoredNewsArticle[], market: "CRUDE" | "NG"): { drivers: WhyDriver[]; leanScore: number; rules: string[] } {
  const relevant = articles
    .filter((a) => a.affectedMarket === market || a.affectedMarket === "BOTH")
    .sort((a, b) => b.importance - a.importance)
    .slice(0, 5);
  const drivers: WhyDriver[] = relevant.map((a) => ({
    headline: a.headline,
    source: a.source,
    url: a.url,
    impact: leanFromScore(a.impactScale),
    timeImpact: a.timeImpact,
  }));
  const leanScore = Number(relevant.reduce((s, a) => s + a.impactScale, 0).toFixed(2));
  const rules = relevant.flatMap((a) => a.matchedRules);
  return { drivers, leanScore, rules };
}

async function aiWhySummaries(env: Env, crude: WhyDriver[], ng: WhyDriver[]): Promise<{ crude: string; naturalGas: string }> {
  if (!crude.length && !ng.length) return { crude: "", naturalGas: "" };
  const fmt = (d: WhyDriver[]) => (d.length ? d.map((x) => `- [${x.impact}] "${x.headline}" (${x.source})`).join("\n") : "(no relevant headlines)");
  try {
    const result = await env.AI.run("@cf/meta/llama-4-scout-17b-16e-instruct", {
      messages: [
        {
          role: "system",
          content:
            "You are an energy market analyst. You are given REAL, already-fetched news headlines about crude oil and natural gas. Summarize ONLY what these headlines say -- NEVER invent an event, price, number, or cause that is not present in them. For each commodity give a 2-3 sentence plain-English summary of why the market is moving today, based only on the headlines provided. If a commodity has no relevant headlines, say exactly that its move looks technical/positioning with no major news catalyst. Reply with ONLY a single JSON object of the form {\"crude\":\"...\",\"naturalGas\":\"...\"}, no markdown.",
        },
        { role: "user", content: `CRUDE OIL headlines:\n${fmt(crude)}\n\nNATURAL GAS headlines:\n${fmt(ng)}` },
      ],
      response_format: { type: "json_object" },
      max_tokens: 500,
    });
    const raw = (result as { response?: unknown }).response;
    const obj = typeof raw === "string" ? JSON.parse(raw) : (raw as { crude?: string; naturalGas?: string });
    return { crude: typeof obj?.crude === "string" ? obj.crude : "", naturalGas: typeof obj?.naturalGas === "string" ? obj.naturalGas : "" };
  } catch {
    return { crude: "", naturalGas: "" }; // the deterministic drivers still stand on their own
  }
}

function assembleWhyCommodity(drivers: WhyDriver[], leanScore: number, rules: string[], aiSummary: string): WhyCommodity {
  const duration = classifyNewsDuration(rules);
  return {
    available: drivers.length > 0,
    lean: leanFromScore(leanScore),
    leanScore,
    drivers,
    aiSummary,
    durationRead: duration.read,
    durationWhy: duration.why,
  };
}

async function computeWhyToday(env: Env): Promise<{ crude: WhyCommodity; naturalGas: WhyCommodity; newsAvailable: boolean; fetchedAt: string }> {
  const cached = await env.COMMODITY_KV.get(WHYTODAY_CACHE_KV_KEY);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch {
      // refetch on a corrupt entry
    }
  }
  const news = await fetchEnergyNews(env);
  const cl = buildWhyDrivers(news.articles, "CRUDE");
  const ng = buildWhyDrivers(news.articles, "NG");
  const ai = news.available ? await aiWhySummaries(env, cl.drivers, ng.drivers) : { crude: "", naturalGas: "" };

  const out = {
    crude: assembleWhyCommodity(cl.drivers, cl.leanScore, cl.rules, ai.crude),
    naturalGas: assembleWhyCommodity(ng.drivers, ng.leanScore, ng.rules, ai.naturalGas),
    newsAvailable: news.available,
    fetchedAt: new Date().toISOString(),
  };
  await env.COMMODITY_KV.put(WHYTODAY_CACHE_KV_KEY, JSON.stringify(out), { expirationTtl: WHYTODAY_CACHE_TTL_SECONDS });
  return out;
}

interface EiaFetchResult {
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

const EIA_CACHE_TTL_SECONDS = 8 * 60;
const EIA_CACHE_KV_KEY = "news:eia:v2";

async function fetchEiaData(env: Env): Promise<EiaFetchResult> {
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
    await env.COMMODITY_KV.put(EIA_CACHE_KV_KEY, JSON.stringify(result), { expirationTtl: EIA_CACHE_TTL_SECONDS });
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

async function fetchEconCalendar(env: Env): Promise<CalendarFetchResult> {
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
    await env.COMMODITY_KV.put(CALENDAR_CACHE_KV_KEY, JSON.stringify(result), { expirationTtl: CALENDAR_CACHE_TTL_SECONDS });
    return result;
  } catch (e: any) {
    return { available: false, events: [], error: e.message ?? "Economic calendar fetch failed" };
  }
}

// ---- Market depth (Level 2 order book) for the underlying future ----
// Reuses the exact same /v2/market-quote/quotes endpoint the option chain
// already calls (see getOptionChain above) -- Upstox's full quote response
// already includes a `depth` object (5 bid/ask levels) alongside the
// last_price/oi/volume fields this file was already reading, so this is one
// more read of an endpoint already in use, not a new upstream integration.
// Some accounts/plans may not carry L2 depth entitlement for MCX -- returns
// { error } rather than fabricating levels when Upstox sends none back, so
// the frontend can show an honest "unavailable" state instead of fake data.
interface DepthLevel {
  price: number;
  quantity: number;
  orders: number;
}

interface MarketDepthSnapshot {
  tradingSymbol: string;
  bestBid: number | null;
  bestAsk: number | null;
  buyDepth: DepthLevel[];
  sellDepth: DepthLevel[];
  totalBuyQuantity: number;
  totalSellQuantity: number;
  volume: number | null;
  averagePrice: number | null;
  asOf: string;
}

async function getFuturesDepth(token: string, instrumentKey: string, tradingSymbol: string): Promise<MarketDepthSnapshot | { error: string }> {
  const usp = new URLSearchParams({ instrument_key: instrumentKey });
  const res = await fetch(`https://api.upstox.com/v2/market-quote/quotes?${usp.toString()}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  let json: any;
  try {
    json = await res.json();
  } catch {
    return { error: `Depth request failed (HTTP ${res.status} ${res.statusText}): response was not valid JSON` };
  }
  if (json.errors && json.errors.length) {
    const msg = json.errors.map((e: any) => e.message || e.errorCode || JSON.stringify(e)).join("; ");
    return { error: `Upstox rejected the depth request (HTTP ${res.status}): ${msg}` };
  }
  if (json.status !== "success" || !json.data) return { error: `Upstox returned no quote data for this instrument (HTTP ${res.status})` };
  const quote: any = Object.values(json.data)[0];
  if (!quote) return { error: "No quote returned for this instrument" };
  const depth = quote.depth;
  if (!depth || !Array.isArray(depth.buy) || !Array.isArray(depth.sell) || (!depth.buy.length && !depth.sell.length)) {
    return { error: "This account doesn't appear to have Level 2 market depth entitlement for MCX -- Upstox returned no depth levels" };
  }
  const toLevels = (levels: any[]): DepthLevel[] => levels.filter((l) => l && l.price).map((l) => ({ price: l.price, quantity: l.quantity ?? 0, orders: l.orders ?? 0 }));
  const buyDepth = toLevels(depth.buy);
  const sellDepth = toLevels(depth.sell);
  return {
    tradingSymbol,
    bestBid: buyDepth[0]?.price ?? null,
    bestAsk: sellDepth[0]?.price ?? null,
    buyDepth,
    sellDepth,
    totalBuyQuantity: quote.total_buy_quantity ?? buyDepth.reduce((s, l) => s + l.quantity, 0),
    totalSellQuantity: quote.total_sell_quantity ?? sellDepth.reduce((s, l) => s + l.quantity, 0),
    volume: quote.volume ?? null,
    averagePrice: quote.average_price ?? null,
    asOf: new Date().toISOString(),
  };
}

// Several components ask for the same symbol's depth in the same tick -- the
// order-book pressure badge on each open call card, plus the depth panel. Same
// in-flight sharing as the intraday feed, for the same reason.
const DEPTH_CACHE_TTL_MS = 4_000;
const depthCache = new Map<string, { at: number; promise: Promise<MarketDepthSnapshot | { error: string }> }>();

async function computeMarketDepth(token: string, symbol: Symbol): Promise<MarketDepthSnapshot | { error: string }> {
  const hit = depthCache.get(symbol);
  if (hit && Date.now() - hit.at < DEPTH_CACHE_TTL_MS) return hit.promise;
  const promise = fetchMarketDepth(token, symbol);
  depthCache.set(symbol, { at: Date.now(), promise });
  promise.then((v) => { if ("error" in v) depthCache.delete(symbol); }).catch(() => depthCache.delete(symbol));
  return promise;
}

async function fetchMarketDepth(token: string, symbol: Symbol): Promise<MarketDepthSnapshot | { error: string }> {
  const fut = await getNearestFuture(token, symbol);
  if (!fut) return { error: "No instrument found" };
  return getFuturesDepth(token, fut.instrument_key, fut.trading_symbol);
}

interface OptionLegAnalytics {
  ltp: number | null;
  oi: number | null;
  iv: number | null;
  volume: number | null;
  change: number | null;
  changePercent: number | null;
}

interface OptionRowAnalytics {
  strike: number;
  call: OptionLegAnalytics & Partial<Greeks>;
  put: OptionLegAnalytics & Partial<Greeks>;
}

interface OptionsAnalytics {
  symbol: Symbol;
  tradingSymbol: string;
  expiry: string;
  spot: number;
  atmStrike: number | null;
  pcr: number | null;
  bias: Direction;
  support: number | null;
  resistance: number | null;
  maxPain: number | null;
  rows: OptionRowAnalytics[];
}

// The option chain is the single most expensive upstream call in the app and
// it was NOT shared: the options page, the depth badge, the Best Call cron and
// the Ai20-20 cron each triggered their own fetch, and within one Cron tick the
// two background checks fetched the same chain twice over for each symbol.
//
// Same in-flight-promise pattern as getIntradayCandles above, for the same
// reason: callers arrive together, so caching only the RESULT would still let
// them all miss and fetch in parallel. Sharing the promise means they await one
// call. TTL is deliberately tiny so nothing gets staler than the client's own
// poll already made it, and a failure is evicted immediately so the next
// attempt retries rather than being stuck with a cached error.
const OPTIONS_CACHE_TTL_MS = 8_000;
const optionsCache = new Map<string, { at: number; promise: Promise<OptionsAnalytics | { error: string; rateLimited?: boolean }> }>();

async function computeOptionsAnalytics(env: Env, token: string, symbol: Symbol, pinnedStrikes: number[] = []): Promise<OptionsAnalytics | { error: string; rateLimited?: boolean }> {
  const key = `${symbol}|${[...pinnedStrikes].sort((a, b) => a - b).join(",")}`;
  const hit = optionsCache.get(key);
  if (hit && Date.now() - hit.at < OPTIONS_CACHE_TTL_MS) return hit.promise;
  const promise = computeOptionsAnalyticsUncached(env, token, symbol, pinnedStrikes);
  optionsCache.set(key, { at: Date.now(), promise });
  promise
    .then((v) => {
      if ("error" in v) optionsCache.delete(key);
    })
    .catch(() => optionsCache.delete(key));
  return promise;
}

async function computeOptionsAnalyticsUncached(env: Env, token: string, symbol: Symbol, pinnedStrikes: number[] = []): Promise<OptionsAnalytics | { error: string; rateLimited?: boolean }> {
  const fut = await getNearestFuture(token, symbol);
  if (!fut) return { error: "No instrument found" };

  const candles = await getHistoricalCandles(env, token, fut.instrument_key);
  const spot = candles && candles.length ? candles[candles.length - 1].close : null;

  const { fut: optionFut, expiry: optionExpiry, chain, error, rateLimited } = await resolveOptionChainAcrossFutures(token, symbol, fut, spot, pinnedStrikes);
  const chainRes = { chain, error };
  if (chainRes.error || !chainRes.chain) return { error: chainRes.error ?? "Option chain unavailable", rateLimited };

  const refSpot = spot ?? chainRes.chain[0]?.underlying_spot_price ?? 0;
  const { rows, atmStrike } = nearestStrikes(chainRes.chain, refSpot, 8, pinnedStrikes);
  const analysis = analyzeChain(chainRes.chain);
  const maxPain = computeMaxPain(chainRes.chain);
  const T = yearsToExpiry(optionExpiry);

  const analyticsRows: OptionRowAnalytics[] = rows.map((r: any) => {
    const callLtp = r.call_options?.market_data?.ltp || null;
    const putLtp = r.put_options?.market_data?.ltp || null;
    const callIV = callLtp ? impliedVolatility(callLtp, refSpot, r.strike_price, T, RISK_FREE_RATE, true) : null;
    const putIV = putLtp ? impliedVolatility(putLtp, refSpot, r.strike_price, T, RISK_FREE_RATE, false) : null;
    const callGreeks = callIV ? black76Greeks(refSpot, r.strike_price, T, RISK_FREE_RATE, callIV / 100, true) : null;
    const putGreeks = putIV ? black76Greeks(refSpot, r.strike_price, T, RISK_FREE_RATE, putIV / 100, false) : null;
    const callClose = r.call_options?.market_data?.close_price || null;
    const putClose = r.put_options?.market_data?.close_price || null;
    return {
      strike: r.strike_price,
      call: {
        ltp: callLtp,
        oi: r.call_options?.market_data?.oi || null,
        iv: callIV,
        volume: r.call_options?.market_data?.volume ?? null,
        change: callLtp && callClose ? r2(callLtp - callClose) : null,
        changePercent: callLtp && callClose ? r2(((callLtp - callClose) / callClose) * 100) : null,
        ...(callGreeks ?? {}),
      },
      put: {
        ltp: putLtp,
        oi: r.put_options?.market_data?.oi || null,
        iv: putIV,
        volume: r.put_options?.market_data?.volume ?? null,
        change: putLtp && putClose ? r2(putLtp - putClose) : null,
        changePercent: putLtp && putClose ? r2(((putLtp - putClose) / putClose) * 100) : null,
        ...(putGreeks ?? {}),
      },
    };
  });

  return {
    symbol,
    tradingSymbol: optionFut.trading_symbol,
    expiry: optionExpiry,
    spot: refSpot,
    atmStrike,
    pcr: analysis.pcr,
    bias: analysis.bias,
    support: analysis.support,
    resistance: analysis.resistance,
    maxPain,
    rows: analyticsRows,
  };
}

interface PortfolioTrade {
  id: string;
  symbol: Symbol;
  optSide?: "CE" | "PE";
  strike?: number;
  entryPrice: number;
  exitPrice?: number;
  quantity: number; // number of lots
  lotSize: number;
  stopLoss?: number;
  target?: number;
  entryDate: string;
  exitDate?: string;
  status: "OPEN" | "CLOSED";
  pnl?: number;
  notes?: string;
  mistakes?: string;
  lessons?: string;
  emotion?: string;
  source?: "manual" | "master-ai" | "signal";
}

const PORTFOLIO_KV_KEY = "portfolio_trades";

async function getPortfolioTrades(env: Env): Promise<PortfolioTrade[]> {
  const raw = await env.COMMODITY_KV.get(PORTFOLIO_KV_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function savePortfolioTrades(env: Env, trades: PortfolioTrade[]): Promise<void> {
  await env.COMMODITY_KV.put(PORTFOLIO_KV_KEY, JSON.stringify(trades));
}

function computePnl(trade: PortfolioTrade): number | undefined {
  if (trade.exitPrice === undefined) return undefined;
  return r2((trade.exitPrice - trade.entryPrice) * trade.quantity * trade.lotSize);
}

async function createPortfolioTrade(env: Env, body: Partial<PortfolioTrade>): Promise<PortfolioTrade> {
  if (!body.symbol || !ALL_SYMBOLS.includes(body.symbol as Symbol)) throw new Error("symbol is required");
  if (typeof body.entryPrice !== "number") throw new Error("entryPrice is required");
  if (typeof body.quantity !== "number" || body.quantity <= 0) throw new Error("quantity is required");
  if (typeof body.lotSize !== "number" || body.lotSize <= 0) throw new Error("lotSize is required");

  // Logging a trade that's already closed (e.g. importing real broker
  // history) needs entry AND exit set in the same call -- the existing
  // OPEN-then-PATCH-to-close flow always stamps exitDate as "now", which is
  // wrong for a trade that actually closed days ago.
  const hasExit = typeof body.exitPrice === "number";

  const trade: PortfolioTrade = {
    id: crypto.randomUUID(),
    symbol: body.symbol as Symbol,
    optSide: body.optSide,
    strike: body.strike,
    entryPrice: body.entryPrice,
    quantity: body.quantity,
    lotSize: body.lotSize,
    stopLoss: body.stopLoss,
    target: body.target,
    entryDate: body.entryDate ?? new Date().toISOString(),
    status: hasExit ? "CLOSED" : "OPEN",
    notes: body.notes,
    mistakes: body.mistakes,
    lessons: body.lessons,
    emotion: body.emotion,
    source: body.source ?? "manual",
  };
  if (hasExit) {
    trade.exitPrice = body.exitPrice;
    trade.exitDate = body.exitDate ?? new Date().toISOString();
    trade.pnl = computePnl(trade);
  }

  const trades = await getPortfolioTrades(env);
  trades.unshift(trade);
  await savePortfolioTrades(env, trades);
  return trade;
}

async function updatePortfolioTrade(env: Env, id: string, patch: Partial<PortfolioTrade>): Promise<PortfolioTrade> {
  const trades = await getPortfolioTrades(env);
  const idx = trades.findIndex((t) => t.id === id);
  if (idx === -1) throw new Error("Trade not found");

  const updated: PortfolioTrade = { ...trades[idx], ...patch, id: trades[idx].id };
  if (patch.exitPrice !== undefined && !patch.status) updated.status = "CLOSED";
  if (updated.status === "CLOSED") {
    updated.exitDate = updated.exitDate ?? new Date().toISOString();
    updated.pnl = computePnl(updated);
  }
  trades[idx] = updated;
  await savePortfolioTrades(env, trades);
  return updated;
}

async function deletePortfolioTrade(env: Env, id: string): Promise<void> {
  const trades = await getPortfolioTrades(env);
  const next = trades.filter((t) => t.id !== id);
  await savePortfolioTrades(env, next);
}

// Every page's own signal/call history (Best Call, AI-Risk, AI-Test V2/Pro,
// Kumar AI, Elite, Kimi, Directional Gate) previously lived only in each
// browser's own localStorage -- opening the app on a different browser or
// device showed nothing, since it was never sent anywhere. This app has no
// login, so there's exactly one shared history (same as every other piece
// of data this Worker already serves) rather than a per-user one. The
// client is responsible for merging/debouncing before it pushes here -- this
// is a deliberately simple whole-blob get/put, no per-entry validation,
// matching the same trust level as the portfolio trades KV store above.
const TRADE_LOGS_KV_KEY = "trade_logs_v1";

async function getTradeLogsFromKv(env: Env): Promise<Record<string, unknown>> {
  const raw = await env.COMMODITY_KV.get(TRADE_LOGS_KV_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function saveTradeLogsToKv(env: Env, logs: Record<string, unknown>): Promise<void> {
  await env.COMMODITY_KV.put(TRADE_LOGS_KV_KEY, JSON.stringify(logs));
}

// ---- Server-side trade-log advancement (Cron) ----
// The browser only advances/closes trades while a tab is open (see
// useTradeLog.ts). This runs the SAME pure advanceOpenEntry logic on the
// Cron schedule so a call's target/stop is detected -- and the trade closed
// at the real observed premium -- even with the app fully shut. It never
// OPENS a trade (that stays the browser's job, driven by each page's own
// engine); it only advances and closes the ones already open, so the two
// sides can never fight over what qualifies.
// An open trade this old whose strike no longer appears in a successfully
// fetched, strike-pinned option chain has an EXPIRED/delisted contract -- it
// can never resolve on live quotes again, so it would sit "running" forever.
// The age guard keeps a fresh intraday trade (whose strike might briefly fall
// outside the window on a transient fetch) from being swept.
const ORPHAN_SWEEP_MIN_AGE_MS = 24 * 60 * 60 * 1000;

const CRON_STATUS_KV_KEY = "cron:trade_log_last_run";

interface AdvanceCounts {
  opensChecked: number;
  advanced: number; // ticked or closed against a live premium
  swept: number; // orphaned (expired-contract) trades closed as manual/breakeven
  eodClosed: number; // still running at the bell, closed at the last premium
}

async function advanceOpenTradesForSymbol(
  env: Env,
  token: string,
  symbol: Symbol,
  logs: Record<string, TradeLogEntry[]>,
  now: number,
  counts: AdvanceCounts
): Promise<boolean> {
  // Gather every open strike for this symbol across all of its keys, so the
  // one chain fetch pins them all in and none freeze for being far from ATM.
  const openStrikes = new Set<number>();
  for (const [key, entries] of Object.entries(logs)) {
    if (symbolOfTradeLogKey(key) !== symbol) continue;
    const last = entries[entries.length - 1];
    if (last && !last.closed) openStrikes.add(last.strike);
  }
  if (openStrikes.size === 0) return false;

  const analytics = await computeOptionsAnalytics(env, token, symbol, Array.from(openStrikes));
  if ("error" in analytics) return false; // no live quotes -> never fabricate a close

  const ltpByStrikeSide = new Map<string, number>();
  const strikesInChain = new Set<number>();
  for (const row of analytics.rows) {
    strikesInChain.add(row.strike);
    if (row.call?.ltp != null) ltpByStrikeSide.set(`${row.strike}-CE`, row.call.ltp);
    if (row.put?.ltp != null) ltpByStrikeSide.set(`${row.strike}-PE`, row.put.ltp);
  }

  let changed = false;
  for (const [key, entries] of Object.entries(logs)) {
    if (symbolOfTradeLogKey(key) !== symbol) continue;
    const last = entries[entries.length - 1];
    if (!last || last.closed) continue;
    counts.opensChecked += 1;

    const ltp = ltpByStrikeSide.get(`${last.strike}-${last.optSide}`) ?? null;
    if (ltp !== null) {
      const advanced = advanceOpenEntry(last, ltp, now);
      if (advanced !== last) {
        logs[key] = [...entries.slice(0, -1), advanced];
        counts.advanced += 1;
        changed = true;
      }
      continue;
    }

    // No live quote for this strike. If the strike is genuinely absent from a
    // chain we DID fetch (so it's not a transient fetch miss) and the trade is
    // old enough that its contract has expired, close it honestly as manual:
    // status closed_manual, no exitPrice, so P&L books it at breakeven rather
    // than inventing an outcome we can't know.
    const expired = !strikesInChain.has(last.strike);
    const stale = now - last.openedAt >= ORPHAN_SWEEP_MIN_AGE_MS;
    if (expired && stale) {
      logs[key] = [...entries.slice(0, -1), { ...last, closed: true, closedAt: now, status: "closed_manual" }];
      counts.swept += 1;
      changed = true;
    }
  }
  return changed;
}

async function runTradeLogAdvanceCheck(env: Env): Promise<void> {
  const token = await env.COMMODITY_KV.get("access_token");
  const now = Date.now();
  const counts: AdvanceCounts = { opensChecked: 0, advanced: 0, swept: 0, eodClosed: 0 };

  // Heartbeat: always record that the Cron ran (and what it did), even when
  // nothing changed and even when there's no token, so "/api/cron-status" can
  // prove the schedule is actually firing.
  const writeHeartbeat = async (note?: string) =>
    env.COMMODITY_KV.put(CRON_STATUS_KV_KEY, JSON.stringify({ at: now, ...counts, note: note ?? "ok" }));

  if (!token) {
    await writeHeartbeat("no access token in KV");
    return;
  }

  let logs = (await getTradeLogsFromKv(env)) as Record<string, TradeLogEntry[]>;
  let anyChanged = false;

  if (!mcxSessionAt(now).isOpen) {
    // MCX is shut. The only job left is the end-of-day close, and it only
    // needs a quote fetch when something is actually still running from
    // before the last bell. The common case -- nothing open -- costs zero
    // Upstox calls, where this used to fetch the chain every five minutes
    // all night and all weekend for as long as any trade was open.
    const { closeAt } = lastMcxClose(now);
    for (const symbol of TRADE_LOG_SYMBOLS) {
      const running = runningBeforeClose(logs, symbol, closeAt);
      if (running.length === 0) continue;
      try {
        const analytics = await computeOptionsAnalytics(env, token, symbol as Symbol, running.map((r) => r.entry.strike));
        // A failed fetch closes nothing -- the next tick retries. Closing at
        // breakeven because Upstox blinked would invent an outcome.
        if ("error" in analytics) {
          // Same token, same limit: the other symbol would fail identically.
          if (analytics.rateLimited) break;
          continue;
        }
        const ltp = new Map<string, number>();
        for (const row of analytics.rows) {
          if (row.call?.ltp != null) ltp.set(`${row.strike}-CE`, row.call.ltp);
          if (row.put?.ltp != null) ltp.set(`${row.strike}-PE`, row.put.ltp);
        }
        const result = closeRunningAtSessionEnd(logs, symbol, closeAt, (strike, side) => ltp.get(`${strike}-${side}`) ?? null);
        if (result.closed > 0) {
          logs = result.logs;
          counts.eodClosed += result.closed;
          anyChanged = true;
        }
      } catch {
        // best-effort -- one symbol failing must not block the other
      }
    }
  } else {
    for (const symbol of TRADE_LOG_SYMBOLS) {
      try {
        const changed = await advanceOpenTradesForSymbol(env, token, symbol as Symbol, logs, now, counts);
        anyChanged = anyChanged || changed;
      } catch {
        // best-effort -- one symbol failing must not block the other
      }
    }
  }

  if (anyChanged) {
    // Re-read the freshest KV right before writing and merge our advanced
    // result over it (advanced = "server", so its closes win), so a client
    // push that landed mid-run -- e.g. a brand-new open trade -- is preserved
    // rather than clobbered by our older snapshot.
    const fresh = (await getTradeLogsFromKv(env)) as Record<string, TradeLogEntry[]>;
    await saveTradeLogsToKv(env, mergeTradeLogs(fresh, logs));
  }
  await writeHeartbeat();
}

async function getCronStatus(env: Env): Promise<Record<string, unknown>> {
  const raw = await env.COMMODITY_KV.get(CRON_STATUS_KV_KEY);
  if (!raw) return { lastRunAt: null, note: "the trade-log Cron has not recorded a run yet" };
  try {
    const p = JSON.parse(raw) as { at?: number; opensChecked?: number; advanced?: number; swept?: number; eodClosed?: number; note?: string };
    return {
      lastRunAt: p.at ? new Date(p.at).toISOString() : null,
      ageSeconds: p.at ? Math.round((Date.now() - p.at) / 1000) : null,
      opensChecked: p.opensChecked ?? null,
      advanced: p.advanced ?? null,
      swept: p.swept ?? null,
      eodClosed: p.eodClosed ?? null,
      note: p.note ?? null,
    };
  } catch {
    return { lastRunAt: null, note: "unreadable cron status" };
  }
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

// ---- Kumar AI: Workers AI reasoning layer for the Kumar AI page ----
// The entry/stop/target/decision/confidence numbers are ALWAYS computed by
// the same deterministic, already-verified rule-based engine the rest of
// this app uses (analyzeTimeframe on the frontend) -- they are sent HERE
// already decided, and the model is explicitly instructed never to change
// them. Its only job is the qualitative layer this app can't compute on its
// own: plain-language reasoning, bullish/bearish factor lists, risk
// factors, expected movement, and a holding-duration suggestion. If the
// model call fails or returns unparseable output, this returns an honest
// error/empty result rather than fabricating a narrative.
interface KumarAiIndicatorSnapshot {
  ema9: number | null;
  ema20: number | null;
  ema50: number | null;
  ema200: number | null;
  rsi14: number | null;
  macd: { line: number; signal: number; histogram: number } | null;
  vwap: number | null;
  atr14: number | null;
  adx14: number | null;
  bollinger: { upper: number; middle: number; lower: number } | null;
  superTrend: { value: number; direction: string } | null;
  volumeRatio: number | null;
}

interface KumarAiAnalyzeRequest {
  symbol: string;
  timeframeLabel: string;
  decision: string;
  bias: string;
  optSide: string | null;
  entry: number;
  stop: number;
  targets: [number, number, number];
  rr: number | null;
  confidencePct: number | null;
  indicators: KumarAiIndicatorSnapshot;
  structureLabel: string | null;
  patternLabel: string | null;
  supportResistanceNote: string | null;
  reasons: string[];
}

interface KumarAiAnalyzeResult {
  reasoning: string;
  bullishReasons: string[];
  bearishReasons: string[];
  riskFactors: string[];
  expectedMovement: string;
  holdingDuration: string;
  bestTimeframeNote: string;
  error?: string;
}

function buildKumarAiPrompt(body: KumarAiAnalyzeRequest): string {
  const ind = body.indicators;
  return `Symbol: ${body.symbol}
Timeframe: ${body.timeframeLabel}
Decision already determined by the rule-based engine: ${body.decision} (bias: ${body.bias})
Option side: ${body.optSide ?? "n/a"}
Entry: ${body.entry}
Stop Loss: ${body.stop}
Targets: ${body.targets.join(", ")}
Risk:Reward: ${body.rr ?? "n/a"}
Confidence: ${body.confidencePct ?? "n/a"}%
EMA9/20/50/200: ${ind.ema9 ?? "n/a"} / ${ind.ema20 ?? "n/a"} / ${ind.ema50 ?? "n/a"} / ${ind.ema200 ?? "n/a"}
RSI(14): ${ind.rsi14 ?? "n/a"}
MACD: line=${ind.macd?.line ?? "n/a"} signal=${ind.macd?.signal ?? "n/a"} histogram=${ind.macd?.histogram ?? "n/a"}
VWAP: ${ind.vwap ?? "n/a"}
ATR(14): ${ind.atr14 ?? "n/a"}
ADX(14): ${ind.adx14 ?? "n/a"}
Bollinger Bands: upper=${ind.bollinger?.upper ?? "n/a"} middle=${ind.bollinger?.middle ?? "n/a"} lower=${ind.bollinger?.lower ?? "n/a"}
SuperTrend: ${ind.superTrend?.value ?? "n/a"} (${ind.superTrend?.direction ?? "n/a"})
Volume vs 10-bar average: ${ind.volumeRatio ?? "n/a"}x
Market structure: ${body.structureLabel ?? "n/a"}
Candle pattern: ${body.patternLabel ?? "n/a"}
Support/Resistance note: ${body.supportResistanceNote ?? "n/a"}
Reasons the rule-based engine already identified: ${body.reasons.join("; ") || "none"}

Do NOT invent, change, or second-guess the entry/stop/target/decision numbers above -- treat them as fixed facts. Return ONLY this JSON shape, no markdown fences, no extra keys:
{
  "reasoning": "2-3 sentence plain-language summary of why this call was generated",
  "bullishReasons": ["short bullet", "..."],
  "bearishReasons": ["short bullet", "..."],
  "riskFactors": ["short bullet", "..."],
  "expectedMovement": "short phrase describing expected price behavior",
  "holdingDuration": "short suggested holding time range",
  "bestTimeframeNote": "one sentence on whether this timeframe suits this setup"
}`;
}

// Accepts `unknown`, not `string` -- with response_format:"json_object", the
// Workers AI binding sometimes hands back an already-parsed object under
// `.response` instead of a JSON string (shape varies by model/binding
// version), and calling .trim() on that used to throw "raw.trim is not a
// function", surfacing as a broken AI-reasoning panel instead of a graceful
// fallback.
function parseKumarAiResponse(raw: unknown): KumarAiAnalyzeResult {
  const strArray = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const fromObj = (obj: Record<string, unknown>): KumarAiAnalyzeResult => ({
    reasoning: typeof obj.reasoning === "string" ? obj.reasoning : "",
    bullishReasons: strArray(obj.bullishReasons),
    bearishReasons: strArray(obj.bearishReasons),
    riskFactors: strArray(obj.riskFactors),
    expectedMovement: typeof obj.expectedMovement === "string" ? obj.expectedMovement : "",
    holdingDuration: typeof obj.holdingDuration === "string" ? obj.holdingDuration : "",
    bestTimeframeNote: typeof obj.bestTimeframeNote === "string" ? obj.bestTimeframeNote : "",
  });

  if (raw && typeof raw === "object") {
    return fromObj(raw as Record<string, unknown>);
  }

  const text = typeof raw === "string" ? raw : "";
  if (!text.trim()) {
    return {
      reasoning: "",
      bullishReasons: [],
      bearishReasons: [],
      riskFactors: [],
      expectedMovement: "",
      holdingDuration: "",
      bestTimeframeNote: "",
      error: "AI returned an empty response",
    };
  }

  try {
    const cleaned = text
      .trim()
      .replace(/^```(json)?/i, "")
      .replace(/```$/, "")
      .trim();
    return fromObj(JSON.parse(cleaned));
  } catch {
    // Model didn't return valid JSON -- surface the raw text as the
    // reasoning rather than silently dropping it or fabricating structure.
    return {
      reasoning: text.trim().slice(0, 800),
      bullishReasons: [],
      bearishReasons: [],
      riskFactors: [],
      expectedMovement: "",
      holdingDuration: "",
      bestTimeframeNote: "",
    };
  }
}

async function computeKumarAiAnalysis(env: Env, body: KumarAiAnalyzeRequest): Promise<KumarAiAnalyzeResult> {
  try {
    const result = await env.AI.run("@cf/meta/llama-4-scout-17b-16e-instruct", {
      messages: [
        {
          role: "system",
          content:
            "You are a professional commodity trading analyst. You are given REAL, already-computed technical indicator readings and a REAL entry/stop/target/decision already decided by a deterministic rule-based engine -- you must NEVER invent or change any of these numbers. Your only job is to explain, in strict JSON, why these readings support (or don't fully support) this call: bullish/bearish factors, risk factors, expected movement, and a holding-duration suggestion. Reply with ONLY a single JSON object, no markdown, no commentary outside the JSON.",
        },
        { role: "user", content: buildKumarAiPrompt(body) },
      ],
      response_format: { type: "json_object" },
      max_tokens: 700,
    });
    return parseKumarAiResponse((result as { response?: unknown }).response);
  } catch (err: unknown) {
    return {
      reasoning: "",
      bullishReasons: [],
      bearishReasons: [],
      riskFactors: [],
      expectedMovement: "",
      holdingDuration: "",
      bestTimeframeNote: "",
      error: err instanceof Error ? err.message : "AI reasoning unavailable right now",
    };
  }
}

// ---- Best Call background push notifications (ntfy.sh) ----
// A Cron Trigger (see wrangler.jsonc) calls runBestCallNotificationCheck on a
// schedule, independent of anyone having the app open -- unlike the
// browser-notification alert engine on the frontend (which only runs while a
// tab is open), this is what lets a call reach the user even with the site
// fully closed. Deliberately built on ntfy.sh (a free, no-signup push relay:
// just an HTTPS POST to a topic URL) instead of hand-rolling the raw Web
// Push protocol -- that would need per-subscription VAPID/AES-GCM crypto
// this environment has no way to verify end-to-end against a real device,
// and a broken crypto path could break at runtime in ways that are very
// hard to diagnose. ntfy trades a small amount of trust in a third-party
// relay for something that's simple, free, and immediately testable by the
// user via the "Send test notification" button in Settings.
const NTFY_TOPIC_KV_KEY = "ntfy_topic";

const CRON_TIMEFRAMES: { tf: string; label: string }[] = [
  { tf: "15", label: "15 Minutes" },
  { tf: "30", label: "30 Minutes" },
  { tf: "60", label: "1 Hour" },
  { tf: "240", label: "4 Hours" },
];
// Same "next higher timeframe confirms the trend" mapping the Directional
// Gate page's own useDirectionalGateSuite hook uses on the frontend.
const CRON_TREND_TF: Record<string, string> = { "15": "60", "30": "60", "60": "240", "240": "1D" };

function bestCallSignature(pick: BestCallPick): string {
  return `${pick.strike}-${pick.optSide}-${pick.source}`;
}

async function sendNtfyNotification(topic: string, title: string, body: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, {
      method: "POST",
      headers: { Title: title, Priority: "high", Tags: "chart_with_upwards_trend" },
      body,
    });
    if (!res.ok) return { ok: false, error: `ntfy.sh responded HTTP ${res.status}` };
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message ?? "ntfy.sh request failed" };
  }
}

// ---- Ai20-20 background push (ntfy.sh) ----
//
// The page this is built for is the one actually traded, and the trader is at
// work when its calls fire. Everything below therefore runs on the Cron with
// no browser open, importing the SAME pure engine the page renders
// (aiTwentyTwentyEngine) so a pushed call and an on-screen call can never
// disagree.
//
// The one thing the Worker does not get for free is premium MOMENTUM. The page
// builds it from a rolling buffer of ATM CE/PE prices collected while it is
// open; the Worker keeps the equivalent buffer in KV across Cron ticks. The
// buffer resets whenever the ATM strike rolls, exactly as the page's does --
// an old strike's premium history says nothing about a freshly repriced one.
const TWENTY_SAMPLES_KV_KEY = "twenty20:samples:v1";
const TWENTY_MAX_SAMPLES = 12;

interface TwentySampleBuffer {
  [symbol: string]: { strike: number | null; ce: number[]; pe: number[] };
}

function twentyMomentumPct(samples: number[]): number | null {
  if (samples.length < 3 || samples[0] <= 0) return null;
  return ((samples[samples.length - 1] - samples[0]) / samples[0]) * 100;
}

function twentySignature(symbol: string, strike: number, optSide: string, entry: number): string {
  return `${symbol}-${strike}-${optSide}-${entry.toFixed(2)}`;
}

/**
 * One Cron tick of the Ai20-20 watcher.
 *
 * Deliberately gated on market hours: outside them there is nothing to enter,
 * the sample buffer would fill with stale prices, and every tick would be a KV
 * write against a 1,000/day free limit for no benefit.
 */
async function runTwentyTwentyNotificationCheck(env: Env): Promise<void> {
  // Gated on market hours for three reasons, not one: there is nothing to
  // enter outside them, the sample buffer would fill with stale prices, and
  // every tick would spend Upstox requests -- which is what pushes the app
  // into Upstox's 1015 rate limit -- for no possible benefit.
  if (!getMarketStatus().isOpen) return;
  const token = await env.COMMODITY_KV.get("access_token");
  if (!token) return;
  // Checked BEFORE any upstream call. With no ntfy topic saved there is
  // nowhere to send a push, so fetching the data to build one would be pure
  // waste against the rate limit.
  const topic = await env.COMMODITY_KV.get(NTFY_TOPIC_KV_KEY);
  if (!topic) return;

  let buffers: TwentySampleBuffer = {};
  try {
    buffers = JSON.parse((await env.COMMODITY_KV.get(TWENTY_SAMPLES_KV_KEY)) ?? "{}") as TwentySampleBuffer;
  } catch {
    buffers = {};
  }

  let buffersChanged = false;

  for (const symbol of OPTION_SYMBOLS) {
    try {
      const fut = await getNearestFuture(token, symbol as Symbol);
      if (!fut) continue;
      const fast = await getCandlesForTF(env, token, fut, "5");
      if ("error" in fast || fast.length === 0) continue;

      const optionsResult = await computeOptionsAnalytics(env, token, symbol as Symbol);
      const options = "error" in optionsResult ? undefined : optionsResult;

      // --- keep the momentum buffer -------------------------------------
      const atmRow = options && options.atmStrike !== null ? options.rows.find((r) => r.strike === options.atmStrike) : undefined;
      const strike = atmRow?.strike ?? null;
      const prev = buffers[symbol];
      const buf = prev && prev.strike === strike ? prev : { strike, ce: [], pe: [] };
      const ceLtp = atmRow?.call.ltp ?? null;
      const peLtp = atmRow?.put.ltp ?? null;
      if (typeof ceLtp === "number") buf.ce = [...buf.ce, ceLtp].slice(-TWENTY_MAX_SAMPLES);
      if (typeof peLtp === "number") buf.pe = [...buf.pe, peLtp].slice(-TWENTY_MAX_SAMPLES);
      buffers[symbol] = buf;
      buffersChanged = true;

      // --- the same engine the page runs --------------------------------
      const analysis = analyzeImmediate(fast, twentyMomentumPct(buf.ce), twentyMomentumPct(buf.pe));
      const candidates = scanForAiTwenty([{ symbol, analysis }]);
      if (candidates.length === 0) continue;
      const projection = projectPremium20(analysis, options);
      if (!projection) continue;

      const sig = twentySignature(symbol, projection.strike, projection.optSide, projection.entry);
      const sigKey = `notified:TWENTY20-${symbol}`;
      if ((await env.COMMODITY_KV.get(sigKey)) === sig) continue;
      await env.COMMODITY_KV.put(sigKey, sig);

      const displayName = symbol === "CRUDEOIL" ? "Crude Oil" : "Natural Gas";
      const lot = TWENTY_LOT_SIZE[symbol as keyof typeof TWENTY_LOT_SIZE] ?? 1;
      const t1 = projection.targets[0];
      await sendNtfyNotification(
        topic,
        `Ai20-20: ${displayName} ${projection.strike} ${projection.optSide}`,
        [
          `BUY ${displayName} ${projection.strike} ${projection.optSide}`,
          "",
          `Entry: Rs ${projection.entry}`,
          `Target 1: Rs ${t1}`,
          `Stop: Rs ${projection.stop}`,
          "",
          `About Rs ${Math.round((t1 - projection.entry) * lot)} per lot at Target 1.`,
          "",
          "Open the app and tap Can I Buy Now? before entering -- this call was",
          "sent the moment it fired, and price may have moved since.",
        ].join("\n")
      );
    } catch {
      // One symbol failing must never stop the other, and must never fail the
      // whole Cron run.
    }
  }

  if (buffersChanged) {
    // A single key for both symbols, written once per tick and only during
    // market hours -- roughly 175 writes a day rather than 576.
    await env.COMMODITY_KV.put(TWENTY_SAMPLES_KV_KEY, JSON.stringify(buffers), { expirationTtl: 24 * 60 * 60 });
  }
}

// Runs the exact same 3-engine comparison (AI Elite + Directional Gate +
// Kimi playbook -> pickBestCall) the frontend's Best Call page displays,
// entirely server-side so it can run on a schedule with nobody's browser
// open. Returns null the same way the frontend does when nothing currently
// qualifies -- never fabricates a pick just to have something to notify.
async function computeBestCallForSymbol(env: Env, token: string, symbol: Symbol): Promise<BestCallPick | null> {
  const fut = await getNearestFuture(token, symbol);
  if (!fut) return null;
  const commodity: "NG" | "CL" = symbol === "NATURALGAS" ? "NG" : "CL";

  const candlesByTf: Record<string, Candle[]> = {};
  for (const { tf } of CRON_TIMEFRAMES) {
    const c = await getCandlesForTF(env, token, fut, tf);
    candlesByTf[tf] = "error" in c ? [] : c;
  }
  const daily = await getCandlesForTF(env, token, fut, "1D");
  candlesByTf["1D"] = "error" in daily ? [] : daily;

  const optionsResult = await computeOptionsAnalytics(env, token, symbol);
  const options = "error" in optionsResult ? undefined : optionsResult;

  const analyses = CRON_TIMEFRAMES.map(({ tf, label }) =>
    analyzeTimeframe({ tf, label, candles: candlesByTf[tf], dailyCandles: candlesByTf["1D"], options, journalWinRate: null })
  );
  const eliteEntries = analyses.map((a) => ({ symbol, analysis: a, options }));
  const elite = findEliteSignal(eliteEntries);
  const elitePick = elite ? eliteToBestCallPick(elite) : null;

  const gatePicks: BestCallPick[] = [];
  for (const direction of ["bullish", "bearish"] as const) {
    for (const { tf, label } of CRON_TIMEFRAMES) {
      const evaluation = evaluateDirectionalGate(direction, candlesByTf[tf], candlesByTf[CRON_TREND_TF[tf]] ?? []);
      if (evaluation.status !== "qualified") continue;
      const p = gateToBestCallPick(evaluation, direction, label, options);
      if (p) gatePicks.push(p);
    }
  }

  const kimiTimeframes = CRON_TIMEFRAMES.map(({ tf, label }) => ({ tf, label, candles: candlesByTf[tf] }));
  const kimiResults = scanAllSetups(commodity, kimiTimeframes);
  const kimiPicks = kimiResults.map((r) => kimiToBestCallPick(r, commodity, options)).filter((p): p is BestCallPick => p !== null);

  const allPicks = [...(elitePick ? [elitePick] : []), ...gatePicks, ...kimiPicks];
  return pickBestCall(allPicks);
}

// Only notifies when the pick actually CHANGES (tracked via a per-symbol
// "last notified" signature in KV) -- otherwise the same still-running call
// would re-notify every single Cron tick.
async function runBestCallNotificationCheck(env: Env): Promise<void> {
  const token = await env.COMMODITY_KV.get("access_token");
  if (!token) return;
  const topic = await env.COMMODITY_KV.get(NTFY_TOPIC_KV_KEY);
  if (!topic) return;

  for (const symbol of OPTION_SYMBOLS) {
    try {
      const pick = await computeBestCallForSymbol(env, token, symbol as Symbol);
      if (!pick) continue;
      const lastSigKey = `notified:BEST-${symbol}`;
      const lastSig = await env.COMMODITY_KV.get(lastSigKey);
      const sig = bestCallSignature(pick);
      if (sig === lastSig) continue;
      await env.COMMODITY_KV.put(lastSigKey, sig);

      const displayName = symbol === "CRUDEOIL" ? "Crude Oil" : "Natural Gas";
      const title = `Best Call: ${displayName} ${pick.strike} ${pick.optSide}`;
      const body = [
        `BUY ${displayName} ${pick.strike} ${pick.optSide}`,
        "",
        `Entry: Rs ${pick.entry}`,
        `Targets: ${pick.targets.join(" / ")}`,
        `Stop: Rs ${pick.stop}`,
        "",
        `Source: ${pick.source} (${Math.round(pick.confidence)}% confidence)`,
      ].join("\n");
      await sendNtfyNotification(topic, title, body);
    } catch {
      // best-effort -- one symbol failing shouldn't block the other
    }
  }
}

// ---- Options expiry alerts (Crude Oil / Natural Gas, 2 days out) ----
// MCX options near expiry lose liquidity and bleed theta fast -- a trade
// that looked fine a week out can become hard to exit at a fair price in
// the final couple of sessions. This surfaces a plain warning once the
// REAL listed option expiry (not the future's own, later, expiry -- see
// resolveOptionExpiryCandidates above) is 2 days away or closer, so open
// positions get closed or rolled in time rather than discovered stuck.
interface ExpiryAlert {
  symbol: "CRUDEOIL" | "NATURALGAS";
  displayName: string;
  expiry: string;
  daysLeft: number;
  message: string;
}

const EXPIRY_ALERT_DISPLAY_NAME: Record<string, string> = { CRUDEOIL: "Crude Oil", NATURALGAS: "Natural Gas" };

// Calendar-day difference (UTC midnight to UTC midnight), not a raw
// millisecond division -- that would round differently depending on what
// time of day "now" happens to be, flipping the reported daysLeft back and
// forth across a boundary within the same calendar day.
// "Today" is the IST calendar date. Using the UTC date meant that between
// midnight and 05:30 IST -- when UTC is still on yesterday -- expiry day read
// as "expires tomorrow".
function daysUntil(expiry: string): number {
  const e = new Date(expiry);
  const expiryMidnight = Date.UTC(e.getUTCFullYear(), e.getUTCMonth(), e.getUTCDate());
  const t = istParts();
  const todayMidnight = Date.UTC(t.y, t.m - 1, t.d);
  return Math.round((expiryMidnight - todayMidnight) / 86_400_000);
}

function expiryAlertMessage(displayName: string, daysLeft: number): string {
  if (daysLeft <= 0) {
    return `${displayName} options expire TODAY. Close or roll any open trade before end of session -- liquidity and spreads worsen fast into expiry.`;
  }
  if (daysLeft === 1) {
    return `${displayName} options expire tomorrow. Close or roll open trades soon -- theta decay accelerates sharply in the last couple of sessions.`;
  }
  return `${displayName} options expire in ${daysLeft} days. Start planning to close or roll open trades -- theta decay accelerates sharply into expiry.`;
}

// Best-effort per symbol, same pattern as computeBestCallForSymbol -- one
// symbol's lookup failing (e.g. a transient Upstox error) shouldn't block
// the other from still being reported.
async function computeExpiryAlerts(token: string): Promise<ExpiryAlert[]> {
  const out: ExpiryAlert[] = [];
  for (const symbol of OPTION_SYMBOLS) {
    try {
      const fut = await getNearestFuture(token, symbol);
      if (!fut) continue;
      const candidates = await resolveOptionExpiryCandidates(token, fut);
      const expiry = candidates[0];
      if (!expiry) continue;
      const daysLeft = daysUntil(expiry);
      if (daysLeft < 0 || daysLeft > 2) continue;
      const displayName = EXPIRY_ALERT_DISPLAY_NAME[symbol] ?? symbol;
      out.push({ symbol: symbol as ExpiryAlert["symbol"], displayName, expiry, daysLeft, message: expiryAlertMessage(displayName, daysLeft) });
    } catch (e) {
      // best-effort -- one symbol failing shouldn't block the other. Except a
      // rate limit: both symbols share one Upstox token and one limit, so the
      // next symbol is guaranteed to fail too and only extends it.
      if (isRateLimit(e)) break;
    }
  }
  return out;
}

// Re-notifies once per distinct (symbol, expiry, daysLeft) combination --
// so the user gets pinged at 2 days out, again at 1 day, again on expiry
// day itself, but not every 5 minutes in between.
async function runExpiryAlertCheck(env: Env): Promise<void> {
  const token = await env.COMMODITY_KV.get("access_token");
  if (!token) return;
  const topic = await env.COMMODITY_KV.get(NTFY_TOPIC_KV_KEY);
  if (!topic) return;

  try {
    const alerts = await computeExpiryAlerts(token);
    for (const alert of alerts) {
      const key = `notified:EXPIRY-${alert.symbol}-${alert.expiry}-${alert.daysLeft}`;
      const already = await env.COMMODITY_KV.get(key);
      if (already) continue;
      await env.COMMODITY_KV.put(key, "1", { expirationTtl: 7 * 86_400 });

      const daysLabel = alert.daysLeft <= 0 ? "TODAY" : alert.daysLeft === 1 ? "1 day" : `${alert.daysLeft} days`;
      const title = `⏳ ${alert.displayName} options expiry in ${daysLabel}`;
      await sendNtfyNotification(topic, title, alert.message);
    }
  } catch {
    // best-effort -- a failed check just means no alert fires this tick
  }
}

async function requireToken(env: Env): Promise<string | Response> {
  const token = await env.COMMODITY_KV.get("access_token");
  if (!token) return json({ error: "No token found in KV. Log in via the main kumarcmtd worker's /login first." }, 400);
  return token;
}

async function handleRequest(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      try {
        if (url.pathname === "/api/market-status") {
          return json(getMarketStatus());
        }

        if (url.pathname === "/api/global-markets") {
          return json(await computeGlobalMarkets());
        }

        // "How far has the world moved since MCX shut." Two KV-and-memo reads,
        // no Upstox call, so it is safe to poll from the Price-Alerts page.
        if (url.pathname === "/api/overnight-tracker") {
          return json(await computeOvernightTracker(env));
        }

        // GPT News only. Kept off /api/global-markets so the Global Markets
        // page keeps rendering exactly the three energy benchmarks it always has.
        if (url.pathname === "/api/macro-markets") {
          return json(await computeMacroMarkets(env));
        }

        if (url.pathname === "/api/prices") {
          const token = await requireToken(env);
          if (token instanceof Response) return token;
          return json(await computePrices(env, token));
        }

        if (url.pathname === "/api/signals") {
          const token = await requireToken(env);
          if (token instanceof Response) return token;
          return json(await computeSignals(env, token));
        }

        const signalMatch = url.pathname.match(/^\/api\/signals\/([A-Z]+)$/);
        if (signalMatch) {
          const symbol = signalMatch[1] as Symbol;
          if (!OPTION_SYMBOLS.includes(symbol as any)) return json({ error: "Unsupported symbol" }, 400);
          const token = await requireToken(env);
          if (token instanceof Response) return token;
          return json(await computeSignal(env, token, symbol));
        }

        if (url.pathname === "/api/scan") {
          const token = await requireToken(env);
          if (token instanceof Response) return token;
          const symbol = url.searchParams.get("symbol") as Symbol;
          const tf = url.searchParams.get("tf") || "15";
          if (!OPTION_SYMBOLS.includes(symbol as any)) return json({ error: "invalid symbol" }, 400);
          return json(await computeScan(env, token, symbol, tf));
        }

        // 90 days of 30-minute candles for the AI Backtest Lab.
        //
        // The Lab runs the backtest IN THE BROWSER, not here: ~1,300 engine
        // evaluations is seconds of CPU and a Worker invocation gets 10 ms.
        // So this endpoint just hands over the candles, which are already the
        // same KV-cached series the gap study and Price-Alerts use -- no extra
        // Upstox call, and the phone has no CPU ceiling.
        if (url.pathname === "/api/history-30m") {
          const token = await requireToken(env);
          if (token instanceof Response) return token;
          const symbol = url.searchParams.get("symbol") as Symbol;
          if (!OPTION_SYMBOLS.includes(symbol as any)) return json({ error: "invalid symbol" }, 400);
          const fut = await getNearestFuture(token, symbol);
          if (!fut) return json({ symbol, tradingSymbol: null, candles: [], error: "No instrument found" });
          const candles = await getHistorical30mCandles(env, token, fut.instrument_key, GAP_STUDY_DAYS);
          return json({ symbol, tradingSymbol: fut.trading_symbol, candles });
        }

        if (url.pathname === "/api/pullback") {
          const token = await requireToken(env);
          if (token instanceof Response) return token;
          const symbol = url.searchParams.get("symbol") as Symbol;
          if (!OPTION_SYMBOLS.includes(symbol as any)) return json({ error: "invalid symbol" }, 400);
          return json(await computePullback(env, token, symbol));
        }

        if (url.pathname === "/api/time-profile") {
          const token = await requireToken(env);
          if (token instanceof Response) return token;
          const symbol = url.searchParams.get("symbol") as Symbol;
          if (!OPTION_SYMBOLS.includes(symbol as any)) return json({ error: "invalid symbol" }, 400);
          return json(await serveTimeProfile(env, token, symbol));
        }

        if (url.pathname === "/api/gap-study") {
          const token = await requireToken(env);
          if (token instanceof Response) return token;
          const symbol = url.searchParams.get("symbol") as Symbol;
          if (!ALL_SYMBOLS.includes(symbol)) return json({ error: "invalid symbol" }, 400);
          return json(await computeGapStudy(env, token, symbol));
        }

        if (url.pathname === "/api/candles") {
          const token = await requireToken(env);
          if (token instanceof Response) return token;
          const symbol = url.searchParams.get("symbol") as Symbol;
          const tf = url.searchParams.get("tf") || "1D";
          if (!ALL_SYMBOLS.includes(symbol)) return json({ error: "invalid symbol" }, 400);
          return json(await computeCandles(env, token, symbol, tf));
        }

        if (url.pathname === "/api/kumar-ai/analyze") {
          if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
          const body = (await request.json().catch(() => null)) as KumarAiAnalyzeRequest | null;
          if (!body || !body.symbol || !body.timeframeLabel || typeof body.entry !== "number") {
            return json({ error: "Invalid request body" }, 400);
          }
          return json(await computeKumarAiAnalysis(env, body));
        }

        const optionsMatch = url.pathname.match(/^\/api\/options\/([A-Z]+)$/);
        if (optionsMatch) {
          const symbol = optionsMatch[1] as Symbol;
          if (!OPTION_SYMBOLS.includes(symbol as any)) return json({ error: "Unsupported symbol" }, 400);
          const token = await requireToken(env);
          if (token instanceof Response) return token;
          // Strikes the client currently has an open trade tracked against --
          // always kept in the response even if the underlying has since
          // moved far enough that they'd otherwise fall outside the normal
          // ATM-centered window (see nearestStrikes/getOptionChain).
          const pinnedStrikes = (url.searchParams.get("strikes") ?? "")
            .split(",")
            .map((s) => Number(s))
            .filter((n) => Number.isFinite(n));
          return json(await computeOptionsAnalytics(env, token, symbol, pinnedStrikes));
        }

        const depthMatch = url.pathname.match(/^\/api\/depth\/([A-Z]+)$/);
        if (depthMatch) {
          const symbol = depthMatch[1] as Symbol;
          if (!ALL_SYMBOLS.includes(symbol)) return json({ error: "Unsupported symbol" }, 400);
          const token = await requireToken(env);
          if (token instanceof Response) return token;
          return json(await computeMarketDepth(token, symbol));
        }

        if (url.pathname === "/api/news-trade") {
          const [news, eia, calendar] = await Promise.all([fetchEnergyNews(env), fetchEiaData(env), fetchEconCalendar(env)]);
          return json({ news, eia, calendar, marketStatus: getMarketStatus(), fetchedAt: new Date().toISOString() });
        }

        if (url.pathname === "/api/why-today") {
          return json(await computeWhyToday(env));
        }

        // Spec-compliant standalone routes -- same underlying cached
        // fetchers as /api/news-trade above (so there is exactly one place
        // that actually talks to RSS/EIA/FRED), exposed individually for
        // any consumer that only needs one slice rather than the combined
        // decision payload. All server-side, no client ever sees a secret.
        if (url.pathname === "/api/news") {
          const symbolParam = url.searchParams.get("symbol");
          const news = await fetchEnergyNews(env);
          // fetchedAt is the time this response was assembled, which -- because
          // fetchEnergyNews may return a KV hit up to NEWS_CACHE_TTL_SECONDS
          // old -- is an upper bound on freshness, not proof of it. AI Flash
          // labels it as "checked", and every article carries its own real
          // publishedAt for the age shown on the item itself.
          const fetchedAt = new Date().toISOString();
          if (!symbolParam) return json({ ...news, fetchedAt });
          const marketKey: AffectedMarket = symbolParam.toUpperCase() === "NG" ? "NG" : symbolParam.toUpperCase() === "CRUDE" ? "CRUDE" : "BOTH";
          return json({
            ...news,
            fetchedAt,
            articles: news.articles.filter((a) => a.affectedMarket === marketKey || a.affectedMarket === "BOTH"),
            events: news.events.filter((e) => e.affectedMarket === marketKey || e.affectedMarket === "BOTH"),
          });
        }

        if (url.pathname === "/api/events") {
          const news = await fetchEnergyNews(env);
          return json({ available: news.available, events: news.events, error: news.error });
        }

        if (url.pathname === "/api/energy") {
          const eia = await fetchEiaData(env);
          return json(eia);
        }

        if (url.pathname === "/api/notify/topic") {
          if (request.method === "GET") {
            const topic = await env.COMMODITY_KV.get(NTFY_TOPIC_KV_KEY);
            return json({ topic: topic ?? null });
          }
          if (request.method === "POST") {
            const body = (await request.json().catch(() => ({}))) as { topic?: string };
            const topic = (body.topic ?? "").trim();
            if (!topic || topic.length > 64 || !/^[a-zA-Z0-9_-]+$/.test(topic)) {
              return json({ error: "Topic must be 1-64 characters: letters, numbers, dashes, or underscores only" }, 400);
            }
            await env.COMMODITY_KV.put(NTFY_TOPIC_KV_KEY, topic);
            return json({ ok: true, topic });
          }
          if (request.method === "DELETE") {
            await env.COMMODITY_KV.delete(NTFY_TOPIC_KV_KEY);
            return json({ ok: true });
          }
          return json({ error: "Method not allowed" }, 405);
        }

        if (url.pathname === "/api/notify/test") {
          if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
          const topic = await env.COMMODITY_KV.get(NTFY_TOPIC_KV_KEY);
          if (!topic) return json({ error: "No ntfy topic saved yet -- save one first" }, 400);
          const result = await sendNtfyNotification(topic, "Kumar Signals Pro test", "If you can see this, background push notifications are working.");
          if (!result.ok) return json({ error: result.error ?? "Failed to send test notification" }, 502);
          return json({ ok: true });
        }

        if (url.pathname === "/api/notify/check-now") {
          if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
          await runBestCallNotificationCheck(env);
          return json({ ok: true });
        }

        if (url.pathname === "/api/expiry-alerts") {
          const token = await requireToken(env);
          if (token instanceof Response) return token;
          return json({ alerts: await computeExpiryAlerts(token) });
        }

        if (url.pathname === "/api/portfolio") {
          if (request.method === "GET") return json(await getPortfolioTrades(env));
          if (request.method === "POST") {
            const body = (await request.json().catch(() => ({}))) as Partial<PortfolioTrade>;
            return json(await createPortfolioTrade(env, body), 201);
          }
          return json({ error: "Method not allowed" }, 405);
        }

        const portfolioMatch = url.pathname.match(/^\/api\/portfolio\/([a-zA-Z0-9-]+)$/);
        if (portfolioMatch) {
          const id = portfolioMatch[1];
          if (request.method === "PATCH") {
            const body = (await request.json().catch(() => ({}))) as Partial<PortfolioTrade>;
            return json(await updatePortfolioTrade(env, id, body));
          }
          if (request.method === "DELETE") {
            await deletePortfolioTrade(env, id);
            return json({ ok: true });
          }
          return json({ error: "Method not allowed" }, 405);
        }

        if (url.pathname === "/api/cron-status") {
          return json(await getCronStatus(env));
        }

        if (url.pathname === "/api/trade-logs") {
          if (request.method === "GET") return json(await getTradeLogsFromKv(env));
          if (request.method === "POST") {
            const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
            if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "Body must be an object keyed by trade-log id" }, 400);
            // Merge the incoming client push OVER what's already in KV rather
            // than overwriting -- the Cron may have closed a trade server-side
            // that the client still shows as open, and the merge's "closed
            // version always wins" rule keeps that close instead of letting a
            // stale-open client copy resurrect it. (incoming = "local",
            // existing KV = "server".)
            const existing = (await getTradeLogsFromKv(env)) as Record<string, TradeLogEntry[]>;
            const merged = mergeTradeLogs(body as Record<string, TradeLogEntry[]>, existing);
            await saveTradeLogsToKv(env, merged);
            return json({ ok: true });
          }
          return json({ error: "Method not allowed" }, 405);
        }

        return json({ error: "Not found" }, 404);
      } catch (err: any) {
        // Full detail (including anything a stack trace would show) goes to
        // Cloudflare's own logs (wrangler tail / dashboard) only -- the
        // client only ever sees a short, capped message, never a trace.
        console.error("API error:", err);
        const message = typeof err?.message === "string" && err.message.length > 0 ? err.message.slice(0, 300) : "Internal server error";
        return json({ error: message }, 500);
      }
    }

    // Static SPA assets. Anything not matching a built file (client-side
    // routes like /charts, /options) falls back to index.html.
    const assetResponse = await env.ASSETS.fetch(request);
    if (assetResponse.status === 404) {
      const indexRequest = new Request(new URL("/index.html", url), request);
      return env.ASSETS.fetch(indexRequest);
    }
    return assetResponse;
}

export default {
  // Every response this Worker can return -- API JSON, index.html, and every
  // static asset -- passes through withSecurityHeaders exactly once here,
  // so no individual route can accidentally ship without the app's security
  // headers by forgetting to set them itself.
  async fetch(request: Request, env: Env): Promise<Response> {
    bindSharedCache(env);
    return withSecurityHeaders(await handleRequest(request, env));
  },

  // Cloudflare Cron Trigger (see wrangler.jsonc "triggers.crons") -- runs
  // independent of any browser tab being open, which is what makes push
  // notifications actually reach the user with the app fully closed.
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    bindSharedCache(env);
    ctx.waitUntil(runBestCallNotificationCheck(env));
    // Ai20-20 -- the page actually traded, pushed with the app closed.
    ctx.waitUntil(runTwentyTwentyNotificationCheck(env));
    ctx.waitUntil(runExpiryAlertCheck(env));
    ctx.waitUntil(runTradeLogAdvanceCheck(env));
    // Builds the Price-Alerts profile off the request path. Does nothing on a
    // tick where today's profile is already cached.
    ctx.waitUntil(warmTimeProfiles(env));
    // Keeps the news feeds warm so no browser request ever has to rebuild
    // ~35 RSS sources inside a 10ms CPU budget. See NEWS_CACHE_TTL_SECONDS.
    ctx.waitUntil(warmEnergyNews(env));
    // One snapshot per trading day, just after MCX shuts, so tomorrow morning
    // "moved since MCX closed" is a measured figure rather than an estimate.
    ctx.waitUntil(captureOvernightAnchor(env));
  },
};
