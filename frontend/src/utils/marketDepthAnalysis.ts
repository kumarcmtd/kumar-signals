import type { Candle, MarketDepthSnapshot } from "../types";

// Reads the underlying future's own Level 2 order book (bid/ask, 5 levels
// each side) and produces one MORE weighted input into the existing AI
// Strategy Verification score -- this module never decides BUY/SELL on its
// own; the page only ever uses its output to nudge the confidence the other
// 12 strategies already computed, exactly like every other check there.
//
// Two things here are honestly heuristic, not confirmed detection, and are
// labeled as such in the UI: "wall" detection (one price level holding much
// more size than its neighbors) and "possible spoofing / order pulling"
// (a wall that was large a sample or two ago and has since mostly vanished
// without price trading through it). Real spoofing/iceberg detection needs
// order-level tape data this app doesn't have access to -- a snapshot
// comparison is a reasonable proxy, not proof.

export type DepthTier = "bullish" | "neutral" | "bearish";

export interface SmartMoneyFlag {
  key: string;
  label: string;
  kind: "positive" | "caution";
}

export interface MarketDepthResult {
  tier: DepthTier;
  confidencePct: number; // 0-100
  depthScore: number; // 0-10
  bestBid: number | null;
  bestAsk: number | null;
  spreadPct: number | null;
  buyPct: number;
  sellPct: number;
  imbalance: number; // -1..+1
  liquidityScore: number; // 0-10
  volumeRatio: number | null;
  smartMoney: SmartMoneyFlag[];
  reason: string;
}

function volumeRatioOf(candles: Candle[]): number | null {
  if (candles.length < 21) return null;
  const recent = candles.slice(-21, -1);
  const avg = recent.reduce((s, c) => s + (c.volume ?? 0), 0) / recent.length;
  if (avg === 0) return null;
  const latest = candles[candles.length - 1].volume ?? 0;
  return latest / avg;
}

function pressureLabel(buyPct: number): { tier: DepthTier; label: string } {
  if (buyPct > 60) return { tier: "bullish", label: "Strong Buyers" };
  if (buyPct >= 55) return { tier: "bullish", label: "Buyers" };
  if (buyPct >= 45) return { tier: "neutral", label: "Neutral" };
  if (buyPct >= 40) return { tier: "bearish", label: "Sellers" };
  return { tier: "bearish", label: "Heavy Selling" };
}

// Any depth level holding notably more size than the average of the other
// levels on its own side -- a "wall" a resting order book is unlikely to
// show up by chance.
function findWall(levels: MarketDepthSnapshot["buyDepth"]): { price: number; quantity: number } | null {
  if (levels.length < 2) return null;
  for (const level of levels) {
    const others = levels.filter((l) => l !== level);
    const avgOthers = others.reduce((s, l) => s + l.quantity, 0) / others.length;
    if (avgOthers > 0 && level.quantity > avgOthers * 3) return { price: level.price, quantity: level.quantity };
  }
  return null;
}

