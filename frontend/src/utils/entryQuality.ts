import type { Candle, Direction, IndicatorSnapshot } from "../types";

// Every entry across this app's three Best-Call source engines (AI Elite,
// Directional Gate, Kimi Playbook) is priced at `last.close` the instant a
// setup fires -- none of them check whether that triggering candle is a
// genuine, backed breakout or an exhaustion spike about to reverse. The
// Day-wise Log shows why that matters: a 53% stop-loss rate against a 30%
// target-hit rate, and the clearest example (Natural Gas 270 CE, entered at
// 6.90, peaked at 6.95, then fell to 4.80) shows the exact signature of a
// bought top -- every momentum indicator flipped within a few candles, and
// down-volume outran up-volume 4:1 right after entry.
//
// This is a GRADUATED penalty, not a veto -- per this session's own
// recurring lesson (S/R proximity, Verify Pro's hard-rejection system, and
// the RSI/VWAP overextension checks were each independently found to be
// wrong for treating one condition as an absolute override). A candle that
// closed weak, or RSI that's already extended, or volume running against
// the move, is evidence a setup is LESS likely to follow through -- not
// proof it won't. Each caller subtracts this from whatever confidence
// score it already computes, the same way AI Verify Pro's caution flags
// dock points from a single consistent score rather than instantly
// rejecting.
export interface EntryQualityCheck {
  penaltyPct: number; // 0-40, capped so this alone can never zero out a signal
  reasons: string[];
}

const RSI_EXTENDED_BULLISH = 78;
const RSI_EXTENDED_BEARISH = 22;
const WEAK_CLOSE_PENALTY = 15;
const RSI_EXTENDED_PENALTY = 12;
const VOLUME_AGAINST_PENALTY = 15;
const MAX_PENALTY = 40;

export function assessEntryQuality(entryCandle: Candle, direction: Direction, snap: Pick<IndicatorSnapshot, "rsi14">, recentCandles: Candle[]): EntryQualityCheck {
  const reasons: string[] = [];
  let penalty = 0;

  // 1. Did the trigger candle actually close with conviction, or just tag
  // the level and fade? A bullish breakout that closes in the bottom half
  // of its own range is far weaker than the pattern match alone suggests.
  const range = entryCandle.high - entryCandle.low;
  if (range > 0) {
    const closePosition = (entryCandle.close - entryCandle.low) / range;
    if (direction === "bullish" && closePosition < 0.4) {
      penalty += WEAK_CLOSE_PENALTY;
      reasons.push(`Entry candle closed in the bottom ${Math.round(closePosition * 100)}% of its range -- weak follow-through for a bullish entry`);
    } else if (direction === "bearish" && closePosition > 0.6) {
      penalty += WEAK_CLOSE_PENALTY;
      reasons.push(`Entry candle closed in the top ${Math.round(closePosition * 100)}% of its range -- weak follow-through for a bearish entry`);
    }
  }

  // 2. Entering a fresh bullish breakout when RSI is already deep
  // overbought (or bearish when deep oversold) often means the move is
  // exhausted, not starting -- the textbook setup for a blow-off reversal.
  if (snap.rsi14 !== null) {
    if (direction === "bullish" && snap.rsi14 > RSI_EXTENDED_BULLISH) {
      penalty += RSI_EXTENDED_PENALTY;
      reasons.push(`RSI already at ${snap.rsi14.toFixed(0)} -- deeply overbought, this may be exhaustion rather than a fresh breakout`);
    } else if (direction === "bearish" && snap.rsi14 < RSI_EXTENDED_BEARISH) {
      penalty += RSI_EXTENDED_PENALTY;
      reasons.push(`RSI already at ${snap.rsi14.toFixed(0)} -- deeply oversold, this may be exhaustion rather than a fresh breakdown`);
    }
  }

  // 3. Is recent volume actually favoring this direction, or has more
  // volume traded against it -- distribution into a rally, or accumulation
  // into a selloff -- than with it over the last few candles?
  const tail = recentCandles.slice(-5);
  if (tail.length >= 3) {
    let withMove = 0;
    let againstMove = 0;
    for (const c of tail) {
      const up = c.close >= c.open;
      const vol = c.volume ?? 0;
      if ((direction === "bullish" && up) || (direction === "bearish" && !up)) withMove += vol;
      else againstMove += vol;
    }
    if (withMove + againstMove > 0 && againstMove > withMove * 1.5) {
      penalty += VOLUME_AGAINST_PENALTY;
      reasons.push(`More volume traded against this move than with it over the last ${tail.length} candles -- lacks real backing`);
    }
  }

  return { penaltyPct: Math.min(MAX_PENALTY, penalty), reasons };
}
