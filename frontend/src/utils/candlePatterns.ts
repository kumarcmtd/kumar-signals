import type { Candle } from "../types";

// Standard OHLC candlestick pattern recognition off the same candle arrays
// every other engine in this app already fetches -- no new data source.
// These are classic price-action reads, not a prediction on their own; AI
// Verify Pro folds them into the Structure bucket as one more vote among
// many, never a standalone signal.

export type CandlePatternBias = "bullish" | "bearish" | "neutral";

export interface CandlePatternResult {
  key: string;
  name: string;
  bias: CandlePatternBias;
}

interface Anatomy {
  open: number;
  close: number;
  high: number;
  low: number;
  body: number;
  range: number;
  upperWick: number;
  lowerWick: number;
  bullish: boolean;
}

function anatomyOf(c: Candle): Anatomy {
  const body = Math.abs(c.close - c.open);
  const range = c.high - c.low;
  const upperWick = c.high - Math.max(c.open, c.close);
  const lowerWick = Math.min(c.open, c.close) - c.low;
  return { open: c.open, close: c.close, high: c.high, low: c.low, body, range, upperWick, lowerWick, bullish: c.close >= c.open };
}

export function detectCandlePatterns(candles: Candle[]): CandlePatternResult[] {
  if (candles.length < 3) return [];
  const out: CandlePatternResult[] = [];
  const last = anatomyOf(candles[candles.length - 1]);
  const prev = anatomyOf(candles[candles.length - 2]);
  const prev2 = anatomyOf(candles[candles.length - 3]);
  if (last.range === 0) return out;

  // Doji -- body is a sliver of the full range, indecision.
  if (last.range > 0 && last.body / last.range < 0.1) {
    out.push({ key: "doji", name: "Doji", bias: "neutral" });
  }

  // Marubozu -- body IS the range, negligible wicks either side.
  if (last.range > 0 && last.body / last.range > 0.9) {
    out.push({ key: "marubozu", name: last.bullish ? "Bullish Marubozu" : "Bearish Marubozu", bias: last.bullish ? "bullish" : "bearish" });
  }

  // Hammer -- small body near the top, long lower wick, tiny upper wick.
  if (last.body > 0 && last.lowerWick >= last.body * 2 && last.upperWick <= last.body * 0.5 && last.body / last.range < 0.4) {
    out.push({ key: "hammer", name: "Hammer", bias: "bullish" });
  }

  // Shooting Star -- mirror of Hammer, long upper wick.
  if (last.body > 0 && last.upperWick >= last.body * 2 && last.lowerWick <= last.body * 0.5 && last.body / last.range < 0.4) {
    out.push({ key: "shootingStar", name: "Shooting Star", bias: "bearish" });
  }

  // Pin Bar -- generic version of Hammer/Shooting Star: one wick dominates
  // the whole range regardless of which side, body sits small and off to one end.
  const dominantWick = Math.max(last.upperWick, last.lowerWick);
  if (last.range > 0 && dominantWick / last.range > 0.6 && last.body / last.range < 0.3) {
    out.push({ key: "pinBar", name: "Pin Bar", bias: last.lowerWick > last.upperWick ? "bullish" : "bearish" });
  }

  // Bullish/Bearish Engulfing -- current body fully engulfs the prior body,
  // opposite colors.
  if (!prev.bullish && last.bullish && last.open <= prev.close && last.close >= prev.open && last.body > prev.body) {
    out.push({ key: "bullishEngulfing", name: "Bullish Engulfing", bias: "bullish" });
  }
  if (prev.bullish && !last.bullish && last.open >= prev.close && last.close <= prev.open && last.body > prev.body) {
    out.push({ key: "bearishEngulfing", name: "Bearish Engulfing", bias: "bearish" });
  }

  // Inside Bar / Outside Bar -- pure range containment vs range expansion.
  if (last.high <= prev.high && last.low >= prev.low) {
    out.push({ key: "insideBar", name: "Inside Bar", bias: "neutral" });
  } else if (last.high >= prev.high && last.low <= prev.low) {
    out.push({ key: "outsideBar", name: "Outside Bar", bias: last.bullish ? "bullish" : "bearish" });
  }

  // Morning Star -- bearish candle, small-bodied middle candle gapping down,
  // then a bullish candle closing back well into the first candle's body.
  const firstBearish = !prev2.bullish && prev2.body / Math.max(prev2.range, 1e-9) > 0.4;
  const middleSmall = prev.body / Math.max(prev.range, 1e-9) < 0.4;
  if (firstBearish && middleSmall && last.bullish && last.close > (prev2.open + prev2.close) / 2) {
    out.push({ key: "morningStar", name: "Morning Star", bias: "bullish" });
  }
  // Evening Star -- mirror.
  const firstBullish = prev2.bullish && prev2.body / Math.max(prev2.range, 1e-9) > 0.4;
  if (firstBullish && middleSmall && !last.bullish && last.close < (prev2.open + prev2.close) / 2) {
    out.push({ key: "eveningStar", name: "Evening Star", bias: "bearish" });
  }

  // Three White Soldiers / Three Black Crows -- 3 consecutive same-direction
  // candles, each closing progressively further, each opening within the
  // prior candle's body (steady climb/decline, not a gap-driven spike).
  if (prev2.bullish && prev.bullish && last.bullish && prev.close > prev2.close && last.close > prev.close && prev.open > prev2.open && last.open > prev.open) {
    out.push({ key: "threeWhiteSoldiers", name: "Three White Soldiers", bias: "bullish" });
  }
  if (!prev2.bullish && !prev.bullish && !last.bullish && prev.close < prev2.close && last.close < prev.close && prev.open < prev2.open && last.open < prev.open) {
    out.push({ key: "threeBlackCrows", name: "Three Black Crows", bias: "bearish" });
  }

  return out;
}
