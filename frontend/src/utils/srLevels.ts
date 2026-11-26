// Support and rejection levels for the Ai-Chart, from real candles only:
//
//   1. Turns: a candle whose high (low) is the extreme of 5 candles on each
//      side, which price then left by at least 1.5 ATR -- a real rejection
//      (or bounce), not a wiggle.
//   2. Turns within half an ATR of each other are one level; turns closer
//      than 12 candles apart count once (one test, not two).
//   3. Below today's price a level is SUPPORT, above it RESISTANCE (a broken
//      ceiling often becomes the floor). STRONG: price turned there 4+ times.
//      WEAK: 2 or 3 times.
//
// Nothing is guessed: a level exists only where price really turned.

import type { Candle } from "../types";
import { atr } from "./indicators";

export type LevelKind = "support" | "resistance";
export type LevelTier = "strong" | "weak";

export interface SrLevel {
  price: number;
  kind: LevelKind;
  tier: LevelTier;
  /** Separate times price turned at this level (bounces and rejections). */
  holds: number;
  /** The last time price turned here (ISO). */
  lastHeld: string;
}

// A turn must be the extreme of 5 candles each side (about 5 hours on 30-minute
// candles) and see price leave by 1.5 ATR: only real swing highs and lows.
const SIDE = 5;
const MIN_REACTION_ATR = 1.5;
const MERGE_ATR = 0.5;
const SAME_TEST_BARS = 12;

const r2 = (n: number) => Math.round(n * 100) / 100;

interface Turn {
  price: number;
  i: number;
}

/**
 * Levels from candles (oldest first, any timeframe; 30-minute candles over a
 * few weeks give the best picture), classed against `price`.
 */
export function findSrLevels(candles: Candle[], price: number): SrLevel[] {
  const c = [...candles].sort((a, b) => a.date.localeCompare(b.date));
  if (c.length < 40) return [];
  const a = atr(c, 14);
  if (!a || a <= 0) return [];
  const turns: Turn[] = [];
  for (let i = SIDE; i < c.length - SIDE; i++) {
    const win = c.slice(i - SIDE, i + SIDE + 1);
    const next = c.slice(i + 1, i + 7);
    if (c[i].high === Math.max(...win.map((k) => k.high)) && c[i].high - Math.min(...next.map((k) => k.low)) >= MIN_REACTION_ATR * a) turns.push({ price: c[i].high, i });
    if (c[i].low === Math.min(...win.map((k) => k.low)) && Math.max(...next.map((k) => k.high)) - c[i].low >= MIN_REACTION_ATR * a) turns.push({ price: c[i].low, i });
  }
  turns.sort((x, y) => x.price - y.price);
  // Turns within half an ATR make one level -- measured from the level's lowest
  // turn, so a busy price area cannot chain into one endless "level".
  const groups: Turn[][] = [];
  for (const t of turns) {
    const g = groups[groups.length - 1];
    if (g && t.price - g[0].price <= MERGE_ATR * a) g.push(t);
    else groups.push([t]);
  }
  const out: SrLevel[] = [];
  for (const g of groups) {
    // Turns a few candles apart are the same test.
    const byTime = [...g].sort((x, y) => x.i - y.i);
    let holds = 0;
    let lastI = -Infinity;
    for (const t of byTime) {
      if (t.i - lastI >= SAME_TEST_BARS) holds++;
      lastI = t.i;
    }
    const tier: LevelTier | null = holds >= 4 ? "strong" : holds >= 2 ? "weak" : null;
    if (!tier) continue;
    const level = r2([...g].sort((x, y) => x.price - y.price)[Math.floor(g.length / 2)].price);
    out.push({ price: level, kind: level <= price ? "support" : "resistance", tier, holds, lastHeld: c[byTime[byTime.length - 1].i].date });
  }
  return out;
}

/**
 * What the chart draws: the nearest strong and weak levels on each side of the
 * price, within `maxDist` (price points), at most `perTier` of each.
 */
export function chartLevels(levels: SrLevel[], price: number, maxDist: number, perTier = 2): SrLevel[] {
  const near = levels.filter((l) => Math.abs(l.price - price) <= maxDist).sort((x, y) => Math.abs(x.price - price) - Math.abs(y.price - price));
  const pick = (kind: LevelKind, tier: LevelTier) => near.filter((l) => l.kind === kind && l.tier === tier).slice(0, perTier);
  return [...pick("support", "strong"), ...pick("support", "weak"), ...pick("resistance", "strong"), ...pick("resistance", "weak")];
}
