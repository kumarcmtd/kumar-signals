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

export type DepthLean = "buyers" | "sellers" | "balanced";
export type DepthTone = "good" | "care" | "neutral";

export interface DepthPressure {
  lean: DepthLean;
  buyPct: number;
  sellPct: number;
  tone: DepthTone;
  headline: string; // e.g. "Buyers are more" / "Sellers are more"
  detail: string; // direction-aware read vs the open call
}

// >=56% of resting quantity on one side is a real lean; the 44-56% middle is
// balanced (book roughly even -- no edge either way).
const LEAN_HI = 56;
const LEAN_LO = 44;

export function computeDepthPressure(totalBuyQuantity: number, totalSellQuantity: number, optSide: "CE" | "PE"): DepthPressure | null {
  const total = totalBuyQuantity + totalSellQuantity;
  if (!Number.isFinite(total) || total <= 0) return null;

  const buyPct = Number(((totalBuyQuantity / total) * 100).toFixed(0));
  const sellPct = 100 - buyPct;
  const lean: DepthLean = buyPct >= LEAN_HI ? "buyers" : buyPct <= LEAN_LO ? "sellers" : "balanced";

  if (lean === "balanced") {
    return { lean, buyPct, sellPct, tone: "neutral", headline: "Book is balanced", detail: "Buy and sell quantity are roughly even — the order book gives no clear edge either way right now." };
  }

  const buyersMore = lean === "buyers";
  const headline = buyersMore ? "Buyers are more" : "Sellers are more";

  // A CE profits when price rises (buy-side flow helps); a PE profits when
  // price falls (sell-side flow helps).
  const flowHelps = (optSide === "CE" && buyersMore) || (optSide === "PE" && !buyersMore);
  const side = optSide === "CE" ? "Call" : "Put";

  if (flowHelps) {
    return {
      lean,
      buyPct,
      sellPct,
      tone: "good",
      headline,
      detail: `Order-book flow is leaning with your ${side} right now (${buyPct}% buy / ${sellPct}% sell). A light plus — not a reason on its own.`,
    };
  }
  return {
    lean,
    buyPct,
    sellPct,
    tone: "care",
    headline,
    detail: `Care — order-book flow is leaning AGAINST your ${side} right now (${buyPct}% buy / ${sellPct}% sell). Short-term only and it can flip fast, but don't ignore it.`,
  };
}
