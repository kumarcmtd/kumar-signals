import type { Candle } from "../types";
import { bollingerBands, adx } from "./indicators";

// Every scanner in this app (timeframeEngine's vetoes, hitScoreEngine's
// zero-veto gate, strategyVerification/verifyProEngine's ADX/EMA200 checks)
// is built around "don't chase an already-extended move" -- reasonable for
// the typical range-bound MCX session, but it's exactly backwards for the
// rare (a few times a year) genuine parabolic breakout day: RSI>80 and
// price far above VWAP reads as "overextended, about to reverse" to those
// checks, when it's actually just what a real trend day looks like in its
// first hour. Those same checks also lean on ADX>=20 and price above
// EMA200 for confirmation -- both structurally LAGGING indicators that
// haven't caught up yet on a move that only just started. By the time they
// do, the move is often mostly over.
//
// This is the standard, well-documented alternative for catching a move
// AT its start rather than after it's "matured": Bollinger Band Width
// (BBW) squeeze-and-release. A volatility contraction (bands pinched tight
// around price) that then expands sharply, together with price closing
// outside the band, a volume surge over the recent average, and ADX
// turning UP off a low base (not yet needing to already be above 20/25) is
// the textbook signature of a fresh breakout igniting -- see e.g.
// StockCharts' Bollinger Band Squeeze writeup and the ATR/volume-based
// breakout literature. When this fires, the rest of this app's engines
// treat it as a legitimate reason to look past the "overextended"/
// "trend not mature yet" reads that would otherwise hold a real move back.

export interface BreakoutIgnition {
  firing: boolean;
  direction: "bullish" | "bearish" | null;
  bandExpansionRatio: number | null; // current band width vs the recent squeeze low
  volumeMultiple: number | null; // latest bar volume vs recent 20-bar average
  adxRising: boolean;
  notes: string[];
}

const BB_PERIOD = 20;
const LOOKBACK = 60;
const SQUEEZE_PERCENTILE = 0.25;
const MIN_EXPANSION_RATIO = 1.4;
const MIN_VOLUME_MULTIPLE = 1.3;

function bandWidthSeries(closes: number[]): number[] {
  const out: number[] = [];
  for (let i = BB_PERIOD; i <= closes.length; i++) {
    const bb = bollingerBands(closes.slice(0, i), BB_PERIOD);
    if (!bb || bb.middle <= 0) continue;
    out.push(((bb.upper - bb.lower) / bb.middle) * 100);
  }
  return out;
}

const EMPTY: BreakoutIgnition = { firing: false, direction: null, bandExpansionRatio: null, volumeMultiple: null, adxRising: false, notes: [] };

export function detectBreakoutIgnition(candles: Candle[]): BreakoutIgnition {
  if (candles.length < BB_PERIOD + 25) return EMPTY;

  const closes = candles.map((c) => c.close);
  const widths = bandWidthSeries(closes);
  if (widths.length < 10) return EMPTY;
  const recentWidths = widths.slice(-LOOKBACK);
  const currentWidth = recentWidths[recentWidths.length - 1];

  // The tightest the bands got recently, EXCLUDING the last 3 bars -- so a
  // squeeze that just released reads as "was tight, now expanding," not
  // "is still tight right now."
  const priorWidths = recentWidths.slice(0, -3);
  if (priorWidths.length < 5) return EMPTY;
  const squeezeWidth = Math.min(...priorWidths);
  const sorted = [...priorWidths].sort((a, b) => a - b);
  const p25 = sorted[Math.floor(sorted.length * SQUEEZE_PERCENTILE)];
  const wasSqueezed = squeezeWidth <= p25;
  const bandExpansionRatio = squeezeWidth > 0 ? currentWidth / squeezeWidth : 1;

  const bb = bollingerBands(closes, BB_PERIOD);
  const last3 = candles.slice(-3);
  const brokeUp = bb ? last3.some((c) => c.close > bb.upper) : false;
  const brokeDown = bb ? last3.some((c) => c.close < bb.lower) : false;
  const direction: "bullish" | "bearish" | null = brokeUp && !brokeDown ? "bullish" : brokeDown && !brokeUp ? "bearish" : null;

  const recentVolumes = candles.slice(-21, -1).map((c) => c.volume ?? 0);
  const avgVolume = recentVolumes.length ? recentVolumes.reduce((s, v) => s + v, 0) / recentVolumes.length : 0;
  const latestVolume = candles[candles.length - 1].volume ?? 0;
  const volumeMultiple = avgVolume > 0 ? latestVolume / avgVolume : null;

  const adxNow = adx(candles);
  const adxPrior = adx(candles.slice(0, -5));
  const adxRising = adxNow !== null && adxPrior !== null && adxNow > adxPrior + 1;

  const firing =
    wasSqueezed && bandExpansionRatio >= MIN_EXPANSION_RATIO && direction !== null && (volumeMultiple === null || volumeMultiple >= MIN_VOLUME_MULTIPLE) && adxRising;

  const notes: string[] = [];
  if (wasSqueezed) notes.push("Bollinger Bands were recently squeezed tight (low-volatility coil).");
  if (bandExpansionRatio >= MIN_EXPANSION_RATIO) notes.push(`Band width has expanded ${bandExpansionRatio.toFixed(1)}x since the squeeze.`);
  if (direction) notes.push(`Price closed outside the ${direction === "bullish" ? "upper" : "lower"} band.`);
  if (volumeMultiple !== null) notes.push(`Volume is ${volumeMultiple.toFixed(1)}x the recent average.`);
  if (adxRising) notes.push("ADX is turning up off a low base -- a fresh trend igniting, not yet mature.");

  return { firing, direction, bandExpansionRatio, volumeMultiple, adxRising, notes };
}
