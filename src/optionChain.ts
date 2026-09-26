// Option chain assembly: expiry discovery, contract + quote fetching, the
// expiry and cross-future fallbacks (which stop on a rate limit), strike
// windowing, and PCR / max-OI analysis.

import { expiryStillLive } from "../frontend/src/utils/mcxSession";
import { type Direction, type FutureInfo, isRateLimit, r2, upstoxJson } from "./env";
import { getUpcomingFutures, sharedKv } from "./upstox";

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
export async function resolveOptionExpiryCandidates(token: string, fut: FutureInfo): Promise<string[]> {
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
export async function resolveOptionChainAcrossFutures(
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

export function nearestStrikes(chain: any[], spot: number, sideCount = 6, pinnedStrikes: number[] = []) {
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

export function analyzeChain(chain: any[]) {
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
