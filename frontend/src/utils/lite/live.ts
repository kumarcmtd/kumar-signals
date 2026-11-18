// Ai Lite live: read the rules on the latest finished 15-minute candle, the
// money rules on today's calls, and the call entry -- shared by the page and
// the server so both write the same call (id from the signal candle).

import type { Candle } from "../../types";
import { openNewEntry, type TradeLogEntry } from "../tradeLogCore";
import { exitPriceFor } from "../tradeLogPnl";
import { mcxCloseMinutes } from "../mcxSession";
import type { StrikeChoice } from "../twentyV3/ticket";
import { finished15, LITE, LITE_BAR_MS, LITE_LOT, liteBars, liteLevels, liteSignal, type LiteSignal, type LiteSym, type Side } from "./engine";

const IST_MS = 5.5 * 3600_000;
export const liteKey = (sym: LiteSym) => `LITE-${sym}`;

export interface LiteRead {
  /** call: the rules fire on the newest candle; watch: live, nothing yet; stale: the candles are old (market shut / feed late). */
  state: "call" | "watch" | "stale" | "no_data";
  signal: LiteSignal | null;
  /** End of the candle the read is on (a call's time and id). */
  barEnd: number | null;
  fut: number | null;
}

const bellOf = (ms: number) => {
  const d = new Date(ms + IST_MS);
  return mcxCloseMinutes(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
};

export function readLite(candles15: Candle[], now: number = Date.now()): LiteRead {
  const done = finished15(candles15, now);
  if (done.length < 40) return { state: "no_data", signal: null, barEnd: null, fut: null };
  const b = liteBars(done.slice(-400));
  const i = b.c.length - 1;
  const barEnd = b.t[i] + LITE_BAR_MS;
  const signal = liteSignal(b, i, bellOf(b.t[i]));
  // A call only on a candle that has just finished (the server checks every 5 minutes).
  if (now - barEnd > 15 * 60_000) return { state: "stale", signal, barEnd, fut: b.c[i] };
  return { state: signal.side ? "call" : "watch", signal, barEnd, fut: b.c[i] };
}

const istDay = (ms: number) => Math.floor((ms + IST_MS) / 86_400_000);

export interface LiteGuard {
  ok: boolean;
  reason: string | null;
  callsToday: number;
  stopsToday: number;
  bookedRs: number;
}

/** Money rules on the real log: one call at a time, 2 stops or Rs 2,000 booked ends the day, 15 minutes after a stop. */
export function liteGuard(log: TradeLogEntry[], side: Side | null, sym: LiteSym, now: number): LiteGuard {
  const today = log.filter((e) => istDay(e.openedAt) === istDay(now));
  const stopsToday = today.filter((e) => e.status === "sl_hit").length;
  const bookedRs = Math.round(today.filter((e) => e.closed).reduce((a, e) => a + (exitPriceFor(e) - e.entry) * LITE_LOT[sym], 0));
  const last = log[log.length - 1];
  const base = { callsToday: today.length, stopsToday, bookedRs };
  if (last && !last.closed) return { ...base, ok: false, reason: `A ${last.optSide} call is running — one at a time.` };
  if (bookedRs >= LITE.dayGoalRs) return { ...base, ok: false, reason: `🎯 Day goal done: +₹${bookedRs.toLocaleString("en-IN")} a lot booked today. Protect it — no more calls today.` };
  if (stopsToday >= LITE.maxStopsPerDay) return { ...base, ok: false, reason: `${stopsToday} stop-losses today — the day is over for this market. Fresh start tomorrow.` };
  if (last && last.status === "sl_hit" && last.optSide === side && now - (last.closedAt ?? last.openedAt) < LITE.cooldownMs) return { ...base, ok: false, reason: "Stopped out a few minutes ago on this side — 15-minute pause." };
  return { ...base, ok: true, reason: null };
}

/** The call entry for a signal: bought at the chosen strike's live premium, levels from the Rs targets. */
export function openLiteEntry(choice: StrikeChoice, side: Side, sym: LiteSym, read: LiteRead): TradeLogEntry {
  const lv = liteLevels(choice.ltp, sym);
  const kind = read.signal?.kind === "breakout" ? "Breakout" : "Pullback";
  return openNewEntry({ strike: choice.strike, optSide: side, entry: choice.ltp, targets: lv.targets, stop: lv.stop }, read.barEnd ?? Date.now(), {
    label: `Ai Lite · ${kind} ${side}`,
    reasons: (read.signal?.checks ?? []).map((c) => `${c.label}: ${c.detail}`),
    confirmingTimeframes: ["15m"],
  });
}
