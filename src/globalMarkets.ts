// Overseas benchmarks (WTI, Brent, Henry Hub) from Yahoo, memoised, and the
// overnight anchor snapshot taken at the MCX close.

import { resolvePrevClose } from "../frontend/src/utils/globalMarketHours";
import { lastMcxClose, mcxSessionAt } from "../frontend/src/utils/mcxSession";
import { type Env, getMarketStatus, r2 } from "./env";

// ---- Global reference markets (overseas benchmarks MCX contracts track) ----
// MCX Crude Oil settles off a basket referencing WTI/Brent; MCX Natural Gas
// settles off Henry Hub. Those overseas markets trade on NYMEX/ICE well past
// MCX's ~23:30 IST close, so this is how a trader sees which way things are
// likely to gap when MCX reopens. Uses Yahoo Finance's public (unofficial,
// unauthenticated) chart endpoint, independent of the Upstox/KV token -- this
// works even when the user hasn't logged in via the main worker.
export const GLOBAL_INSTRUMENTS: { symbol: string; name: string; tracksMCX: string }[] = [
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

export async function getYahooQuote(symbol: string, name: string, tracksMCX: string): Promise<GlobalQuote> {
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

export async function computeGlobalMarkets(): Promise<GlobalQuote[]> {
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

export async function captureOvernightAnchor(env: Env): Promise<void> {
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

export async function computeOvernightTracker(env: Env): Promise<{
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
