// The Trade Card's answer for one market, held STEADY.
//
// The verdict is built from finished candles, so it can only really change
// when a 5-minute candle closes. On top of that, within one candle it may
// only get SAFER (TRADE -> WAIT -> AVOID), never jump up to TRADE on a news
// re-score or a refetch -- that up-down flicker is what made the old cards
// confusing. The one live override is safety: once the live price is through
// the stop, it says EXIT at once.

import { useMemo } from "react";
import { useCandles } from "../api/hooks";
import { useBuyDecision } from "./useBuyDecision";
import { tradeVerdict, type TradeAction, type TradeVerdict } from "../utils/tradeVerdict";

type Sym = "CRUDEOIL" | "NATURALGAS";

const RANK: Record<TradeAction, number> = { TRADE_CE: 3, TRADE_PE: 3, WAIT_CE: 2, WAIT_PE: 2, AVOID: 1, CLOSED: 0, NO_DATA: 0 };

interface Held {
  v: TradeVerdict;
  since: string | null; // when this action began, IST HH:MM
}
const held = new Map<Sym, Held>();

/** Exported for tests: decide between what is shown and a fresh reading. */
export function holdVerdict(prev: Held | undefined, next: TradeVerdict): Held {
  if (!prev || next.action === "CLOSED" || next.action === "NO_DATA") return { v: next, since: next.basedOn };
  const sameCandle = prev.v.basedOn === next.basedOn;
  if (sameCandle && RANK[next.action] >= RANK[prev.v.action] && next.action !== prev.v.action) return prev; // no upgrades mid-candle
  if (sameCandle && next.action === prev.v.action) return prev;
  return { v: next, since: next.action === prev.v.action ? prev.since : next.basedOn };
}

export function useTradeVerdict(symbol: Sym) {
  const d = useBuyDecision(symbol);
  const c5 = useCandles(symbol, "5");
  const c15 = useCandles(symbol, "15");
  const minute = Math.floor(Date.now() / 60_000);

  const fresh = useMemo(
    () =>
      tradeVerdict({
        result: d.result,
        c5: c5.data?.candles ?? [],
        c15: c15.data?.candles ?? [],
        news: d.news,
        now: Date.now(),
        marketOpen: d.marketOpen,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [d.result, c5.data, c15.data, d.news, d.marketOpen, minute],
  );

  const shown = useMemo(() => {
    const h = holdVerdict(held.get(symbol), fresh);
    held.set(symbol, h);
    return h;
  }, [fresh, symbol]);

  // Safety: the live price already through the stop of a TRADE.
  const v = shown.v;
  const live = d.livePrice;
  const stopBroken = (v.action === "TRADE_CE" || v.action === "TRADE_PE") && v.stop !== null && live !== null && (v.action === "TRADE_CE" ? live <= v.stop : live >= v.stop);
  const verdict: TradeVerdict = stopBroken
    ? { ...v, action: "AVOID", headline: "EXIT — STOP BROKEN", reason: `Live price ₹${live!.toFixed(2)} is through the stop ₹${v.stop!.toFixed(2)}. Exit; no new entry this candle.` }
    : v;

  return { verdict, since: shown.since, pick: d.pick, livePrice: live, error: d.error, loading: d.loading, refetch: d.refetch };
}
