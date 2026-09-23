import type { MarketStatus, PriceCard, SignalCard, InstrumentSymbol, Candle, OptionsAnalytics, MarketDepthSnapshot, GlobalQuote, OvernightTrackerResponse, PortfolioTrade, KumarAiAnalyzeRequest, KumarAiAnalyzeResult, NewsTradeApiResponse, NewsFetchResponse, ExpiryAlert } from "../types";
import type { WhyCommodity } from "../utils/whyTodaySummary";
import type { EiaScoreResult } from "../utils/newsScoring";
import type { MorningGapRecord } from "../utils/overnightGapEngine";
import type { TimeProfile, ClaimResult, ScheduledEvent, EventProfile } from "../utils/timeProfileEngine";
import type { PullbackResult } from "../utils/pullbackReversalEngine";

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
  latest: { date: string; gapPct: number; open: number; prevClose: number; live: boolean } | null;
  global: { name: string; changePct: number | null } | null;
  sessions: MorningGapRecord[];
  error?: string;
}

// GPT News' macro backdrop (USD/INR, DXY, Gold, US 10Y). `spark` is a list of
// real daily closes, oldest first -- an empty list means that source failed,
// never a flat synthesized line.
export interface MacroQuote {
  symbol: string;
  name: string;
  short: string;
  unit: "usd" | "inr" | "index" | "pct";
  price: number | null;
  change: number | null;
  changePercent: number | null;
  spark: number[];
  asOf: string | null;
  error?: string;
}

export interface MacroMarketsResponse {
  quotes: MacroQuote[];
  fetchedAt: string;
}

// Price-Alerts. The heavy lifting happens on the worker (which imports the
// very same timeProfileEngine module), so the page receives finished statistics
// rather than ~1,200 raw half-hour bars over a mobile connection.
export interface TimeProfileResponse {
  available: boolean;
  symbol: InstrumentSymbol;
  tradingSymbol: string | null;
  profile: TimeProfile | null;
  claims: ClaimResult[];
  events: ScheduledEvent[];
  eventProfiles: EventProfile[];
  sessionsAnalyzed: number;
  firstDate: string | null;
  lastDate: string | null;
  contractNote: string;
  computedAt: string;
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
  overnightTracker: () => getJSON<OvernightTrackerResponse>("/overnight-tracker"),
  macroMarkets: () => getJSON<MacroMarketsResponse>("/macro-markets"),
  expiryAlerts: () => getJSON<{ alerts: ExpiryAlert[] }>("/expiry-alerts"),
  whyToday: () => getJSON<WhyTodayResponse>("/why-today"),
  energy: () => getJSON<EnergyDataResponse>("/energy"),
  gapStudy: (symbol: InstrumentSymbol) => getJSON<GapStudyResponse>(`/gap-study?symbol=${symbol}`),
  timeProfile: (symbol: InstrumentSymbol) => getJSON<TimeProfileResponse>(`/time-profile?symbol=${symbol}`),
  // One shared read of the central Pullback/Reversal engine. Computed on the
  // Worker so the six main tabs share a single request instead of each fetching
  // four timeframes of candles for themselves.
  pullback: (symbol: InstrumentSymbol) => getJSON<PullbackResult>(`/pullback?symbol=${symbol}`),
  // Raw 30-minute history for the AI Backtest Lab, which runs the backtest in
  // the browser -- a Worker invocation gets 10ms of CPU and the run needs
  // seconds. Server-side this is the same KV-cached series the gap study uses.
  history30m: (symbol: InstrumentSymbol) =>
    getJSON<{ symbol: InstrumentSymbol; tradingSymbol: string | null; candles: Candle[]; error?: string }>(`/history-30m?symbol=${symbol}`),
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
