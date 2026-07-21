import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { InstrumentSymbol } from "../types";
import type { Decision } from "../utils/masterEngine";

export type JournalOutcome = "open" | "win" | "loss";

export interface JournalEntry {
  id: string;
  ts: number;
  symbol: InstrumentSymbol;
  decision: Decision;
  confidence: number;
  strike?: number;
  optSide?: "CE" | "PE";
  entry: number | null;
  stop: number | null;
  target1: number | null;
  outcome: JournalOutcome;
}

interface JournalState {
  entries: JournalEntry[];
  logSignal: (entry: Omit<JournalEntry, "id" | "ts" | "outcome">) => void;
  markOutcome: (id: string, outcome: JournalOutcome) => void;
  clear: () => void;
}

const MAX_ENTRIES = 100;
const ACTIONABLE: Decision[] = ["STRONG BUY", "BUY", "BUY ON DIP", "SELL", "STRONG SELL", "SELL ON RISE"];

export const useJournalStore = create<JournalState>()(
  persist(
    (set, get) => ({
      entries: [],
      logSignal: (entry) => {
        if (!ACTIONABLE.includes(entry.decision)) return;
        const { entries } = get();
        const last = entries.find((e) => e.symbol === entry.symbol);
        // Dedupe: only log a new entry when the call actually changed for this symbol.
        if (last && last.decision === entry.decision && last.strike === entry.strike && last.optSide === entry.optSide) return;
        const next: JournalEntry = { ...entry, id: `${entry.symbol}-${Date.now()}`, ts: Date.now(), outcome: "open" };
        set({ entries: [next, ...entries].slice(0, MAX_ENTRIES) });
      },
      markOutcome: (id, outcome) => set({ entries: get().entries.map((e) => (e.id === id ? { ...e, outcome } : e)) }),
      clear: () => set({ entries: [] }),
    }),
    { name: "kumar-signals-master-ai-journal" }
  )
);

export function journalStats(entries: JournalEntry[]) {
  const closed = entries.filter((e) => e.outcome !== "open" && e.entry !== null && e.target1 !== null && e.stop !== null);
  const wins = closed.filter((e) => e.outcome === "win");
  const losses = closed.filter((e) => e.outcome === "loss");

  const pctMove = (e: JournalEntry) => {
    if (e.entry === null) return 0;
    const exit = e.outcome === "win" ? e.target1! : e.stop!;
    return ((exit - e.entry) / e.entry) * 100;
  };

  const winPcts = wins.map(pctMove);
  const lossPcts = losses.map(pctMove);
  const avgWin = winPcts.length ? winPcts.reduce((s, v) => s + v, 0) / winPcts.length : null;
  const avgLoss = lossPcts.length ? lossPcts.reduce((s, v) => s + v, 0) / lossPcts.length : null;
  const winRate = closed.length ? (wins.length / closed.length) * 100 : null;
  const grossWin = winPcts.reduce((s, v) => s + Math.max(v, 0), 0);
  const grossLoss = Math.abs(lossPcts.reduce((s, v) => s + Math.min(v, 0), 0));
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : winPcts.length ? Infinity : null;

  const allPcts = [...winPcts, ...lossPcts];
  let sharpe: number | null = null;
  if (allPcts.length >= 2) {
    const mean = allPcts.reduce((s, v) => s + v, 0) / allPcts.length;
    const variance = allPcts.reduce((s, v) => s + (v - mean) ** 2, 0) / allPcts.length;
    const stdDev = Math.sqrt(variance);
    sharpe = stdDev > 0 ? mean / stdDev : null;
  }

  return { totalClosed: closed.length, winRate, avgWin, avgLoss, profitFactor, sharpe };
}
