// Every page's CE / PE calls as marks on the futures chart: which page called,
// which side, and where the futures price stood when the call came (the close
// of the candle that had just finished -- calls fire on finished candles).

import type { Candle } from "../types";
import type { TradeLogEntry } from "./tradeLogCore";
import { engineForKey, MIN_SAMPLE, symbolForKey } from "./aiEdgeEngine";
import { verifiedEntryIds } from "./dedupeTradeLog";
import { outcomeOf, PAGE_KEY_FILTER } from "./pageReport";
import { exitPriceFor } from "./tradeLogPnl";

export type ChartSym = "CRUDEOIL" | "NATURALGAS";

export interface CallMark {
  id: string;
  key: string;
  /** Full page name ("Ai20-20"), its short name ("Ai20") and the code drawn inside its star ("20"). */
  page: string;
  tag: string;
  code: string;
  route: string;
  side: "CE" | "PE";
  openedAt: number;
  /** Start of the candle the mark sits on (ms) and the futures price there. */
  barTime: number;
  price: number;
  practice: boolean;
  entry: TradeLogEntry;
}

const LOT: Record<ChartSym, number> = { CRUDEOIL: 100, NATURALGAS: 1250 };

/** Short chart tags by page id (aiEdgeEngine ENGINES). */
const TAG: Record<string, string> = {
  twenty20: "Ai20",
  lite: "Ai Lite",
  best: "Best Call",
  shoot: "Shoot",
  today: "Today",
  levelcross: "LvlX",
  aiup: "AI-Up",
  aiown: "Own",
  airisk: "Risk",
  gatece: "CE Buy",
  gatepe: "PE Buy",
  kumarai: "Kumar",
  elite: "Elite",
  pattern: "Learn",
  kimi: "Kimi",
  aitest: "Test V2",
};
/** The letter(s) inside each page's star: B = Best Call, 20 = Ai20-20, L = Ai Lite, T = Ai-Today ... */
const CODE: Record<string, string> = {
  best: "B",
  twenty20: "20",
  lite: "L",
  today: "T",
  shoot: "S",
  aitest: "V2",
  levelcross: "X",
  aiup: "U",
  aiown: "O",
  airisk: "R",
  gatece: "C",
  gatepe: "P",
  kumarai: "K",
  elite: "E",
  pattern: "LN",
  kimi: "KI",
};
/** Pages that log calls but are not in the report registry. */
const EXTRA: [prefix: string, page: string, tag: string, code: string, route: string][] = [
  ["SUPERFAST", "Ai-Super Fast", "Fast", "F", "/ai-super-fast"],
  ["TRUST", "Ai-Trust", "Trust", "TR", "/ai-trust"],
];

export interface PageOfKey {
  page: string;
  tag: string;
  code: string;
  route: string;
}

/** Which page a trade-log key belongs to -- null for keys that page's own report leaves out (old Ai20-20 rule logs). */
export function pageOfKey(key: string): PageOfKey | null {
  for (const [prefix, page, tag, code, route] of EXTRA) if (key.startsWith(`${prefix}-`)) return { page, tag, code, route };
  const e = engineForKey(key);
  if (!e) return null;
  const only = PAGE_KEY_FILTER[e.route]?.only;
  if (only && !only(key)) return null;
  return { page: e.id === "aitest" ? "AI-Test V2" : e.label, tag: TAG[e.id] ?? e.label, code: CODE[e.id] ?? e.label.charAt(0).toUpperCase(), route: e.route };
}

