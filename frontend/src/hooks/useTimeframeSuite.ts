import { useMemo } from "react";
import { useCandles, useOptionsAnalytics, useSignal } from "../api/hooks";
import { analyzeTimeframe, type TimeframeAnalysis } from "../utils/timeframeEngine";
import type { InstrumentSymbol } from "../types";

export const TIMEFRAMES: { tf: string; label: string }[] = [
  { tf: "5", label: "5 Minutes" },
  { tf: "10", label: "10 Minutes" },
  { tf: "15", label: "15 Minutes" },
  { tf: "30", label: "30 Minutes" },
  { tf: "60", label: "1 Hour" },
  { tf: "240", label: "4 Hours" },
];

// Fetches all 6 independent timeframes plus the daily reference (for
// pivot/CPR) and the live option chain/signal for one instrument, and scores
// each timeframe independently through the confluence engine.
export function useTimeframeSuite(symbol: InstrumentSymbol, journalWinRate: number | null) {
  const c5 = useCandles(symbol, "5");
  const c10 = useCandles(symbol, "10");
  const c15 = useCandles(symbol, "15");
  const c30 = useCandles(symbol, "30");
  const c60 = useCandles(symbol, "60");
  const c240 = useCandles(symbol, "240");
  const c1D = useCandles(symbol, "1D");
  const { data: options, error: optionsError } = useOptionsAnalytics(symbol);
  const { data: signal, error: signalError } = useSignal(symbol);

  const queries = [c5, c10, c15, c30, c60, c240];
  const loading = queries.some((q) => q.isLoading);
  const liveDataUnavailable = !!optionsError || !!signalError || !!options?.error || !!signal?.error;

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
  }, [c5.data, c10.data, c15.data, c30.data, c60.data, c240.data, c1D.data, options, liveDataUnavailable, journalWinRate]);

  return { analyses, loading, liveDataUnavailable, options, signal, errorMessage: signal?.error || options?.error };
}
