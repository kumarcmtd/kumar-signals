import { useMemo } from "react";
import { useCandles, useOptionsAnalytics, useSignal } from "../api/hooks";
import { analyzeTimeframe, type TimeframeAnalysis } from "../utils/timeframeEngine";
import type { InstrumentSymbol } from "../types";

// 5-minute and 10-minute timeframes were removed from every call/signal
// engine across the app -- too much noise from short-term price wiggles
// produced confusing, frequently-reversing calls with a high loss rate.
// 15 minutes is now the shortest timeframe scored anywhere.
export const TIMEFRAMES: { tf: string; label: string }[] = [
  { tf: "15", label: "15 Minutes" },
  { tf: "30", label: "30 Minutes" },
  { tf: "60", label: "1 Hour" },
  { tf: "240", label: "4 Hours" },
];

// Fetches all 4 independent timeframes plus the daily reference (for
// pivot/CPR) and the live option chain/signal for one instrument, and scores
// each timeframe independently through the confluence engine.
export function useTimeframeSuite(symbol: InstrumentSymbol, journalWinRate: number | null) {
  const c15 = useCandles(symbol, "15");
  const c30 = useCandles(symbol, "30");
  const c60 = useCandles(symbol, "60");
  const c240 = useCandles(symbol, "240");
  const c1D = useCandles(symbol, "1D");
  const optionsQ = useOptionsAnalytics(symbol);
  const signalQ = useSignal(symbol);
  const { data: options, error: optionsError } = optionsQ;
  const { data: signal, error: signalError } = signalQ;

  const queries = [c15, c30, c60, c240];
  const allQueries = [...queries, c1D, optionsQ, signalQ];
  const loading = queries.some((q) => q.isLoading);
  const liveDataUnavailable = !!optionsError || !!signalError || !!options?.error || !!signal?.error;
  const isFetching = allQueries.some((q) => q.isFetching);
  const dataUpdatedAt = Math.max(...allQueries.map((q) => q.dataUpdatedAt));
  const refetchAll = () => Promise.all(allQueries.map((q) => q.refetch()));

  const analyses = useMemo<TimeframeAnalysis[]>(() => {
    return TIMEFRAMES.map(({ tf, label }, i) => {
      const q = queries[i];
      return analyzeTimeframe({
        tf,
        label,
        candles: q.data?.candles ?? [],
        dailyCandles: c1D.data?.candles,
        options: liveDataUnavailable ? undefined : options,
        journalWinRate,
      });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    });
  }, [c15.data, c30.data, c60.data, c240.data, c1D.data, options, liveDataUnavailable, journalWinRate]);

  return {
    analyses,
    loading,
    liveDataUnavailable,
    options,
    signal,
    errorMessage: signal?.error || options?.error,
    isFetching,
    dataUpdatedAt,
    refetchAll,
  };
}
