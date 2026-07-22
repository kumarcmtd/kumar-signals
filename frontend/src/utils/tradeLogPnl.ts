import type { TradeLogEntry } from "../store/appStore";
import { sessionDayKey } from "./tradeLogStats";

export interface RealizedTrade {
  symbol: string;
  tf: string;
  entry: TradeLogEntry;
  exitPrice: number;
  pnlPoints: number;
}

// The exact live tick that closed a trade isn't stored on the entry itself
// (only the rule that closed it), so the exit price used here is the RULE's
// own defined level -- original stop for sl_hit, entry price (breakeven) for
// stopped_breakeven, the Target 1 trailing level for stopped_after_t1, and
// the full Target 3 level for target3_hit. This is an honest approximation
// of the real exit, not an invented number: it is exactly the level our own
// close logic acted on.
function exitPriceFor(e: TradeLogEntry): number {
  switch (e.status) {
    case "target3_hit":
      return e.targets[2];
    case "stopped_after_t1":
      return e.targets[0];
    case "stopped_breakeven":
      return e.entry;
    case "sl_hit":
      return e.stop;
    default:
      return e.entry;
  }
}

export function flattenClosedTrades(tradeLogs: Record<string, TradeLogEntry[]>): RealizedTrade[] {
  const out: RealizedTrade[] = [];
  for (const [key, entries] of Object.entries(tradeLogs)) {
    const dash = key.lastIndexOf("-");
    const symbol = key.slice(0, dash);
    const tf = key.slice(dash + 1);
    for (const e of entries) {
      if (!e.closed) continue;
      const exitPrice = exitPriceFor(e);
      out.push({ symbol, tf, entry: e, exitPrice, pnlPoints: Number((exitPrice - e.entry).toFixed(2)) });
    }
  }
  return out.sort((a, b) => (a.entry.closedAt ?? 0) - (b.entry.closedAt ?? 0));
}

export interface PerformanceStats {
  totalClosed: number;
  wins: number;
  losses: number;
  breakevens: number;
  accuracyPct: number | null;
  netPoints: number;
  avgWin: number | null;
  avgLoss: number | null;
  profitFactor: number | null;
  expectancy: number | null;
  maxDrawdown: number;
  bestTrade: RealizedTrade | null;
  worstTrade: RealizedTrade | null;
  currentStreak: { type: "win" | "loss" | "none"; count: number };
  avgHoldingMinutes: number | null;
  todayClosed: number;
  todayWins: number;
  todayLosses: number;
}

export function computePerformanceStats(realized: RealizedTrade[]): PerformanceStats {
  const wins = realized.filter((r) => r.pnlPoints > 0);
  const losses = realized.filter((r) => r.pnlPoints < 0);
  const breakevens = realized.filter((r) => r.pnlPoints === 0);

  const netPoints = Number(realized.reduce((s, r) => s + r.pnlPoints, 0).toFixed(2));
  const avgWin = wins.length ? Number((wins.reduce((s, r) => s + r.pnlPoints, 0) / wins.length).toFixed(2)) : null;
  const avgLoss = losses.length ? Number((Math.abs(losses.reduce((s, r) => s + r.pnlPoints, 0)) / losses.length).toFixed(2)) : null;
  const grossWin = wins.reduce((s, r) => s + r.pnlPoints, 0);
  const grossLoss = Math.abs(losses.reduce((s, r) => s + r.pnlPoints, 0));
  const profitFactor = grossLoss > 0 ? Number((grossWin / grossLoss).toFixed(2)) : null;
  const decided = wins.length + losses.length;
  const accuracyPct = decided > 0 ? Math.round((wins.length / decided) * 100) : null;
  const expectancy = realized.length ? Number((netPoints / realized.length).toFixed(2)) : null;

  let peak = 0;
  let running = 0;
  let maxDrawdown = 0;
  for (const r of realized) {
    running += r.pnlPoints;
    peak = Math.max(peak, running);
    maxDrawdown = Math.max(maxDrawdown, peak - running);
  }

  const bestTrade = realized.length ? realized.reduce((b, r) => (r.pnlPoints > b.pnlPoints ? r : b)) : null;
  const worstTrade = realized.length ? realized.reduce((w, r) => (r.pnlPoints < w.pnlPoints ? r : w)) : null;

  let currentStreak: PerformanceStats["currentStreak"] = { type: "none", count: 0 };
  for (let i = realized.length - 1; i >= 0; i--) {
    const r = realized[i];
    const type: "win" | "loss" | "none" = r.pnlPoints > 0 ? "win" : r.pnlPoints < 0 ? "loss" : "none";
    if (i === realized.length - 1) {
      if (type === "none") break;
      currentStreak = { type, count: 1 };
    } else if (type === currentStreak.type) {
      currentStreak.count += 1;
    } else {
      break;
    }
  }

  const holdingDurations = realized.filter((r) => r.entry.closedAt !== null).map((r) => (r.entry.closedAt! - r.entry.openedAt) / 60000);
  const avgHoldingMinutes = holdingDurations.length ? Math.round(holdingDurations.reduce((s, v) => s + v, 0) / holdingDurations.length) : null;

  const now = Date.now();
  const todayKey = sessionDayKey(now);
  const todaysTrades = realized.filter((r) => r.entry.closedAt !== null && sessionDayKey(r.entry.closedAt) === todayKey);

  return {
    totalClosed: realized.length,
    wins: wins.length,
    losses: losses.length,
    breakevens: breakevens.length,
    accuracyPct,
    netPoints,
    avgWin,
    avgLoss,
    profitFactor,
    expectancy,
    maxDrawdown: Number(maxDrawdown.toFixed(2)),
    bestTrade,
    worstTrade,
    currentStreak,
    avgHoldingMinutes,
    todayClosed: todaysTrades.length,
    todayWins: todaysTrades.filter((r) => r.pnlPoints > 0).length,
    todayLosses: todaysTrades.filter((r) => r.pnlPoints < 0).length,
  };
}
