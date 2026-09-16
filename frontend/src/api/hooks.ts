import { useMemo } from "react";
import { useLocation } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";
import { useAppStore } from "../store/appStore";
import { refetchIntervalFor, queryFailed, PAUSED_RETRY_MS } from "../config/livePages";
import type { InstrumentSymbol, PortfolioTrade, KumarAiAnalyzeRequest } from "../types";

/**
 * The polling interval a query should use ON THE PAGE CURRENTLY OPEN.
 *
 * The six main tabs always poll. Every other page loads once and then holds
 * still until the user taps Update, unless they switch auto-update on for the
 * session. Putting the rule here means it applies to all ~25 pages at once and
 * no individual page can forget it.
 *
 * `false` only stops the REPEAT fetches -- React Query still fetches once on
 * mount, so a paused page is never an empty page.
 *
 * The one exception is failure. Before pages could be paused, a transient
 * upstream blip (an Upstox rate-limit, a dropped connection) healed itself on
 * the next tick a few seconds later and nobody ever saw it. With polling off,
 * that same blip would freeze "Current", "Probability" and "R:R" as dashes
 * until the user happened to tap Update. So a paused query still retries, just
 * slowly, and only while it is actually broken.
 */
function usePollInterval(ms: number): number | false | ((query: { state: { status: string; data: unknown } }) => number | false) {
  const { pathname } = useLocation();
  const liveOverride = useAppStore((s) => s.liveOnOtherPages);
  const interval = refetchIntervalFor(pathname, liveOverride, ms);
  if (interval !== false) return interval;
  return (query) => (queryFailed(query.state) ? PAUSED_RETRY_MS : false);
}

// Deliberately NOT gated by usePollInterval. This drives the LIVE/CLOSED clock
// in the header, which is mounted on every page -- pausing it would freeze the
// clock and look broken -- and it is pure server-side computation with no
// Upstox call behind it.
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
    refetchInterval: usePollInterval(15_000),
  });
}

export function useSignals() {
  return useQuery({
    queryKey: ["signals"],
    queryFn: api.signals,
    refetchInterval: usePollInterval(30_000),
  });
}

