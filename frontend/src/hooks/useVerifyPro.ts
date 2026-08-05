import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAppStore, type TradeLogEntry } from "../store/appStore";
import { usePortfolio, useMarketDepth } from "../api/hooks";
import { computePortfolioSummary } from "../utils/portfolioStats";
import { useBestCallForSymbol, type TradableSymbol } from "./useBestCall";
import { liveLtpFor, effectiveStopFor } from "./useTradeLog";
import { evaluateMarketDepth, type MarketDepthResult } from "../utils/marketDepthAnalysis";
import { evaluateVerifyPro, type VerifyProResult } from "../utils/verifyProEngine";
import { computeVerifyProTrackRecord } from "../utils/verifyProTrackRecord";
import type { MarketDepthSnapshot } from "../types";

const REFRESH_MS = 5000;
const MAX_SAMPLES = 12;

function liveOiFor(options: ReturnType<typeof useBestCallForSymbol>["options"], strike: number, optSide: "CE" | "PE"): number | null {
  if (!options || options.error) return null;
  const row = options.rows.find((r) => r.strike === strike);
  if (!row) return null;
  return optSide === "CE" ? row.call.oi : row.put.oi;
}

// Same read-only pattern as useStrategyVerification: reuses Best Call's own
// live data end to end, never writes to the trade log itself, never calls a
// new API of its own beyond the existing /api/depth. The one write this hook
// DOES make is a single, one-time-per-trade snapshot into the store's
// verifyProSnapshots (see appStore.ts) for the track-only accuracy report --
// frozen the first time a trade is verified, never touched again after that.
export function useVerifyPro(symbol: TradableSymbol) {
  const { data: trades } = usePortfolio();
  const journalWinRate = useMemo(() => computePortfolioSummary(trades ?? []).winRate, [trades]);
  const data = useBestCallForSymbol(symbol, journalWinRate);
  const tradeLogs = useAppStore((s) => s.tradeLogs);
  const verifyProSnapshots = useAppStore((s) => s.verifyProSnapshots);
  const recordVerifyProSnapshot = useAppStore((s) => s.recordVerifyProSnapshot);
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

  const prevDepthRef = useRef<MarketDepthSnapshot | null>(null);
  const marketDepth: MarketDepthResult | null = useMemo(() => {
    if (!depthData) return null;
    return evaluateMarketDepth(depthData, prevDepthRef.current, data.underlyingCandles);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depthData, data.underlyingCandles, tick]);
  const previousRawDepthForFlow = prevDepthRef.current;
  useEffect(() => {
    if (depthData) prevDepthRef.current = depthData;
  }, [depthData]);

  const active = latest && !latest.closed ? latest : undefined;
  const livePremium = active ? liveLtpFor(data.options, active.strike, active.optSide) : null;
  const liveOi = active ? liveOiFor(data.options, active.strike, active.optSide) : null;
  const underlyingPrice = data.underlyingCandles.length ? data.underlyingCandles[data.underlyingCandles.length - 1].close : null;

  const samplesRef = useRef<{ key: string; premium: number[]; oi: (number | null)[]; underlying: number[] }>({ key: "", premium: [], oi: [], underlying: [] });
  const sampleKey = active ? active.id : "";
  if (samplesRef.current.key !== sampleKey) {
    samplesRef.current = { key: sampleKey, premium: [], oi: [], underlying: [] };
  }
  useEffect(() => {
    if (!active || livePremium === null) return;
    const buf = samplesRef.current;
    buf.premium = [...buf.premium, livePremium].slice(-MAX_SAMPLES);
    buf.oi = [...buf.oi, liveOi].slice(-MAX_SAMPLES);
    if (underlyingPrice !== null) buf.underlying = [...buf.underlying, underlyingPrice].slice(-MAX_SAMPLES);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, active?.id, livePremium, liveOi, underlyingPrice]);

  const result: VerifyProResult | null = useMemo(() => {
    if (!active || underlyingPrice === null || data.underlyingCandles.length < 30) return null;
    return evaluateVerifyPro({
      direction: active.optSide === "CE" ? "bullish" : "bearish",
      candles: data.underlyingCandles,
      liveUnderlyingPrice: underlyingPrice,
      entry: active.entry,
      stop: active.stop,
      effectiveStop: effectiveStopFor(active),
      targets: active.targets,
      targetsHit: active.targetsHit,
      livePremium,
      premiumSamples: samplesRef.current.premium,
      oiSamples: samplesRef.current.oi,
      underlyingPriceSamples: samplesRef.current.underlying,
      marketDepth,
      rawDepth: depthData ?? null,
      previousRawDepth: previousRawDepthForFlow,
      options: data.options ?? null,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, underlyingPrice, data.underlyingCandles, livePremium, marketDepth, depthData, data.options, tick]);

  useEffect(() => {
    if (!active || !result) return;
    if (verifyProSnapshots[active.id]) return;
    const checks: Record<string, VerifyProResult["checks"][number]["tier"]> = {};
    for (const c of result.checks) checks[c.key] = c.tier;
    recordVerifyProSnapshot(active.id, { checks, tradeGrade: result.tradeGrade, weightedScorePct: result.weightedScorePct, capturedAt: Date.now() });
  }, [active, result, verifyProSnapshots, recordVerifyProSnapshot]);

  const trackRecord = useMemo(() => computeVerifyProTrackRecord(data.trackingKey, tradeLogs, verifyProSnapshots), [data.trackingKey, tradeLogs, verifyProSnapshots]);

  return {
    latest: active,
    symbol,
    livePremium,
    underlyingPrice,
    expiry: data.expiry,
    candlesLoading: data.underlyingCandlesLoading,
    candlesError: data.underlyingCandlesError,
    result,
    trackRecord,
  };
}
