import type { MarketStatus, PriceCard, SignalCard, InstrumentSymbol, Candle, OptionsAnalytics } from "../types";

async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`);
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
};
