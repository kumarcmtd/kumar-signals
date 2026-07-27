import type { Candle, OptionsAnalytics } from "../types";
import { detectCandlePattern, analyzeStructure, type CandlePattern } from "./priceAction";
import { computeIndicatorSnapshot } from "./indicators";
import { CANDLESTICK_PATTERNS } from "../data/learnLibrary";
import { projectFromUnderlying, type BestCallPick } from "./bestCallSelector";

// A 4th "Best Call" source, deliberately separate from AI Elite / Directional
// Gate / Kimi Playbook: this one is driven ONLY by the candlestick-pattern
// knowledge on the AI-Learn page. Only patterns that map 1:1 onto a real
// AI-Learn catalog entry (same shape rule, same directional bias) qualify --
// doji/inside_bar/outside_bar/strong_*_candle are deliberately excluded
// because they don't cleanly correspond to one specific cataloged pattern,
// and forcing a match would misrepresent what AI-Learn actually says.
const PATTERN_TO_LEARN_ID: Partial<Record<CandlePattern, string>> = {
  hammer: "hammer",
  shooting_star: "shooting-star",
  bullish_engulfing: "bullish-engulfing",
  bearish_engulfing: "bearish-engulfing",
  bullish_pin_bar: "pin-bar",
  bearish_pin_bar: "pin-bar",
};

const MIN_VOLUME_RATIO = 1.2;

function volumeRatioOf(candles: Candle[]): number | null {
  if (candles.length < 11) return null;
  const last = candles[candles.length - 1];
  const recent = candles.slice(-11, -1);
  const avg = recent.reduce((s, c) => s + (c.volume ?? 0), 0) / recent.length;
  if (avg <= 0) return null;
  return Number(((last.volume ?? 0) / avg).toFixed(2));
}

// Requires: (1) the detected candle IS one of the 6 patterns with a clean
// AI-Learn match, (2) the broader swing structure's own trend agrees with
// that candle's direction (the same "structure must independently confirm"
// bar the Directional Gate uses), and (3) real volume participation. Entry
// is the current close; stop/targets are ATR-derived using the same
// 1x/1.5x/2.5x/3.5x convention already used elsewhere in this app.
export function evaluatePatternSignal(candles: Candle[], tfLabel: string, optionsChain: OptionsAnalytics | undefined): BestCallPick | null {
  if (candles.length < 40) return null;
  const { pattern, direction } = detectCandlePattern(candles);
  if (direction === "neutral") return null;
  const learnId = PATTERN_TO_LEARN_ID[pattern];
  if (!learnId) return null;
  const learnEntry = CANDLESTICK_PATTERNS.find((e) => e.id === learnId);
  if (!learnEntry) return null;

  const structure = analyzeStructure(candles);
  if (structure.trend !== direction) return null;

  const volRatio = volumeRatioOf(candles);
  if (volRatio === null || volRatio < MIN_VOLUME_RATIO) return null;

  const snap = computeIndicatorSnapshot(candles);
  if (snap.atr14 === null || snap.atr14 <= 0) return null;

  const last = candles[candles.length - 1];
  const entry = last.close;
  const sign = direction === "bullish" ? 1 : -1;
  const stop = Number((entry - sign * snap.atr14).toFixed(2));
  const targets = [1.5, 2.5, 3.5].map((m) => Number((entry + sign * snap.atr14! * m).toFixed(2))) as [number, number, number];

  const volScore = Math.min(((volRatio - MIN_VOLUME_RATIO) / 1.5) * 20, 20);
  const bosBonus = structure.bos && structure.bosDirection === direction ? 10 : 0;
  const confidence = Math.round(Math.min(55 + volScore + bosBonus, 92));

  const optSide: "CE" | "PE" = direction === "bullish" ? "CE" : "PE";
  const proj = projectFromUnderlying(optSide, entry, stop, targets, optionsChain);
  if (!proj) return null;

  const reasons = [
    learnEntry.summary,
    ...(learnEntry.tradeNote ? [learnEntry.tradeNote] : []),
    `Structure trend also reads ${direction}${structure.label ? ` (${structure.label})` : ""}`,
    `Volume ${volRatio}x the recent average confirms participation`,
    ...(bosBonus ? ["Break of structure just confirmed the same direction"] : []),
  ];

  return {
    source: "Pattern Signal",
    label: `${learnEntry.name} (${tfLabel})`,
    direction,
    optSide,
    confidence,
    strike: proj.strike,
    entry: proj.entry,
    targets: proj.targets,
    stop: proj.stop,
    rr: proj.rr,
    reasons,
  };
}
