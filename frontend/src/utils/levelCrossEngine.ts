import type { Candle, Direction } from "../types";
import { findSwingPoints } from "./priceAction";
import { computeIndicatorSnapshot } from "./indicators";
import { detectBreakoutIgnition } from "./breakoutIgnition";
import { assessEntryQuality } from "./entryQuality";
import type { Decision6 } from "./timeframeEngine";

// The exact pattern the user pointed at on their own chart: a horizontal
// level tested several times (price kept coming back to it and failing to
// pass), then a candle finally closes through it with real conviction --
// and the move accelerates, because a level that's been tested repeatedly
// represents real, sizeable supply (at resistance) or demand (at support)
// that just got absorbed. This is standard, well-documented technical
// analysis (the more significant the level, the more significant the
// break), not a novel idea -- what's new here is scanning for it live,
// across every timeframe, with no fixed candle interval, and only
// surfacing it once genuine follow-through evidence backs the break.
//
// "Genuine" is the operative word: a level can also get tagged and rejected
// on a single wide-wick spike that immediately reverses -- exactly the
// exhaustion pattern entryQuality.ts already exists to catch (see the
// Best Call NG 270 CE writeup). This engine reuses that same check as a
// QUALIFYING filter rather than a soft score dock: since the whole premise
// here is "only the highest-probability breaks", a cross with real
// exhaustion warning signs simply doesn't qualify at all, the same way
// AI-Shoot's Hit Score bar means most scans return nothing.

export interface SrLevel {
  price: number;
  type: "support" | "resistance";
  touches: number;
  lastTouchIndex: number;
}

const LEVEL_TOLERANCE_PCT = 0.35; // cluster swings within this % of each other into one level
const MIN_TOUCHES = 2;

// Clusters swing highs (resistance candidates) and swing lows (support
// candidates) that sit within LEVEL_TOLERANCE_PCT of each other into a
// single level, counting each contributing swing as a "touch" -- the more
// touches, the more times the market has actually tested that price and
// failed to sustain a break, i.e. the more significant it is.
export function detectSignificantLevels(candles: Candle[], excludeLastBars = 3): SrLevel[] {
  if (candles.length < 40) return [];
  const usable = candles.slice(0, Math.max(1, candles.length - excludeLastBars));
  const swings = findSwingPoints(usable, 3);

  function cluster(type: "high" | "low"): SrLevel[] {
    const points = swings.filter((s) => s.type === type).sort((a, b) => a.price - b.price);
    const levels: { prices: number[]; lastIndex: number }[] = [];
    for (const p of points) {
      const group = levels.find((g) => {
        const avg = g.prices.reduce((s, v) => s + v, 0) / g.prices.length;
        return Math.abs(p.price - avg) / avg <= LEVEL_TOLERANCE_PCT / 100;
      });
      if (group) {
        group.prices.push(p.price);
        group.lastIndex = Math.max(group.lastIndex, p.index);
      } else {
        levels.push({ prices: [p.price], lastIndex: p.index });
      }
    }
    return levels
      .filter((g) => g.prices.length >= MIN_TOUCHES)
      .map((g) => ({
        price: Number((g.prices.reduce((s, v) => s + v, 0) / g.prices.length).toFixed(2)),
        type: (type === "high" ? "resistance" : "support") as "support" | "resistance",
        touches: g.prices.length,
        lastTouchIndex: g.lastIndex,
      }));
  }

  return [...cluster("high"), ...cluster("low")].sort((a, b) => b.touches - a.touches);
}

export interface LevelCrossSignal {
  tf: string;
  label: string;
  decision: Decision6;
  insufficient: string | null;
  direction: Direction;
  optSide: "CE" | "PE" | null;
  level: SrLevel | null;
  nextLevel: SrLevel | null;
  underlyingEntry: number | null;
  underlyingStop: number | null;
  underlyingTargets: [number, number, number] | null;
  confidence: number | null; // 0-100, same role as hitProbability elsewhere
  reasons: string[];
}

