// "How long should I wait for this call?" -- an honest read on hold time so a
// trader neither bails 10 minutes in nor sits in a dead call for days. Built
// from two REAL sources, never a made-up number:
//   1) the call's own pace so far (how fast its premium has actually moved),
//   2) the median time this page's PAST WINNING calls took to close.
// Both degrade gracefully to "not enough data yet" rather than guessing.

import type { TradeLogEntry } from "../store/appStore";
import { exitPriceFor } from "./tradeLogPnl";

function median(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export interface HistoricalHold {
  medianWinMin: number;
  winCount: number;
}

// Median open->close duration of the winning calls in this history (a winner
// = closed above its entry premium). Needs at least 3 to be meaningful.
export function historicalHold(entries: TradeLogEntry[]): HistoricalHold | null {
  const durs = entries
    .filter((e) => e.closed && typeof e.closedAt === "number" && exitPriceFor(e) > e.entry)
    .map((e) => ((e.closedAt as number) - e.openedAt) / 60000)
    .filter((m) => m > 0 && m < 60 * 24 * 10); // ignore absurd/stale spans
  if (durs.length < 3) return null;
  return { medianWinMin: Math.round(median(durs)), winCount: durs.length };
}

// "At the pace it's actually moved so far, roughly this long to the next
// target." Uses only the live premium's realized velocity since entry -- no
// delta or volatility model. Null when it's too early to read, the premium is
// not progressing, or the target is already reached.
export function paceEtaMin(entry: number, current: number | null, openedAt: number, nextTarget: number): number | null {
  if (current === null) return null;
  const elapsedMin = (Date.now() - openedAt) / 60000;
  if (elapsedMin < 5) return null; // too soon to read a pace
  const gain = current - entry;
  if (gain <= 0) return null; // not progressing yet
  const remaining = nextTarget - current;
  if (remaining <= 0) return null; // already at/through the target
  const velocity = gain / elapsedMin; // premium per minute
  if (velocity <= 0) return null;
  const eta = remaining / velocity;
  return eta > 0 && eta < 60 * 24 * 10 ? Math.round(eta) : null;
}

export function formatDuration(min: number): string {
  if (min < 1) return "under a minute";
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h < 24) return m === 0 ? `${h}h` : `${h}h ${m}m`;
  const d = Math.floor(h / 24);
  const hr = h % 24;
  return hr === 0 ? `${d}d` : `${d}d ${hr}h`;
}
