import { useMemo } from "react";
import { useCandles, useOptionsAnalytics } from "../api/hooks";
import { analyzeTimeframe, type TimeframeAnalysis } from "../utils/timeframeEngine";
import { TIMEFRAMES } from "./useTimeframeSuite";
import type { InstrumentSymbol, Candle } from "../types";

export interface HitScoreTimeframeEntry {
  tf: string;
  label: string;
  analysis: TimeframeAnalysis;
  candles: Candle[];
}

// Same 4 timeframes (15/30/60/240) and same analyzeTimeframe() engine
// useTimeframeSuite already uses -- duplicated here (rather than extending
// that shared hook) only because AI-Shoot's scorer additionally needs the
// raw candles per timeframe (for the order-block confluence check), which
// useTimeframeSuite doesn't expose.
export function useHitScoreSuite(symbol: InstrumentSymbol, journalWinRate: number | null) {
  const c15 = useCandles(symbol, "15");
  const c30 = useCandles(symbol, "30");
  const c60 = useCandles(symbol, "60");
  const c240 = useCandles(symbol, "240");
  const c1D = useCandles(symbol, "1D");
  const optionsQ = useOptionsAnalytics(symbol);
  const { data: options, error: optionsError } = optionsQ;

  const queries = [c15, c30, c60, c240];
  const allQueries = [...queries, c1D, optionsQ];
  const loading = queries.some((q) => q.isLoading);
  const liveDataUnavailable = !!optionsError || !!options?.error;
  const isFetching = allQueries.some((q) => q.isFetching);
  const dataUpdatedAt = Math.max(...allQueries.map((q) => q.dataUpdatedAt));
  const refetchAll = () => Promise.all(allQueries.map((q) => q.refetch()));

  const entries = useMemo<HitScoreTimeframeEntry[]>(() => {
    return TIMEFRAMES.map(({ tf, label }, i) => {
      const candles = queries[i].data?.candles ?? [];
      const analysis = analyzeTimeframe({ tf, label, candles, dailyCandles: c1D.data?.candles, options: liveDataUnavailable ? undefined : options, journalWinRate });
      return { tf, label, analysis, candles };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c15.data, c30.data, c60.data, c240.data, c1D.data, options, liveDataUnavailable, journalWinRate]);

  return { entries, options, loading, liveDataUnavailable, errorMessage: options?.error, isFetching, dataUpdatedAt, refetchAll };
}
