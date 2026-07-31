import { useEffect } from "react";
import { useAppStore, type TradeLogEntry } from "../store/appStore";
import type { Decision6 } from "../utils/timeframeEngine";
import type { OptionsAnalytics } from "../types";

// Every page's own trade log is a rolling window capped at this many
// entries per "<prefix>-<symbol>[-<tf>]" key. This used to be 10, which
// sounds generous until you notice there are ~50 such keys across the app
// and some engines (Directional Gate, AI-Test V2's per-timeframe scoring)
// fire many times a day -- a single busy session could roll a whole
// morning's calls off the end before anyone got to review them. Raised
// well past what any real trading day produces per key, so "study today's
// results" actually has today's results to look at.
export const MAX_HISTORY = 200;

interface ProjLike {
  strike: number;
  optSide: "CE" | "PE";
  entry: number;
  targets: [number, number, number];
  stop: number;
}

// The only fields useTradeLog actually reads off each timeframe's analysis.
// TimeframeAnalysis already has all of these, so every existing caller
// (which passes TimeframeAnalysis[]) is unaffected; this just lets a
// differently-shaped engine (e.g. the CE/PE directional gate, which isn't a
// Decision6 score at all) feed its own lightweight per-timeframe result in
// without needing to fabricate an entire TimeframeAnalysis object.
interface AnalysisLike {
  tf: string;
  decision: Decision6;
  insufficient?: string | null;
  optSide?: "CE" | "PE" | null;
}

// The stop this trade will ACTUALLY exit on next, as opposed to entry.stop
// (the original level, frozen forever at open time). advanceOpenEntry
// already trails this internally -- once Target 1 is touched, a pullback to
// breakeven closes the trade neutral rather than waiting for the original,
// much deeper stop; once Target 2 is touched, the floor rises again to
// Target 1. Every card/row that shows "SL ₹..." should show THIS number, not
// entry.stop, or it looks like the trade is still risking the full original
// distance long after the real risk has already been locked down to zero
// (or better).
export function effectiveStopFor(entry: TradeLogEntry): number {
  return entry.targetsHit[1] ? entry.targets[0] : entry.targetsHit[0] ? entry.entry : entry.stop;
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

export function openNewEntry(proj: ProjLike, now: number, meta?: TradeLogEntry["meta"], decision?: Decision6): TradeLogEntry {
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
    meta,
    decision,
    highWaterMark: proj.entry,
  };
}

// Advances one open entry against a fresh live premium. Target HITS are
// permanent once touched (drives the trailing stop/closure below). Target
// TOUCHES keep counting on every fresh crossing -- a rising edge from below
// a target back up through it, detected against targetAboveState -- so a
// price that hits a target, pulls back, and later hits it again shows 2
// touches, not just a flag stuck at 1. Close rules, in order the user asked
// for them: hit stop before any target -> SL Hit; after Target 1, the
// effective stop trails up to breakeven (entry); after Target 2, it trails
// to the Target 1 level; Target 3 fully closes the trade regardless of what
// happens after. Returns the SAME object reference when nothing actually
// changed, so callers can skip a write.
export function advanceOpenEntry(entry: TradeLogEntry, liveLtp: number | null, now: number): TradeLogEntry {
  if (entry.closed || liveLtp === null) return entry;

  const priorAbove = entry.targetAboveState ?? entry.targetsHit;
  const aboveNow: [boolean, boolean, boolean] = [liveLtp >= entry.targets[0], liveLtp >= entry.targets[1], liveLtp >= entry.targets[2]];
  const stateChanged = aboveNow.some((v, i) => v !== priorAbove[i]);

  const priorTouches = entry.targetTouches ?? [0, 0, 0];
  const targetTouches = priorTouches.map((t, i) => t + (aboveNow[i] && !priorAbove[i] ? 1 : 0)) as [number, number, number];

  const targetsHit: [boolean, boolean, boolean] = [
    entry.targetsHit[0] || aboveNow[0],
    entry.targetsHit[1] || aboveNow[1],
    entry.targetsHit[2] || aboveNow[2],
  ];

  const priorHigh = entry.highWaterMark ?? entry.entry;
  const highWaterMark = Math.max(priorHigh, liveLtp);
  const highChanged = highWaterMark !== priorHigh;

  if (targetsHit[2]) {
    if (entry.status === "target3_hit") return entry;
    return { ...entry, targetsHit, targetTouches, targetAboveState: aboveNow, highWaterMark, status: "target3_hit", closed: true, closedAt: entry.closedAt ?? now };
  }

  const effectiveStop = targetsHit[1] ? entry.targets[0] : targetsHit[0] ? entry.entry : entry.stop;
  if (liveLtp <= effectiveStop) {
    const status: TradeLogEntry["status"] = targetsHit[1] ? "stopped_after_t1" : targetsHit[0] ? "stopped_breakeven" : "sl_hit";
    return { ...entry, targetsHit, targetTouches, targetAboveState: aboveNow, highWaterMark, status, closed: true, closedAt: now };
  }

  if (!stateChanged && !highChanged) return entry;
  return { ...entry, targetsHit, targetTouches, targetAboveState: aboveNow, highWaterMark, status: "running" };
}

