import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useCandles, useOptionsAnalytics } from "../api/hooks";
import type { InstrumentSymbol } from "../types";

// Ai20-20's data source for the "immediate" engine: no fixed candle
// timeframe to wait on. Fine-grained (5-minute) candles give the underlying
// a fast-reacting read (see aiTwentyTwentyEngine's analyzeImmediate), and a
// short in-browser rolling sample of the ATM CE/PE premium's own live price
// -- refreshed on a faster cadence than any single page's default poll, the
// same technique useStrategyVerification.ts already uses to track a call in
// real time -- gives a genuine tick-to-tick read independent of any candle
// closing at all.
const REFRESH_MS = 8000;
const MAX_SAMPLES = 8; // roughly the last ~55-60s of live premium at this cadence
const FAST_TF = "5";

export function useImmediateSuite(symbol: InstrumentSymbol) {
  const candlesQ = useCandles(symbol, FAST_TF);
  const optionsQ = useOptionsAnalytics(symbol);
  const { data: options, error: optionsError } = optionsQ;
  const liveDataUnavailable = !!optionsError || !!options?.error;

  const queryClient = useQueryClient();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => {
      queryClient.invalidateQueries({ queryKey: ["options-analytics", symbol] });
      queryClient.invalidateQueries({ queryKey: ["candles", symbol, FAST_TF] });
      setTick((t) => t + 1);
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [queryClient, symbol]);

  const atmRow = options && !options.error ? options.rows.find((r) => r.strike === options.atmStrike) : undefined;
  const ceLtp = atmRow?.call.ltp ?? null;
  const peLtp = atmRow?.put.ltp ?? null;

  // Resets the moment the ATM strike itself rolls to a new one -- an old
  // strike's premium history has no bearing on a freshly-repriced ATM leg.
  const samplesRef = useRef<{ strike: number | null; ce: number[]; pe: number[] }>({ strike: null, ce: [], pe: [] });
  const strikeKey = atmRow?.strike ?? null;
  if (samplesRef.current.strike !== strikeKey) {
    samplesRef.current = { strike: strikeKey, ce: [], pe: [] };
  }
  useEffect(() => {
    if (ceLtp !== null) samplesRef.current.ce = [...samplesRef.current.ce, ceLtp].slice(-MAX_SAMPLES);
    if (peLtp !== null) samplesRef.current.pe = [...samplesRef.current.pe, peLtp].slice(-MAX_SAMPLES);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ceLtp, peLtp, strikeKey]);

  const momentumPct = (samples: number[]): number | null => {
    if (samples.length < 3 || samples[0] <= 0) return null;
    return ((samples[samples.length - 1] - samples[0]) / samples[0]) * 100;
  };

  const { ceMomentumPct, peMomentumPct } = useMemo(
    () => ({ ceMomentumPct: momentumPct(samplesRef.current.ce), peMomentumPct: momentumPct(samplesRef.current.pe) }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tick, ceLtp, peLtp, strikeKey]
  );

  return {
    candles: candlesQ.data?.candles ?? [],
    candlesLoading: candlesQ.isLoading,
    candlesError: (candlesQ.data as { error?: string } | undefined)?.error ?? null,
    options,
    loading: candlesQ.isLoading || optionsQ.isLoading,
    liveDataUnavailable,
    ceMomentumPct,
    peMomentumPct,
  };
}
