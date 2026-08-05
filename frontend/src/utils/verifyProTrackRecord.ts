import type { TradeLogEntry, VerifyProSnapshot } from "../store/appStore";
import { flattenClosedTrades, computePerformanceStats, type PerformanceStats } from "./tradeLogPnl";

// Track-only self-learning: reuses the SAME win/loss/RR/drawdown math Trade
// Report already runs (flattenClosedTrades + computePerformanceStats), then
// joins each closed trade against the VerifyProSnapshot frozen for it at
// entry time to answer "when THIS specific check passed, how often did we
// actually win?" -- a report card, not a feedback loop. Nothing here ever
// changes a weight or a score; it only informs what a human reading this
// page decides to trust more or less over time.

export interface CheckAccuracy {
  key: string;
  passWinRatePct: number | null;
  passSamples: number;
  failWinRatePct: number | null;
  failSamples: number;
}

export interface VerifyProTrackRecord {
  performance: PerformanceStats;
  checkAccuracy: CheckAccuracy[];
  totalSnapshots: number;
}

const MIN_SAMPLES_TO_SHOW = 3;

export function computeVerifyProTrackRecord(trackingKey: string, tradeLogs: Record<string, TradeLogEntry[]>, snapshots: Record<string, VerifyProSnapshot>): VerifyProTrackRecord {
  const closed = flattenClosedTrades({ [trackingKey]: tradeLogs[trackingKey] ?? [] });
  const performance = computePerformanceStats(closed);

  const tally = new Map<string, { passWin: number; passTotal: number; failWin: number; failTotal: number }>();
  let totalSnapshots = 0;
  for (const r of closed) {
    const snap = snapshots[r.entry.id];
    if (!snap) continue;
    totalSnapshots++;
    const won = r.pnlPoints > 0;
    for (const [key, tier] of Object.entries(snap.checks)) {
      const t = tally.get(key) ?? { passWin: 0, passTotal: 0, failWin: 0, failTotal: 0 };
      if (tier === "pass") {
        t.passTotal += 1;
        if (won) t.passWin += 1;
      } else if (tier === "fail") {
        t.failTotal += 1;
        if (won) t.failWin += 1;
      }
      tally.set(key, t);
    }
  }

  const checkAccuracy: CheckAccuracy[] = Array.from(tally.entries())
    .map(([key, t]) => ({
      key,
      passWinRatePct: t.passTotal >= MIN_SAMPLES_TO_SHOW ? Math.round((t.passWin / t.passTotal) * 100) : null,
      passSamples: t.passTotal,
      failWinRatePct: t.failTotal >= MIN_SAMPLES_TO_SHOW ? Math.round((t.failWin / t.failTotal) * 100) : null,
      failSamples: t.failTotal,
    }))
    .filter((c) => c.passSamples > 0 || c.failSamples > 0)
    .sort((a, b) => b.passSamples + b.failSamples - (a.passSamples + a.failSamples));

  return { performance, checkAccuracy, totalSnapshots };
}
