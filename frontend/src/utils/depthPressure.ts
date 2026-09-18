// Order-book buy/sell pressure, read RELATIVE to the call you're holding.
//
// The Level-2 depth shows how much quantity is resting on the bid vs the ask.
// When a Put (bearish) call is open but buyers dominate the book, that flow is
// leaning AGAINST the trade -- worth a heads-up. This turns the raw totals into
// one plain, direction-aware line.
//
// Honesty note: resting depth is a SHORT-TERM, easily-shifted (and spoofable)
// read -- it is a light confirmation, never a reason to trade on its own. The
// wording and the caption keep it that way.
//
// IMPORTANT: when recent candles are passed in, the lean is cross-checked
// against what price ACTUALLY did (see marketPressure.ts). A book showing 80%
// buy quantity while price falls is bids being eaten, not buyers winning, and
// this function will NOT return a "good" tone for it whichever side you hold.

import type { Candle } from "../types";
import { readMarketPressure, type MarketPressureRead } from "./marketPressure";

export type DepthLean = "buyers" | "sellers" | "balanced";
export type DepthTone = "good" | "care" | "neutral";

export interface DepthPressure {
  lean: DepthLean;
  buyPct: number;
  sellPct: number;
  tone: DepthTone;
  headline: string; // e.g. "Buyers are more" / "Sellers are more"
  detail: string; // direction-aware read vs the open call
  /** Set when price was checked and disagrees with the book. */
  conflict: boolean;
  /** The full cross-check, when candles were available. */
  pressure: MarketPressureRead | null;
}

// >=56% of resting quantity on one side is a real lean; the 44-56% middle is
// balanced (book roughly even -- no edge either way).
const LEAN_HI = 56;
const LEAN_LO = 44;

export function computeDepthPressure(
  totalBuyQuantity: number,
  totalSellQuantity: number,
  optSide: "CE" | "PE",
  candles?: Candle[] | null
): DepthPressure | null {
  const total = totalBuyQuantity + totalSellQuantity;
  if (!Number.isFinite(total) || total <= 0) return null;

  const buyPct = Number(((totalBuyQuantity / total) * 100).toFixed(0));
  const sellPct = 100 - buyPct;
  const lean: DepthLean = buyPct >= LEAN_HI ? "buyers" : buyPct <= LEAN_LO ? "sellers" : "balanced";

  // The cross-check against real price movement. Null when no candles were
  // passed, in which case this behaves exactly as it did before.
  const pressure = candles && candles.length > 0 ? readMarketPressure(totalBuyQuantity, totalSellQuantity, candles) : null;
  const priceChecked = pressure !== null && pressure.price.pressure !== "unknown";

  if (lean === "balanced") {
    return {
      lean,
      buyPct,
      sellPct,
      tone: "neutral",
      headline: "Book is balanced",
      detail: priceChecked
        ? pressure!.detail
        : "Buy and sell quantity are roughly even — the order book gives no clear edge either way right now.",
      conflict: false,
      pressure,
    };
  }

  const buyersMore = lean === "buyers";
  const headline = buyersMore ? "Buyers are more" : "Sellers are more";
  const side = optSide === "CE" ? "Call" : "Put";

  // THE TRAP THIS GUARD EXISTS FOR. A book leaning heavily one way while price
  // moves the other way is resting orders being consumed. It must never read
  // as "good" -- not even for the side it superficially favours, because the
  // number is describing the opposite of what it looks like.
  if (priceChecked && pressure!.conflict) {
    return {
      lean,
      buyPct,
      sellPct,
      tone: "care",
      headline: pressure!.headline,
      detail: `${pressure!.detail} Your ${side} is not confirmed by this.`,
      conflict: true,
      pressure,
    };
  }

  // A CE profits when price rises (buy-side flow helps); a PE profits when
  // price falls (sell-side flow helps).
  const flowHelps = (optSide === "CE" && buyersMore) || (optSide === "PE" && !buyersMore);

  // A lean price has NOT confirmed is not a plus, whichever way it points.
  // It gets stated, not celebrated.
  if (priceChecked && pressure!.verdict === "quiet") {
    return {
      lean,
      buyPct,
      sellPct,
      tone: "neutral",
      headline: pressure!.headline,
      detail: `${pressure!.detail} Nothing here confirms or contradicts your ${side} yet.`,
      conflict: false,
      pressure,
    };
  }

  if (flowHelps) {
    const confirmed = priceChecked && pressure!.verdict === "aligned";
    return {
      lean,
      buyPct,
      sellPct,
      tone: "good",
      headline,
      detail: confirmed
        ? `Order-book flow is leaning with your ${side} (${buyPct}% buy / ${sellPct}% sell) and price is moving that way too. A genuine plus — but resting orders can be pulled in a second, so it is never a reason on its own.`
        : `Order-book flow is leaning with your ${side} right now (${buyPct}% buy / ${sellPct}% sell). This is resting quantity only — price has not been checked against it. A light plus, not a reason on its own.`,
      conflict: false,
      pressure,
    };
  }
  return {
    lean,
    buyPct,
    sellPct,
    tone: "care",
    headline,
    detail: `Care — order-book flow is leaning AGAINST your ${side} right now (${buyPct}% buy / ${sellPct}% sell). Short-term only and it can flip fast, but don't ignore it.`,
    conflict: false,
    pressure,
  };
}
