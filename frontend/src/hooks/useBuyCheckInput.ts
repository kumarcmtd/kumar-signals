// The inputs "Can I Buy Now?" needs, gathered once.
//
// WHY THIS IS A HOOK AND NOT COPIED ONTO EACH PAGE.
//
// Five pages now carry this button. The block that feeds it is fifteen lines
// of the same thing every time: the live premium, the effective stop, the news
// score, the market status, the premium swing, the clock. Pasted five times,
// those fifteen lines drift -- one page picks up a fix, the next one does not,
// and the same signal answers "yes" on Best Call and "no" on AI-Up with no
// explanation anywhere on screen.
//
// That is not a hypothetical. This button exists BECAUSE a page showed a green
// "Buy Now" badge a few centimetres above a red "CONFLICT -- WAIT" and nothing
// reconciled them. Shipping five hand-maintained copies of its inputs would be
// rebuilding the same fault one level down.
//
// So each page hands over only what is genuinely page-specific -- which trade
// is open, what its live premium is, which candles it drew -- and everything
// shared is resolved here, once, the same way for everyone.

import { useMemo } from "react";
import { useMarketStatus } from "../api/hooks";
import { useNewsTradeAI } from "./useNewsTradeAI";
import { atr } from "../utils/indicators";
import { istHourInKolkata, type BuyCheckInput } from "../utils/canIBuyNow";
import type { EntryTimingTier } from "../utils/entryTiming";
import type { NewsTradeSymbol } from "../utils/newsTradeEngine";
import type { Candle } from "../types";

/**
 * The slice of a trade-log entry this needs.
 *
 * Deliberately structural rather than the full TradeLogEntry: three of the
 * five pages build their hero card from slightly different shapes, and
 * demanding the whole type would force casts at every call site.
 */
export interface BuyCheckTrade {
  entry: number;
  targets: number[];
  optSide: "CE" | "PE";
  openedAt: number | string | null;
}

export interface BuyCheckArgs {
  /** Only the two options-traded contracts; the news engine covers no others. */
  symbol: NewsTradeSymbol;
  /** The open call, or null when the page has nothing live to check. */
  trade: BuyCheckTrade | null;
  /** Live premium of that leg. Null outside market hours or before a fill. */
  livePremium: number | null;
  /** The CURRENT stop, after any break-even move -- not the original. */
  stop: number | null;
  /** The candles the page already drew. Used for the premium swing only. */
  candles: Candle[] | undefined | null;
  lotSize: number;
  /** The page's own entry-timing tier, or null when it could not be computed. */
  timingTier: EntryTimingTier | null;
}

/**
 * Premium movement per candle, from the underlying's ATR.
 *
 * An option premium does not move rupee-for-rupee with the underlying, so the
 * ATR is scaled down. This is a rough figure and is used only to judge whether
 * a stop is wide enough to survive normal noise -- never to price anything, and
 * never shown to the user as if it were a measured premium range.
 */
const PREMIUM_SWING_RATIO = 0.6;

export function useBuyCheckInput(args: BuyCheckArgs): BuyCheckInput | null {
  const { symbol, trade, livePremium, stop, candles, lotSize, timingTier } = args;

  // The SAME hook NewsImpactCard renders from, so the button and that card can
  // never disagree -- which is the exact failure this button was built for.
  const { result: newsDecision } = useNewsTradeAI(symbol);
  const { data: marketStatus } = useMarketStatus();

  const premiumSwingPerCandle = useMemo(() => {
    const a = atr(candles ?? [], 14);
    return a === null ? null : a * PREMIUM_SWING_RATIO;
  }, [candles]);

  return useMemo(() => {
    // Offered whenever the page has a most-recent call at all, open OR closed,
    // and the engine gives the answer. Hiding the button is deliberately NOT
    // done here: "No button available" was a real complaint, and a check that
    // vanishes exactly when someone is unsure is worse than one that says
    // "this call is finished, there is nothing to enter".
    if (!trade || stop === null) return null;

    const openedMs = trade.openedAt === null ? null : new Date(trade.openedAt).getTime();
    const signalAgeMinutes = openedMs !== null && Number.isFinite(openedMs) ? (Date.now() - openedMs) / 60000 : null;

    return {
      livePremium,
      signalEntry: trade.entry,
      stop,
      targets: trade.targets,
      lotSize,
      marketOpen: marketStatus?.isOpen ?? false,
      timingTier,
      conflict: newsDecision?.tradeConfirmation === "WAIT_CONFLICT",
      netScore: typeof newsDecision?.finalNet === "number" ? newsDecision.finalNet : null,
      optSide: trade.optSide,
      premiumSwingPerCandle,
      istHour: istHourInKolkata(),
      signalAgeMinutes,
    };
  }, [trade, stop, livePremium, lotSize, marketStatus, timingTier, newsDecision, premiumSwingPerCandle]);
}
