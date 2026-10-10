import type { TradeLogEntry } from "./tradeLogCore";

// A genuine, legitimate re-trigger of the same strike (this trade closes,
// and a fresh one opens right away because the underlying still qualifies)
// never overlaps in time -- the new entry's openedAt is always >= the
// previous entry's closedAt. So for the same strike+side, two entries whose
// [openedAt, closedAt] windows genuinely overlap can only be two
// independent clients (this app has no login, so two tabs/devices/visitors
// all share one trade log) each detecting the SAME real-world signal before
// syncing the other's write -- never two real separate trades. Shared by
// the cross-device sync merge (which permanently drops the losing
// duplicate going forward) and by each page's own display/accuracy math
// (which re-derives the same verdict at render time, so accuracy is always
// correct even in a browser that hasn't reloaded since the merge fix
// shipped, and so the Call History can visibly mark which entry is the one
// actually being counted).
// A second rule for "ghost" re-entries: a stale option-chain snapshot used
// to re-open a just-stopped leg at the SAME stale entry price within moments,
// and the next fresh quote stopped it again -- many identical losing lines
// for one real move. Same leg, same entry price, opened within GHOST_MS of
// the previous line's stop-out: that is the same call repeated, not a new one.
const GHOST_MS = 2 * 60_000;
const STOP_STATUSES = new Set(["sl_hit", "stopped_breakeven", "stopped_after_t1"]);

export function dedupeOverlappingEntries(sorted: TradeLogEntry[]): TradeLogEntry[] {
  const out: TradeLogEntry[] = [];
  let prev: TradeLogEntry | undefined; // the previous entry seen, kept or not -- a ghost run chains
  for (const e of sorted) {
    const last = out[out.length - 1];
    const sameLeg = last && last.strike === e.strike && last.optSide === e.optSide;
    const lastEnd = last ? (last.closed ? (last.closedAt ?? last.openedAt) : Infinity) : -Infinity;
    const ghost =
      prev !== undefined &&
      prev.strike === e.strike &&
      prev.optSide === e.optSide &&
      prev.closed &&
      STOP_STATUSES.has(prev.status) &&
      e.entry === prev.entry &&
      e.openedAt - (prev.closedAt ?? prev.openedAt) < GHOST_MS;
    prev = e;
    if (sameLeg && e.openedAt < lastEnd) continue;
    if (ghost) continue;
    out.push(e);
  }
  return out;
}

// Same rule, but returns which ids to KEEP as a Set rather than a filtered
// array in openedAt order -- lets a caller mark each original entry (in
// whatever order it's already displaying them) as verified/duplicate
// without needing to re-sort or lose its own display order.
export function verifiedEntryIds(entries: TradeLogEntry[]): Set<string> {
  const sorted = [...entries].sort((a, b) => a.openedAt - b.openedAt);
  return new Set(dedupeOverlappingEntries(sorted).map((e) => e.id));
}

// Filters a whole tradeLogs dictionary down to only the verified (non-
// duplicate) entries per key -- for feeding accuracy/track-record stats so
// a duplicate detection of the same real signal can never be double-counted,
// regardless of whether the underlying stored array has been cleaned up by
// a fresh app reload yet.
export function verifiedTradeLogsOnly(tradeLogs: Record<string, TradeLogEntry[]>): Record<string, TradeLogEntry[]> {
  const out: Record<string, TradeLogEntry[]> = {};
  for (const [key, entries] of Object.entries(tradeLogs)) {
    const keepIds = verifiedEntryIds(entries);
    out[key] = entries.filter((e) => keepIds.has(e.id));
  }
  return out;
}
