import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { InstrumentSymbol } from "../types";

export type Timeframe = "5" | "15" | "30" | "1D";

interface RiskSettings {
  capital: number;
  riskPercent: number;
}

// A frozen snapshot of a trade recommendation at the moment it first became
// actionable (decision !== WAIT), keyed by "<symbol>-<timeframe>". Without
// this, "Entry" would just be whatever the current live premium happens to
// be on every refresh -- which is always true of itself and can never show
// a target/stop as "hit". Freezing it here is what makes a real Target
// Hit / SL Hit read possible.
export interface SignalSnapshot {
  strike: number;
  optSide: "CE" | "PE";
  entry: number;
  targets: [number, number, number];
  stop: number;
  capturedAt: number;
}

interface AppState {
  selectedInstrument: InstrumentSymbol;
  setSelectedInstrument: (symbol: InstrumentSymbol) => void;

  selectedTimeframe: Timeframe;
  setSelectedTimeframe: (tf: Timeframe) => void;

  risk: RiskSettings;
  setRisk: (risk: Partial<RiskSettings>) => void;

  signalSnapshots: Record<string, SignalSnapshot>;
  setSignalSnapshot: (key: string, snapshot: SignalSnapshot) => void;
  clearSignalSnapshot: (key: string) => void;
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

      signalSnapshots: {},
      setSignalSnapshot: (key, snapshot) => set((s) => ({ signalSnapshots: { ...s.signalSnapshots, [key]: snapshot } })),
      clearSignalSnapshot: (key) =>
        set((s) => {
          const next = { ...s.signalSnapshots };
          delete next[key];
          return { signalSnapshots: next };
        }),
    }),
    { name: "kumar-signals-pro-store" }
  )
);
