// A timeframe's closed-call record on one market (Ai-Today). Kept out of the
// React hook so the server can share the plan rules without browser code.

import type { TradeLogEntry } from "./tradeLogCore";

type FocusSym = "CRUDEOIL" | "NATURALGAS";

export interface TfRecord {
  closed: number;
  wins: number; // reached T1 or beyond
  losses: number; // stop hit
  winRate: number | null;
}

/** A timeframe's record: this page's own log plus the same engine's older log (Trade Report / AI-Test). */
export function tfRecord(logs: Record<string, TradeLogEntry[]>, sym: FocusSym, tf: string): TfRecord {
  const all = [...(logs[`TODAY-${sym}-${tf}`] ?? []), ...(logs[`${sym}-${tf}`] ?? [])].filter((e) => e.closed);
  const wins = all.filter((e) => e.status === "target3_hit" || e.status === "stopped_after_t1").length;
  const losses = all.filter((e) => e.status === "sl_hit").length;
  return { closed: all.length, wins, losses, winRate: wins + losses ? Math.round((wins / (wins + losses)) * 100) : null };
}