/** Marks for one market's calls that fall inside the candles shown (oldest first), `tfMs` = candle length. */
export function callMarks(logs: Record<string, TradeLogEntry[]>, sym: ChartSym, candles: Candle[], tfMs: number): CallMark[] {
  if (!candles.length) return [];
  const times = candles.map((c) => Date.parse(c.date));
  const first = times[0];
  const end = times[times.length - 1] + tfMs;
  const out: CallMark[] = [];
  for (const [key, entries] of Object.entries(logs)) {
    if (!key.includes(sym) || !entries?.length) continue;
    const who = pageOfKey(key);
    if (!who) continue;
    const keep = verifiedEntryIds(entries);
    for (const e of entries) {
      if (!keep.has(e.id) || e.openedAt < first || e.openedAt > end) continue;
      // The candle that had just finished when the call came; else the one it fell inside.
      let idx = -1;
      for (let i = times.length - 1; i >= 0; i--) {
        if (times[i] + tfMs <= e.openedAt) {
          idx = i;
          break;
        }
      }
      if (idx < 0) idx = 0;
      out.push({ id: `${key}:${e.id}`, key, ...who, side: e.optSide, openedAt: e.openedAt, barTime: times[idx], price: candles[idx].close, practice: !!e.practice, entry: e });
    }
  }
  return out.sort((x, y) => x.openedAt - y.openedAt);
}

/** "Target 3 hit · +₹2,000 a lot" -- how a call ended (or that it is still running). */
export function callResult(m: CallMark, sym: ChartSym): { text: string; rs: number | null; tone: "win" | "loss" | "flat" | "open" } {
  const e = m.entry;
  if (!e.closed) return { text: "Running", rs: null, tone: "open" };
  const rs = Math.round((exitPriceFor(e) - e.entry) * LOT[sym]);
  const what: Record<string, string> = {
    target3_hit: "Target 3 hit",
    stopped_after_t1: "Out at T1 after T2",
    stopped_breakeven: "Out at entry after T1",
    sl_hit: "Stop hit",
    closed_eod: "Closed at day end",
    closed_manual: "Closed by hand",
  };
  return { text: what[e.status] ?? "Closed", rs, tone: rs > 0 ? "win" : rs < 0 ? "loss" : "flat" };
}

export interface PageScore extends PageOfKey {
  /** Closed calls in the period: won (T2 / T3), stopped (stop before T1), and all closed. */
  won: number;
  stopped: number;
  closed: number;
  running: number;
  /** Won out of won + stopped, % -- the same count as each page's trade report. */
  winPct: number | null;
}

/**
 * Each page's success rate on one market: calls closed since `since` (null =
 * all), counted exactly as the page's own trade report counts them (same keys,
 * duplicates from a second phone skipped). Best rate first among pages with
 * enough finished calls to judge (MIN_SAMPLE), then the ones with too few --
 * one lucky win must not top the table -- and pages with none yet last.
 */
export function pageScores(logs: Record<string, TradeLogEntry[]>, sym: ChartSym, since: number | null): PageScore[] {
  const by = new Map<string, PageScore>();
  for (const [key, entries] of Object.entries(logs)) {
    if (!entries?.length || symbolForKey(key) !== sym) continue;
    const who = pageOfKey(key);
    if (!who) continue;
    const s = by.get(who.page) ?? { ...who, won: 0, stopped: 0, closed: 0, running: 0, winPct: null };
    const keep = verifiedEntryIds(entries);
    for (const e of entries) {
      if (!keep.has(e.id)) continue;
      if (!e.closed) {
        s.running++;
        continue;
      }
      if (since !== null && (e.closedAt ?? e.openedAt) < since) continue;
      s.closed++;
      const o = outcomeOf(e);
      if (o === "won") s.won++;
      else if (o === "stopped") s.stopped++;
    }
    by.set(who.page, s);
  }
  return [...by.values()]
    .filter((s) => s.closed + s.running > 0)
    .map((s) => ({ ...s, winPct: s.won + s.stopped ? Math.round((s.won / (s.won + s.stopped)) * 100) : null }))
    .sort((a, b) => Number(b.won + b.stopped >= MIN_SAMPLE) - Number(a.won + a.stopped >= MIN_SAMPLE) || (b.winPct ?? -1) - (a.winPct ?? -1) || b.won + b.stopped - (a.won + a.stopped));
}
