import type { Candle } from "../types";
import { atr, trueRanges } from "./indicators";

export type SpeedLabel = "Calm" | "Normal" | "Volatile" | "Extreme";

export interface PriceSpeedReading {
  // 0-100, self-calibrated to this instrument's own recent range history --
  // NOT a fixed rupee or percentage cutoff. Crude Oil trades in the
  // thousands and Natural Gas in the hundreds, so a shared absolute
  // threshold would need separate tuning per instrument; comparing each
  // instrument's own current candle range against its own recent baseline
  // sidesteps that entirely. A score of 50 always means "moving about as
  // fast as this exact market usually does right now", for either symbol.
  score: number;
  label: SpeedLabel;
  color: string;
  atrValue: number;
  atrPct: number;
  lastRange: number;
  ratio: number;
  estPremiumSwing: number | null;
}

const RECENT_BARS = 3;
const BASELINE_LOOKBACK = 40;

export function computePriceSpeed(candles: Candle[], delta: number | null = null): PriceSpeedReading | null {
  if (candles.length < BASELINE_LOOKBACK + RECENT_BARS) return null;
  const price = candles[candles.length - 1].close;
  if (!(price > 0)) return null;

  const tr = trueRanges(candles);
  const recentSlice = tr.slice(-RECENT_BARS);
  const baselineSlice = tr.slice(-(BASELINE_LOOKBACK + RECENT_BARS), -RECENT_BARS);
  const recentAvg = recentSlice.reduce((s, v) => s + v, 0) / recentSlice.length;
  const baselineAvg = baselineSlice.reduce((s, v) => s + v, 0) / baselineSlice.length;
  if (baselineAvg <= 0) return null;

  // recentAvg/baselineAvg == 1 means "trading exactly as choppy as its own
  // recent history" -- scaled so that sits mid-Normal, not right on a
  // band edge, and doubling that baseline pace reads as fully Extreme.
  const ratio = recentAvg / baselineAvg;
  const score = Math.max(0, Math.min(100, Math.round(ratio * 50)));

  const atrValue = atr(candles) ?? baselineAvg;
  const lastRange = tr[tr.length - 1];

  const { label, color }: { label: SpeedLabel; color: string } =
    score > 75 ? { label: "Extreme", color: "#DC2626" } : score > 55 ? { label: "Volatile", color: "#EA580C" } : score >= 30 ? { label: "Normal", color: "#16A34A" } : { label: "Calm", color: "#0EA5E9" };

  return {
    score,
    label,
    color,
    atrValue: Number(atrValue.toFixed(2)),
    atrPct: Number(((atrValue / price) * 100).toFixed(2)),
    lastRange: Number(lastRange.toFixed(2)),
    ratio: Number(ratio.toFixed(2)),
    estPremiumSwing: delta !== null ? Number((lastRange * Math.abs(delta)).toFixed(2)) : null,
  };
}
