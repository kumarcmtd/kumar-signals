import { useMemo } from "react";
import { useCandles, useOptionsAnalytics } from "../api/hooks";
import { TIMEFRAMES } from "./useTimeframeSuite";
import { evaluateMomentumBreakout, type BreakoutEvaluation } from "../utils/momentumBreakoutEngine";
import type { InstrumentSymbol } from "../types";

export interface BreakoutTimeframeResult {
  tf: string;
  label: string;
  evaluation: BreakoutEvaluation;
}

// Unlike the Directional Gate, this engine reads each timeframe entirely on
// its own -- no higher-timeframe trend filter -- since waiting for
// higher-timeframe agreement is exactly the kind of lag AI-Risk exists to
// avoid. Reuses the same 15/30/60/240 timeframe set as every other report
// page in this app.
export function useMomentumBreakoutSuite(symbol: InstrumentSymbol) {
  const c15 = useCandles(symbol, "15");
  const c30 = useCandles(symbol, "30");
  const c60 = useCandles(symbol, "60");
  const c240 = useCandles(symbol, "240");
  const optionsQ = useOptionsAnalytics(symbol);
  const { data: options, error: optionsError } = optionsQ;

  const queries = [c15, c30, c60, c240];
  const allQueries = [...queries, optionsQ];
  const loading = queries.some((q) => q.isLoading);
  const liveDataUnavailable = !!optionsError || !!options?.error;
  const isFetching = allQueries.some((q) => q.isFetching);
  const dataUpdatedAt = Math.max(...allQueries.map((q) => q.dataUpdatedAt));
  const refetchAll = () => Promise.all(allQueries.map((q) => q.refetch()));

  const candlesByTf: Record<string, ReturnType<typeof useCandles>["data"]> = {
    "15": c15.data,
    "30": c30.data,
    "60": c60.data,
    "240": c240.data,
  };

  const results = useMemo<BreakoutTimeframeResult[]>(() => {
    return TIMEFRAMES.map(({ tf, label }) => ({
      tf,
      label,
      evaluation: evaluateMomentumBreakout(candlesByTf[tf]?.candles ?? []),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c15.data, c30.data, c60.data, c240.data]);

  return { results, options, loading, liveDataUnavailable, errorMessage: options?.error, isFetching, dataUpdatedAt, refetchAll };
}
