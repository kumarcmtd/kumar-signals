import type { OptionsAnalytics } from "../types";
import type { Decision6 } from "./timeframeEngine";
import { dedupeOverlappingEntries } from "./dedupeTradeLog";

// The pure, React-free heart of trade-log tracking: the entry shape, the
// advance/close rules, and the cross-source merge. Deliberately kept free of
// any React or Zustand import so BOTH the browser (via useTradeLog.ts's
// hooks) AND the Cloudflare Worker's Cron (worker.ts) can run the exact same
// logic -- the worker advances and closes open trades server-side on a
// schedule so a call's target/stop is detected even when the app is fully
// closed, and it can never drift from what the browser would have done
// because it is literally the same code.

// One trade instance for a given "<prefix>-<symbol>[-<timeframe>]" line:
// entry/targets/stop are frozen at the moment the signal first fired,
// targetsHit ticks off each level as the live premium reaches it
// (permanently, even if price later retraces), and once closed the line is
// done -- the next actionable signal for that key starts a brand-new entry
// rather than mutating this one.
export type TradeLogStatus = "running" | "sl_hit" | "stopped_breakeven" | "stopped_after_t1" | "target3_hit" | "closed_manual";

export interface TradeLogEntry {
  id: string;
  strike: number;
  optSide: "CE" | "PE";
  entry: number;
  targets: [number, number, number];
  stop: number;
  targetsHit: [boolean, boolean, boolean];
  status: TradeLogStatus;
  closed: boolean;
  openedAt: number;
  closedAt: number | null;
  // Captured at the moment the entry opened, so a later "explain this call"
  // view can show the REAL reasoning from back then instead of substituting
  // today's live analysis (which has nothing to do with an already-closed
  // trade) or inventing something. Optional so existing entries and callers
  // that don't track this (AI-Test V2/Pro) are unaffected.
  meta?: { label: string; reasons: string[]; confirmingTimeframes: string[] };
  // The decision tier (Strong Buy/Good Buy/Risky Buy/Don't Buy Risky) that
  // was active when this entry opened -- lets a "which signal actually wins
  // more" ranking group real closed trades by tier. Optional: entries from
  // before this field existed, and Kimi's setup-based log (no Decision6
  // concept), simply have no tier and are excluded from that ranking.
  decision?: Decision6;
  // How many separate TIMES price has crossed up through each target --
  // unlike targetsHit (a permanent, one-way "reached at least once" flag
  // used to trail the stop and decide closure), this keeps counting on every
  // fresh touch: hit T1, pull back below it, hit T1 again -> 2. Optional so
  // entries persisted before this field existed just start counting from
  // whatever targetsHit already recorded (see advanceOpenEntry).
  targetTouches?: [number, number, number];
  // Internal bookkeeping for targetTouches: was price at/above each target
  // as of the last poll -- lets advanceOpenEntry tell a genuine new touch
  // (crossing up from below) apart from "still sitting above from before."
  targetAboveState?: [boolean, boolean, boolean];
  // Highest live premium seen since this entry opened -- a call can run up
  // most of the way to a target and pull back WITHOUT ever crossing that
  // target's exact level, which targetsHit/targetTouches has no way to show
  // (they only fire at the target price itself). This is the number a price
  // scale needs to answer "how close did it actually get before pulling
  // back," independent of whether any target line was crossed. Optional so
  // entries persisted before this field existed just start tracking from
  // whatever price is live the next time they're advanced.
  highWaterMark?: number;
  // The REAL live premium observed at the moment this entry closed -- the
  // first poll (client or Cron) at which the target/stop condition was met.
  // Recorded so P&L uses the actual observed fill rather than the rule's own
  // level: options gap, and a fast move through a stop fills well below it,
  // so booking losses at exactly the stop level understated them. Optional so
  // entries closed before this field existed fall back to the level-based
  // exitPriceFor() approximation.
  exitPrice?: number;
}

// Every page's own trade log is a rolling window capped at this many entries
// per key. Well past what any real trading day produces per key, so
// "study today's results" actually has today's results to look at.
export const MAX_HISTORY = 200;

export interface ProjLike {
  strike: number;
  optSide: "CE" | "PE";
  entry: number;
  targets: [number, number, number];
  stop: number;
}