// Pure reducer over one timeframe's trade log: advances the currently open
// entry (if any) against the live premium, or opens a fresh entry once the
// previous one has closed and the engine is newly actionable again. Returns
// the SAME array reference when nothing changed, so the caller can skip a
// store write (and avoid re-render loops).
export function advanceTradeLog(
  history: TradeLogEntry[],
  ctx: {
    decision: Decision6;
    insufficient: string | null | undefined;
    optSide: "CE" | "PE" | null | undefined;
    proj: ProjLike | null;
    liveLtpForOpen: number | null;
    meta?: TradeLogEntry["meta"];
  },
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
    const created = openNewEntry({ strike: ctx.proj.strike, optSide: ctx.optSide, entry: ctx.proj.entry, targets: ctx.proj.targets, stop: ctx.proj.stop }, now, ctx.meta, ctx.decision);
    const next = [...history, created];
    return next.length > maxHistory ? next.slice(next.length - maxHistory) : next;
  }

  return history;
}

// keyPrefix defaults to symbol (unchanged behavior for every existing
// caller). Pass a distinct prefix to track a separate page's own history
// under exclusive keys in the SAME shared tradeLogs dictionary without
// colliding with another page's entries for the same symbol+timeframe --
// e.g. Kumar AI uses "KUMARAI-<symbol>" so its background tracking never
// mixes with AI-Test V2/Pro's own logs.
export function useTradeLog(
  symbol: string,
  analyses: AnalysisLike[],
  projections: (ProjLike | null)[],
  options: OptionsAnalytics | undefined,
  keyPrefix: string = symbol
) {
  const tradeLogs = useAppStore((s) => s.tradeLogs);
  const setTradeLog = useAppStore((s) => s.setTradeLog);

  useEffect(() => {
    const now = Date.now();
    analyses.forEach((a, i) => {
      const key = `${keyPrefix}-${a.tf}`;
      const history = tradeLogs[key] ?? [];
      const last = history[history.length - 1];
      const open = last && !last.closed ? last : undefined;
      const liveLtpForOpen = open ? liveLtpFor(options, open.strike, open.optSide) : null;
      const proj = projections[i];
      const next = advanceTradeLog(history, { decision: a.decision, insufficient: a.insufficient, optSide: a.optSide, proj, liveLtpForOpen }, now);
      if (next !== history) setTradeLog(key, next);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyPrefix, analyses, projections, options]);

  return tradeLogs;
}

// Same tracking logic as useTradeLog, but for a single named line rather
// than one per timeframe -- used by AI Elite, which only ever tracks the
// one candidate that clears its stricter bar (or nothing at all). Stored
// under a distinct "ELITE-<symbol>" key in the SAME shared tradeLogs
// dictionary so it can't collide with any real "<symbol>-<tf>" key.
export function useEliteTradeLog(
  trackingKey: string | null,
  decision: Decision6 | null,
  optSide: "CE" | "PE" | null,
  proj: ProjLike | null,
  options: OptionsAnalytics | undefined,
  meta?: TradeLogEntry["meta"]
) {
  const tradeLogs = useAppStore((s) => s.tradeLogs);
  const setTradeLog = useAppStore((s) => s.setTradeLog);

  useEffect(() => {
    if (!trackingKey) return;
    const now = Date.now();
    const history = tradeLogs[trackingKey] ?? [];
    const last = history[history.length - 1];
    const open = last && !last.closed ? last : undefined;
    const liveLtpForOpen = open ? liveLtpFor(options, open.strike, open.optSide) : null;
    const next = advanceTradeLog(history, { decision: decision ?? "WAIT", insufficient: null, optSide, proj, liveLtpForOpen, meta }, now);
    if (next !== history) setTradeLog(trackingKey, next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackingKey, decision, optSide, proj, options, meta]);

  return trackingKey ? tradeLogs[trackingKey] ?? [] : [];
}
