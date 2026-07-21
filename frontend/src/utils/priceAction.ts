import type { Candle, Direction } from "../types";

export type CandlePattern =
  | "bullish_engulfing"
  | "bearish_engulfing"
  | "doji"
  | "hammer"
  | "shooting_star"
  | "bullish_pin_bar"
  | "bearish_pin_bar"
  | "inside_bar"
  | "outside_bar"
  | "strong_bullish_candle"
  | "strong_bearish_candle"
  | "none";

function range(c: Candle) {
  return c.high - c.low;
}
function bodySize(c: Candle) {
  return Math.abs(c.close - c.open);
}
function upperWick(c: Candle) {
  return c.high - Math.max(c.open, c.close);
}
function lowerWick(c: Candle) {
  return Math.min(c.open, c.close) - c.low;
}

export function detectCandlePattern(candles: Candle[]): { pattern: CandlePattern; direction: Direction } {
  if (candles.length < 2) return { pattern: "none", direction: "neutral" };
  const c = candles[candles.length - 1];
  const p = candles[candles.length - 2];
  const r = range(c);
  if (r === 0) return { pattern: "none", direction: "neutral" };

  const body = bodySize(c);
  const bodyPct = body / r;
  const uw = upperWick(c);
  const lw = lowerWick(c);

  if (bodyPct < 0.1) return { pattern: "doji", direction: "neutral" };

  if (c.close > c.open && p.close < p.open && c.close >= p.open && c.open <= p.close) {
    return { pattern: "bullish_engulfing", direction: "bullish" };
  }
  if (c.close < c.open && p.close > p.open && c.open >= p.close && c.close <= p.open) {
    return { pattern: "bearish_engulfing", direction: "bearish" };
  }

  if (lw > body * 2 && uw < body * 0.5) {
    return { pattern: c.close > c.open ? "hammer" : "bullish_pin_bar", direction: "bullish" };
  }
  if (uw > body * 2 && lw < body * 0.5) {
    return { pattern: c.close < c.open ? "shooting_star" : "bearish_pin_bar", direction: "bearish" };
  }

  if (c.high < p.high && c.low > p.low) return { pattern: "inside_bar", direction: "neutral" };
  if (c.high > p.high && c.low < p.low) {
    return { pattern: "outside_bar", direction: c.close > c.open ? "bullish" : "bearish" };
  }

  if (bodyPct > 0.7) {
    return { pattern: c.close > c.open ? "strong_bullish_candle" : "strong_bearish_candle", direction: c.close > c.open ? "bullish" : "bearish" };
  }

  return { pattern: "none", direction: "neutral" };
}

export interface SwingPoint {
  index: number;
  price: number;
  type: "high" | "low";
}

export function findSwingPoints(candles: Candle[], lookback = 3): SwingPoint[] {
  const points: SwingPoint[] = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    const window = candles.slice(i - lookback, i + lookback + 1);
    const isHigh = window.every((w) => w.high <= candles[i].high);
    const isLow = window.every((w) => w.low >= candles[i].low);
    if (isHigh) points.push({ index: i, price: candles[i].high, type: "high" });
    if (isLow) points.push({ index: i, price: candles[i].low, type: "low" });
  }
  return points;
}

export interface StructureAnalysis {
  label: "HH" | "HL" | "LH" | "LL" | null;
  bos: boolean;
  bosDirection: Direction;
  choch: boolean;
  trend: Direction;
}

// Approximates SMC-style market structure from swing pivots: whether the last
// two swing highs/lows are rising (HH/HL, uptrend) or falling (LH/LL,
// downtrend), a break of structure (close beyond the last swing extreme), and
// a change of character (a BOS opposite the prevailing swing trend -- an
// early reversal signal).
export function analyzeStructure(candles: Candle[]): StructureAnalysis {
  const swings = findSwingPoints(candles);
  const highs = swings.filter((s) => s.type === "high");
  const lows = swings.filter((s) => s.type === "low");

  let trend: Direction = "neutral";
  let label: StructureAnalysis["label"] = null;
  if (highs.length >= 2 && lows.length >= 2) {
    const risingHighs = highs[highs.length - 1].price > highs[highs.length - 2].price;
    const risingLows = lows[lows.length - 1].price > lows[lows.length - 2].price;
    if (risingHighs && risingLows) {
      trend = "bullish";
      label = "HH";
    } else if (!risingHighs && !risingLows) {
      trend = "bearish";
      label = "LL";
    } else {
      label = risingHighs ? "LH" : "HL";
    }
  }

  const lastClose = candles[candles.length - 1]?.close ?? 0;
  let bos = false;
  let bosDirection: Direction = "neutral";
  if (highs.length && lastClose > highs[highs.length - 1].price) {
    bos = true;
    bosDirection = "bullish";
  }
  if (lows.length && lastClose < lows[lows.length - 1].price) {
    bos = true;
    bosDirection = "bearish";
  }
  const choch = bos && trend !== "neutral" && bosDirection !== trend;

  return { label, bos, bosDirection, choch, trend };
}
