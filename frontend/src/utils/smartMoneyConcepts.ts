import type { Candle, Direction } from "../types";
import { obvTrend } from "./indicators";

// Best-effort Smart Money Concepts reads (Break of Structure, Change of
// Character, Order Blocks, Fair Value Gaps, Liquidity Sweeps, Premium/
// Discount zones, Equal Highs/Lows) built purely from swing-point geometry
// on the same OHLC candles every other check already has. Real SMC analysis
// is normally done by an experienced trader eyeballing structure across
// multiple timeframes with order-flow/tape context this app doesn't have --
// what follows is a systematic, honest approximation from swing highs/lows
// and candle geometry alone, not a claim of true institutional detection.
// Every flag this produces is labeled as a "read", and AI Verify Pro treats
// all of it as one Structure/Smart Money vote among many, never a trigger by itself.

export interface SmcFlag {
  key: string;
  label: string;
  kind: "bullish" | "bearish" | "neutral";
}

export type SmcZone = "premium" | "discount" | "equilibrium";

export interface SmcResult {
  structureBias: Direction;
  bosDetected: boolean;
  chochDetected: boolean;
  zone: SmcZone;
  zonePct: number; // 0 = bottom of recent swing range, 100 = top
  liquiditySweepDetected: boolean;
  flags: SmcFlag[];
}

interface SwingPoint {
  index: number;
  price: number;
  type: "high" | "low";
}

function findSwings(candles: Candle[], strength = 2): SwingPoint[] {
  const out: SwingPoint[] = [];
  for (let i = strength; i < candles.length - strength; i++) {
    const window = candles.slice(i - strength, i + strength + 1);
    if (candles[i].high === Math.max(...window.map((c) => c.high))) out.push({ index: i, price: candles[i].high, type: "high" });
    if (candles[i].low === Math.min(...window.map((c) => c.low))) out.push({ index: i, price: candles[i].low, type: "low" });
  }
  return out;
}

const TOLERANCE_PCT = 0.15; // how close two swing points need to be to count as "equal"