// The stop this trade will ACTUALLY exit on next, as opposed to entry.stop
// (the original level, frozen at open). Once Target 1 is touched a pullback
// to breakeven closes it neutral; once Target 2 is touched the floor rises
// to the Target 1 level. Every card/row showing "SL ₹..." should show THIS.
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
// TOUCHES keep counting on every fresh crossing. Close rules, in order:
// hit stop before any target -> SL Hit; after Target 1 the effective stop
// trails to breakeven; after Target 2 it trails to the Target 1 level;
// Target 3 fully closes. On any close, exitPrice records the real observed
// premium (liveLtp), not the rule level -- so losses that gapped through the
// stop are booked at the true fill, not flattered. Returns the SAME object
// reference when nothing changed, so callers can skip a write.
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
    return { ...entry, targetsHit, targetTouches, targetAboveState: aboveNow, highWaterMark, status: "target3_hit", closed: true, closedAt: entry.closedAt ?? now, exitPrice: liveLtp };
  }

  const effectiveStop = targetsHit[1] ? entry.targets[0] : targetsHit[0] ? entry.entry : entry.stop;
  if (liveLtp <= effectiveStop) {
    const status: TradeLogStatus = targetsHit[1] ? "stopped_after_t1" : targetsHit[0] ? "stopped_breakeven" : "sl_hit";
    return { ...entry, targetsHit, targetTouches, targetAboveState: aboveNow, highWaterMark, status, closed: true, closedAt: now, exitPrice: liveLtp };
  }

  if (!stateChanged && !highChanged) return entry;
  return { ...entry, targetsHit, targetTouches, targetAboveState: aboveNow, highWaterMark, status: "running" };
}

// Pure reducer over one key's trade log: advances the currently open entry
// (if any) against the live premium, or opens a fresh entry once the previous
// one has closed and the engine is newly actionable again. Returns the SAME
// array reference when nothing changed.
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

// Merges one key's two entry lists by id (a real union, not a whole-array
// pick). For an id both sides have, the closed/more-advanced version always
// wins -- which is exactly what lets the Cron close a trade server-side and
// have that close survive even when a browser later pushes its own still-open
// copy of the same id. Otherwise local wins (it's what's actually running).
// Capped to MAX_HISTORY, keeping the newest by open time.
export function mergeTradeLogEntryLists(local: TradeLogEntry[], server: TradeLogEntry[]): TradeLogEntry[] {
  const byId = new Map<string, TradeLogEntry>();
  for (const e of server) byId.set(e.id, e);
  for (const e of local) {
    const existing = byId.get(e.id);
    if (!existing || !existing.closed || e.closed) byId.set(e.id, e);
  }
  const merged = Array.from(byId.values()).sort((a, b) => a.openedAt - b.openedAt);
  const deduped = dedupeOverlappingEntries(merged);
  return deduped.length > MAX_HISTORY ? deduped.slice(deduped.length - MAX_HISTORY) : deduped;
}

export function mergeTradeLogs(
  local: Record<string, TradeLogEntry[]>,
  server: Record<string, TradeLogEntry[]>
): Record<string, TradeLogEntry[]> {
  const keys = new Set([...Object.keys(local), ...Object.keys(server)]);
  const out: Record<string, TradeLogEntry[]> = {};
  for (const key of keys) {
    out[key] = mergeTradeLogEntryLists(local[key] ?? [], server[key] ?? []);
  }
  return out;
}

// The two markets whose option premiums drive every trade-log line. Every
// key across the app ("BEST-CRUDEOIL", "TWENTY20-NATURALGAS-15", ...) embeds
// exactly one of these as a substring, and neither is a substring of the
// other, so a key's symbol can be recovered without knowing which page's
// naming convention produced it.
export const TRADE_LOG_SYMBOLS = ["CRUDEOIL", "NATURALGAS"] as const;
export type TradeLogSymbol = (typeof TRADE_LOG_SYMBOLS)[number];

export function symbolOfTradeLogKey(key: string): TradeLogSymbol | null {
  for (const s of TRADE_LOG_SYMBOLS) if (key.includes(s)) return s;
  return null;
}
