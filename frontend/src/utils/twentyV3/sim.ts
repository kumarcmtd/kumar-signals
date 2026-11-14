// Ai20-20 v3 trade replay: walks finished 5-minute candles, opens a trade when
// a setup fires and manages it the way the page and the server do. Same money
// model as the v2 lab: option at delta 0.5, Rs per lot after costs (spread +
// charges per trade, ~Rs 50 per lot per hour of time decay). One trade at a
// time, never held overnight, the stop counts first when a candle touches
// both the stop and a target.

import { LAB_COST_RS, LAB_DELTA, LAB_LOT, type LabSym, type LabTrade } from "../twentyLab";
import { bandAt, firstEntry, type V3Ctx, type V3Entry, type V3SetupId } from "./setups";

const THETA_RS_PER_HOUR = 50;
const REENTRY_COOLDOWN_BARS = 2;

export interface V3Trade extends LabTrade {
  setup: V3SetupId;
}

export interface V3SimOpts {
  sym: LabSym;
  /** No new trade after this many stop-losses in a day. */
  maxStopsPerDay?: number;
  maxTradesPerDay?: number;
  /** No new trade once the day's booked loss reaches this many rupees per lot. */
  dayLossLimitRs?: number;
  /** Extra rupees per trade on top of the usual costs (a stress test). */
  extraCostRs?: number;
}

interface Pos extends V3Entry {
  i0: number;
  entry: number;
  t2: number;
  t3: number;
  h1: boolean;
  h2: boolean;
  best: number;
}

/** Where a trailing trade exits at candle i's close (futures price), or null if it stays. */
export function trailHit(ctx: V3Ctx, i: number, side: "CE" | "PE"): boolean {
  const b = bandAt(ctx.f, i, ctx.k ?? 1);
  const v = ctx.f.vwap[i];
  const close = ctx.p.c[i].close;
  if (!b || !Number.isFinite(v)) return false;
  return side === "CE" ? close < Math.max(b.upper, v) : close > Math.min(b.lower, v);
}

export function simulateV3(ctx: V3Ctx, setups: readonly V3SetupId[], opts: V3SimOpts): V3Trade[] {
  const { p } = ctx;
  const c = p.c;
  const lot = LAB_LOT[opts.sym];
  const cost = LAB_COST_RS[opts.sym] + (opts.extraCostRs ?? 0);
  const out: V3Trade[] = [];
  let open: Pos | null = null;
  let lastStop: { side: "CE" | "PE"; at: number } | null = null;
  let day = NaN;
  let stops = 0;
  let trades = 0;
  let booked = 0;

  const close = (j: number, fav: number, exit: LabTrade["exit"]) => {
    const o = open!;
    const hours = ((j - o.i0) * 5) / 60;
    const rs = Math.round(LAB_DELTA * fav * lot - cost - THETA_RS_PER_HOUR * hours);
    out.push({ setup: o.setup, side: o.side, openIdx: o.i0, closeIdx: j, openAt: c[o.i0].date, entryMinute: p.minute[o.i0], t1: o.h1, exit, rs });
    if (exit === "sl" || exit === "breakeven" || exit === "after_t1" || exit === "trail") lastStop = { side: o.side, at: j };
    if (exit === "sl") stops++;
    booked += rs;
    open = null;
  };

  for (let i = 0; i < c.length; i++) {
    if (p.day[i] !== day) {
      day = p.day[i];
      stops = trades = booked = 0;
    }
    if (open) {
      const o: Pos = open;
      const k = c[i];
      const d = o.side === "CE" ? 1 : -1;
      const favOf = (x: number) => d * (x - o.entry);
      const adverse = d > 0 ? favOf(k.low) : favOf(k.high);
      const best = d > 0 ? favOf(k.high) : favOf(k.low);
      if (o.manage === "steps") {
        const eff = o.h2 ? o.t1Pts : o.h1 ? 0 : -o.stopPts;
        if (adverse <= eff) close(i, Math.min(favOf(k.open), eff), o.h2 ? "after_t1" : o.h1 ? "breakeven" : "sl");
        else {
          if (best >= o.t1Pts) o.h1 = true;
          if (best >= o.t2) o.h2 = true;
          if (best >= o.t3) close(i, o.t3, "t3");
          else {
            const eff2 = o.h2 ? o.t1Pts : o.h1 ? 0 : -o.stopPts;
            if (eff2 > eff && favOf(k.close) <= eff2) close(i, eff2, o.h2 ? "after_t1" : "breakeven");
            else if (p.lastOfDay[i]) close(i, favOf(k.close), "day_end");
          }
        }
      } else {
        if (adverse <= -o.stopPts) close(i, Math.min(favOf(k.open), -o.stopPts), "sl");
        else {
          o.best = Math.max(o.best, best);
          if (o.best >= o.t1Pts) o.h1 = true;
          const check = o.manage === "trail5" || (o.manage === "trail30" && ctx.f.sessMin[i] % 30 === 25);
          if ((o.manage === "trail5" || o.manage === "trail30") && check && i > o.i0 && trailHit(ctx, i, o.side)) close(i, favOf(k.close), "trail");
          else if (p.lastOfDay[i]) close(i, favOf(k.close), "day_end");
        }
      }
    }
    if (open || p.lastOfDay[i]) continue;
    if (opts.maxStopsPerDay !== undefined && stops >= opts.maxStopsPerDay) continue;
    if (opts.maxTradesPerDay !== undefined && trades >= opts.maxTradesPerDay) continue;
    if (opts.dayLossLimitRs !== undefined && booked <= -opts.dayLossLimitRs) continue;
    const e = firstEntry(ctx, i, setups);
    if (!e) continue;
    const ls = lastStop as { side: "CE" | "PE"; at: number } | null;
    if (ls && ls.side === e.side && i - ls.at < REENTRY_COOLDOWN_BARS) continue;
    open = { ...e, i0: i, entry: c[i].close, t2: 1.6 * e.t1Pts, t3: 2.25 * e.t1Pts, h1: false, h2: false, best: 0 };
    trades++;
  }
  return out;
}
