// The Trade Card's own scorecard.
//
// Every time the card says TRADE CE / TRADE PE, the server writes the call
// down (entry = the close of the candle it was based on, the card's stop and
// target) and then follows the futures price, 5-minute candle by candle:
//   target first  -> WIN
//   stop first    -> LOSS (if one candle touches both, it counts as a LOSS --
//                    we cannot tell which came first, so assume the worse)
//   neither by the MCX close -> closed at the last price ("day end")
// Measured in futures points and in R (multiples of the risk taken), because
// the option premium depends on the strike and the day; the ₹ shown on the
// page is an ATM estimate and says so. Nothing here is guessed: every number
// comes from the logged call and the finished candles after it.

import type { Candle } from "../types";

export interface CardCall {
  id: string;
  symbol: "CRUDEOIL" | "NATURALGAS";
  side: "CE" | "PE";
  candleAt: string; // the 5-minute candle the call was based on (its start, ISO)
  openedAt: string; // when that candle closed = the entry time
  entry: number;
  stop: number;
  t1: number;
  reason: string;
  closed: boolean;
  result: "target" | "stop" | "day_end" | "time_exit" | null;
  exit: number | null;
  closedAt: string | null;
  pnlPts: number | null; // in the call's favour, futures points
  r: number | null; // pnlPts / risk
  bestPts: number; // furthest in the call's favour while open
  trust?: boolean; // passed the stricter Ai-Trust rules too (utils/trustGrade)
  tier?: "card" | "trust" | "quick"; // which call it was (missing on old entries = "card")
  t2?: number;
  exitByIso?: string; // quick trades: time stop -- closed at market if still open then
  /** The ATM option at the moment of the call: entry premium and the premium
   *  estimated (delta) at the stop / targets -- for the live call card. */
  opt?: { strike: number; entry: number; stop: number | null; t1: number | null; t2: number | null; delta: number | null };
}

export const LOG_CAP = 150;
const r2 = (n: number) => Math.round(n * 100) / 100;

function finish(c: CardCall, result: CardCall["result"], exit: number, at: string): CardCall {
  const up = c.side === "CE";
  const pnl = r2(up ? exit - c.entry : c.entry - exit);
  const risk = Math.abs(c.entry - c.stop);
  return { ...c, closed: true, result, exit: r2(exit), closedAt: at, pnlPts: pnl, r: risk > 0 ? Math.round((pnl / risk) * 100) / 100 : null };
}

/** Walk the finished 5-minute candles after the entry; close the call on target, stop or day end. */
export function advanceCall(call: CardCall, closed5: Candle[], dayOver: boolean): CardCall {
  if (call.closed) return call;
  const up = call.side === "CE";
  const after = closed5.filter((c) => Date.parse(c.date) >= Date.parse(call.openedAt)).sort((a, b) => a.date.localeCompare(b.date));
  let c = call;
  for (const k of after) {
    const best = up ? k.high - c.entry : c.entry - k.low;
    if (best > c.bestPts) c = { ...c, bestPts: r2(best) };
    const end = new Date(Date.parse(k.date) + 5 * 60_000).toISOString();
    const hitStop = up ? k.low <= c.stop : k.high >= c.stop;
    const hitTarget = up ? k.high >= c.t1 : k.low <= c.t1;
    if (hitStop) return finish(c, "stop", c.stop, end);
    if (hitTarget) return finish(c, "target", c.t1, end);
    if (c.exitByIso && Date.parse(end) >= Date.parse(c.exitByIso)) return finish(c, "time_exit", k.close, end);
  }
  if (dayOver) {
    const last = after[after.length - 1];
    return finish(c, "day_end", last ? last.close : c.entry, last ? new Date(Date.parse(last.date) + 5 * 60_000).toISOString() : c.openedAt);
  }
  return c;
}

