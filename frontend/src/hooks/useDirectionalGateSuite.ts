import { useMemo } from "react";
import { useCandles, useOptionsAnalytics } from "../api/hooks";
import { TIMEFRAMES } from "./useTimeframeSuite";
import { evaluateDirectionalGate, type GateDirection, type GateEvaluation } from "../utils/directionalGateEngine";
import type { InstrumentSymbol, Candle } from "../types";

// Every entry timeframe is gated by the NEXT higher timeframe's trend --
// 15m/30m both use the 1H trend, 1H uses the 4H trend, and 4H uses the
// daily trend. Reuses the exact same TIMEFRAMES (15/30/60/240) every other
// report page in this app already shows, per the "same timeframe/report as
// previous ones" requirement -- only the underlying signal logic differs.
const TREND_TF: Record<string, string> = { "15": "60", "30": "60", "60": "240", "240": "1D" };

export interface GateTimeframeResult {
  tf: string;
  label: string;
  evaluation: GateEvaluation;
}

export function useDirectionalGateSuite(symbol: InstrumentSymbol, direction: GateDirection) {
  const c15 = useCandles(symbol, "15");
  const c30 = useCandles(symbol, "30");
  const c60 = useCandles(symbol, "60");
  const c240 = useCandles(symbol, "240");
  const c1D = useCandles(symbol, "1D");
  const optionsQ = useOptionsAnalytics(symbol);
  const { data: options, error: optionsError } = optionsQ;

  const entryQueries = [c15, c30, c60, c240];
  const allQueries = [...entryQueries, c1D, optionsQ];
  const loading = entryQueries.some((q) => q.isLoading);
  const liveDataUnavailable = !!optionsError || !!options?.error;
  const isFetching = allQueries.some((q) => q.isFetching);
  const dataUpdatedAt = Math.max(...allQueries.map((q) => q.dataUpdatedAt));
  const refetchAll = () => Promise.all(allQueries.map((q) => q.refetch()));

  const entryCandlesByTf: Record<string, Candle[]> = {
    "15": c15.data?.candles ?? [],
    "30": c30.data?.candles ?? [],
    "60": c60.data?.candles ?? [],
    "240": c240.data?.candles ?? [],
  };
  const trendCandlesByTf: Record<string, Candle[]> = {
    "60": c60.data?.candles ?? [],
    "240": c240.data?.candles ?? [],
    "1D": c1D.data?.candles ?? [],
  };

  const results = useMemo<GateTimeframeResult[]>(() => {
    return TIMEFRAMES.map(({ tf, label }) => ({
      tf,
      label,
      evaluation: evaluateDirectionalGate(direction, entryCandlesByTf[tf], trendCandlesByTf[TREND_TF[tf]]),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [direction, c15.data, c30.data, c60.data, c240.data, c1D.data]);

  return { results, options, loading, liveDataUnavailable, errorMessage: options?.error, isFetching, dataUpdatedAt, refetchAll };
}
