import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAppStore, type TradeLogEntry } from "../store/appStore";
import { usePortfolio, useMarketDepth } from "../api/hooks";
import { computePortfolioSummary } from "../utils/portfolioStats";
import { useBestCallForSymbol, type TradableSymbol } from "./useBestCall";
import { liveLtpFor, effectiveStopFor } from "./useTradeLog";
import { evaluateStrategyVerification, type VerificationResult } from "../utils/strategyVerification";
import { evaluateMarketDepth, type MarketDepthResult } from "../utils/marketDepthAnalysis";
import type { MarketDepthSnapshot } from "../types";

const REFRESH_MS = 5000;
const MAX_SAMPLES = 12; // 1 minute of history at a 5s cadence

function liveOiFor(options: ReturnType<typeof useBestCallForSymbol>["options"], strike: number, optSide: "CE" | "PE"): number | null {
  if (!options || options.error) return null;
  const row = options.rows.find((r) => r.strike === strike);
  if (!row) return null;
  return optSide === "CE" ? row.call.oi : row.put.oi;
}

// This is a pure, read-only consumer of exactly the same shared data Best
// Call itself already computes (useBestCallForSymbol) -- it never writes to
// the trade log, never calls its own API, and never touches BestCall.tsx.
// The only thing genuinely new here is a short in-browser rolling sample of
// live premium/OI (there's no historical-candle endpoint for a single
// option strike), refreshed on this page's own 5-second cadence by
// invalidating the same React Query cache keys every other page already
// shares -- not a new API, just re-asking for the existing one sooner.
export function useStrategyVerification(symbol: TradableSymbol) {
  const { data: trades } = usePortfolio();
  const journalWinRate = useMemo(() => computePortfolioSummary(trades ?? []).winRate, [trades]);
  const data = useBestCallForSymbol(symbol, journalWinRate);
  const tradeLogs = useAppStore((s) => s.tradeLogs);
  const latest: TradeLogEntry | undefined = tradeLogs[data.trackingKey]?.[tradeLogs[data.trackingKey].length - 1];

  const { data: depthData } = useMarketDepth(symbol);

  const queryClient = useQueryClient();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => {
      queryClient.invalidateQueries({ queryKey: ["options-analytics", symbol] });
      queryClient.invalidateQueries({ queryKey: ["candles", symbol, "15"] });
      queryClient.invalidateQueries({ queryKey: ["depth", symbol] });
      setTick((t) => t + 1);
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [queryClient, symbol]);

  // One snapshot back, used only to notice a wall that was large a moment
  // ago and has since mostly vanished (a "possible order pulling" heuristic).
  const prevDepthRef = useRef<MarketDepthSnapshot | null>(null);
  const marketDepth: MarketDepthResult | null = useMemo(() => {
    if (!depthData) return null;
    return evaluateMarketDepth(depthData, prevDepthRef.current, data.underlyingCandles);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depthData, data.underlyingCandles, tick]);
  useEffect(() => {
    if (depthData) prevDepthRef.current = depthData;
  }, [depthData]);

  // Only a currently OPEN call is meaningful to verify in real time -- once
  // it's closed there's nothing live left to check against.
  const active = latest && !latest.closed ? latest : undefined;
  const livePremium = active ? liveLtpFor(data.options, active.strike, active.optSide) : null;
  const liveOi = active ? liveOiFor(data.options, active.strike, active.optSide) : null;

  // Rolling sample buffers -- reset the moment the tracked call itself
  // changes (a new strike/side), so an old call's history never bleeds
  // into a fresh one's verification.
  const samplesRef = useRef<{ key: string; premium: number[]; oi: (number | null)[] }>({ key: "", premium: [], oi: [] });
  const sampleKey = active ? active.id : "";
  if (samplesRef.current.key !== sampleKey) {
    samplesRef.current = { key: sampleKey, premium: [], oi: [] };
  }
  useEffect(() => {
    if (!active || livePremium === null) return;
    const buf = samplesRef.current;
    buf.premium = [...buf.premium, livePremium].slice(-MAX_SAMPLES);
    buf.oi = [...buf.oi, liveOi].slice(-MAX_SAMPLES);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, active?.id, livePremium, liveOi]);

  const underlyingPrice = data.underlyingCandles.length ? data.underlyingCandles[data.underlyingCandles.length - 1].close : null;

  const result: VerificationResult | null = useMemo(() => {
    if (!active || underlyingPrice === null || data.underlyingCandles.length < 30) return null;
    return evaluateStrategyVerification({
      direction: active.optSide === "CE" ? "bullish" : "bearish",
      candles: data.underlyingCandles,
      liveUnderlyingPrice: underlyingPrice,
      entry: active.entry,
      effectiveStop: effectiveStopFor(active),
      livePremium,
      premiumSamples: samplesRef.current.premium,
      oiSamples: samplesRef.current.oi,
      marketDepth,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, underlyingPrice, data.underlyingCandles, livePremium, marketDepth, tick]);

  return {
    latest: active,
    symbol,
    livePremium,
    underlyingPrice,
    expiry: data.expiry,
    candlesLoading: data.underlyingCandlesLoading,
    candlesError: data.underlyingCandlesError,
    result,
    marketDepth,
  };
}
