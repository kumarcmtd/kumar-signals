import type { Candle } from "../types";
import { computeIndicatorSnapshot } from "./indicators";

// Re-checks whether the underlying still has the technical strength to
// rebound toward target, for a call currently sitting between its entry and
// its stop-loss -- underwater, but not yet stopped out. This is exactly the
// moment a trader has to decide "hold, this still looks fine" vs "this setup
// is breaking down" without any real signal to go on. Reuses the exact same
// indicators every entry-time engine in this app already computes
// (computeIndicatorSnapshot), just re-read against RIGHT NOW instead of the
// moment the call fired, and checked against the call's own original
// direction rather than computing a fresh direction from scratch.
export type ReboundTier = "strong" | "moderate" | "weak";

export interface ReboundCheck {
  tier: ReboundTier;
  label: string;
  score: number; // 0-100 -- how many of the 5 checks still favor the original direction
  reasons: string[];
}

const MIN_ADX_FOR_TREND = 18;

export function checkReboundStrength(candles: Candle[], direction: "bullish" | "bearish"): ReboundCheck | null {
  if (candles.length < 30) return null;
  const snap = computeIndicatorSnapshot(candles);
  if (snap.rsi14 === null || snap.adx14 === null || snap.ema9 === null || snap.ema20 === null || !snap.macd) return null;

  const bullish = direction === "bullish";
  const checks: { pass: boolean; passReason: string; failReason: string }[] = [
    {
      pass: bullish ? snap.ema9 > snap.ema20 : snap.ema9 < snap.ema20,
      passReason: `EMA9/EMA20 stack is still ${bullish ? "bullish" : "bearish"}`,
      failReason: `EMA9/EMA20 stack has flipped ${bullish ? "bearish" : "bullish"}`,
    },
    {
      pass: bullish ? snap.rsi14 > 50 : snap.rsi14 < 50,
      passReason: `RSI (${snap.rsi14.toFixed(1)}) is still ${bullish ? "above" : "below"} 50`,
      failReason: `RSI (${snap.rsi14.toFixed(1)}) has crossed to the wrong side of 50`,
    },
    {
      pass: bullish ? snap.macd.histogram > 0 : snap.macd.histogram < 0,
      passReason: `MACD histogram is still ${bullish ? "positive" : "negative"}`,
      failReason: "MACD histogram has flipped against the call",
    },
    {
      pass: snap.trendDirection === direction,
      passReason: `SuperTrend still reads ${direction}`,
      failReason: `SuperTrend has flipped to ${snap.trendDirection}`,
    },
    {
      pass: snap.adx14 >= MIN_ADX_FOR_TREND,
      passReason: `ADX (${snap.adx14.toFixed(1)}) shows a real trend, not chop`,
      failReason: `ADX (${snap.adx14.toFixed(1)}) has faded below ${MIN_ADX_FOR_TREND} -- too choppy to trust either way`,
    },
  ];

  const passCount = checks.filter((c) => c.pass).length;
  const score = Math.round((passCount / checks.length) * 100);
  const reasons = checks.map((c) => (c.pass ? `✓ ${c.passReason}` : `✗ ${c.failReason}`));

  const tier: ReboundTier = passCount >= 4 ? "strong" : passCount >= 2 ? "moderate" : "weak";
  const label = tier === "strong" ? "Still Strength Signal" : tier === "moderate" ? "Some Good Signal" : "Weak Signal";

  return { tier, label, score, reasons };
}
