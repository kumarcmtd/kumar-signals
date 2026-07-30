import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { InstrumentSymbol, Direction } from "../types";
import type { Decision6 } from "../utils/timeframeEngine";

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
export type TradeLogStatus = "running" | "sl_hit" | "stopped_breakeven" | "stopped_after_t1" | "target3_hit" | "closed_manual";

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
  // The decision tier (Strong Buy/Good Buy/Risky Buy/Don't Buy Risky) that
  // was active when this entry opened -- lets a "which signal actually wins
  // more" ranking group real closed trades by tier. Optional: entries from
  // before this field existed, and Kimi's setup-based log (no Decision6
  // concept), simply have no tier and are excluded from that ranking.
  decision?: Decision6;
  // How many separate TIMES price has crossed up through each target --
  // unlike targetsHit (a permanent, one-way "reached at least once" flag
  // used to trail the stop and decide closure), this keeps counting on every
  // fresh touch: hit T1, pull back below it, hit T1 again -> 2. Optional so
  // entries persisted before this field existed just start counting from
  // whatever targetsHit already recorded (see advanceOpenEntry).
  targetTouches?: [number, number, number];
  // Internal bookkeeping for targetTouches: was price at/above each target
  // as of the last poll -- lets advanceOpenEntry tell a genuine new touch
  // (crossing up from below) apart from "still sitting above from before."
  targetAboveState?: [boolean, boolean, boolean];
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
      hydrateTradeLogs: (logs) => set({ tradeLogs: logs }),
      forceCloseTradeLog: (key) =>
        set((s) => {
          const history = s.tradeLogs[key];
          const last = history?.[history.length - 1];
          if (!last || last.closed) return s;
          const closed: TradeLogEntry = { ...last, closed: true, closedAt: Date.now(), status: "closed_manual" };
          return { tradeLogs: { ...s.tradeLogs, [key]: [...history.slice(0, -1), closed] } };
        }),

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
