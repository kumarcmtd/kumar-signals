import type { Candle, MarketDepthSnapshot } from "../types";

// Approximates order-flow reads (net delta, which side is acting
// aggressively, absorption, exhaustion) from the same 5-level depth
// snapshots and candles already used elsewhere in this app. True order flow
// needs a tick-by-tick trade tape (who actually traded at the bid vs the
// ask, in what size) -- this app only has periodic L2 snapshots and OHLC
// bars, so every read below is a structural proxy, not a measured fact, and
// is labeled that way in the UI.

export type OrderFlowSide = "buyers" | "sellers" | "balanced";

export interface OrderFlowResult {
  deltaLabel: string;
  deltaBias: "bullish" | "bearish" | "neutral";
  aggressiveSide: OrderFlowSide;
  absorption: boolean;
  exhaustion: boolean;
  reason: string;
}

function pctOf(depth: MarketDepthSnapshot): number {
  const total = depth.totalBuyQuantity + depth.totalSellQuantity;
  return total > 0 ? (depth.totalBuyQuantity / total) * 100 : 50;
}

export function analyzeOrderFlow(depth: MarketDepthSnapshot | null, previousDepth: MarketDepthSnapshot | null, candles: Candle[]): OrderFlowResult | null {
  if (!depth || depth.error || depth.bestBid === null || depth.bestAsk === null || candles.length < 12) return null;

  const buyPct = pctOf(depth);
  const imbalance = (buyPct - 50) / 50; // -1..+1, matches marketDepthAnalysis' convention

  let deltaBias: OrderFlowResult["deltaBias"] = "neutral";
  let deltaLabel = "Balanced";
  if (imbalance >= 0.5) { deltaBias = "bullish"; deltaLabel = "Strong Net Buying"; }
  else if (imbalance >= 0.15) { deltaBias = "bullish"; deltaLabel = "Net Buying"; }
  else if (imbalance <= -0.5) { deltaBias = "bearish"; deltaLabel = "Strong Net Selling"; }
  else if (imbalance <= -0.15) { deltaBias = "bearish"; deltaLabel = "Net Selling"; }

  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const priceRose = last.close > prev.close;
  const priceFell = last.close < prev.close;

  let aggressiveSide: OrderFlowSide = "balanced";
  if (previousDepth && !previousDepth.error) {
    const prevBuyPct = pctOf(previousDepth);
    const buyPctDelta = buyPct - prevBuyPct;
    if (buyPctDelta > 5 && priceRose) aggressiveSide = "buyers";
    else if (buyPctDelta < -5 && priceFell) aggressiveSide = "sellers";
  }

  const window10 = candles.slice(-11, -1);
  const avgRange10 = window10.length ? window10.reduce((s, c) => s + (c.high - c.low), 0) / window10.length : 0;
  const avgVol10 = window10.length ? window10.reduce((s, c) => s + (c.volume ?? 0), 0) / window10.length : 0;
  const lastRange = last.high - last.low;
  const lastVol = last.volume ?? 0;

  // Absorption -- one side dominates the book and volume is elevated, but
  // price barely moved this bar. Reads as size being soaked up without the
  // price actually giving ground.
  const absorption = avgRange10 > 0 && lastRange < avgRange10 * 0.4 && avgVol10 > 0 && lastVol > avgVol10 * 1.2 && Math.abs(imbalance) > 0.3;

  // Exhaustion -- a long wick against the currently dominant pressure side,
  // with volume fading over the last few bars (the move running out of gas).
  const upperWick = last.high - Math.max(last.open, last.close);
  const lowerWick = Math.min(last.open, last.close) - last.low;
  const dominantWick = Math.max(upperWick, lowerWick);
  const volumeFading = candles.length >= 3 && lastVol < (candles[candles.length - 2].volume ?? 0) && (candles[candles.length - 2].volume ?? 0) < (candles[candles.length - 3].volume ?? 0);
  const wickAgainstPressure = (deltaBias === "bullish" && upperWick === dominantWick && dominantWick > 0) || (deltaBias === "bearish" && lowerWick === dominantWick && dominantWick > 0);
  const exhaustion = lastRange > 0 && dominantWick / lastRange > 0.5 && wickAgainstPressure && volumeFading;

  const reasonParts = [`Buy ${buyPct.toFixed(0)}% / Sell ${(100 - buyPct).toFixed(0)}%`];
  if (aggressiveSide !== "balanced") reasonParts.push(`${aggressiveSide === "buyers" ? "buyers" : "sellers"} acting aggressively`);
  if (absorption) reasonParts.push("possible absorption");
  if (exhaustion) reasonParts.push("possible exhaustion");

  return { deltaLabel, deltaBias, aggressiveSide, absorption, exhaustion, reason: reasonParts.join(" · ") };
}
