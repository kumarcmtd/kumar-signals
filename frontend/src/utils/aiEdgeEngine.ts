// AI Edge -- which of this app's engines actually make money, in rupees.
//
// Every page in this app already scores itself: Best Call reads keys starting
// "BEST-", AI-Shoot reads "SHOOT-", Level Cross reads "LEVELCROSS-", and so on
// down twelve pages. Nothing has ever compared them to each other, so with
// this many engines firing there was no way to tell which ones were earning
// and which were quietly giving it back.
//
// Two things make this different from the per-page stats that already exist:
//
//  1. RUPEES, NOT POINTS. computePerformanceStats sums premium points, but a
//     point is not a fixed amount of money here -- Crude's lot is 100 and
//     Natural Gas's is 1250, so one NG point is worth 12.5 Crude points.
//     Summing points across both symbols silently overweights NG by that
//     factor; converting each trade through its own lot size is the only way
//     a cross-engine comparison means anything.
//
//  2. LOSS SIZE, NOT JUST LOSS COUNT. The per-page stats rank by win rate
//     (targets hit vs stops hit). An engine can win 70% of the time and still
//     lose money if its losses run bigger than its wins, and win rate cannot
//     see that. Profit factor and expectancy can.
//
// IMPORTANT -- what these numbers are: this reads the app's OWN trade logs,
// which record each call at its signalled entry and close it at the observed
// target/stop. They are not broker fills. They exclude brokerage and taxes,
// and they assume every call was taken at exactly one lot. So this measures
// ENGINE QUALITY, not the trader's realised P&L, and it will not reconcile
// to an Upstox statement. Nothing here is estimated or filled in -- an engine
// with no closed trades reports exactly that.

import type { TradeLogEntry } from "../store/appStore";
import { exitPriceFor } from "./tradeLogPnl";

export type EdgeSymbol = "CRUDEOIL" | "NATURALGAS";

export const LOT_SIZE: Record<EdgeSymbol, number> = { CRUDEOIL: 100, NATURALGAS: 1250 };

export type EdgeVerdict = "trust" | "watch" | "drop" | "insufficient";

// Below this many closed trades an engine gets no verdict at all. Judging a
// page on three trades is reading noise, and a confident-looking "DROP" on a
// tiny sample would be the most damaging thing this page could do.
export const MIN_SAMPLE = 8;

export interface EngineDef {
  id: string;
  label: string;
  /** Trade-log key prefix. null = the unprefixed "<SYMBOL>-<tf>" keys. */
  prefix: string | null;
  route: string;
}

// Mirrors the keyPrefix each page passes to useTradeLog. AI-Test V2, AI-Test
// Pro and Trade Report all call it with the default prefix (the bare symbol),
// so they genuinely share one log and are reported as one engine rather than
// pretending to be three.
export const ENGINES: EngineDef[] = [
  { id: "best", label: "Best Call", prefix: "BEST", route: "/best-call" },
  { id: "shoot", label: "AI-Shoot", prefix: "SHOOT", route: "/" },
  { id: "twenty20", label: "Ai20-20", prefix: "TWENTY20", route: "/ai-20-20" },
  { id: "levelcross", label: "Level Cross", prefix: "LEVELCROSS", route: "/level-cross-scan" },
  { id: "aiup", label: "AI-Up", prefix: "AIUP", route: "/ai-up" },
  { id: "aiown", label: "AI Own", prefix: "AIOWN", route: "/ai-own" },
  { id: "airisk", label: "AI-Risk", prefix: "AIRISK", route: "/ai-risk" },
  { id: "gatece", label: "CE Buy", prefix: "GATECE", route: "/ce-buy-signals" },
  { id: "gatepe", label: "PE Buy", prefix: "GATEPE", route: "/pe-buy-signals" },
  { id: "kumarai", label: "Kumar AI", prefix: "KUMARAI", route: "/kumar-ai" },
  { id: "elite", label: "AI Elite", prefix: "ELITE", route: "/ai-elite" },
  { id: "pattern", label: "AI-Learn", prefix: "PATTERN", route: "/ai-learn" },
  { id: "kimi", label: "Kimi AI", prefix: "KIMI", route: "/kimi-ai-trade" },
  { id: "aitest", label: "AI-Test (V2/Pro)", prefix: null, route: "/ai-test-v2" },
];

