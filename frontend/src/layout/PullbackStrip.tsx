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
import { usePullback } from "../api/hooks";
import { useAppStore } from "../store/appStore";
import { isAlwaysLivePage } from "../config/livePages";
import { PullbackStatusCard } from "../components/PullbackKit";

export function PullbackStrip() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const symbol = useAppStore((s) => s.selectedInstrument);
  const tradable = symbol === "CRUDEOIL" || symbol === "NATURALGAS" ? symbol : "CRUDEOIL";
  // Hooks must run unconditionally, so the query is declared before the route
  // check and simply goes unused on pages that do not show the strip.
  const { data, isLoading, error } = usePullback(tradable);

  if (!isAlwaysLivePage(pathname)) return null;

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
