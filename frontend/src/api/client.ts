import type { MarketStatus, PriceCard, SignalCard, InstrumentSymbol, Candle, OptionsAnalytics, MarketDepthSnapshot, GlobalQuote, PortfolioTrade, KumarAiAnalyzeRequest, KumarAiAnalyzeResult, NewsTradeApiResponse, NewsFetchResponse, ExpiryAlert } from "../types";
import type { WhyCommodity } from "../utils/whyTodaySummary";
import type { EiaScoreResult } from "../utils/newsScoring";
import type { MorningGapRecord } from "../utils/overnightGapEngine";

export interface EnergyDataResponse {
  available: boolean;
  crude: EiaScoreResult | null;
  ngStorage: EiaScoreResult | null;
  error?: string;
}

export interface NewsFeedResponse extends NewsFetchResponse {
  fetchedAt: string;
}

export interface GapStudyResponse {
  available: boolean;
  windowLabel: string;
  latest: { date: string; gapPct: number; open: number; prevClose: number } | null;
  sessions: MorningGapRecord[];
  error?: string;
}

export interface WhyTodayResponse {
  crude: WhyCommodity;
  naturalGas: WhyCommodity;
  newsAvailable: boolean;
  fetchedAt: string;
}
import type { TradeLogEntry } from "../store/appStore";

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
  optionsAnalytics: (symbol: InstrumentSymbol, pinnedStrikes: number[] = []) =>
    getJSON<OptionsAnalytics>(`/options/${symbol}${pinnedStrikes.length ? `?strikes=${pinnedStrikes.join(",")}` : ""}`),
  depth: (symbol: InstrumentSymbol) => getJSON<MarketDepthSnapshot>(`/depth/${symbol}`),
  newsTrade: () => getJSON<NewsTradeApiResponse>("/news-trade"),
  // AI Flash's feed. Deliberately the lighter /news route rather than
  // /news-trade -- the flash page needs only headlines, not the EIA and
  // economic-calendar payloads, and it polls far more often than that page.
  newsFeed: () => getJSON<NewsFeedResponse>("/news"),
  globalMarkets: () => getJSON<GlobalQuote[]>("/global-markets"),
  expiryAlerts: () => getJSON<{ alerts: ExpiryAlert[] }>("/expiry-alerts"),
  whyToday: () => getJSON<WhyTodayResponse>("/why-today"),
  energy: () => getJSON<EnergyDataResponse>("/energy"),
  gapStudy: (symbol: InstrumentSymbol) => getJSON<GapStudyResponse>(`/gap-study?symbol=${symbol}`),
  portfolio: () => getJSON<PortfolioTrade[]>("/portfolio"),
  createTrade: (trade: Partial<PortfolioTrade>) => sendJSON<PortfolioTrade>("/portfolio", "POST", trade),
  updateTrade: (id: string, patch: Partial<PortfolioTrade>) => sendJSON<PortfolioTrade>(`/portfolio/${id}`, "PATCH", patch),
  deleteTrade: (id: string) => sendJSON<{ ok: true }>(`/portfolio/${id}`, "DELETE"),
  kumarAiAnalyze: (payload: KumarAiAnalyzeRequest) => sendJSON<KumarAiAnalyzeResult>("/kumar-ai/analyze", "POST", payload),
  getNtfyTopic: () => getJSON<{ topic: string | null }>("/notify/topic"),
  saveNtfyTopic: (topic: string) => sendJSON<{ ok: true; topic: string }>("/notify/topic", "POST", { topic }),
  deleteNtfyTopic: () => sendJSON<{ ok: true }>("/notify/topic", "DELETE"),
  sendTestNotification: () => sendJSON<{ ok: true }>("/notify/test", "POST"),
  checkNotificationsNow: () => sendJSON<{ ok: true }>("/notify/check-now", "POST"),
  getTradeLogs: () => getJSON<Record<string, TradeLogEntry[]>>("/trade-logs"),
  saveTradeLogs: (logs: Record<string, TradeLogEntry[]>) => sendJSON<{ ok: true }>("/trade-logs", "POST", logs),
};