export function analyzeSmartMoneyConcepts(candles: Candle[]): SmcResult {
  const flags: SmcFlag[] = [];
  if (candles.length < 30) {
    return { structureBias: "neutral", bosDetected: false, chochDetected: false, zone: "equilibrium", zonePct: 50, liquiditySweepDetected: false, flags };
  }

  const swings = findSwings(candles.slice(-60), 2);
  const highs = swings.filter((s) => s.type === "high");
  const lows = swings.filter((s) => s.type === "low");
  const lastClose = candles[candles.length - 1].close;
  const lastCandle = candles[candles.length - 1];

  // Structure bias: rising swing highs AND rising swing lows = bullish
  // structure (HH/HL); falling both = bearish (LH/LL); anything else = mixed.
  let structureBias: Direction = "neutral";
  if (highs.length >= 2 && lows.length >= 2) {
    const risingHighs = highs[highs.length - 1].price > highs[highs.length - 2].price;
    const risingLows = lows[lows.length - 1].price > lows[lows.length - 2].price;
    if (risingHighs && risingLows) structureBias = "bullish";
    else if (!risingHighs && !risingLows) structureBias = "bearish";
  }

  const lastHigh = highs.length ? highs[highs.length - 1] : null;
  const lastLow = lows.length ? lows[lows.length - 1] : null;

  // BOS -- close breaks the most recent swing point IN the direction
  // structure already implied (continuation). CHoCH -- breaks it AGAINST
  // that structure (the first sign of a possible flip).
  let bosDetected = false;
  let chochDetected = false;
  if (lastHigh && lastClose > lastHigh.price) {
    if (structureBias === "bullish" || structureBias === "neutral") {
      bosDetected = true;
      flags.push({ key: "bos", label: `Break of Structure -- price closed above the last swing high (₹${lastHigh.price.toFixed(2)})`, kind: "bullish" });
    } else {
      chochDetected = true;
      flags.push({ key: "choch", label: `Change of Character -- price broke above the last swing high (₹${lastHigh.price.toFixed(2)}) against the prior downtrend`, kind: "bullish" });
    }
  } else if (lastLow && lastClose < lastLow.price) {
    if (structureBias === "bearish" || structureBias === "neutral") {
      bosDetected = true;
      flags.push({ key: "bos", label: `Break of Structure -- price closed below the last swing low (₹${lastLow.price.toFixed(2)})`, kind: "bearish" });
    } else {
      chochDetected = true;
      flags.push({ key: "choch", label: `Change of Character -- price broke below the last swing low (₹${lastLow.price.toFixed(2)}) against the prior uptrend`, kind: "bearish" });
    }
  }

  // Liquidity Sweep / Stop Hunt -- the current candle's WICK clears the
  // last swing point but the CLOSE stays back on the original side --
  // classic "grab the stops, then reverse" signature.
  let liquiditySweepDetected = false;
  if (lastHigh && lastCandle.high > lastHigh.price && lastClose < lastHigh.price) {
    liquiditySweepDetected = true;
    flags.push({ key: "sweepHigh", label: `Liquidity Sweep -- wicked above ₹${lastHigh.price.toFixed(2)} then closed back below it (stop hunt)`, kind: "bearish" });
  }
  if (lastLow && lastCandle.low < lastLow.price && lastClose > lastLow.price) {
    liquiditySweepDetected = true;
    flags.push({ key: "sweepLow", label: `Liquidity Sweep -- wicked below ₹${lastLow.price.toFixed(2)} then closed back above it (stop hunt)`, kind: "bullish" });
  }

  // Equal Highs / Equal Lows -- a resting liquidity pool where two recent
  // swing points sit within a tight tolerance of each other.
  for (let i = highs.length - 1; i > 0 && i > highs.length - 4; i--) {
    if (Math.abs((highs[i].price - highs[i - 1].price) / highs[i - 1].price) * 100 < TOLERANCE_PCT) {
      flags.push({ key: "equalHigh", label: `Equal Highs near ₹${highs[i].price.toFixed(2)} -- resting liquidity likely sits just above`, kind: "neutral" });
      break;
    }
  }
  for (let i = lows.length - 1; i > 0 && i > lows.length - 4; i--) {
    if (Math.abs((lows[i].price - lows[i - 1].price) / lows[i - 1].price) * 100 < TOLERANCE_PCT) {
      flags.push({ key: "equalLow", label: `Equal Lows near ₹${lows[i].price.toFixed(2)} -- resting liquidity likely sits just below`, kind: "neutral" });
      break;
    }
  }

  // Fair Value Gap -- the most recent 3-candle imbalance (candle i-1 and
  // i+1 don't overlap at all), only checked on the freshest triple since
  // older gaps have likely already been filled by now.
  const c3 = candles.slice(-3);
  if (c3.length === 3) {
    if (c3[0].low > c3[2].high) {
      flags.push({ key: "fvgBearish", label: `Fair Value Gap between ₹${c3[2].high.toFixed(2)}-₹${c3[0].low.toFixed(2)} -- an imbalance price may retrace to fill`, kind: "bearish" });
    } else if (c3[0].high < c3[2].low) {
      flags.push({ key: "fvgBullish", label: `Fair Value Gap between ₹${c3[0].high.toFixed(2)}-₹${c3[2].low.toFixed(2)} -- an imbalance price may retrace to fill`, kind: "bullish" });
    }
  }

  // Order Block -- the last opposite-colored candle right before the move
  // that produced the current BOS/CHoCH, a simple proxy for "where
  // institutions likely built the position that's now driving this move."
  if (bosDetected || chochDetected) {
    const bullishMove = flags.some((f) => (f.key === "bos" || f.key === "choch") && f.kind === "bullish");
    const window = candles.slice(-8, -1);
    for (let i = window.length - 1; i >= 0; i--) {
      const c = window[i];
      const isOpposite = bullishMove ? c.close < c.open : c.close > c.open;
      if (isOpposite) {
        flags.push({
          key: "orderBlock",
          label: `${bullishMove ? "Bullish" : "Bearish"} Order Block near ₹${c.low.toFixed(2)}-₹${c.high.toFixed(2)} -- last opposite candle before this move`,
          kind: bullishMove ? "bullish" : "bearish",
        });
        break;
      }
    }
  }

  // Premium/Discount zone -- where price sits within the most recent
  // swing-high-to-swing-low range (Fibonacci-style: >50% = premium/expensive
  // to buy, <50% = discount/cheap to buy).
  let zone: SmcZone = "equilibrium";
  let zonePct = 50;
  if (lastHigh && lastLow && lastHigh.price !== lastLow.price) {
    const rangeHigh = Math.max(lastHigh.price, lastLow.price);
    const rangeLow = Math.min(lastHigh.price, lastLow.price);
    zonePct = Math.round(Math.max(0, Math.min(100, ((lastClose - rangeLow) / (rangeHigh - rangeLow)) * 100)));
    zone = zonePct > 60 ? "premium" : zonePct < 40 ? "discount" : "equilibrium";
  }

  // Institutional Buying/Selling -- OBV quietly trending while price sits in
  // the "cheap" (discount) or "expensive" (premium) zone, the same read a
  // desk trader would call accumulation/distribution.
  const obv = obvTrend(candles, 20);
  if (obv && obv.strength > 30) {
    if (zone === "discount" && obv.direction === "bullish") {
      flags.push({ key: "instBuy", label: "Institutional Buying likely -- OBV rising while price sits in the discount zone", kind: "bullish" });
    } else if (zone === "premium" && obv.direction === "bearish") {
      flags.push({ key: "instSell", label: "Institutional Selling likely -- OBV falling while price sits in the premium zone", kind: "bearish" });
    }
  }

  return { structureBias, bosDetected, chochDetected, zone, zonePct, liquiditySweepDetected, flags };
}