/** Add a new call if the card says TRADE and nothing is open for this market yet. */
export function maybeOpen(
  log: CardCall[],
  symbol: CardCall["symbol"],
  v: { action: string; side: "CE" | "PE" | null; stop: number | null; t1: number | null; reason: string },
  lastClosed: Candle | null,
  extra: Partial<Pick<CardCall, "tier" | "trust" | "t2" | "exitByIso">> = {},
): CardCall[] {
  if (!lastClosed || !v.side || v.stop === null || v.t1 === null) return log;
  if (v.action !== `TRADE_${v.side}`) return log;
  if (log.some((c) => !c.closed)) return log;
  if (log.some((c) => c.candleAt === lastClosed.date)) return log; // this candle's call is already logged
  const openedAt = new Date(Date.parse(lastClosed.date) + 5 * 60_000).toISOString();
  const call: CardCall = {
    id: `${symbol}-${lastClosed.date}`,
    symbol,
    side: v.side,
    candleAt: lastClosed.date,
    openedAt,
    entry: lastClosed.close,
    stop: v.stop,
    t1: v.t1,
    reason: v.reason,
    closed: false,
    result: null,
    exit: null,
    closedAt: null,
    pnlPts: null,
    r: null,
    bestPts: 0,
    ...extra,
  };
  return [...log, call].slice(-LOG_CAP);
}

export interface CardStats {
  calls: number;
  closed: number;
  wins: number; // target hit, or a day-end exit in profit
  losses: number;
  open: number;
  winRate: number | null; // % of closed
  totalR: number;
  totalPts: number;
  avgWinR: number | null;
  avgLossR: number | null;
}

export function cardStats(log: CardCall[]): CardStats {
  const done = log.filter((c) => c.closed && c.pnlPts !== null);
  const wins = done.filter((c) => (c.pnlPts ?? 0) > 0);
  const losses = done.filter((c) => (c.pnlPts ?? 0) <= 0);
  const avg = (xs: CardCall[]) => (xs.length ? Math.round((xs.reduce((a, c) => a + (c.r ?? 0), 0) / xs.length) * 100) / 100 : null);
  return {
    calls: log.length,
    closed: done.length,
    wins: wins.length,
    losses: losses.length,
    open: log.length - done.length,
    winRate: done.length ? Math.round((wins.length / done.length) * 100) : null,
    totalR: Math.round(done.reduce((a, c) => a + (c.r ?? 0), 0) * 100) / 100,
    totalPts: r2(done.reduce((a, c) => a + (c.pnlPts ?? 0), 0)),
    avgWinR: avg(wins),
    avgLossR: avg(losses),
  };
}

export const COOL_OFF_MIN = 60;
export const MAX_STOPS_PER_DAY = 2;

/**
 * The circuit breaker. After a stop-out the same market often keeps chopping
 * against the setup, and two losers in a day are the sign the day does not
 * suit the system. So: no new call on a market for 60 minutes after it
 * stopped out, and no new calls at all after 2 stop-outs in a day.
 */
export function dayGuard(all: CardCall[], symbol: CardCall["symbol"], now: number): { blocked: boolean; reason: string | null } {
  const ist = (ms: number) => new Date(ms + 5.5 * 3600_000).toISOString();
  const today = ist(now).slice(0, 10);
  const stops = all.filter((c) => c.result === "stop" && c.closedAt && ist(Date.parse(c.closedAt)).slice(0, 10) === today);
  if (stops.length >= MAX_STOPS_PER_DAY) return { blocked: true, reason: `${stops.length} stop-losses today — no new calls until tomorrow. Protect the capital.` };
  const mine = stops.filter((c) => c.symbol === symbol).sort((a, b) => b.closedAt!.localeCompare(a.closedAt!))[0];
  if (mine) {
    const until = Date.parse(mine.closedAt!) + COOL_OFF_MIN * 60_000;
    if (now < until) return { blocked: true, reason: `Stopped out at ${ist(Date.parse(mine.closedAt!)).slice(11, 16)} — cooling off until ${ist(until).slice(11, 16)}.` };
  }
  return { blocked: false, reason: null };
}
