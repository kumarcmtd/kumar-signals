import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";
import { useAppStore } from "../store/appStore";
import type { InstrumentSymbol, PortfolioTrade, KumarAiAnalyzeRequest } from "../types";

export function useMarketStatus() {
  return useQuery({
    queryKey: ["market-status"],
    queryFn: api.marketStatus,
    refetchInterval: 30_000,
  });
}

export function usePrices() {
  return useQuery({
    queryKey: ["prices"],
    queryFn: api.prices,
    refetchInterval: 15_000,
  });
}

export function useSignals() {
  return useQuery({
    queryKey: ["signals"],
    queryFn: api.signals,
    refetchInterval: 30_000,
  });
}

export function useSignal(symbol: InstrumentSymbol) {
  return useQuery({
    queryKey: ["signal", symbol],
    queryFn: () => api.signal(symbol),
    refetchInterval: 30_000,
  });
}

export function useScan(symbol: InstrumentSymbol, tf: string, enabled: boolean) {
  return useQuery({
    queryKey: ["scan", symbol, tf],
    queryFn: () => api.scan(symbol, tf),
    enabled,
    staleTime: 10_000,
  });
}

export function useCandles(symbol: InstrumentSymbol, tf: string) {
  return useQuery({
    queryKey: ["candles", symbol, tf],
    queryFn: () => api.candles(symbol, tf),
    staleTime: 10_000,
    refetchInterval: tf === "1D" ? 60_000 : 15_000,
  });
}

// Every page's own trade-log key naming is different ("BEST-CRUDEOIL",
// "AIRISK-NATURALGAS-15", "GATECE-CRUDEOIL-30", "CRUDEOIL-1D", ...) but every
// one of them contains the plain symbol name somewhere, and "CRUDEOIL" /
// "NATURALGAS" never collide as substrings of each other -- so this is a
// safe, page-agnostic way to find every currently-open trade for a symbol
// across the ENTIRE app without importing every individual page's hook.
// Without this, an open trade whose strike drifts far enough from the
// current ATM (exactly what happens on a big move) would silently stop
// getting live quotes -- see nearestStrikes/getOptionChain on the worker.
function useOpenStrikesFor(symbol: InstrumentSymbol): number[] {
  const tradeLogs = useAppStore((s) => s.tradeLogs);
  return useMemo(() => {
    const set = new Set<number>();
    for (const [key, entries] of Object.entries(tradeLogs)) {
      if (!key.includes(symbol)) continue;
      const last = entries[entries.length - 1];
      if (last && !last.closed) set.add(last.strike);
    }
    return Array.from(set).sort((a, b) => a - b);
  }, [tradeLogs, symbol]);
}

export function useOptionsAnalytics(symbol: InstrumentSymbol) {
  const pinnedStrikes = useOpenStrikesFor(symbol);
  const pinnedKey = pinnedStrikes.join(",");
  return useQuery({
    queryKey: ["options-analytics", symbol, pinnedKey],
    queryFn: () => api.optionsAnalytics(symbol, pinnedStrikes),
    refetchInterval: 20_000,
  });
}

// Level 2 market depth for the underlying future -- used by AI Strategy
// Verification's Market Depth & Smart Money card. A short refetch interval
// since a stale order-book snapshot is actively misleading, not just less
// current; the page's own 5s tick also force-refreshes this same key.
export function useMarketDepth(symbol: InstrumentSymbol) {
  return useQuery({
    queryKey: ["depth", symbol],
    queryFn: () => api.depth(symbol),
    refetchInterval: 5_000,
  });
}

export function useGlobalMarkets() {
  return useQuery({
    queryKey: ["global-markets"],
    queryFn: api.globalMarkets,
    refetchInterval: 30_000,
  });
}

export function usePortfolio() {
  return useQuery({
    queryKey: ["portfolio"],
    queryFn: api.portfolio,
    refetchInterval: 20_000,
  });
}

export function useCreateTrade() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (trade: Partial<PortfolioTrade>) => api.createTrade(trade),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["portfolio"] }),
  });
}

export function useUpdateTrade() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<PortfolioTrade> }) => api.updateTrade(id, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["portfolio"] }),
  });
}

export function useDeleteTrade() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteTrade(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["portfolio"] }),
  });
}

// On-demand (button-driven), not a polling query -- the Kumar AI page calls
// this once per signal card when the user asks for AI reasoning, not
// automatically on every render.
export function useKumarAiAnalyze() {
  return useMutation({
    mutationFn: (payload: KumarAiAnalyzeRequest) => api.kumarAiAnalyze(payload),
  });
}

export function useNtfyTopic() {
  return useQuery({
    queryKey: ["ntfy-topic"],
    queryFn: api.getNtfyTopic,
    staleTime: 60_000,
  });
}

export function useSaveNtfyTopic() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (topic: string) => api.saveNtfyTopic(topic),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ntfy-topic"] }),
  });
}

export function useDeleteNtfyTopic() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.deleteNtfyTopic(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ntfy-topic"] }),
  });
}

export function useSendTestNotification() {
  return useMutation({ mutationFn: () => api.sendTestNotification() });
}

// The background push check normally only runs on the server's own 5-minute
// Cron schedule -- this lets a user trigger it on demand right after saving
// a topic, so they don't have to wait up to 5 minutes to see whether a
// currently-open Best Call notifies correctly.
export function useCheckNotificationsNow() {
  return useMutation({ mutationFn: () => api.checkNotificationsNow() });
}
