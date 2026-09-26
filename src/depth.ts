// Level-2 order book (market depth) for the underlying future.

import type { Symbol } from "./env";
import { getNearestFuture } from "./upstox";

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

export async function computeMarketDepth(token: string, symbol: Symbol): Promise<MarketDepthSnapshot | { error: string }> {
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
