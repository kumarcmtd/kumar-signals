import type { SuperTrendLogEntry } from "../store/appStore";
import { effectiveStopForSetup } from "./superTrendProEngine";

// The exact live tick that closed a trade isn't stored (only the rule that
// closed it) -- exit price is that rule's own defined level: the full Target
// 5 level, the original stop, or the trailing floor the targetsHit already
// on the entry imply. Same honest-approximation reasoning tradeLogPnl.ts
// uses for the option-premium trade logs.
export function exitPriceForSuperTrend(e: SuperTrendLogEntry): number {
  if (e.status === "target5_hit") return e.targets[4];
  if (e.status === "sl_hit") return e.stop;
  if (e.status === "stopped_trailing") return effectiveStopForSetup({ entry: e.entry, targets: e.targets, stopLoss: e.stop }, e.targetsHit);
  return e.entry;
}

export interface SuperTrendRealized {
  entry: SuperTrendLogEntry;
  exitPrice: number;
  pnlPoints: number;
  targetsHitCount: number;
}

export function flattenClosedSuperTrend(logs: Record<string, SuperTrendLogEntry[]>): SuperTrendRealized[] {
  const out: SuperTrendRealized[] = [];
  for (const entries of Object.values(logs)) {
    for (const e of entries) {
      if (!e.closed) continue;
      const exitPrice = exitPriceForSuperTrend(e);
      const sign = e.direction === "bullish" ? 1 : -1;
      out.push({ entry: e, exitPrice, pnlPoints: Number((sign * (exitPrice - e.entry)).toFixed(4)), targetsHitCount: e.targetsHit.filter(Boolean).length });
    }
  }
  return out.sort((a, b) => (a.entry.closedAt ?? 0) - (b.entry.closedAt ?? 0));
}

export interface SuperTrendPerformance {
  totalClosed: number;
  wins: number;
  losses: number;
  winRatePct: number | null;
  lossRatePct: number | null;
  targetHitPct: number | null;
  stopLossPct: number | null;
  avgConfidence: number | null;
  avgHoldingMinutes: number | null;
  avgRR: number | null;
  profitFactor: number | null;
  todayTotal: number;
  todayWins: number;
  todayLosses: number;
  todayAccuracyPct: number | null;
}

function sessionDayKeyIST(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}

export function computeSuperTrendPerformance(realized: SuperTrendRealized[]): SuperTrendPerformance {
  const wins = realized.filter((r) => r.pnlPoints > 0);
  const losses = realized.filter((r) => r.pnlPoints < 0);
  const decided = wins.length + losses.length;

  const targetHits = realized.filter((r) => r.entry.status === "target5_hit" || r.targetsHitCount > 0);
  const stopLosses = realized.filter((r) => r.entry.status === "sl_hit");

  const grossWin = wins.reduce((s, r) => s + r.pnlPoints, 0);
  const grossLoss = Math.abs(losses.reduce((s, r) => s + r.pnlPoints, 0));

  const holdingDurations = realized.filter((r) => r.entry.closedAt !== null).map((r) => (r.entry.closedAt! - r.entry.openedAt) / 60000);
  const rrs = realized.map((r) => {
    const risk = Math.abs(r.entry.entry - r.entry.stop);
    return risk > 0 ? r.pnlPoints / risk : null;
  }).filter((v): v is number => v !== null);

  const todayKey = sessionDayKeyIST(Date.now());
  const todays = realized.filter((r) => r.entry.closedAt !== null && sessionDayKeyIST(r.entry.closedAt) === todayKey);
  const todayWins = todays.filter((r) => r.pnlPoints > 0).length;
  const todayLosses = todays.filter((r) => r.pnlPoints < 0).length;
  const todayDecided = todayWins + todayLosses;

  return {
    totalClosed: realized.length,
    wins: wins.length,
    losses: losses.length,
    winRatePct: decided > 0 ? Math.round((wins.length / decided) * 100) : null,
    lossRatePct: decided > 0 ? Math.round((losses.length / decided) * 100) : null,
    targetHitPct: realized.length ? Math.round((targetHits.length / realized.length) * 100) : null,
    stopLossPct: realized.length ? Math.round((stopLosses.length / realized.length) * 100) : null,
    avgConfidence: realized.length ? Math.round(realized.reduce((s, r) => s + r.entry.confidence, 0) / realized.length) : null,
    avgHoldingMinutes: holdingDurations.length ? Math.round(holdingDurations.reduce((s, v) => s + v, 0) / holdingDurations.length) : null,
    avgRR: rrs.length ? Number((rrs.reduce((s, v) => s + v, 0) / rrs.length).toFixed(2)) : null,
    profitFactor: grossLoss > 0 ? Number((grossWin / grossLoss).toFixed(2)) : null,
    todayTotal: todays.length,
    todayWins,
    todayLosses,
    todayAccuracyPct: todayDecided > 0 ? Math.round((todayWins / todayDecided) * 100) : null,
  };
}
