import type { Candle } from "../types";

// Answers "is real buying/selling actually behind this move, or is price
// just drifting on thin activity?" -- distinct from the order-book bid/ask
// quantity split (resting, unfilled orders that can be pulled any second),
// this reads ACTUAL TRADED volume on the underlying's own recent candles and
// checks whether volume is heavier on the candles moving in the call's
// direction than on the candles moving against it. A rally with real volume
// behind it is far more trustworthy than one drifting up on light activity.
export type VolumeSupportTier = "strong" | "moderate" | "weak";

export interface VolumeSupportCheck {
  tier: VolumeSupportTier;
  label: string;
  note: string;
  bias: number; // directional volume / opposing volume, e.g. 1.8 = 1.8x heavier with the move
}

const LOOKBACK = 12;

export function checkVolumeSupport(candles: Candle[], direction: "bullish" | "bearish"): VolumeSupportCheck | null {
  if (candles.length < LOOKBACK) return null;
  const recent = candles.slice(-LOOKBACK);
  if (recent.some((c) => c.volume === undefined || c.volume === null)) return null;

  let upVolume = 0;
  let downVolume = 0;
  for (const c of recent) {
    if (c.close > c.open) upVolume += c.volume ?? 0;
    else if (c.close < c.open) downVolume += c.volume ?? 0;
  }
  const totalVolume = upVolume + downVolume;
  if (totalVolume <= 0) return null;

  const floor = totalVolume * 0.02;
  const directionalVolume = Math.max(direction === "bullish" ? upVolume : downVolume, floor);
  const opposingVolume = Math.max(direction === "bullish" ? downVolume : upVolume, floor);
  const bias = Number((directionalVolume / opposingVolume).toFixed(2));

  const moveWord = direction === "bullish" ? "rally" : "drop";
  const dirWord = direction === "bullish" ? "up" : "down";

  let tier: VolumeSupportTier;
  let label: string;
  let note: string;
  if (bias >= 1.5) {
    tier = "strong";
    label = "Volume Confirms The Move";
    note = `Volume on the ${dirWord}-candles is running ${bias}x heavier than against it -- real buying/selling behind this ${moveWord}, not just drift.`;
  } else if (bias >= 0.9) {
    tier = "moderate";
    label = "Some Volume Support";
    note = `Volume is leaning ${dirWord} but only modestly (${bias}x) -- some support, not a strong confirmation yet.`;
  } else {
    tier = "weak";
    label = "Move Lacks Volume Backing";
    note = `More volume has actually traded against this ${moveWord} (${(1 / bias).toFixed(2)}x) than with it -- this could fade without real ${direction === "bullish" ? "buying" : "selling"} behind it.`;
  }

  return { tier, label, note, bias };
}
