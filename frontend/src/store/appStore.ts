import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { InstrumentSymbol } from "../types";

export type Timeframe = "5" | "15" | "30" | "1D";

interface RiskSettings {
  capital: number;
  riskPercent: number;
}

// One trade instance for a given "<symbol>-<timeframe>" line: entry/targets/
// stop are frozen at the moment the signal first fired, targetsHit ticks off
// each level as the live premium reaches it (permanently, even if price later
// retraces), and once closed the line is done -- the next actionable signal
// for that timeframe starts a brand-new entry rather than mutating this one.
export type TradeLogStatus = "running" | "sl_hit" | "stopped_breakeven" | "stopped_after_t1" | "target3_hit";

export interface TradeLogEntry {
  id: string;
  strike: number;
  optSide: "CE" | "PE";
  entry: number;
  targets: [number, number, number];
  stop: number;
  targetsHit: [boolean, boolean, boolean];
  status: TradeLogStatus;
  closed: boolean;
  openedAt: number;
  closedAt: number | null;
  // Captured at the moment the entry opened, so a later "explain this call"
  // view can show the REAL reasoning from back then instead of substituting
  // today's live analysis (which has nothing to do with an already-closed
  // trade) or inventing something. Optional so existing entries and callers
  // that don't track this (AI-Test V2/Pro) are unaffected.
  meta?: { label: string; reasons: string[]; confirmingTimeframes: string[] };
}

// One line per fired alert, newest first. The engine that produces these
// (useAlertEngine) never invents a signal -- every entry mirrors a decision
// the corresponding page (AI-Test V2/Pro, AI Elite, or Kimi AI) is already
// showing live, just surfaced app-wide instead of only on that one page.
export type AlertSource = "Timeframe" | "Elite" | "Kimi";

export interface AlertEntry {
  id: string;
  createdAt: number;
  source: AlertSource;
  symbol: InstrumentSymbol;
  tfLabel: string;
  title: string;
  detail: string;
  read: boolean;
}

export interface AlertSettings {
  enabled: boolean;
  browserNotifications: boolean;
  soundEnabled: boolean;
  // "strong" only fires on STRONG BUY/STRONG SELL (Timeframe/Elite) or a
  // tradeable BUY/STRONG BUY Kimi setup -- "all" also includes the weaker
  // BUY/WATCH BUY/SELL tiers, which is noisier but catches earlier signals.
  minTier: "strong" | "all";
  sources: { timeframe: boolean; elite: boolean; kimi: boolean };
}

const MAX_ALERTS = 200;

interface AppState {
  selectedInstrument: InstrumentSymbol;
  setSelectedInstrument: (symbol: InstrumentSymbol) => void;

  selectedTimeframe: Timeframe;
  setSelectedTimeframe: (tf: Timeframe) => void;

  risk: RiskSettings;
  setRisk: (risk: Partial<RiskSettings>) => void;

  tradeLogs: Record<string, TradeLogEntry[]>;
  setTradeLog: (key: string, entries: TradeLogEntry[]) => void;

  alerts: AlertEntry[];
  addAlerts: (entries: AlertEntry[]) => void;
  markAlertRead: (id: string) => void;
  markAllAlertsRead: () => void;
  clearAlerts: () => void;

  alertSettings: AlertSettings;
  setAlertSettings: (patch: Partial<AlertSettings>) => void;
  setAlertSources: (patch: Partial<AlertSettings["sources"]>) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      selectedInstrument: "CRUDEOIL",
      setSelectedInstrument: (symbol) => set({ selectedInstrument: symbol }),

      selectedTimeframe: "1D",
      setSelectedTimeframe: (tf) => set({ selectedTimeframe: tf }),

      risk: { capital: 200000, riskPercent: 3 },
      setRisk: (risk) => set((s) => ({ risk: { ...s.risk, ...risk } })),

      tradeLogs: {},
      setTradeLog: (key, entries) => set((s) => ({ tradeLogs: { ...s.tradeLogs, [key]: entries } })),

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
        sources: { timeframe: true, elite: true, kimi: true },
      },
      setAlertSettings: (patch) => set((s) => ({ alertSettings: { ...s.alertSettings, ...patch } })),
      setAlertSources: (patch) => set((s) => ({ alertSettings: { ...s.alertSettings, sources: { ...s.alertSettings.sources, ...patch } } })),
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
