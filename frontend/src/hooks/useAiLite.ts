// Ai Lite for one market: the rules on the latest finished 15-minute candle,
// the money rules on today's calls, and the call itself -- opened here with
// the SAME entry the server writes (id from the signal candle), then moved
// along against the live option premium until it closes.

import { useEffect, useMemo, useState } from "react";
import { useCandles, useMarketStatus, useOptionsAnalytics } from "../api/hooks";
import { useAppStore } from "../store/appStore";
import { advanceOpenEntry, liveLtpFor, MAX_HISTORY } from "../utils/tradeLogCore";
import { daysToExpiry } from "../utils/oiBuildup";
import { pickStrike } from "../utils/twentyV3/ticket";
import type { LiteSym } from "../utils/lite/engine";
import { liteGuard, liteKey, openLiteEntry, readLite } from "../utils/lite/live";
import type { OptionsAnalytics } from "../types";

/** No new call on expiry day: the fastest time decay of the whole contract. */
export function liteExpiryBlock(options: OptionsAnalytics | undefined, now: number): string | null {
  if (!options?.expiry) return null;
  const d = daysToExpiry(options.expiry, now);
  return d !== null && d <= 0 ? "The option expires today — no new Ai Lite calls (time decay is fastest today)." : null;
}

export function useAiLite(sym: LiteSym) {
  const { data: market } = useMarketStatus();
  const candlesQ = useCandles(sym, "15");
  const optionsQ = useOptionsAnalytics(sym);
  const tradeLogs = useAppStore((s) => s.tradeLogs);
  const setTradeLog = useAppStore((s) => s.setTradeLog);
  const key = liteKey(sym);
  const log = useMemo(() => tradeLogs[key] ?? [], [tradeLogs, key]);

  // Re-read every 15 s so a just-finished candle counts before the feed refreshes.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 15_000);
    return () => clearInterval(id);
  }, []);
  const candles = useMemo(() => (candlesQ.data && "candles" in candlesQ.data ? (candlesQ.data.candles ?? []) : []), [candlesQ.data]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const read = useMemo(() => readLite(candles, Date.now()), [candles, tick]);
  const options = optionsQ.data && !optionsQ.data.error ? optionsQ.data : undefined;
  const side = read.state === "call" ? (read.signal?.side ?? null) : null;
  const choice = useMemo(() => (side ? pickStrike(options, side) : null), [side, options]);
  const open = market?.isOpen === true;

  useEffect(() => {
    const now = Date.now();
    const history = useAppStore.getState().tradeLogs[key] ?? [];
    const last = history[history.length - 1];
    if (last && !last.closed) {
      const next = advanceOpenEntry(last, liveLtpFor(options, last.strike, last.optSide), now);
      if (next !== last) setTradeLog(key, [...history.slice(0, -1), next]);
      return;
    }
    if (!open || !side || !choice || liteExpiryBlock(options, now)) return;
    if (!liteGuard(history, side, sym, now).ok) return;
    const entry = openLiteEntry(choice, side, sym, read);
    if (history.some((e) => e.id === entry.id)) return;
    setTradeLog(key, [...history, entry].slice(-MAX_HISTORY));
  }, [read, side, choice, options, open, key, sym, setTradeLog]);

  const now = Date.now();
  const running = log.length && !log[log.length - 1].closed ? log[log.length - 1] : null;
  return {
    sym,
    read,
    log,
    running,
    choice,
    options,
    open,
    marketKnown: !!market,
    guard: liteGuard(log, side, sym, now),
    expiry: liteExpiryBlock(options, now),
    loading: candlesQ.isLoading,
    liveDataUnavailable: !!optionsQ.error || !!optionsQ.data?.error || !!(candlesQ.data && "error" in candlesQ.data && candlesQ.data.error),
    errorMessage: (optionsQ.data?.error as string | undefined) ?? (candlesQ.data && "error" in candlesQ.data ? (candlesQ.data.error as string | undefined) : undefined),
    updatedAt: Math.max(candlesQ.dataUpdatedAt, optionsQ.dataUpdatedAt),
    fetching: candlesQ.isFetching || optionsQ.isFetching,
    refetch: () => Promise.all([candlesQ.refetch(), optionsQ.refetch()]),
  };
}

export type AiLiteState = ReturnType<typeof useAiLite>;
