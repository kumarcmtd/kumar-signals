// Pullback-vs-reversal read and the Price-Alerts time-of-day profile.

import { evaluatePullbackReversal, type ExternalSignal, type PullbackResult, type TfKey } from "../frontend/src/utils/pullbackReversalEngine";
import { buildSlotSessions, buildTimeProfile, type ClaimResult, eventProfile, type EventProfile, type ScheduledEvent, scheduledEvents, testClaims } from "../frontend/src/utils/timeProfileEngine";
import { type EiaFetchResult, fetchEiaData } from "./eiaCalendar";
import { type Candle, type Env, OPTION_SYMBOLS, type Symbol } from "./env";
import { buildMorningSessions, GAP_STUDY_DAYS, getHistorical30mCandles, hist30mCacheKey } from "./gapStudy";
import { fetchEnergyNews, type NewsFetchResult } from "./news";
import { getCandlesForTF } from "./signals";
import { getNearestFuture } from "./upstox";

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

export async function computePullback(env: Env, token: string, symbol: Symbol): Promise<PullbackResult> {
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
export async function serveTimeProfile(env: Env, token: string, symbol: Symbol): Promise<TimeProfileResponse> {
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
// The day's profile is built once per symbol, and building one is the most
// CPU-expensive thing the cron does (90 days of half-hour bars). So each run
// only CHECKS whether today's profile exists -- streamed and cancelled, never
// parsed -- and does at most ONE step towards one missing profile. It used to
// call the full computeTimeProfile for both symbols every tick, parsing the
// cached profile each time just to discover it was already there.
//
// A missing profile takes two runs: the first fetches and caches the 90 days
// of half-hour bars, the next builds the profile from that cache. Done in one
// run the two measured ~17 ms together, over the free plan's 10 ms.
export async function warmTimeProfiles(env: Env): Promise<void> {
  const token = await env.COMMODITY_KV.get("access_token");
  if (!token) return;
  for (const symbol of OPTION_SYMBOLS) {
    try {
      const fut = await getNearestFuture(token, symbol);
      if (!fut) continue;
      const exists = await env.COMMODITY_KV.get(timeProfileCacheKey(fut.instrument_key), "stream");
      if (exists) {
        await exists.cancel().catch(() => undefined);
        continue;
      }
      const history = await env.COMMODITY_KV.get(hist30mCacheKey(fut.instrument_key), "stream");
      if (history) {
        await history.cancel().catch(() => undefined);
        await computeTimeProfile(env, token, symbol as Symbol);
      } else {
        await getHistorical30mCandles(env, token, fut.instrument_key, GAP_STUDY_DAYS);
      }
      return;
    } catch {
      // A warm failure is not worth surfacing anywhere -- the next tick retries.
    }
  }
}

function timeProfileCacheKey(instrumentKey: string): string {
  return `timeprofile:v2:${instrumentKey}:${new Date().toISOString().slice(0, 10)}`;
}

async function computeTimeProfile(env: Env, token: string, symbol: Symbol): Promise<TimeProfileResponse> {
  const empty: TimeProfileResponse = {
    available: false, symbol, tradingSymbol: null, profile: null, claims: [], events: scheduledEvents(),
    eventProfiles: [], sessionsAnalyzed: 0, firstDate: null, lastDate: null,
    contractNote: "", computedAt: new Date().toISOString(),
  };

  const fut = await getNearestFuture(token, symbol);
  if (!fut) return { ...empty, error: "No instrument found" };

  const cacheKey = timeProfileCacheKey(fut.instrument_key);
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
