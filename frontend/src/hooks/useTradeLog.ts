import { useEffect } from "react";
import { useAppStore, type TradeLogEntry } from "../store/appStore";
import type { TimeframeAnalysis, Decision6 } from "../utils/timeframeEngine";
import type { OptionsAnalytics } from "../types";

const MAX_HISTORY = 10;

interface ProjLike {
  strike: number;
  optSide: "CE" | "PE";
  entry: number;
  targets: [number, number, number];
  stop: number;
}

export function liveLtpFor(options: OptionsAnalytics | undefined, strike: number, optSide: "CE" | "PE"): number | null {
  if (!options || options.error) return null;
  const row = options.rows.find((r) => r.strike === strike);
  if (!row) return null;
  const leg = optSide === "CE" ? row.call : row.put;
  return leg.ltp;
}

function makeId(proj: ProjLike, now: number): string {
  return `${proj.strike}-${proj.optSide}-${now}`;
}

function openNewEntry(proj: ProjLike, now: number): TradeLogEntry {
  return {
    id: makeId(proj, now),
    strike: proj.strike,
    optSide: proj.optSide,
    entry: proj.entry,
    targets: proj.targets,
    stop: proj.stop,
    targetsHit: [false, false, false],
    status: "running",
    closed: false,
    openedAt: now,
    closedAt: null,
  };
}

// Advances one open entry against a fresh live premium. Target ticks are
// permanent once touched. Close rules, in order the user asked for them:
// hit stop before any target -> SL Hit; after Target 1, the effective stop
// trails up to breakeven (entry); after Target 2, it trails to the Target 1
// level; Target 3 fully closes the trade regardless of what happens after.
// Returns the SAME object reference when nothing actually changed, so
// callers can skip a write.
export function advanceOpenEntry(entry: TradeLogEntry, liveLtp: number | null, now: number): TradeLogEntry {
  if (entry.closed || liveLtp === null) return entry;

  const targetsHit: [boolean, boolean, boolean] = [
    entry.targetsHit[0] || liveLtp >= entry.targets[0],
    entry.targetsHit[1] || liveLtp >= entry.targets[1],
    entry.targetsHit[2] || liveLtp >= entry.targets[2],
  ];
  const targetsChanged = targetsHit.some((v, i) => v !== entry.targetsHit[i]);

  if (targetsHit[2]) {
    if (entry.status === "target3_hit") return entry;
    return { ...entry, targetsHit, status: "target3_hit", closed: true, closedAt: entry.closedAt ?? now };
  }

  const effectiveStop = targetsHit[1] ? entry.targets[0] : targetsHit[0] ? entry.entry : entry.stop;
  if (liveLtp <= effectiveStop) {
    const status: TradeLogEntry["status"] = targetsHit[1] ? "stopped_after_t1" : targetsHit[0] ? "stopped_breakeven" : "sl_hit";
    return { ...entry, targetsHit, status, closed: true, closedAt: now };
  }

  if (!targetsChanged) return entry;
  return { ...entry, targetsHit, status: "running" };
}

// Pure reducer over one timeframe's trade log: advances the currently open
// entry (if any) against the live premium, or opens a fresh entry once the
// previous one has closed and the engine is newly actionable again. Returns
// the SAME array reference when nothing changed, so the caller can skip a
// store write (and avoid re-render loops).
export function advanceTradeLog(
  history: TradeLogEntry[],
  ctx: { decision: Decision6; insufficient: string | null | undefined; optSide: "CE" | "PE" | null | undefined; proj: ProjLike | null; liveLtpForOpen: number | null },
  now: number,
  maxHistory = MAX_HISTORY
): TradeLogEntry[] {
  const last = history[history.length - 1];
  const open = last && !last.closed ? last : undefined;

  if (open) {
    const advanced = advanceOpenEntry(open, ctx.liveLtpForOpen, now);
    if (advanced === open) return history;
    const next = [...history.slice(0, -1), advanced];
    return next.length > maxHistory ? next.slice(next.length - maxHistory) : next;
  }

  if (!ctx.insufficient && ctx.decision !== "WAIT" && ctx.optSide && ctx.proj) {
    const created = openNewEntry({ strike: ctx.proj.strike, optSide: ctx.optSide, entry: ctx.proj.entry, targets: ctx.proj.targets, stop: ctx.proj.stop }, now);
    const next = [...history, created];
    return next.length > maxHistory ? next.slice(next.length - maxHistory) : next;
  }

  return history;
}

export function useTradeLog(symbol: string, analyses: TimeframeAnalysis[], projections: (ProjLike | null)[], options: OptionsAnalytics | undefined) {
  const tradeLogs = useAppStore((s) => s.tradeLogs);
  const setTradeLog = useAppStore((s) => s.setTradeLog);

  useEffect(() => {
    const now = Date.now();
    analyses.forEach((a, i) => {
      const key = `${symbol}-${a.tf}`;
      const history = tradeLogs[key] ?? [];
      const last = history[history.length - 1];
      const open = last && !last.closed ? last : undefined;
      const liveLtpForOpen = open ? liveLtpFor(options, open.strike, open.optSide) : null;
      const proj = projections[i];
      const next = advanceTradeLog(history, { decision: a.decision, insufficient: a.insufficient, optSide: a.optSide, proj, liveLtpForOpen }, now);
      if (next !== history) setTradeLog(key, next);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, analyses, projections, options]);

  return tradeLogs;
}
