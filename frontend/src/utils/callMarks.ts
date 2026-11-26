// Every page's CE / PE calls as marks on the futures chart: which page called,
// which side, and where the futures price stood when the call came (the close
// of the candle that had just finished -- calls fire on finished candles).

import type { Candle } from "../types";
import type { TradeLogEntry } from "./tradeLogCore";
import { engineForKey } from "./aiEdgeEngine";
import { verifiedEntryIds } from "./dedupeTradeLog";
import { exitPriceFor } from "./tradeLogPnl";

export type ChartSym = "CRUDEOIL" | "NATURALGAS";

export interface CallMark {
  id: string;
  key: string;
  /** Full page name ("Ai20-20") and the short tag drawn on the chart ("Ai20"). */
  page: string;
  tag: string;
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
  best: "Best",
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
/** Pages that log calls but are not in the report registry. */
const EXTRA: [prefix: string, page: string, tag: string, route: string][] = [
  ["SUPERFAST", "Ai-Super Fast", "Fast", "/ai-super-fast"],
  ["TRUST", "Ai-Trust", "Trust", "/ai-trust"],
];

export function pageOfKey(key: string): { page: string; tag: string; route: string } | null {
  for (const [prefix, page, tag, route] of EXTRA) if (key.startsWith(`${prefix}-`)) return { page, tag, route };
  const e = engineForKey(key);
  if (!e) return null;
  return { page: e.id === "aitest" ? "AI-Test V2" : e.label, tag: TAG[e.id] ?? e.label, route: e.route };
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
      out.push({ id: `${key}:${e.id}`, key, page: who.page, tag: who.tag, route: who.route, side: e.optSide, openedAt: e.openedAt, barTime: times[idx], price: candles[idx].close, practice: !!e.practice, entry: e });
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
