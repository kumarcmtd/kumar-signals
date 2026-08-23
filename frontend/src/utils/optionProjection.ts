import type { OptionsAnalytics } from "../types";

// The single, shared way this app turns an underlying entry/stop/target set
// into an OPTION-premium entry/stop/target set. Lives in its own module (not
// on either engine) so bestCallSelector and directionalGateEngine can both
// use it without a circular import, and every card in the app projects
// premiums the exact same, honest way.

export interface PremiumProjection {
  strike: number;
  entry: number;
  targets: [number, number, number];
  stop: number;
  rr: number | null;
  delta: number; // the |delta| actually used (real per-strike, or the fallback)
  thetaPerDay: number; // the per-day theta actually used (<= 0)
}

const DELTA_FALLBACK = 0.5;
// A modest, uniform expected hold of ~4 trading hours, expressed as a
// fraction of a CALENDAR day (theta is quoted per calendar day). Long enough
// that the theta haircut is meaningful near expiry -- exactly where the old
// flat-delta, no-theta projection was most optimistic -- without
// over-penalizing a quick intraday scalp.
const HOLD_DAYS_DEFAULT = 0.17;
// Never let a projected stop imply losing more than 65% of the premium.
const STOP_FLOOR_FRACTION = 0.35;

// optSide's ATM leg carries the real Black-76 delta and per-day theta the
// worker already solves from the live premium. Uses them instead of a flat
// 0.5 delta with no decay:
//  - delta: real premium sensitivity to a favourable underlying move (puts
//    carry a negative delta, so we take the magnitude). Falls back to 0.5
//    only if the chain couldn't produce one, so behaviour degrades gracefully.
//  - theta: reduces each target by the premium that decays away while holding.
//  - gamma: deliberately OMITTED. It would only RAISE targets as the option
//    goes in-the-money, so leaving it out keeps the projection conservative
//    -- better to under-promise the target premium than over-promise it.
export function projectPremiumFromUnderlying(
  optSide: "CE" | "PE",
  underlyingEntry: number,
  underlyingStop: number,
  underlyingTargets: [number, number, number],
  options: OptionsAnalytics | undefined,
  holdDays: number = HOLD_DAYS_DEFAULT
): PremiumProjection | null {
  if (!options || options.error) return null;
  const row = options.rows.find((r) => r.strike === options.atmStrike) ?? options.rows[Math.floor(options.rows.length / 2)];
  if (!row) return null;
  const leg = optSide === "CE" ? row.call : row.put;
  if (leg.ltp === null || leg.ltp <= 0) return null;
  const entry = leg.ltp;

  const rawDelta = typeof leg.delta === "number" ? Math.abs(leg.delta) : NaN;
  const delta = Number.isFinite(rawDelta) && rawDelta > 0.05 && rawDelta <= 1 ? rawDelta : DELTA_FALLBACK;

  const thetaPerDay = typeof leg.theta === "number" ? Math.min(0, leg.theta) : 0;
  const decay = thetaPerDay * holdDays; // <= 0, premium eroded over the hold

  const fav = (uTarget: number) => Math.max(0, delta * Math.abs(uTarget - underlyingEntry) + decay);
  const targets: [number, number, number] = [
    Number((entry + fav(underlyingTargets[0])).toFixed(2)),
    Number((entry + fav(underlyingTargets[1])).toFixed(2)),
    Number((entry + fav(underlyingTargets[2])).toFixed(2)),
  ];

  const riskMove = Math.abs(underlyingEntry - underlyingStop);
  const stop = Number(Math.max(entry * STOP_FLOOR_FRACTION, entry - delta * riskMove).toFixed(2));

  // Canonical reward:risk -- premium reward to Target 2 over premium risk.
  // Target 1 and the stop are both built from the same ~1.5x-ATR underlying
  // step, so R:R measured to Target 1 is structurally ~1:1 for EVERY engine
  // and carries no information; Target 2 is the first level reflecting a real
  // edge. Using it consistently makes the "R:R" on every card mean the same
  // thing -- and on the thing you actually trade, the option.
  const rr = entry - stop > 0 ? Number(((targets[1] - entry) / (entry - stop)).toFixed(2)) : null;

  return { strike: row.strike, entry, targets, stop, rr, delta, thetaPerDay };
}
