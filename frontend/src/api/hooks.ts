import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";
import type { InstrumentSymbol, PortfolioTrade } from "../types";

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

export function useOptionsAnalytics(symbol: InstrumentSymbol) {
  return useQuery({
    queryKey: ["options-analytics", symbol],
    queryFn: () => api.optionsAnalytics(symbol),
    refetchInterval: 20_000,
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
