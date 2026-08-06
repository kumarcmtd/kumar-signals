import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useCandles, useOptionsAnalytics, useMarketDepth, useNewsTrade } from "../api/hooks";
import { evaluateMarketDepth, type MarketDepthResult } from "../utils/marketDepthAnalysis";
import { evaluateNewsTrade, type NewsTradeResult, type NewsTradeSymbol } from "../utils/newsTradeEngine";
import type { MarketDepthSnapshot } from "../types";

const REFRESH_MS = 15_000;
const MAX_SAMPLES = 12;

function atmOiFor(options: ReturnType<typeof useOptionsAnalytics>["data"]): number | null {
  if (!options || options.error || options.atmStrike === null) return null;
  const row = options.rows.find((r) => r.strike === options.atmStrike);
  if (!row) return null;
  const call = row.call.oi ?? 0;
  const put = row.put.oi ?? 0;
  return call + put;
}

// Read-only, symbol-level scanner (not tied to any specific open trade) --
// reuses the exact same candle/options/depth queries every other page
// already has, plus the shared news feed from useNewsTrade(). The only new
// state here is a short rolling sample of the ATM strike's combined OI and
// the underlying price, built the same way Strategy Verification/Verify Pro
// build their own rolling samples (no historical OI-candle endpoint exists).
export function useNewsTradeAI(symbol: NewsTradeSymbol) {
  const candlesQ = useCandles(symbol, "15");
  const optionsQ = useOptionsAnalytics(symbol);
  const depthQ = useMarketDepth(symbol);
  const newsQ = useNewsTrade();

  const candles = candlesQ.data?.candles ?? [];
  const underlyingPrice = candles.length ? candles[candles.length - 1].close : null;

  const queryClient = useQueryClient();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => {
      queryClient.invalidateQueries({ queryKey: ["candles", symbol, "15"] });
      queryClient.invalidateQueries({ queryKey: ["options-analytics", symbol] });
      queryClient.invalidateQueries({ queryKey: ["depth", symbol] });
      setTick((t) => t + 1);
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [queryClient, symbol]);

  const prevDepthRef = useRef<MarketDepthSnapshot | null>(null);
  const depth: MarketDepthResult | null = useMemo(() => {
    if (!depthQ.data) return null;
    return evaluateMarketDepth(depthQ.data, prevDepthRef.current, candles);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depthQ.data, candles, tick]);
  useEffect(() => {
    if (depthQ.data) prevDepthRef.current = depthQ.data;
  }, [depthQ.data]);

  const samplesRef = useRef<{ oi: (number | null)[]; price: number[] }>({ oi: [], price: [] });
  useEffect(() => {
    const oi = atmOiFor(optionsQ.data);
    const buf = samplesRef.current;
    buf.oi = [...buf.oi, oi].slice(-MAX_SAMPLES);
    if (underlyingPrice !== null) buf.price = [...buf.price, underlyingPrice].slice(-MAX_SAMPLES);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, optionsQ.data, underlyingPrice]);

  const result: NewsTradeResult | null = useMemo(() => {
    if (candles.length < 30) return null;
    return evaluateNewsTrade({
      symbol,
      candles,
      options: optionsQ.data ?? null,
      depth,
      articles: newsQ.data?.news.articles ?? [],
      eia: symbol === "CRUDEOIL" ? (newsQ.data?.eia.crude ?? null) : (newsQ.data?.eia.ngStorage ?? null),
      atmOiSamples: samplesRef.current.oi,
      underlyingPriceSamples: samplesRef.current.price,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, candles, optionsQ.data, depth, newsQ.data, tick]);

  return {
    result,
    underlyingPrice,
    candlesLoading: candlesQ.isLoading,
    candlesError: (candlesQ.data as { error?: string } | undefined)?.error ?? null,
    newsAvailable: newsQ.data?.news.available ?? false,
    eiaAvailable: newsQ.data?.eia.available ?? false,
    calendarAvailable: newsQ.data?.calendar.available ?? false,
    calendarEvents: newsQ.data?.calendar.events ?? [],
    fetchedAt: newsQ.data?.fetchedAt ?? null,
  };
}
