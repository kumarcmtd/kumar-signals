// KUMAR AI MARKET PRESSURE ENGINE
//
// One shared module, used by every place in the app that displays a buy/sell
// percentage, so those places can never disagree with each other.
//
// WHY THIS EXISTS
// ---------------
// The order book's "BUY 80% / SELL 20%" is RESTING quantity: orders sitting
// and waiting. It is passive. It says how much someone is WILLING to buy at a
// price below the market -- it does not say buyers are winning.
//
// When price is falling while the book shows 80% buy, that usually means the
// opposite of what it looks like: sellers are crossing the spread and eating
// through those resting bids. The big buy number is the queue being consumed,
// not demand in control. A trader who reads the number on its own buys into a
// falling market.
//
// So this module never lets resting depth speak alone. It reads depth, reads
// what price ACTUALLY did over the last few bars, and when the two disagree it
// says so plainly instead of picking the cheerful one.
//
// Resting depth is also the easiest thing in the market to fake -- a large bid
// can be pulled the instant price approaches it. Treat it as supporting
// evidence only. That rule is enforced here in code, not left to the reader.

import type { Candle } from "../types";
import { atr } from "./indicators";

export type PricePressure = "buying" | "selling" | "flat" | "unknown";
export type DepthLean = "buyers" | "sellers" | "balanced";
export type PressureVerdict = "aligned" | "conflict" | "quiet" | "unknown";

export interface PricePressureRead {
  pressure: PricePressure;
  /** Short plain label, e.g. "Price is falling". */
  label: string;
  /** Move over the measured window, as a percentage of where it started. */
  changePct: number | null;
  /** Same move measured in ATR units, so Crude and Natural Gas compare fairly. */
  atrMultiple: number | null;
  /** Bars in the window that made a lower low / higher high than the bar before. */
  lowerLows: number;
  higherHighs: number;
  /** Recent volume against the prior stretch -- >1 means the move carries size. */
  volumeRatio: number | null;
  /** How many bars were actually measured. */
  barsUsed: number;
}

export interface MarketPressureRead {
  depthLean: DepthLean;
  buyPct: number;
  sellPct: number;
  price: PricePressureRead;
  verdict: PressureVerdict;
  /** True when the book leans one way and price is going the other way. */
  conflict: boolean;
  /** The headline for the conflict case, e.g. "Book looks bullish, price is not". */
  headline: string;
  /** One or two plain sentences explaining what is really happening. */
  detail: string;
}

/** Bars of context. On 15-minute candles this is roughly the last two hours. */
export const WINDOW_BARS = 8;
/** Below this the move is noise, not pressure. Measured in ATR, so it scales. */
const MOVE_ATR_FLOOR = 0.6;
/** >=56% of resting quantity on one side is a real lean; 44-56% is balanced. */
const LEAN_HI = 56;
const LEAN_LO = 44;

export function depthLeanOf(buyPct: number): DepthLean {
  if (buyPct >= LEAN_HI) return "buyers";
  if (buyPct <= LEAN_LO) return "sellers";
  return "balanced";
}

/**
 * What price ACTUALLY did, from traded candles -- the half of the picture the
 * order book cannot show you.
 *
 * The move is measured in ATR rather than rupees or percent because Crude Oil
 * trades near Rs.9,000 and Natural Gas near Rs.250; a fixed threshold would
 * call every Crude wobble a trend and miss every Natural Gas one.
 */
export function readPricePressure(candles: Candle[] | undefined | null, window = WINDOW_BARS): PricePressureRead {
  const empty: PricePressureRead = {
    pressure: "unknown",
    label: "Price direction unknown",
    changePct: null,
    atrMultiple: null,
    lowerLows: 0,
    higherHighs: 0,
    volumeRatio: null,
    barsUsed: 0,
  };
  if (!candles || candles.length < 4) return empty;

  const recent = candles.slice(-window);
  const first = recent[0];
  const last = recent[recent.length - 1];
  if (!Number.isFinite(first.close) || !Number.isFinite(last.close) || first.close <= 0) return empty;

  const move = last.close - first.close;
  const changePct = (move / first.close) * 100;

  // ATR over the full series, not just the window -- a short window during a
  // sharp move would report an inflated "normal" range and hide the move.
  const atrValue = atr(candles, 14);
  const atrMultiple = atrValue && atrValue > 0 ? move / atrValue : null;

  let lowerLows = 0;
  let higherHighs = 0;
  for (let i = 1; i < recent.length; i += 1) {
    if (recent[i].low < recent[i - 1].low) lowerLows += 1;
    if (recent[i].high > recent[i - 1].high) higherHighs += 1;
  }

  // Does the move carry size? Last third of the window against the stretch
  // before it. Volume is optional on a candle, so this can stay null.
  let volumeRatio: number | null = null;
  const withVolume = candles.filter((c) => typeof c.volume === "number" && (c.volume ?? 0) > 0);
  if (withVolume.length >= 12) {
    const tail = withVolume.slice(-3);
    const prior = withVolume.slice(-13, -3);
    const tailAvg = tail.reduce((s, c) => s + (c.volume ?? 0), 0) / tail.length;
    const priorAvg = prior.reduce((s, c) => s + (c.volume ?? 0), 0) / prior.length;
    if (priorAvg > 0) volumeRatio = tailAvg / priorAvg;
  }

  const base = { changePct, atrMultiple, lowerLows, higherHighs, volumeRatio, barsUsed: recent.length };

  // A move only counts as pressure when it is bigger than the instrument's own
  // normal bar range AND the bar-by-bar path agrees with it. Price drifting
  // sideways with one big candle in the middle is not pressure.
  const magnitude = atrMultiple === null ? null : Math.abs(atrMultiple);
  const structuralDown = lowerLows > higherHighs;
  const structuralUp = higherHighs > lowerLows;

  if (magnitude !== null && magnitude >= MOVE_ATR_FLOOR) {
    if (move < 0 && structuralDown) return { ...base, pressure: "selling", label: "Price is falling" };
    if (move > 0 && structuralUp) return { ...base, pressure: "buying", label: "Price is rising" };
  }

  // No ATR (too little history) -- fall back to the bar path alone, and only
  // when it is one-sided enough to be worth saying out loud.
  if (magnitude === null) {
    if (move < 0 && lowerLows >= recent.length - 2) return { ...base, pressure: "selling", label: "Price is falling" };
    if (move > 0 && higherHighs >= recent.length - 2) return { ...base, pressure: "buying", label: "Price is rising" };
    return { ...base, pressure: "unknown", label: "Price direction unclear" };
  }

  return { ...base, pressure: "flat", label: "Price is going sideways" };
}

