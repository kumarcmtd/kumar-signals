// Ai20-20 v3 order ticket: which strike to buy, at what price, and every
// level in rupees -- one exact instruction, nothing to work out.
//
// Strike choice (practitioner consensus for intraday option BUYING): at the
// money or slightly in the money, delta about 0.5-0.65. Far out-of-the-money
// options barely move until the future runs a long way, and lose value fast.
// Close to expiry time decay is heaviest at the money, so one strike in the
// money is preferred. A strike must also trade (open interest and volume)
// so the order fills near the screen price.

import type { OptionsAnalytics } from "../../types";
import { BUY_UP_TO_SHARE } from "../buyNow";
import { daysToExpiry } from "../oiBuildup";
import { LAB_LOT, type LabSym } from "../twentyLab";
import type { V3Entry } from "./setups";

export interface StrikeChoice {
  strike: number;
  ltp: number;
  delta: number;
  deltaKnown: boolean;
  oi: number | null;
  volume: number | null;
  inMoney: 0 | 1 | 2;
  daysToExpiry: number | null;
  why: string;
}

/** Usual delta by how far in the money, used only when the chain has no greeks. */
const DELTA_GUESS = [0.5, 0.6, 0.68] as const;

export function pickStrike(options: OptionsAnalytics | undefined, side: "CE" | "PE", now: number = Date.now()): StrikeChoice | null {
  if (!options || options.error || !options.rows?.length) return null;
  const rows = [...options.rows].sort((a, b) => a.strike - b.strike);
  let atm = rows.findIndex((r) => r.strike === options.atmStrike);
  if (atm < 0) atm = rows.reduce((best, r, i) => (Math.abs(r.strike - options.spot) < Math.abs(rows[best].strike - options.spot) ? i : best), 0);
  const dte = options.expiry ? daysToExpiry(options.expiry, now) : null;
  const target = dte !== null && dte <= 3 ? 0.62 : 0.55;
  const legOf = (i: number) => (side === "CE" ? rows[i]?.call : rows[i]?.put);
  let maxOi = 0;
  for (let i = Math.max(0, atm - 2); i <= Math.min(rows.length - 1, atm + 2); i++) maxOi = Math.max(maxOi, legOf(i)?.oi ?? 0);
  const cands: StrikeChoice[] = [];
  for (const step of [0, 1, 2] as const) {
    const i = side === "CE" ? atm - step : atm + step;
    const leg = legOf(i);
    if (!leg || leg.ltp === null || !(leg.ltp >= 1)) continue;
    const raw = typeof leg.delta === "number" ? Math.abs(leg.delta) : NaN;
    const known = raw >= 0.1 && raw <= 0.95;
    const liquid = maxOi <= 0 || ((leg.oi ?? 0) >= 0.2 * maxOi && (leg.volume ?? 1) > 0);
    if (!liquid && step > 0) continue;
    cands.push({ strike: rows[i].strike, ltp: leg.ltp, delta: known ? raw : DELTA_GUESS[step], deltaKnown: known, oi: leg.oi ?? null, volume: leg.volume ?? null, inMoney: step, daysToExpiry: dte, why: "" });
  }
  if (!cands.length) return null;
  const best = cands.reduce((a, b) => (Math.abs(b.delta - target) < Math.abs(a.delta - target) ? b : a));
  const where = best.inMoney === 0 ? "At the money" : `${best.inMoney} strike${best.inMoney > 1 ? "s" : ""} in the money`;
  const dteText = dte === null ? "" : dte <= 3 ? ` — ${dte} day${dte === 1 ? "" : "s"} to expiry, so a little in the money loses less to time decay` : ` — ${dte} days to expiry`;
  best.why = `${where}, delta ${best.delta.toFixed(2)}${best.deltaKnown ? "" : " (estimated)"}${dteText}.`;
  return best;
}

export interface V3Ticket {
  sym: LabSym;
  side: "CE" | "PE";
  strike: number;
  entry: number;
  /** Highest price still worth paying (a quarter of the way to T1). */
  maxPay: number;
  stop: number;
  targets: [number, number, number];
  delta: number;
  lotSize: number;
  riskPerLot: number;
  premiumPerLot: number;
  targetRsPerLot: [number, number, number];
  strikeWhy: string;
}

const r2 = (n: number) => Number(n.toFixed(2));

/** The option prices for a call: futures levels moved to the option by its delta. */
export function buildTicket(e: V3Entry, choice: StrikeChoice, sym: LabSym): V3Ticket {
  const d = choice.delta;
  const entry = choice.ltp;
  const stop = r2(Math.max(entry * 0.5, entry - d * e.stopPts));
  const t1 = r2(entry + d * e.t1Pts);
  const t2 = r2(entry + d * 1.6 * e.t1Pts);
  const t3 = r2(entry + d * 2.25 * e.t1Pts);
  const lotSize = LAB_LOT[sym];
  return {
    sym,
    side: e.side,
    strike: choice.strike,
    entry,
    maxPay: r2(entry + BUY_UP_TO_SHARE * (t1 - entry)),
    stop,
    targets: [t1, t2, t3],
    delta: r2(d),
    lotSize,
    riskPerLot: Math.round((entry - stop) * lotSize),
    premiumPerLot: Math.round(entry * lotSize),
    targetRsPerLot: [Math.round((t1 - entry) * lotSize), Math.round((t2 - entry) * lotSize), Math.round((t3 - entry) * lotSize)],
    strikeWhy: choice.why,
  };
}
