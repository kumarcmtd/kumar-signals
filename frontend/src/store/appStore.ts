import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { InstrumentSymbol, Direction } from "../types";
import type { StrategyTier } from "../utils/strategyVerification";
// TradeLogEntry/TradeLogStatus now live in the pure, React-free tradeLogCore
// module so the Cloudflare Worker's Cron can share the exact same shape and
// advance/close logic. Re-exported here so every existing
// `import { type TradeLogEntry } from "../store/appStore"` keeps working.
export type { TradeLogStatus, TradeLogEntry } from "../utils/tradeLogCore";
import type { TradeLogEntry } from "../utils/tradeLogCore";

export type Timeframe = "5" | "15" | "30" | "1D";

interface RiskSettings {
  capital: number;
  riskPercent: number;
}

// One line per fired alert, newest first. The engine that produces these
// (useAlertEngine) never invents a signal -- every entry mirrors a decision
// the corresponding page (AI-Test V2/Pro, AI Elite, or Kimi AI) is already
// showing live, just surfaced app-wide instead of only on that one page.
export type AlertSource = "Timeframe" | "Elite" | "Kimi" | "BestCall";

export interface AlertEntry {
  id: string;
  createdAt: number;
  source: AlertSource;
  symbol: InstrumentSymbol;
  tfLabel: string;
  title: string;
  detail: string;
  read: boolean;
  // Explicit bearish flag set from the real decision/direction at creation
  // time -- older, already-persisted alerts predate this field and fall
  // back to text-sniffing the title (see Alerts.tsx) since label wording
  // isn't guaranteed to contain "sell" anymore.
  bearish?: boolean;
}

export interface AlertSettings {
  enabled: boolean;
  browserNotifications: boolean;
  soundEnabled: boolean;
  // "strong" only fires on STRONG BUY/STRONG SELL (Timeframe/Elite) or a
  // tradeable BUY/STRONG BUY Kimi setup -- "all" also includes the weaker
  // BUY/WATCH BUY/SELL tiers, which is noisier but catches earlier signals.
  minTier: "strong" | "all";
  sources: { timeframe: boolean; elite: boolean; kimi: boolean; bestCall: boolean };
}

const MAX_ALERTS = 200;

// AI SuperTrend Pro's own trade log. Kept separate from TradeLogEntry/
// tradeLogs above rather than reusing that shape: every other engine in this
// app trades OPTION PREMIUM off a strike (strike/optSide/3 targets),
// SuperTrend Pro trades the raw underlying/futures price directly with 5
// ATR-based targets -- a genuinely different shape, not a variant of the
// same one. Keyed by "<symbol>-<timeframe>", same rolling-history
// convention as tradeLogs.
export type SuperTrendLogStatus = "running" | "sl_hit" | "target5_hit" | "stopped_trailing";

export interface SuperTrendLogEntry {
  id: string;
  symbol: InstrumentSymbol;
  timeframe: string;
  direction: Direction;
  entry: number;
  stop: number;
  targets: [number, number, number, number, number];
  targetsHit: [boolean, boolean, boolean, boolean, boolean];
  confidence: number;
  status: SuperTrendLogStatus;
  closed: boolean;
  openedAt: number;
  closedAt: number | null;
}

const MAX_SUPERTREND_HISTORY = 100;

// AI Verify Pro's own "self-learning" track record -- track-only, never
// auto-adjusts any engine's weights. Frozen once per trade the moment it's
// first verified (never overwritten on later 5s ticks), keyed by the SAME
// TradeLogEntry.id Best Call already uses for that call, so it can later be
// joined against tradeLogs' own win/loss outcome (flattenClosedTrades) to
// build a real "when THIS check passed, we won X% of the time" report. Local
// only -- persisted via this store's existing persist() below, not synced to
// the cross-device KV backend the trade logs use.
export interface VerifyProSnapshot {
  checks: Record<string, StrategyTier>;
  tradeGrade: string;
  weightedScorePct: number;
  capturedAt: number;
}

interface AppState {
  selectedInstrument: InstrumentSymbol;
  setSelectedInstrument: (symbol: InstrumentSymbol) => void;

  selectedTimeframe: Timeframe;
  setSelectedTimeframe: (tf: Timeframe) => void;

  risk: RiskSettings;
  setRisk: (risk: Partial<RiskSettings>) => void;

  tradeLogs: Record<string, TradeLogEntry[]>;
  setTradeLog: (key: string, entries: TradeLogEntry[]) => void;
  // Bulk-replaces the whole record in one go -- used only by the
  // cross-device sync bootstrap (see syncTradeLogs.ts) after it has merged
  // this browser's local history with whatever's on the server, so every
  // page's own per-key setTradeLog calls don't need to know sync exists.
  hydrateTradeLogs: (logs: Record<string, TradeLogEntry[]>) => void;
  // Manually ends the currently-open entry for a key right now (e.g. the
  // user took profit/loss outside of any target/SL level the app tracks) --
  // a no-op if that key's last entry is already closed, so it can't
  // resurrect or overwrite real history.
  forceCloseTradeLog: (key: string) => void;
  // Bulk-closes every still-open call across ALL pages that was opened on a
  // PREVIOUS IST day (a stale "runner" left over from yesterday or earlier).
  // Books each at its entry (status closed_manual -> no fabricated P&L), the
  // same honest way forceCloseTradeLog does. Returns how many it cleared so
  // the caller can confirm. Never touches a call opened today.
  clearStaleTradeLogs: () => number;