function pctText(read: PricePressureRead): string {
  if (read.changePct === null) return "";
  const dir = read.changePct >= 0 ? "up" : "down";
  return ` (${dir} ${Math.abs(read.changePct).toFixed(2)}% over the last ${read.barsUsed} bars)`;
}

/**
 * The rule the whole module exists for: put resting depth next to real price
 * movement and refuse to call it bullish when they disagree.
 */
export function readMarketPressure(
  totalBuyQuantity: number,
  totalSellQuantity: number,
  candles: Candle[] | undefined | null,
  window = WINDOW_BARS
): MarketPressureRead | null {
  const total = totalBuyQuantity + totalSellQuantity;
  if (!Number.isFinite(total) || total <= 0) return null;

  const buyPct = Number(((totalBuyQuantity / total) * 100).toFixed(0));
  const sellPct = 100 - buyPct;
  const depthLean = depthLeanOf(buyPct);
  const price = readPricePressure(candles, window);

  const base = { depthLean, buyPct, sellPct, price };

  if (price.pressure === "unknown") {
    return {
      ...base,
      verdict: "unknown",
      conflict: false,
      headline: "Waiting on price data",
      detail:
        "The order book is showing a split, but there isn't enough recent price data to check it against what price is actually doing. Treat the percentages as unconfirmed.",
    };
  }

  const depthBull = depthLean === "buyers";
  const depthBear = depthLean === "sellers";
  const priceDown = price.pressure === "selling";
  const priceUp = price.pressure === "buying";

  // THE TRAP. Big resting buy quantity while price keeps falling means those
  // bids are being eaten, not defended.
  if (depthBull && priceDown) {
    return {
      ...base,
      verdict: "conflict",
      conflict: true,
      headline: "Book looks bullish, price is not",
      detail:
        `${buyPct}% of the resting quantity is on the buy side, but price is still falling${pctText(price)}. ` +
        "Those buy orders are waiting orders, and sellers are going through them. A big buy percentage on a falling market is bids being eaten, not buyers winning. This is not a buy signal.",
    };
  }

  if (depthBear && priceUp) {
    return {
      ...base,
      verdict: "conflict",
      conflict: true,
      headline: "Book looks bearish, price is not",
      detail:
        `${sellPct}% of the resting quantity is on the sell side, but price is still rising${pctText(price)}. ` +
        "Those sell orders are waiting orders, and buyers are going through them. This is not a sell signal.",
    };
  }

  if ((depthBull && priceUp) || (depthBear && priceDown)) {
    const side = depthBull ? "buy" : "sell";
    const way = depthBull ? "rising" : "falling";
    return {
      ...base,
      verdict: "aligned",
      conflict: false,
      headline: depthBull ? "Buyers are more, and price agrees" : "Sellers are more, and price agrees",
      detail:
        `The book leans ${side} side and price is actually ${way}${pctText(price)}, so the two agree. ` +
        "That is a genuine plus — but resting orders can be pulled in a second, so this supports a decision, it never makes one.",
    };
  }

  if (depthLean === "balanced") {
    return {
      ...base,
      verdict: "quiet",
      conflict: false,
      headline: "Book is balanced",
      detail: `Buy and sell quantity are roughly even, so the book gives no edge either way. ${price.label}${pctText(price)}.`,
    };
  }

  // Book leans, price is going sideways -- a lean with nothing behind it yet.
  return {
    ...base,
    verdict: "quiet",
    conflict: false,
    headline: depthBull ? "Buyers are more, but price is flat" : "Sellers are more, but price is flat",
    detail:
      `${depthBull ? buyPct : sellPct}% of the resting quantity is on one side, but price isn't moving with it${pctText(price)}. ` +
      "A lean in the book that price hasn't confirmed is not yet worth acting on.",
  };
}
