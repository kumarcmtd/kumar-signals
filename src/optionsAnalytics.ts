// Options analytics for the Options page and the cron: chain + Greeks +
// max pain, memoised with an in-flight promise.

import { type Direction, type Env, r2, type Symbol } from "./env";
import { black76Greeks, computeMaxPain, type Greeks, impliedVolatility, RISK_FREE_RATE, yearsToExpiry } from "./greeks";
import { analyzeChain, nearestStrikes, resolveOptionChainAcrossFutures } from "./optionChain";
import { getHistoricalCandles, getNearestFuture } from "./upstox";

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

export async function computeOptionsAnalytics(env: Env, token: string, symbol: Symbol, pinnedStrikes: number[] = []): Promise<OptionsAnalytics | { error: string; rateLimited?: boolean }> {
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
