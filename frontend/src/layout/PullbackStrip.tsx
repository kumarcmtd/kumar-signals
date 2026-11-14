// The compact Pullback vs Reversal status that appears on the six main tabs
// (spec Part 3).
//
// Rendered once here in the shell rather than pasted into six pages. That keeps
// six carefully-built layouts untouched, guarantees the card cannot drift out of
// sync between them, and means it can be removed again in one edit.
//
// It reads the SAME shared query as the AI Pullback page, so the heavy work
// happens once on the Worker and every tab shares the result -- no page fetches
// four timeframes of candles for itself.

import { useLocation, useNavigate } from "react-router-dom";
import { useMarketStatus, usePullback } from "../api/hooks";
import { useAppStore } from "../store/appStore";
import { isAlwaysLivePage } from "../config/livePages";
import { PullbackStatusCard } from "../components/PullbackKit";
import { MarketClosedCard } from "../components/MarketClosedCard";

export function PullbackStrip() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const symbol = useAppStore((s) => s.selectedInstrument);
  const tradable = symbol === "CRUDEOIL" || symbol === "NATURALGAS" ? symbol : "CRUDEOIL";
  // Hooks must run unconditionally, so the query is declared before the route
  // check and simply goes unused on pages that do not show the strip.
  const { data, isLoading, error } = usePullback(tradable);
  const { data: market } = useMarketStatus();

  if (!isAlwaysLivePage(pathname)) return null;

  // MCX shut: the live read has no intraday candles, so show the last session
  // and the next open instead of blank fields and a "wait for a 1H close" line.
  if (market && !market.isOpen) {
    return (
      <div className="mb-4">
        <MarketClosedCard symbol={tradable} preOpen={market.session === "PRE_OPEN"} onOpen={() => navigate("/ai-pullback")} />
      </div>
    );
  }

  return (
    <div className="mb-4">
      <PullbackStatusCard
        result={data}
        loading={isLoading}
        error={error ? (error as Error).message : null}
        onOpen={() => navigate("/ai-pullback")}
      />
    </div>
  );
}