export function engineForKey(key: string): EngineDef | null {
  for (const e of ENGINES) {
    if (e.prefix && key.startsWith(`${e.prefix}-`)) return e;
  }
  // No prefix matched. The unprefixed engine's keys are "<SYMBOL>-<tf>", so
  // only claim the key if it actually starts with a symbol -- an unknown
  // future prefix must not be silently absorbed into AI-Test's numbers.
  if (key.startsWith("CRUDEOIL-") || key.startsWith("NATURALGAS-")) return ENGINES.find((e) => e.prefix === null) ?? null;
  return null;
}

// Every page's key contains the plain symbol somewhere, and the two names
// never collide as substrings of each other -- the same trick useOpenStrikesFor
// relies on. Safer than positional parsing, which breaks on prefixed keys.
export function symbolForKey(key: string): EdgeSymbol | null {
  if (key.includes("CRUDEOIL")) return "CRUDEOIL";
  if (key.includes("NATURALGAS")) return "NATURALGAS";
  return null;
}

/** Rupee P&L for one closed entry at exactly one lot. */
export function rupeesFor(entry: TradeLogEntry, symbol: EdgeSymbol): number {
  return Math.round((exitPriceFor(entry) - entry.entry) * LOT_SIZE[symbol]);
}

export interface EdgeTrade {
  key: string;
  engineId: string;
  symbol: EdgeSymbol;
  rupees: number;
  closedAt: number;
  entry: TradeLogEntry;
}

export function flattenEdgeTrades(tradeLogs: Record<string, TradeLogEntry[]>, sinceMs: number | null = null): EdgeTrade[] {
  const out: EdgeTrade[] = [];
  for (const [key, entries] of Object.entries(tradeLogs)) {
    const engine = engineForKey(key);
    const symbol = symbolForKey(key);
    if (!engine || !symbol) continue;
    for (const e of entries) {
      if (!e.closed) continue;
      const closedAt = e.closedAt ?? e.openedAt;
      if (sinceMs !== null && closedAt < sinceMs) continue;
      out.push({ key, engineId: engine.id, symbol, rupees: rupeesFor(e, symbol), closedAt, entry: e });
    }
  }
  return out.sort((a, b) => a.closedAt - b.closedAt);
}

export interface EngineEdge {
  id: string;
  label: string;
  route: string;
  trades: number;
  wins: number;
  losses: number;
  breakevens: number;
  winRatePct: number | null;
  grossWinRs: number;
  grossLossRs: number;
  netRs: number;
  avgWinRs: number | null;
  avgLossRs: number | null;
  /** gross win / gross loss. null when there are no losses to divide by. */
  profitFactor: number | null;
  expectancyRs: number | null;
  maxDrawdownRs: number;
  bestRs: number | null;
  worstRs: number | null;
  verdict: EdgeVerdict;
  verdictReason: string;
}

function statsFor(def: EngineDef, trades: EdgeTrade[]): EngineEdge {
  const wins = trades.filter((t) => t.rupees > 0);
  const losses = trades.filter((t) => t.rupees < 0);
  const breakevens = trades.filter((t) => t.rupees === 0);

  const grossWinRs = wins.reduce((s, t) => s + t.rupees, 0);
  const grossLossRs = Math.abs(losses.reduce((s, t) => s + t.rupees, 0));
  const netRs = grossWinRs - grossLossRs;
  const decided = wins.length + losses.length;

  const avgWinRs = wins.length ? Math.round(grossWinRs / wins.length) : null;
  const avgLossRs = losses.length ? Math.round(grossLossRs / losses.length) : null;
  const profitFactor = grossLossRs > 0 ? Number((grossWinRs / grossLossRs).toFixed(2)) : null;
  const expectancyRs = trades.length ? Math.round(netRs / trades.length) : null;
  const winRatePct = decided > 0 ? Math.round((wins.length / decided) * 100) : null;

  let running = 0;
  let peak = 0;
  let maxDrawdownRs = 0;
  for (const t of trades) {
    running += t.rupees;
    peak = Math.max(peak, running);
    maxDrawdownRs = Math.max(maxDrawdownRs, peak - running);
  }

  let verdict: EdgeVerdict;
  let verdictReason: string;
  if (trades.length === 0) {
    verdict = "insufficient";
    verdictReason = "No closed trades yet.";
  } else if (trades.length < MIN_SAMPLE) {
    verdict = "insufficient";
    verdictReason = `Only ${trades.length} closed ${trades.length === 1 ? "trade" : "trades"} — too few to judge (needs ${MIN_SAMPLE}).`;
  } else if (expectancyRs !== null && expectancyRs <= 0) {
    verdict = "drop";
    verdictReason = `Loses about ₹${Math.abs(expectancyRs).toLocaleString("en-IN")} per trade on average.`;
  } else if (profitFactor === null) {
    // Wins with no losses at all. Real, but worth naming rather than printing
    // an infinite profit factor.
    verdict = "trust";
    verdictReason = "No losing trades recorded yet.";
  } else if (profitFactor >= 2) {
    verdict = "trust";
    verdictReason = `Makes ₹${profitFactor.toFixed(2)} for every ₹1 it loses.`;
  } else {
    verdict = "watch";
    verdictReason = `Profitable, but only ₹${profitFactor.toFixed(2)} earned per ₹1 lost — thin margin.`;
  }

  return {
    id: def.id, label: def.label, route: def.route,
    trades: trades.length, wins: wins.length, losses: losses.length, breakevens: breakevens.length,
    winRatePct, grossWinRs, grossLossRs, netRs, avgWinRs, avgLossRs, profitFactor, expectancyRs, maxDrawdownRs,
    bestRs: trades.length ? Math.max(...trades.map((t) => t.rupees)) : null,
    worstRs: trades.length ? Math.min(...trades.map((t) => t.rupees)) : null,
    verdict, verdictReason,
  };
}

