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

interface AppState {
  selectedInstrument: InstrumentSymbol;
  setSelectedInstrument: (symbol: InstrumentSymbol) => void;

  selectedTimeframe: Timeframe;
  setSelectedTimeframe: (tf: Timeframe) => void;

  risk: RiskSettings;
  setRisk: (risk: Partial<RiskSettings>) => void;

  tradeLogs: Record<string, TradeLogEntry[]>;
  setTradeLog: (key: string, entries: TradeLogEntry[]) => void;
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
    }),
    { name: "kumar-signals-pro-store" }
  )
);
