import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { InstrumentSymbol } from "../types";

export type Timeframe = "5" | "15" | "30" | "1D";

interface RiskSettings {
  capital: number;
  riskPercent: number;
}

interface AppState {
  selectedInstrument: InstrumentSymbol;
  setSelectedInstrument: (symbol: InstrumentSymbol) => void;

  selectedTimeframe: Timeframe;
  setSelectedTimeframe: (tf: Timeframe) => void;

  risk: RiskSettings;
  setRisk: (risk: Partial<RiskSettings>) => void;
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
    }),
    { name: "kumar-signals-pro-store" }
  )
);