export function computeEngineEdges(tradeLogs: Record<string, TradeLogEntry[]>, sinceMs: number | null = null): EngineEdge[] {
  const all = flattenEdgeTrades(tradeLogs, sinceMs);
  const byEngine = new Map<string, EdgeTrade[]>();
  for (const t of all) {
    const list = byEngine.get(t.engineId);
    if (list) list.push(t);
    else byEngine.set(t.engineId, [t]);
  }
  return ENGINES.map((def) => statsFor(def, byEngine.get(def.id) ?? []))
    // Engines that have never produced a closed trade sink to the bottom
    // rather than cluttering the top with empty rows; everything else ranks
    // by the rupees it actually contributed.
    .sort((a, b) => {
      if (a.trades === 0 && b.trades === 0) return a.label.localeCompare(b.label);
      if (a.trades === 0) return 1;
      if (b.trades === 0) return -1;
      return b.netRs - a.netRs;
    });
}

export interface EdgeTotals {
  trades: number;
  netRs: number;
  profitFactor: number | null;
  expectancyRs: number | null;
  winRatePct: number | null;
  /** Engines rated "drop", and what they cost in total. */
  droppedCount: number;
  droppedCostRs: number;
  /** Net if every "drop"-rated engine had simply not been traded. */
  netWithoutDroppedRs: number;
  bestEngine: EngineEdge | null;
  worstEngine: EngineEdge | null;
}

export function computeEdgeTotals(edges: EngineEdge[]): EdgeTotals {
  const rated = edges.filter((e) => e.trades > 0);
  const trades = rated.reduce((s, e) => s + e.trades, 0);
  const grossWin = rated.reduce((s, e) => s + e.grossWinRs, 0);
  const grossLoss = rated.reduce((s, e) => s + e.grossLossRs, 0);
  const wins = rated.reduce((s, e) => s + e.wins, 0);
  const losses = rated.reduce((s, e) => s + e.losses, 0);
  const netRs = grossWin - grossLoss;

  const dropped = edges.filter((e) => e.verdict === "drop");
  const droppedCostRs = dropped.reduce((s, e) => s + e.netRs, 0);

  const profitable = rated.filter((e) => e.netRs > 0);
  const losing = rated.filter((e) => e.netRs < 0);

  return {
    trades,
    netRs,
    profitFactor: grossLoss > 0 ? Number((grossWin / grossLoss).toFixed(2)) : null,
    expectancyRs: trades > 0 ? Math.round(netRs / trades) : null,
    winRatePct: wins + losses > 0 ? Math.round((wins / (wins + losses)) * 100) : null,
    droppedCount: dropped.length,
    droppedCostRs,
    netWithoutDroppedRs: netRs - droppedCostRs,
    bestEngine: profitable.length ? profitable.reduce((b, e) => (e.netRs > b.netRs ? e : b)) : null,
    worstEngine: losing.length ? losing.reduce((w, e) => (e.netRs < w.netRs ? e : w)) : null,
  };
}
