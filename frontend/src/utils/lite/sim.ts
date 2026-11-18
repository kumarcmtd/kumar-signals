// Ai Lite replay for the lab: the rules read on 15-minute bars built from
// 5-minute candles, each call then managed on the following 5-minute candles
// the way the live trade log manages it. Option premium moves at delta 0.5 of
// the futures move; Rs 150 crude / Rs 200 gas costs a call and ~Rs 50 an hour
// of time decay come off every result. The stop counts first when a candle
// touches both the stop and a target.

import type { Candle } from "../../types";
import { resampleCandles } from "../candleResample";
import { mcxCloseMinutes } from "../mcxSession";
import { LITE, LITE_LOT, liteBars, liteSignal, type LiteKind, type LiteSym, type Side } from "./engine";

const DELTA = 0.5;
const THETA_RS_PER_HOUR = 50;
const COST_RS: Record<LiteSym, number> = { CRUDEOIL: 150, NATURALGAS: 200 };
const IST_MS = 5.5 * 3600_000;

export type LiteExit = "t3" | "sl" | "breakeven" | "after_t1" | "day_end";
export interface LiteTrade {
  side: Side;
  kind: LiteKind;
  openAt: number;
  closeAt: number;
  rs: number;
  exit: LiteExit;
}
export interface LiteSimOpts {
  stopRs?: number;
  /** Turn a rule off to see what it adds (lab only). */
  noChase?: boolean;
  only?: LiteKind;
  /** Keep trading after 2 stops / Rs 2,000 booked (lab only). */
  noDayRules?: boolean;
}

const istDayOf = (ms: number) => Math.floor((ms + IST_MS) / 86_400_000);
const bellOf = (ms: number) => {
  const d = new Date(ms + IST_MS);
  return mcxCloseMinutes(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
};

export function simulateLite(c5: Candle[], sym: LiteSym, opts: LiteSimOpts = {}): LiteTrade[] {
  const lot = LITE_LOT[sym];
  const pts = (rs: number) => rs / (DELTA * lot);
  const stopPts = pts(opts.stopRs ?? LITE.stopRs);
  const [t1, t2, tgt] = [pts(LITE.t1Rs), pts(LITE.t2Rs), pts(LITE.targetRs)];
  const b = liteBars(resampleCandles(c5, 15));
  // The 15-minute bar that each 5-minute candle closes (by end time).
  const barAtEnd = new Map<number, number>();
  b.t.forEach((t, i) => barAtEnd.set(t + 15 * 60_000, i));
  const t5 = c5.map((k) => Date.parse(k.date));
  const out: LiteTrade[] = [];
  let pos: { side: Side; kind: LiteKind; entry: number; i0: number; stop: number; h1: boolean; h2: boolean } | null = null;
  let day = NaN;
  let stops = 0;
  let booked = 0;
  let lastStop: { side: Side; at: number } | null = null;

  const close = (j: number, fav: number, exit: LiteExit) => {
    const p = pos!;
    const hours = (t5[j] - t5[p.i0]) / 3600_000;
    const rs = Math.round(DELTA * fav * lot - COST_RS[sym] - THETA_RS_PER_HOUR * hours);
    out.push({ side: p.side, kind: p.kind, openAt: t5[p.i0], closeAt: t5[j] + 5 * 60_000, rs, exit });
    if (exit === "sl") {
      stops++;
      lastStop = { side: p.side, at: t5[j] };
    }
    booked += rs;
    pos = null;
  };

  for (let j = 0; j < c5.length; j++) {
    const k = c5[j];
    const dj = istDayOf(t5[j]);
    if (dj !== day) {
      day = dj;
      stops = 0;
      booked = 0;
    }
    const lastOfDay = j === c5.length - 1 || istDayOf(t5[j + 1]) !== dj;
    if (pos) {
      const p: NonNullable<typeof pos> = pos;
      const d = p.side === "CE" ? 1 : -1;
      const fav = (x: number) => d * (x - p.entry);
      const worst = d > 0 ? fav(k.low) : fav(k.high);
      const best = d > 0 ? fav(k.high) : fav(k.low);
      if (worst <= p.stop) close(j, Math.min(fav(k.open), p.stop), p.h2 ? "after_t1" : p.h1 ? "breakeven" : "sl");
      else if (best >= tgt) close(j, tgt, "t3");
      else {
        if (best >= t1) p.h1 = true;
        if (best >= t2) p.h2 = true;
        p.stop = p.h2 ? t1 : p.h1 ? Math.max(p.stop, 0) : p.stop;
        if (lastOfDay) close(j, fav(k.close), "day_end");
      }
    }
    if (pos || lastOfDay) continue;
    const i = barAtEnd.get(t5[j] + 5 * 60_000);
    if (i === undefined) continue;
    if (!opts.noDayRules && (stops >= LITE.maxStopsPerDay || booked >= LITE.dayGoalRs)) continue;
    const s = liteSignal(b, i, bellOf(b.t[i]));
    let side = s.side;
    let kind = s.kind;
    if (opts.noChase && !side && s.lean && s.checks.find((c) => c.key === "trigger")?.ok) {
      side = s.lean;
      kind = s.checks.find((c) => c.key === "trigger")!.detail.startsWith("Dip") ? "pullback" : "breakout";
    }
    if (!side || !kind || (opts.only && kind !== opts.only)) continue;
    const ls = lastStop as { side: Side; at: number } | null;
    if (ls && ls.side === side && t5[j] - ls.at < LITE.cooldownMs) continue;
    pos = { side, kind, entry: k.close, i0: j, stop: -stopPts, h1: false, h2: false };
  }
  return out;
}

export interface LiteStats {
  trades: number;
  perMonth: number;
  winPct: number;
  avgRs: number;
  netRs: number;
  pf: number | null;
  maxDdRs: number;
  firstHalfAvg: number | null;
  secondHalfAvg: number | null;
  exits: Record<string, number>;
}

export function liteStats(t: LiteTrade[], days: number): LiteStats {
  const net = t.reduce((a, x) => a + x.rs, 0);
  const win = t.filter((x) => x.rs > 0);
  const loss = t.filter((x) => x.rs < 0);
  const gl = -loss.reduce((a, x) => a + x.rs, 0);
  let peak = 0;
  let eq = 0;
  let dd = 0;
  for (const x of t) {
    eq += x.rs;
    peak = Math.max(peak, eq);
    dd = Math.max(dd, peak - eq);
  }
  const half = Math.floor(t.length / 2);
  const avg = (xs: LiteTrade[]) => (xs.length ? Math.round(xs.reduce((a, x) => a + x.rs, 0) / xs.length) : null);
  const exits: Record<string, number> = {};
  for (const x of t) exits[x.exit] = (exits[x.exit] ?? 0) + 1;
  return {
    trades: t.length,
    perMonth: days ? Math.round((t.length / days) * 21 * 10) / 10 : 0,
    winPct: t.length ? Math.round((win.length / t.length) * 100) : 0,
    avgRs: t.length ? Math.round(net / t.length) : 0,
    netRs: Math.round(net),
    pf: gl > 0 ? Math.round((win.reduce((a, x) => a + x.rs, 0) / gl) * 100) / 100 : null,
    maxDdRs: Math.round(dd),
    firstHalfAvg: avg(t.slice(0, half)),
    secondHalfAvg: avg(t.slice(half)),
    exits,
  };
}