export function useSignal(symbol: InstrumentSymbol) {
  return useQuery({
    queryKey: ["signal", symbol],
    queryFn: () => api.signal(symbol),
    refetchInterval: usePollInterval(30_000),
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
    refetchInterval: usePollInterval(tf === "1D" ? 60_000 : 15_000),
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

// `enabled` defaults to true so every existing caller is unchanged. GPT News
// passes false unless the trader explicitly turns live premium tracking on --
// the option chain is the single heaviest upstream call in the app, and a new
// page must not add to it by default.
export function useOptionsAnalytics(symbol: InstrumentSymbol, enabled = true) {
  const pinnedStrikes = useOpenStrikesFor(symbol);
  const pinnedKey = pinnedStrikes.join(",");
  return useQuery({
    queryKey: ["options-analytics", symbol, pinnedKey],
    queryFn: () => api.optionsAnalytics(symbol, pinnedStrikes),
    enabled,
    refetchInterval: usePollInterval(20_000),
  });
}

// Level 2 market depth for the underlying future -- used by AI Strategy
// Verification's Market Depth & Smart Money card and the order-book pressure
// badge. This was the fastest poll in the app at 5s, which across two symbols
// was 24 upstream calls a minute on its own and a real contributor to the
// Upstox rate limit. A stale order book is misleading, so this stays the
// fastest thing here -- just not three times faster than it needs to be. The
// pages that genuinely need an instant read still force-refresh this key on
// their own tick.
export function useMarketDepth(symbol: InstrumentSymbol) {
  return useQuery({
    queryKey: ["depth", symbol],
    queryFn: () => api.depth(symbol),
    refetchInterval: usePollInterval(15_000),
  });
}

// News Based Trade AI's feed -- symbol-agnostic (both Crude and NG read the
// same response, filtered client-side by newsTradeEngine.ts), so this is
// ONE shared query rather than one per symbol. News doesn't need Market
// Depth's 5s cadence -- a 60s refetch is plenty for headline-driven data.
export function useNewsTrade() {
  return useQuery({
    queryKey: ["news-trade"],
    queryFn: api.newsTrade,
    refetchInterval: usePollInterval(60_000),
  });
}

// AI Flash's feed. The server caches news for 60s (Cloudflare KV's hard
// minimum), so polling faster than that would only re-serve the same cached
// payload -- 30s keeps the on-screen "X min ago" ages ticking and picks up a
// new server cache generation within seconds of it existing.
export function useNewsFeed() {
  return useQuery({
    queryKey: ["news-feed"],
    queryFn: api.newsFeed,
    refetchInterval: usePollInterval(30_000),
  });
}

// The 9-11 AM gap study is built from completed sessions and cached 6h on the
// server, so it only meaningfully changes once a day. A slow client cadence is
// plenty; today's own gap is in the same payload and settles at the open.
export function useGapStudy(symbol: InstrumentSymbol) {
  return useQuery({
    queryKey: ["gap-study", symbol],
    queryFn: () => api.gapStudy(symbol),
    staleTime: 10 * 60_000,
    refetchInterval: usePollInterval(15 * 60_000),
  });
}

// Expiry doesn't change intraday, so this doesn't need News/Depth's fast
// cadence -- a 5-minute refetch (matching the worker's own Cron interval)
// is plenty to catch the daysLeft boundary rolling over.
export function useExpiryAlerts() {
  return useQuery({
    queryKey: ["expiry-alerts"],
    queryFn: api.expiryAlerts,
    refetchInterval: usePollInterval(5 * 60_000),
  });
}

// "Why Today" is AI-synthesized off cached news (5-min server cache), so a
// slow client cadence is plenty -- refetch every 5 minutes.
export function useWhyToday() {
  return useQuery({
    queryKey: ["why-today"],
    queryFn: api.whyToday,
    refetchInterval: usePollInterval(5 * 60_000),
  });
}

// EIA weekly crude inventory / NG storage -- the number itself plus a
// bullish/bearish read. Updates on the worker's ~8-min server cache; a
// 5-minute client refetch is plenty (it only changes once a week on release).
export function useEnergyData() {
  return useQuery({
    queryKey: ["energy-data"],
    queryFn: api.energy,
    refetchInterval: usePollInterval(5 * 60_000),
  });
}

export function useGlobalMarkets() {
  return useQuery({
    queryKey: ["global-markets"],
    queryFn: api.globalMarkets,
    refetchInterval: usePollInterval(30_000),
  });
}

// GPT News' macro backdrop. Cached 2 minutes on the server and these
// instruments move on a macro timescale, not a tick one -- a 2-minute client
// refetch is plenty and adds no load to the Upstox quota (this is Yahoo).
export function useMacroMarkets() {
  return useQuery({
    queryKey: ["macro-markets"],
    queryFn: api.macroMarkets,
    staleTime: 60_000,
    refetchInterval: usePollInterval(2 * 60_000),
  });
}

// Price-Alerts. The server caches the computed profile for 6 hours and it is
// built from COMPLETED sessions, so it barely changes during a day -- a slow
// client cadence is right, and it shares the gap study's underlying candle
// cache so it adds no Upstox load.
export function useTimeProfile(symbol: InstrumentSymbol) {
  return useQuery({
    queryKey: ["time-profile", symbol],
    queryFn: () => api.timeProfile(symbol),
    staleTime: 30 * 60_000,
    refetchInterval: usePollInterval(60 * 60_000),
  });
}

// The Pullback vs Reversal read. The server memoises this for 60 seconds and it
// is built from structure, which does not change tick by tick -- so a 60s
// cadence on the live tabs is plenty, and every page that shows the card shares
// this one query rather than adding its own candle fetches.
export function usePullback(symbol: InstrumentSymbol) {
  return useQuery({
    queryKey: ["pullback", symbol],
    queryFn: () => api.pullback(symbol),
    staleTime: 30_000,
    refetchInterval: usePollInterval(60_000),
  });
}

// The Backtest Lab's candle history. Frozen data -- it only changes when a new
// session completes -- so it is fetched once and never polled.
export function useHistory30m(symbol: InstrumentSymbol, enabled: boolean) {
  return useQuery({
    queryKey: ["history-30m", symbol],
    queryFn: () => api.history30m(symbol),
    enabled,
    staleTime: 60 * 60_000,
    refetchInterval: false,
  });
}

export function usePortfolio() {
  return useQuery({
    queryKey: ["portfolio"],
    queryFn: api.portfolio,
    refetchInterval: usePollInterval(20_000),
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
