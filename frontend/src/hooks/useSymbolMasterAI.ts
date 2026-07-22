import { useMemo } from "react";
import { useCandles, useOptionsAnalytics, useSignal } from "../api/hooks";
import { computeMasterAI, type MasterAIResult } from "../utils/masterEngine";
import type { InstrumentSymbol } from "../types";

// Fetches all four timeframes + option analytics + the pattern signal for one
// instrument and runs them through the confluence engine. Factored out so the
// score board can run this for every tradable instrument at once instead of
// only the currently-selected one.
export function useSymbolMasterAI(symbol: InstrumentSymbol) {
  const c1D = useCandles(symbol, "1D");
  const c30 = useCandles(symbol, "30");
  const c15 = useCandles(symbol, "15");
  const c5 = useCandles(symbol, "5");
  const { data: options, error: optionsError, dataUpdatedAt: optionsUpdatedAt } = useOptionsAnalytics(symbol);
  const { data: signal, error: signalError } = useSignal(symbol);

  const candlesReady = !!(c1D.data && c30.data && c15.data && c5.data);
  const loading = c1D.isLoading || c30.isLoading || c15.isLoading || c5.isLoading;
  const liveDataUnavailable = !!signalError || !!optionsError || !!signal?.error || !!options?.error;
  const errorMessage = signal?.error || options?.error;

  const result = useMemo<MasterAIResult | null>(() => {
    if (!candlesReady || liveDataUnavailable) return null;
    return computeMasterAI({
      candlesByTf: { "1D": c1D.data!.candles, "30": c30.data!.candles, "15": c15.data!.candles, "5": c5.data!.candles },
      options,
      signal,
    });
  }, [candlesReady, liveDataUnavailable, c1D.data, c30.data, c15.data, c5.data, options, signal]);

  return { result, loading, liveDataUnavailable, errorMessage, options, signal, optionsUpdatedAt };
}
