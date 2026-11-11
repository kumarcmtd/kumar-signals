// One page's own trade report: every call THAT page made, read from its own
// trade log (the key prefix its engine writes -- see ENGINES in aiEdgeEngine),
// in rupees per lot. Shown at the bottom of each page by PageReportStrip.
//
// Counting matches the call cards: WON = reached T1 or beyond, STOPPED = stop
// hit; a break-even, day-end or manual close is "other". Money is the real
// recorded exit premium (exitPriceFor), 1 lot, with an estimated cost per call
// taken off the net. Duplicate copies of one call (two phones) are skipped.

import type { TradeLogEntry } from "../store/appStore";
import { engineForKey, rupeesFor, symbolForKey, type EdgeSymbol, type EngineDef } from "./aiEdgeEngine";
import { verifiedEntryIds } from "./dedupeTradeLog";

export const EST_COST_RS: Record<EdgeSymbol, number> = { CRUDEOIL: 150, NATURALGAS: 200 };
export type ReportPeriod = "today" | "7d" | "30d" | "all";
export type ReportMarket = "ALL" | EdgeSymbol;

export interface ReportCall {
  key: string;
  symbol: EdgeSymbol;
  group: string;
  entry: TradeLogEntry;
  rs: number;
  netRs: number;
  outcome: "won" | "stopped" | "other";
  closedAt: number;
}

export interface ReportRow {
  label: string;
  closed: number;
  won: number;
  stopped: number;
  winPct: number | null;
  netRs: number;
}

export interface PageReport {
  closed: number;
  running: number;
  won: number;
  stopped: number;
  other: number;
  winPct: number | null;
  t1Pct: number | null;
  grossRs: number;
  netRs: number;
  avgNetRs: number | null;
  best: ReportCall | null;
  worst: ReportCall | null;
  groups: ReportRow[];
  markets: ReportRow[];
  days: (ReportRow & { day: string })[];
  /** The current run of wins or stop-losses (break-evens skipped), newest first. */
  streak: { kind: "won" | "stopped"; n: number } | null;
  duplicatesSkipped: number;
}

const TF_LABEL: Record<string, string> = {
  "1": "1m",
  "3": "3m",
  "5": "5m",
  "10": "10m",
  "15": "15m",
  "30": "30m",
  "60": "1h",
  "120": "2h",
  "240": "4h",
  "1D": "Daily",
  V2: "v2 rules",
  LIVE: "old rules",
  // Ai-Trust tiers (its calls come from the Trade Card log, keyed TRUST-<SYMBOL>-<tier>)
  proven: "Proven strategies",
  trust: "AI-Trust calls",
  card: "Trade Card calls",
  quick: "Quick trades",
};
const IST_MS = 5.5 * 3600_000;
const istDay = (ms: number) => new Date(ms + IST_MS).toISOString().slice(0, 10);

/** "TODAY-NATURALGAS-60" -> "1h"; "BEST-CRUDEOIL" -> "All calls". */
export function groupLabel(key: string, symbol: EdgeSymbol): string {
  const parts = key.split("-");
  const rest = parts.slice(parts.indexOf(symbol) + 1).join("-");
  if (!rest) return "All calls";
  return TF_LABEL[rest] ?? rest;
}

function outcomeOf(e: TradeLogEntry): ReportCall["outcome"] {
  if (e.status === "target3_hit" || e.status === "stopped_after_t1") return "won";
  if (e.status === "sl_hit") return "stopped";
  return "other";
}

function row(label: string, calls: ReportCall[]): ReportRow {
  const won = calls.filter((c) => c.outcome === "won").length;
  const stopped = calls.filter((c) => c.outcome === "stopped").length;
  return { label, closed: calls.length, won, stopped, winPct: won + stopped ? Math.round((won / (won + stopped)) * 100) : null, netRs: calls.reduce((s, c) => s + c.netRs, 0) };
}

export function periodStart(period: ReportPeriod, now: number): number | null {
  if (period === "all") return null;
  if (period === "today") return Date.parse(`${istDay(now)}T00:00:00Z`) - IST_MS;
  return now - (period === "7d" ? 7 : 30) * 86_400_000;
}

export function buildPageReport(
  tradeLogs: Record<string, TradeLogEntry[]>,
  engine: EngineDef,
  /** scoped: `tradeLogs` already holds only this page's calls (Ai-Trust), so no prefix filter. */
  opts: { period: ReportPeriod; market: ReportMarket; now?: number; scoped?: boolean }
): PageReport {
  const now = opts.now ?? Date.now();
  const since = periodStart(opts.period, now);
  const calls: ReportCall[] = [];
  let running = 0;
  let duplicatesSkipped = 0;
  for (const [key, entries] of Object.entries(tradeLogs)) {
    if (!opts.scoped && engineForKey(key)?.id !== engine.id) continue;
    const symbol = symbolForKey(key);
    if (!symbol || (opts.market !== "ALL" && symbol !== opts.market)) continue;
    const keep = verifiedEntryIds(entries);
    for (const e of entries) {
      if (!keep.has(e.id)) {
        duplicatesSkipped++;
        continue;
      }
      if (!e.closed) {
        running++;
        continue;
      }
      const closedAt = e.closedAt ?? e.openedAt;
      if (since !== null && closedAt < since) continue;
      const rs = rupeesFor(e, symbol);
      calls.push({ key, symbol, group: groupLabel(key, symbol), entry: e, rs, netRs: rs - EST_COST_RS[symbol], outcome: outcomeOf(e), closedAt });
    }
  }
  calls.sort((a, b) => b.closedAt - a.closedAt);

  const all = row("All", calls);
  const t1 = calls.filter((c) => c.entry.targetsHit[0]).length;
  const grossRs = calls.reduce((s, c) => s + c.rs, 0);
  const byRs = [...calls].sort((a, b) => b.rs - a.rs);

  const groupNames = [...new Set(calls.map((c) => c.group))];
  const groups = groupNames.map((g) => row(g, calls.filter((c) => c.group === g))).sort((a, b) => b.closed - a.closed);
  const markets = (["CRUDEOIL", "NATURALGAS"] as const).map((m) => row(m === "CRUDEOIL" ? "Crude Oil" : "Natural Gas", calls.filter((c) => c.symbol === m))).filter((r) => r.closed > 0);
  const dayKeys = [...new Set(calls.map((c) => istDay(c.closedAt)))].slice(0, 7);
  const days = dayKeys.map((d) => ({
    ...row(new Date(`${d}T12:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", weekday: "short", timeZone: "UTC" }), calls.filter((c) => istDay(c.closedAt) === d)),
    day: d,
  }));

  let streak: PageReport["streak"] = null;
  for (const c of calls) {
    if (c.outcome === "other") continue;
    if (!streak) streak = { kind: c.outcome, n: 1 };
    else if (c.outcome === streak.kind) streak.n++;
    else break;
  }

  return {
    closed: calls.length,
    running,
    won: all.won,
    stopped: all.stopped,
    other: calls.length - all.won - all.stopped,
    winPct: all.winPct,
    t1Pct: calls.length ? Math.round((t1 / calls.length) * 100) : null,
    grossRs,
    netRs: all.netRs,
    avgNetRs: calls.length ? Math.round(all.netRs / calls.length) : null,
    best: byRs[0] && byRs[0].rs > 0 ? byRs[0] : null,
    worst: byRs.length && byRs[byRs.length - 1].rs < 0 ? byRs[byRs.length - 1] : null,
    groups,
    markets,
    days,
    streak,
    duplicatesSkipped,
  };
}
