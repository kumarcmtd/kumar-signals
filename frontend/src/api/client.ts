import type { MarketStatus, PriceCard, SignalCard, InstrumentSymbol, Candle, OptionsAnalytics, GlobalQuote, PortfolioTrade, KumarAiAnalyzeRequest, KumarAiAnalyzeResult } from "../types";

async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

async function sendJSON<T>(path: string, method: "POST" | "PATCH" | "DELETE", data?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: data !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: data !== undefined ? JSON.stringify(data) : undefined,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

export const api = {
  marketStatus: () => getJSON<MarketStatus>("/market-status"),
  prices: () => getJSON<PriceCard[]>("/prices"),
  signals: () => getJSON<SignalCard[]>("/signals"),
  signal: (symbol: InstrumentSymbol) => getJSON<SignalCard>(`/signals/${symbol}`),
  scan: (symbol: InstrumentSymbol, tf: string) =>
    getJSON<SignalCard & { timeframe: string }>(`/scan?symbol=${symbol}&tf=${tf}`),
  candles: (symbol: InstrumentSymbol, tf: string) =>
    getJSON<{ tradingSymbol: string; timeframe: string; candles: Candle[] }>(`/candles?symbol=${symbol}&tf=${tf}`),
  optionsAnalytics: (symbol: InstrumentSymbol) => getJSON<OptionsAnalytics>(`/options/${symbol}`),
  globalMarkets: () => getJSON<GlobalQuote[]>("/global-markets"),
  portfolio: () => getJSON<PortfolioTrade[]>("/portfolio"),
  createTrade: (trade: Partial<PortfolioTrade>) => sendJSON<PortfolioTrade>("/portfolio", "POST", trade),
  updateTrade: (id: string, patch: Partial<PortfolioTrade>) => sendJSON<PortfolioTrade>(`/portfolio/${id}`, "PATCH", patch),
  deleteTrade: (id: string) => sendJSON<{ ok: true }>(`/portfolio/${id}`, "DELETE"),
  kumarAiAnalyze: (payload: KumarAiAnalyzeRequest) => sendJSON<KumarAiAnalyzeResult>("/kumar-ai/analyze", "POST", payload),
};