  alerts: AlertEntry[];
  addAlerts: (entries: AlertEntry[]) => void;
  markAlertRead: (id: string) => void;
  markAllAlertsRead: () => void;
  clearAlerts: () => void;

  alertSettings: AlertSettings;
  setAlertSettings: (patch: Partial<AlertSettings>) => void;
  setAlertSources: (patch: Partial<AlertSettings["sources"]>) => void;

  superTrendLogs: Record<string, SuperTrendLogEntry[]>;
  setSuperTrendLog: (key: string, entries: SuperTrendLogEntry[]) => void;

  verifyProSnapshots: Record<string, VerifyProSnapshot>;
  recordVerifyProSnapshot: (id: string, snapshot: VerifyProSnapshot) => void;
}

// Midnight of the current calendar day in IST, as an epoch ms. A call whose
// openedAt is before this was raised on a previous IST trading day.
function istDayStartMs(): number {
  const ymd = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }); // YYYY-MM-DD
  return new Date(`${ymd}T00:00:00+05:30`).getTime();
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      selectedInstrument: "CRUDEOIL",
      setSelectedInstrument: (symbol) => set({ selectedInstrument: symbol }),

      selectedTimeframe: "1D",
      setSelectedTimeframe: (tf) => set({ selectedTimeframe: tf }),

      risk: { capital: 200000, riskPercent: 3 },
      setRisk: (risk) => set((s) => ({ risk: { ...s.risk, ...risk } })),

      tradeLogs: {},
      setTradeLog: (key, entries) => set((s) => ({ tradeLogs: { ...s.tradeLogs, [key]: entries } })),
      hydrateTradeLogs: (logs) => set({ tradeLogs: logs }),
      forceCloseTradeLog: (key) =>
        set((s) => {
          const history = s.tradeLogs[key];
          const last = history?.[history.length - 1];
          if (!last || last.closed) return s;
          const closed: TradeLogEntry = { ...last, closed: true, closedAt: Date.now(), status: "closed_manual" };
          return { tradeLogs: { ...s.tradeLogs, [key]: [...history.slice(0, -1), closed] } };
        }),
      clearStaleTradeLogs: () => {
        const dayStart = istDayStartMs();
        const s = get();
        const next: Record<string, TradeLogEntry[]> = {};
        let cleared = 0;
        for (const [k, history] of Object.entries(s.tradeLogs)) {
          const last = history[history.length - 1];
          if (last && !last.closed && last.openedAt < dayStart) {
            next[k] = [...history.slice(0, -1), { ...last, closed: true, closedAt: Date.now(), status: "closed_manual" }];
            cleared++;
          } else {
            next[k] = history;
          }
        }
        if (cleared > 0) set({ tradeLogs: next });
        return cleared;
      },

      alerts: [],
      addAlerts: (entries) =>
        set((s) => ({ alerts: [...entries, ...s.alerts].slice(0, MAX_ALERTS) })),
      markAlertRead: (id) => set((s) => ({ alerts: s.alerts.map((a) => (a.id === id ? { ...a, read: true } : a)) })),
      markAllAlertsRead: () => set((s) => ({ alerts: s.alerts.map((a) => (a.read ? a : { ...a, read: true })) })),
      clearAlerts: () => set({ alerts: [] }),

      alertSettings: {
        enabled: true,
        browserNotifications: false,
        soundEnabled: true,
        minTier: "strong",
        sources: { timeframe: true, elite: true, kimi: true, bestCall: true },
      },
      setAlertSettings: (patch) => set((s) => ({ alertSettings: { ...s.alertSettings, ...patch } })),
      setAlertSources: (patch) => set((s) => ({ alertSettings: { ...s.alertSettings, sources: { ...s.alertSettings.sources, ...patch } } })),

      superTrendLogs: {},
      setSuperTrendLog: (key, entries) =>
        set((s) => ({
          superTrendLogs: {
            ...s.superTrendLogs,
            [key]: entries.length > MAX_SUPERTREND_HISTORY ? entries.slice(entries.length - MAX_SUPERTREND_HISTORY) : entries,
          },
        })),

      verifyProSnapshots: {},
      recordVerifyProSnapshot: (id, snapshot) =>
        set((s) => (s.verifyProSnapshots[id] ? s : { verifyProSnapshots: { ...s.verifyProSnapshots, [id]: snapshot } })),
    }),
    {
      name: "kumar-signals-pro-store",
      version: 1,
      // v0 -> v1: the Kimi AI Trade ledger used to open a line for ANY
      // scanner hit (a pattern match alone, no confluence/edge-score bar),
      // which produced a genuinely broken ~9% win rate. Now that a real
      // gate exists (kimiScanner.ts's detectConfluence + calculateHitProbability's
      // tradeable check), that old data is just noise, not a fair baseline
      // for the new logic -- clearing only the KIMI-* keys here (AI-Test
      // V2/Pro and Elite's own trade logs are untouched) so the win rate
      // starts clean instead of dragging a broken average for a long time.
      migrate: (persistedState, version) => {
        const state = persistedState as { tradeLogs?: Record<string, TradeLogEntry[]> } | undefined;
        if (version < 1 && state?.tradeLogs) {
          const filtered: Record<string, TradeLogEntry[]> = {};
          for (const [k, v] of Object.entries(state.tradeLogs)) {
            if (!k.startsWith("KIMI-")) filtered[k] = v;
          }
          state.tradeLogs = filtered;
        }
        return state;
      },
    }
  )
);
