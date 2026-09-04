// Early "you're near a big level" radar. Crude/NG spend most of their time
// between the same tested support/resistance shelves; the money is made by
// spotting price ARRIVING at one -- to bounce, to reject, or to break -- a few
// candles early. This reuses the exact same significant-level detector the
// Level Cross page trusts, then reads where live price sits relative to the
// nearest shelf above and below and turns it into one plain warning. Pure and
// deterministic.

import type { Candle } from "../types";
import { detectSignificantLevels } from "./levelCrossEngine";
import { atr } from "./indicators";

export type LevelAlertKind = "near_support" | "near_resistance" | "breakout_up" | "breakdown";

export interface LevelAlert {
  kind: LevelAlertKind;
  price: number; // the level in play
  touches: number; // how many times it was tested (conviction)
  distancePct: number; // how far live price is from it, %
  headline: string;
  detail: string;
}

// A level "in play" is within this many ATRs of live price. A fresh break is
// price having crossed it within the last couple of bars.
const NEAR_ATR_MULT = 0.7;

export function detectLevelProximity(candles: Candle[]): LevelAlert | null {
  if (!candles || candles.length < 45) return null;
  const atrV = atr(candles, 14);
  if (!atrV || atrV <= 0) return null;

  const levels = detectSignificantLevels(candles);
  if (!levels.length) return null;

  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const price = last.close;
  const near = NEAR_ATR_MULT * atrV;

  const fmt = (p: number) => `₹${p.toFixed(2)}`;
  const dist = (p: number) => Math.abs((price - p) / price) * 100;

  // 1) Fresh break the priority: price closed through a level it was on the
  //    other side of one bar ago.
  const brokeUp = levels
    .filter((l) => prev.close <= l.price && last.close > l.price)
    .sort((a, b) => b.touches - a.touches)[0];
  if (brokeUp) {
    return {
      kind: "breakout_up",
      price: brokeUp.price,
      touches: brokeUp.touches,
      distancePct: Number(dist(brokeUp.price).toFixed(2)),
      headline: `BREAKING OUT above ${fmt(brokeUp.price)}`,
      detail: `Price just pushed through resistance tested ${brokeUp.touches}× — a momentum move up can follow. Watch for it to hold above.`,
    };
  }
  const brokeDown = levels
    .filter((l) => prev.close >= l.price && last.close < l.price)
    .sort((a, b) => b.touches - a.touches)[0];
  if (brokeDown) {
    return {
      kind: "breakdown",
      price: brokeDown.price,
      touches: brokeDown.touches,
      distancePct: Number(dist(brokeDown.price).toFixed(2)),
      headline: `BREAKING DOWN below ${fmt(brokeDown.price)}`,
      detail: `Price just lost support tested ${brokeDown.touches}× — a fall can follow. Watch for it to stay below.`,
    };
  }

  // 2) Approaching a shelf: nearest level above (resistance) / below (support).
  const above = levels.filter((l) => l.price > price).sort((a, b) => a.price - b.price)[0];
  const below = levels.filter((l) => l.price < price).sort((a, b) => b.price - a.price)[0];

  const aboveDist = above ? above.price - price : Infinity;
  const belowDist = below ? price - below.price : Infinity;

  // Whichever shelf is closer, if it's within range.
  if (above && aboveDist <= near && aboveDist <= belowDist) {
    return {
      kind: "near_resistance",
      price: above.price,
      touches: above.touches,
      distancePct: Number(dist(above.price).toFixed(2)),
      headline: `Approaching resistance ${fmt(above.price)}`,
      detail: `Live price is closing in on a level tested ${above.touches}× — expect either a rejection down or a breakout up. Be ready, don't chase blind.`,
    };
  }
  if (below && belowDist <= near) {
    return {
      kind: "near_support",
      price: below.price,
      touches: below.touches,
      distancePct: Number(dist(below.price).toFixed(2)),
      headline: `Near support ${fmt(below.price)}`,
      detail: `Live price is closing in on a level tested ${below.touches}× — expect either a bounce up or a breakdown. Be ready, don't chase blind.`,
    };
  }

  return null;
}
