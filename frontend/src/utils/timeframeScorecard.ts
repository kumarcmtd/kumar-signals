// Which TIMEFRAME has actually made money, per symbol, across every engine.
//
// AI Edge ranks engines. This answers the other question: for Natural Gas and
// for Crude Oil separately, did the 15-minute calls make money, or the 1-hour,
// or the 4-hour? It pools every engine's closed trades by the timeframe in
// the trade-log key, on the same rupees-at-one-lot scale AI Edge uses, and
// never gives a verdict on fewer than MIN_SAMPLE trades.

import type { TradeLogEntry } from "./tradeLogCore";
import { ENGINES, flattenEdgeTrades, MIN_SAMPLE, type EdgeSymbol } from "./aiEdgeEngine";

export type TfVerdict = "profitable" | "flat" | "losing" | "insufficient";

const TF_LABEL: Record<string, string> = {
  "5": "5 min",
  "10": "10 min",
  "15": "15 min",
  "30": "30 min",
  "60": "1 hour",
  "240": "4 hour",
  "1D": "Daily",
  LIVE: "Live (Ai20-20)",
  multi: "Multi-timeframe pages",
};
const TF_ORDER = ["5", "10", "15", "30", "60", "240", "1D", "LIVE", "multi"];

/**
 * The timeframe a key's trades were called on: the last segment after the
 * symbol ("TWENTY20-NATURALGAS-15" -> "15", "CRUDEOIL-240" -> "240"). Pages
 * that blend several timeframes into one call ("BEST-CRUDEOIL") have none and
 * are grouped as "multi".
 */
export function timeframeForKey(key: string, symbol: EdgeSymbol): string {
  const i = key.indexOf(symbol);
  if (i < 0) return "multi";
  const segments = key.slice(i + symbol.length).split("-").filter(Boolean);
  const last = segments[segments.length - 1];
  return last && TF_LABEL[last] && last !== "multi" ? last : "multi";
}

export interface TfRow {
  tf: string;
  label: string;
  trades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  net: number; // ₹ at one lot
  avgWin: number | null;
  avgLoss: number | null; // positive number
  profitFactor: number | null; // gross wins / gross losses
  engines: { label: string; trades: number; net: number }[];
  verdict: TfVerdict;
}

export interface SymbolScorecard {
  symbol: EdgeSymbol;
  rows: TfRow[]; // best net first
  best: TfRow | null; // best row with a real verdict and positive net
  totalTrades: number;
}

function verdictFor(trades: number, net: number, pf: number | null): TfVerdict {
  if (trades < MIN_SAMPLE) return "insufficient";
  if (net > 0 && (pf === null || pf >= 1.2)) return "profitable";
  if (net < 0) return "losing";
  return "flat";
}

export function computeTimeframeScorecard(tradeLogs: Record<string, TradeLogEntry[]>, sinceMs: number | null = null): Record<EdgeSymbol, SymbolScorecard> {
  const trades = flattenEdgeTrades(tradeLogs, sinceMs);
  const label = new Map(ENGINES.map((e) => [e.id, e.label]));
  const out = {} as Record<EdgeSymbol, SymbolScorecard>;

  for (const symbol of ["NATURALGAS", "CRUDEOIL"] as const) {
    const groups = new Map<string, typeof trades>();
    for (const t of trades) {
      if (t.symbol !== symbol) continue;
      const tf = timeframeForKey(t.key, symbol);
      const g = groups.get(tf);
      if (g) g.push(t);
      else groups.set(tf, [t]);
    }

    const rows: TfRow[] = [];
    for (const [tf, list] of groups) {
      const winsList = list.filter((t) => t.rupees > 0);
      const lossList = list.filter((t) => t.rupees < 0);
      const grossWin = winsList.reduce((s, t) => s + t.rupees, 0);
      const grossLoss = -lossList.reduce((s, t) => s + t.rupees, 0);
      const net = grossWin - grossLoss;
      const pf = grossLoss > 0 ? grossWin / grossLoss : null;
      const byEngine = new Map<string, { trades: number; net: number }>();
      for (const t of list) {
        const e = byEngine.get(t.engineId) ?? { trades: 0, net: 0 };
        e.trades++;
        e.net += t.rupees;
        byEngine.set(t.engineId, e);
      }
      rows.push({
        tf,
        label: TF_LABEL[tf] ?? tf,
        trades: list.length,
        wins: winsList.length,
        losses: lossList.length,
        winRate: list.length ? (winsList.length / list.length) * 100 : null,
        net,
        avgWin: winsList.length ? grossWin / winsList.length : null,
        avgLoss: lossList.length ? grossLoss / lossList.length : null,
        profitFactor: pf,
        engines: [...byEngine].map(([id, v]) => ({ label: label.get(id) ?? id, ...v })).sort((a, b) => b.net - a.net),
        verdict: verdictFor(list.length, net, pf),
      });
    }
    rows.sort((a, b) => b.net - a.net || TF_ORDER.indexOf(a.tf) - TF_ORDER.indexOf(b.tf));
    const best = rows.find((r) => r.verdict === "profitable") ?? null;
    out[symbol] = { symbol, rows, best, totalTrades: rows.reduce((s, r) => s + r.trades, 0) };
  }
  return out;
}