export function evaluateMarketDepth(
  depth: MarketDepthSnapshot,
  previousDepth: MarketDepthSnapshot | null,
  candles: Candle[]
): MarketDepthResult | null {
  if (depth.error || depth.bestBid === null || depth.bestAsk === null) return null;

  const buyQty = depth.totalBuyQuantity;
  const sellQty = depth.totalSellQuantity;
  const totalQty = buyQty + sellQty;
  const buyPct = totalQty > 0 ? (buyQty / totalQty) * 100 : 50;
  const sellPct = 100 - buyPct;
  const imbalance = totalQty > 0 ? (buyQty - sellQty) / totalQty : 0;

  const mid = (depth.bestBid + depth.bestAsk) / 2;
  const spreadAbs = depth.bestAsk - depth.bestBid;
  const spreadPct = mid > 0 ? (spreadAbs / mid) * 100 : null;

  // Spread quality bands rescaled as a % of price rather than the raw point
  // thresholds in the original spec (<3 / 3-8 / >8 points), since Natural
  // Gas (~₹300) and Crude Oil (~₹8000) sit on completely different price
  // scales -- a fixed rupee spread threshold would misjudge one of them.
  const spreadQuality: DepthTier = spreadPct === null ? "neutral" : spreadPct < 0.05 ? "bullish" : spreadPct <= 0.15 ? "neutral" : "bearish";

  const volumeRatio = volumeRatioOf(candles);

  // Total top-5 depth on both sides relative to how much actually trades in
  // a typical bar -- there's no historical order-book baseline to compare
  // against, so this is a clearly-labeled heuristic, not a calibrated market
  // microstructure metric.
  const avgCandleVolume =
    candles.length >= 20 ? candles.slice(-20).reduce((s, c) => s + (c.volume ?? 0), 0) / 20 : null;
  const liquidityScore = avgCandleVolume && avgCandleVolume > 0 ? Math.max(0, Math.min(10, (totalQty / avgCandleVolume) * 10)) : 5;

  const pressure = pressureLabel(buyPct);

  const smartMoney: SmartMoneyFlag[] = [];
  const buyWall = findWall(depth.buyDepth);
  const sellWall = findWall(depth.sellDepth);
  if (buyWall) smartMoney.push({ key: "buyWall", label: `Large Buy Wall at ₹${buyWall.price.toFixed(2)}`, kind: "positive" });
  if (sellWall) smartMoney.push({ key: "sellWall", label: `Large Sell Wall at ₹${sellWall.price.toFixed(2)}`, kind: "caution" });
  if (buyPct > 60 && (volumeRatio ?? 0) > 1.3) smartMoney.push({ key: "momentumBuy", label: "Institutions Buying -- momentum + heavy bid size", kind: "positive" });
  if (sellPct > 60 && (volumeRatio ?? 0) > 1.3) smartMoney.push({ key: "momentumSell", label: "Heavy Selling Wall -- momentum + heavy ask size", kind: "caution" });

  if (previousDepth && !previousDepth.error) {
    const prevBuyWall = findWall(previousDepth.buyDepth);
    const prevSellWall = findWall(previousDepth.sellDepth);
    if (prevBuyWall && (!buyWall || buyWall.quantity < prevBuyWall.quantity * 0.5) && depth.bestBid !== null && depth.bestBid >= prevBuyWall.price) {
      smartMoney.push({ key: "pullBuy", label: "Possible order pulling -- a large buy wall just shrank without price falling through it", kind: "caution" });
    }
    if (prevSellWall && (!sellWall || sellWall.quantity < prevSellWall.quantity * 0.5) && depth.bestAsk !== null && depth.bestAsk <= prevSellWall.price) {
      smartMoney.push({ key: "pullSell", label: "Possible order pulling -- a large sell wall just shrank without price rising through it", kind: "caution" });
    }
  }

  if (smartMoney.length === 0) smartMoney.push({ key: "clean", label: "No notable walls or unusual activity detected right now", kind: "positive" });

  // Overall tier: pressure is the primary read, nudged toward bearish if
  // caution flags dominate the positive ones even when pressure alone looks
  // neutral/bullish (a large sell wall sitting right above should matter).
  const cautionCount = smartMoney.filter((f) => f.kind === "caution").length;
  const positiveCount = smartMoney.filter((f) => f.kind === "positive" && f.key !== "clean").length;
  let tier = pressure.tier;
  if (tier === "neutral" && cautionCount > positiveCount) tier = "bearish";
  else if (tier === "neutral" && positiveCount > cautionCount) tier = "bullish";

  const tierScore = tier === "bullish" ? 100 : tier === "neutral" ? 50 : 0;
  const spreadScore = spreadQuality === "bullish" ? 100 : spreadQuality === "neutral" ? 50 : 0;
  const imbalanceScore = Math.round(((imbalance + 1) / 2) * 100);
  const liquidityPctScore = liquidityScore * 10;
  const smartMoneyScore = Math.max(0, Math.min(100, 50 + (positiveCount - cautionCount) * 20));

  const depthScore = Number(((tierScore * 0.35 + spreadScore * 0.15 + imbalanceScore * 0.2 + liquidityPctScore * 0.15 + smartMoneyScore * 0.15) / 10).toFixed(1));
  const confidencePct = Math.round(depthScore * 10);

  const reasonParts = [`Buy ${buyPct.toFixed(0)}% / Sell ${sellPct.toFixed(0)}% (${pressure.label})`];
  if (spreadPct !== null) reasonParts.push(`spread ${spreadPct.toFixed(2)}%`);
  if (buyWall || sellWall) reasonParts.push(buyWall ? "buy wall detected" : "sell wall detected");

  return {
    tier,
    confidencePct,
    depthScore,
    bestBid: depth.bestBid,
    bestAsk: depth.bestAsk,
    spreadPct,
    buyPct: Number(buyPct.toFixed(1)),
    sellPct: Number(sellPct.toFixed(1)),
    imbalance: Number(imbalance.toFixed(2)),
    liquidityScore: Number(liquidityScore.toFixed(1)),
    volumeRatio,
    smartMoney,
    reason: reasonParts.join(" · "),
  };
}