const MIN_VOLUME_RATIO = 1.3;
const MAX_QUALITY_PENALTY = 15; // stricter than the graduated dock elsewhere -- this engine only ever surfaces genuine breaks
const CROSS_LOOKBACK_BARS = 3; // "just crossed", not "crossed a while ago and is now far extended"

function emptySignal(tf: string, label: string, insufficient: string | null): LevelCrossSignal {
  return {
    tf,
    label,
    decision: "WAIT",
    insufficient,
    direction: "neutral",
    optSide: null,
    level: null,
    nextLevel: null,
    underlyingEntry: null,
    underlyingStop: null,
    underlyingTargets: null,
    confidence: null,
    reasons: [],
  };
}

export function evaluateLevelCross(candles: Candle[], tf: string, label: string): LevelCrossSignal {
  if (candles.length < 45) {
    return emptySignal(tf, label, `Not enough ${label} bars yet for a reliable level read (need 45+, have ${candles.length})`);
  }

  const levels = detectSignificantLevels(candles);
  if (!levels.length) return emptySignal(tf, label, null);

  const last = candles[candles.length - 1];
  const snap = computeIndicatorSnapshot(candles);
  const recentVolumes = candles.slice(-21, -1).map((c) => c.volume ?? 0);
  const avgVolume = recentVolumes.length ? recentVolumes.reduce((s, v) => s + v, 0) / recentVolumes.length : 0;
  const volumeRatio = avgVolume > 0 ? (last.volume ?? 0) / avgVolume : 0;
  const recentBars = candles.slice(-CROSS_LOOKBACK_BARS);

  // A resistance level is "crossed bullish" when the current close is above
  // it but a bar within the lookback window was still at/below it -- a
  // fresh break, not one that happened many bars ago and has since run far.
  function justCrossedUp(level: SrLevel): boolean {
    if (last.close <= level.price) return false;
    return recentBars.some((c) => c.close <= level.price) || candles[candles.length - 1 - CROSS_LOOKBACK_BARS]?.close <= level.price;
  }
  function justCrossedDown(level: SrLevel): boolean {
    if (last.close >= level.price) return false;
    return recentBars.some((c) => c.close >= level.price) || candles[candles.length - 1 - CROSS_LOOKBACK_BARS]?.close >= level.price;
  }

  const bullishCrosses = levels.filter((l) => l.type === "resistance" && justCrossedUp(l));
  const bearishCrosses = levels.filter((l) => l.type === "support" && justCrossedDown(l));

  // Most-touched (most significant) qualifying level wins if more than one
  // crossed at once -- a level tested 5 times breaking means more than one
  // tested twice.
  const bestBullish = bullishCrosses.sort((a, b) => b.touches - a.touches)[0] ?? null;
  const bestBearish = bearishCrosses.sort((a, b) => b.touches - a.touches)[0] ?? null;

  let direction: Direction = "neutral";
  let level: SrLevel | null = null;
  if (bestBullish && bestBearish) {
    level = bestBullish.touches >= bestBearish.touches ? bestBullish : bestBearish;
    direction = level === bestBullish ? "bullish" : "bearish";
  } else if (bestBullish) {
    level = bestBullish;
    direction = "bullish";
  } else if (bestBearish) {
    level = bestBearish;
    direction = "bearish";
  }

  if (!level || direction === "neutral") return emptySignal(tf, label, null);

  // Genuine-break qualifying filter (see file header) -- a weak close,
  // already-extended RSI, or volume running against the break disqualifies
  // it outright rather than just docking points, since this page's whole
  // point is "only the best probability, even if that's zero today".
  const quality = assessEntryQuality(last, direction, snap, candles);
  const reasons: string[] = [`${level.type === "resistance" ? "Resistance" : "Support"} at ${level.price} tested ${level.touches} times, just broken ${direction === "bullish" ? "above" : "below"}`];

  if (quality.penaltyPct > MAX_QUALITY_PENALTY) {
    reasons.push(...quality.reasons, "Break doesn't show enough conviction yet (weak close / exhaustion signs) -- waiting for a cleaner one");
    return { ...emptySignal(tf, label, null), reasons };
  }
  if (volumeRatio < MIN_VOLUME_RATIO) {
    reasons.push(`Volume ${volumeRatio.toFixed(2)}x average is below the ${MIN_VOLUME_RATIO}x minimum needed to trust this break`);
    return { ...emptySignal(tf, label, null), reasons };
  }

  reasons.push(`Volume ${volumeRatio.toFixed(2)}x the recent average confirms real participation behind the break`);

  const ignition = detectBreakoutIgnition(candles);
  const ignitionAligned = ignition.firing && ignition.direction === direction;
  if (ignitionAligned) reasons.push(...ignition.notes);

  const adxRising = snap.adx14 !== null && snap.adx14 >= 18;
  if (adxRising) reasons.push(`ADX ${snap.adx14!.toFixed(1)} shows real trend strength building`);

  // Target = the next significant level further out in the break's
  // direction (a real, level-derived target, not an invented number) --
  // falls back to an ATR projection only when no further level exists.
  const beyond = levels
    .filter((l) => (direction === "bullish" ? l.price > level!.price : l.price < level!.price))
    .sort((a, b) => (direction === "bullish" ? a.price - b.price : b.price - a.price));
  const nextLevel = beyond[0] ?? null;

  const atr = snap.atr14 ?? last.close * 0.01;
  const sign = direction === "bullish" ? 1 : -1;
  const underlyingEntry = last.close;
  // A broken resistance becomes support (and vice versa) -- classic
  // principle -- so the stop sits just back on the other side of the level
  // that just broke, with a small ATR buffer against noise.
  const underlyingStop = Number((level.price - sign * atr * 0.4).toFixed(2));
  const t1 = nextLevel && Math.abs(nextLevel.price - underlyingEntry) >= atr * 0.8 ? nextLevel.price : underlyingEntry + sign * atr * 1.5;
  const underlyingTargets: [number, number, number] = [
    Number(t1.toFixed(2)),
    Number((underlyingEntry + sign * Math.abs(t1 - underlyingEntry) * 1.6).toFixed(2)),
    Number((underlyingEntry + sign * Math.abs(t1 - underlyingEntry) * 2.4).toFixed(2)),
  ];
  if (nextLevel) reasons.push(`Next significant level (${nextLevel.touches}x tested) at ${nextLevel.price} used as the real target, not a projection`);

  const touchBonus = Math.min(20, (level.touches - MIN_TOUCHES) * 6);
  const volBonus = Math.min(15, (volumeRatio - MIN_VOLUME_RATIO) * 10);
  const ignitionBonus = ignitionAligned ? 12 : 0;
  const adxBonus = adxRising ? 8 : 0;
  const confidence = Math.round(Math.max(20, Math.min(97, 55 + touchBonus + volBonus + ignitionBonus + adxBonus - quality.penaltyPct)));

  const decision: Decision6 = confidence >= 80 ? (direction === "bullish" ? "STRONG BUY" : "STRONG SELL") : confidence >= 60 ? (direction === "bullish" ? "BUY" : "SELL") : "WAIT";
  if (decision === "WAIT") reasons.push(`Confidence ${confidence} is below this page's own high bar -- logged as a near miss, not a live call`);

  return {
    tf,
    label,
    decision,
    insufficient: null,
    direction,
    optSide: decision === "WAIT" ? null : direction === "bullish" ? "CE" : "PE",
    level,
    nextLevel,
    underlyingEntry: decision === "WAIT" ? null : underlyingEntry,
    underlyingStop: decision === "WAIT" ? null : underlyingStop,
    underlyingTargets: decision === "WAIT" ? null : underlyingTargets,
    confidence,
    reasons,
  };
}
