import type { TradeLogEntry } from "../store/appStore";
import { DECISION_LABEL, type Decision6 } from "./timeframeEngine";
import { dayNumberToKey, sessionDayNumber } from "./mcxSession";

// MCX commodity sessions run roughly 09:00 to 23:30/23:55 IST -- a single
// trading day, even though it crosses into the evening. Grouping by plain
// calendar date (midnight cutoff) would be correct here since the session
// never crosses midnight, but we still resolve everything through IST
// explicitly so a viewer in any other timezone gets the same day buckets.
// Arithmetic rather than Intl.formatToParts: IST is a fixed offset with no
// daylight saving, so this is exact, and it runs per trade/per candle in hot
// paths where the formatter was measurably expensive. Anything before 09:00
// IST (e.g. a trade that closes a few minutes after midnight) belongs to the
// previous session day.
export function sessionDayKey(ts: number): string {
  return dayNumberToKey(sessionDayNumber(ts));
}

function formatDayLabel(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: "UTC" });
}

export interface DayTradeStats {
  dateKey: string;
  label: string;
  targetHit: number;
  breakeven: number;
  slHit: number;
  total: number;
}

// Target Hit = closed with at least one target locked in as a real gain
// (Target 3 fully, or trailed out after Target 1/2). Breakeven = Target 1
// was touched but price came back to entry before anything more --
// net zero, not a win. SL Hit = stopped out without ever reaching a target.
export function summarizeTradeLogsByDay(tradeLogs: Record<string, TradeLogEntry[]>): DayTradeStats[] {
  const buckets = new Map<string, { targetHit: number; breakeven: number; slHit: number; total: number }>();

  for (const entries of Object.values(tradeLogs)) {
    for (const e of entries) {
      if (!e.closed || e.closedAt === null) continue;
      const key = sessionDayKey(e.closedAt);
      const bucket = buckets.get(key) ?? { targetHit: 0, breakeven: 0, slHit: 0, total: 0 };
      if (e.status === "target3_hit" || e.status === "stopped_after_t1") bucket.targetHit += 1;
      else if (e.status === "stopped_breakeven") bucket.breakeven += 1;
      else if (e.status === "sl_hit") bucket.slHit += 1;
      bucket.total += 1;
      buckets.set(key, bucket);
    }
  }

  return Array.from(buckets.entries())
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([dateKey, stats]) => ({ dateKey, label: formatDayLabel(dateKey), ...stats }));
}

export interface SignalRanking {
  label: string;
  decisions: Decision6[];
  targetHit: number;
  breakeven: number;
  slHit: number;
  total: number;
  winRate: number | null;
}

// SELL and STRONG SELL share one bucket, matching DECISION_LABEL's own
// "Don't Buy Risky" combined wording for both bearish tiers -- otherwise
// this ranking would show two rows with the identical label. WAIT is
// excluded outright: it never opens a trade, so it would only ever show
// "no closed trades."
const SIGNAL_BUCKETS: { label: string; decisions: Decision6[] }[] = [
  { label: DECISION_LABEL["STRONG BUY"], decisions: ["STRONG BUY"] },
  { label: DECISION_LABEL["BUY"], decisions: ["BUY"] },
  { label: DECISION_LABEL["WATCH BUY"], decisions: ["WATCH BUY"] },
  { label: DECISION_LABEL["SELL"], decisions: ["SELL", "STRONG SELL"] },
];

// Ranks each decision tier ("signal") by its own real closed-trade win rate
// -- answers "which signal actually wins more," as distinct from
// summarizeTradeLogsByDay (which groups by day) or a per-timeframe ranking.
// Entries with no recorded decision (persisted before this field existed,
// or from Kimi's setup-based log which has no Decision6 concept) are
// simply excluded rather than guessed at.
export function rankSignalsByWinRate(entries: TradeLogEntry[]): SignalRanking[] {
  return SIGNAL_BUCKETS.map(({ label, decisions }) => {
    const closed = entries.filter((e) => e.closed && e.decision && decisions.includes(e.decision));
    let targetHit = 0;
    let breakeven = 0;
    let slHit = 0;
    for (const e of closed) {
      if (e.status === "target3_hit" || e.status === "stopped_after_t1") targetHit += 1;
      else if (e.status === "stopped_breakeven") breakeven += 1;
      else if (e.status === "sl_hit") slHit += 1;
    }
    const decided = targetHit + slHit;
    const winRate = decided > 0 ? Math.round((targetHit / decided) * 100) : null;
    return { label, decisions, targetHit, breakeven, slHit, total: closed.length, winRate };
  }).sort((a, b) => {
    if (a.winRate === null && b.winRate === null) return b.total - a.total;
    if (a.winRate === null) return 1;
    if (b.winRate === null) return -1;
    if (b.winRate !== a.winRate) return b.winRate - a.winRate;
    return b.total - a.total;
  });
}
