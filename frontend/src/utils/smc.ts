import type { Candle, Direction } from "../types";
import type { SwingPoint } from "./priceAction";

export interface FairValueGap {
  index: number;
  top: number;
  bottom: number;
  direction: Direction;
}

// A 3-candle imbalance: candle[i]'s low sits above candle[i-2]'s high (bullish
// gap the market left unfilled) or vice versa for bearish.
export function findFairValueGaps(candles: Candle[], lookback = 30): FairValueGap[] {
  const gaps: FairValueGap[] = [];
  const start = Math.max(2, candles.length - lookback);
  for (let i = start; i < candles.length; i++) {
    const a = candles[i - 2];
    const c = candles[i];
    if (c.low > a.high) gaps.push({ index: i, top: c.low, bottom: a.high, direction: "bullish" });
    else if (c.high < a.low) gaps.push({ index: i, top: a.low, bottom: c.high, direction: "bearish" });
  }
  return gaps;
}

export interface OrderBlock {
  index: number;
  high: number;
  low: number;
  direction: Direction;
}

// The last opposite-colored candle before a strong (>1.5x avg body) impulsive
// move -- the institutional order approximation SMC calls an order block.
export function findOrderBlocks(candles: Candle[], lookback = 20): OrderBlock[] {
  const window = candles.slice(-lookback);
  if (window.length < 3) return [];
  const avgBody = window.reduce((s, c) => s + Math.abs(c.close - c.open), 0) / window.length;
  const blocks: OrderBlock[] = [];
  const start = Math.max(1, candles.length - lookback);
  for (let i = start; i < candles.length - 1; i++) {
    const c = candles[i];
    const next = candles[i + 1];
    const nextBody = Math.abs(next.close - next.open);
    if (nextBody <= avgBody * 1.5) continue;
    if (c.close < c.open && next.close > next.open) blocks.push({ index: i, high: c.high, low: c.low, direction: "bullish" });
    else if (c.close > c.open && next.close < next.open) blocks.push({ index: i, high: c.high, low: c.low, direction: "bearish" });
  }
  return blocks.slice(-5);
}

// A wick pierces a recent swing high/low (grabbing resting liquidity) but the
// candle closes back inside range -- a stop-hunt that often precedes a move
// the other way.
export function detectLiquiditySweep(candles: Candle[], swings: SwingPoint[]): { direction: Direction; swept: boolean } {
  const last = candles[candles.length - 1];
  if (!last || !swings.length) return { direction: "neutral", swept: false };
  const recentHighs = swings.filter((s) => s.type === "high").slice(-3);
  const recentLows = swings.filter((s) => s.type === "low").slice(-3);
  for (const h of recentHighs) {
    if (last.high > h.price && last.close < h.price) return { direction: "bearish", swept: true };
  }
  for (const l of recentLows) {
    if (last.low < l.price && last.close > l.price) return { direction: "bullish", swept: true };
  }
  return { direction: "neutral", swept: false };
}

export function equalHighsLows(swings: SwingPoint[], tolerance = 0.0015): { equalHighs: boolean; equalLows: boolean } {
  const highs = swings.filter((s) => s.type === "high").slice(-4);
  const lows = swings.filter((s) => s.type === "low").slice(-4);
  const closeMatch = (a: number, b: number) => Math.abs(a - b) / ((a + b) / 2) < tolerance;
  let equalHighs = false;
  let equalLows = false;
  for (let i = 0; i < highs.length; i++) {
    for (let j = i + 1; j < highs.length; j++) if (closeMatch(highs[i].price, highs[j].price)) equalHighs = true;
  }
  for (let i = 0; i < lows.length; i++) {
    for (let j = i + 1; j < lows.length; j++) if (closeMatch(lows[i].price, lows[j].price)) equalLows = true;
  }
  return { equalHighs, equalLows };
}

// Where price sits within its recent swing range: upper half ("premium",
// favors selling/put buying) vs lower half ("discount", favors buying/call
// buying) vs the middle ("equilibrium").
export function premiumDiscountZone(candles: Candle[], swings: SwingPoint[]): "premium" | "discount" | "equilibrium" {
  const highs = swings.filter((s) => s.type === "high").slice(-3);
  const lows = swings.filter((s) => s.type === "low").slice(-3);
  const last = candles[candles.length - 1];
  if (!highs.length || !lows.length || !last) return "equilibrium";
  const rangeHigh = Math.max(...highs.map((h) => h.price));
  const rangeLow = Math.min(...lows.map((l) => l.price));
  if (rangeHigh <= rangeLow) return "equilibrium";
  const pct = (last.close - rangeLow) / (rangeHigh - rangeLow);
  if (pct > 0.6) return "premium";
  if (pct < 0.4) return "discount";
  return "equilibrium";
}
