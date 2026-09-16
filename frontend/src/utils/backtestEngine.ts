// AI Backtest Lab -- measuring how the Pullback/Reversal engine actually did.
//
// It calls the SAME evaluatePullbackReversal() the live page calls. There is no
// second "backtest formula", because the moment live and historical logic diverges the
// numbers stop being comparable and the whole exercise becomes decoration.
//
// THE RULE THAT MATTERS MOST (spec Part 34): at historical bar T the engine is
// handed candles.slice(0, T + 1) and nothing else. Not one bar more. Future
// candles, future support levels, future indicator values and future news are
// all structurally unreachable, because they are not in the array. A backtest
// that leaks even one future bar produces beautiful, worthless numbers -- so
// this is enforced by construction rather than by care, and pinned by a test.
//
// Two things the spec asks for that this deliberately does NOT do, because the
// data to do them honestly does not exist:
//
//   * NEWS (Parts 43 TEST B/C/D). The app holds roughly 48 hours of RSS in a
//     60-second cache. There is no news archive, so a historical signal cannot
//     know what was reported that day. Replaying TODAY'S headlines against last
//     month's candles is textbook look-ahead bias. Every backtested signal is
//     therefore technical-only, and the page says so.
//
//   * 15-MINUTE OUTCOMES (Part 31). The only history available at this depth is
//     30-minute bars, so a 15-minute horizon cannot be measured. It is reported
//     as unavailable rather than approximated.

import type { Candle } from "../types";
import {
  evaluatePullbackReversal, MIN_BARS_PER_TF,
  type PullbackState, type FallKind, type PullbackConfig, type TfKey,
} from "./pullbackReversalEngine";
import { atr } from "./indicators";

/** ATR multiples the user can score against (spec Part 32). */
export const THRESHOLDS = [0.5, 1, 1.5, 2] as const;
export type Threshold = (typeof THRESHOLDS)[number];

/** Horizons, in 30-minute bars. 15M is absent: it is below the data's resolution. */
export const HORIZONS: { key: string; label: string; bars: number }[] = [
  { key: "30m", label: "30 min", bars: 1 },
  { key: "1h", label: "1 hour", bars: 2 },
  { key: "2h", label: "2 hours", bars: 4 },
  { key: "4h", label: "4 hours", bars: 8 },
  { key: "session", label: "1 session", bars: 29 },
];

export type Regime = "strong_bull" | "weak_bull" | "sideways" | "weak_bear" | "strong_bear" | "high_volatility";
export type Split = "train" | "validation" | "test";
export type Outcome = "success" | "failure" | "unknown";

export interface TouchResult {
  /** Which side was reached FIRST, or none within the whole measured window. */
  dir: "up" | "down" | "none";
  /** How many 30-minute bars it took. */
  bars: number | null;
}

export interface BacktestSignal {
  t: number;
  price: number;
  atrValue: number;
  state: PullbackState;
  confidence: number;
  bullScore: number;
  bearScore: number;
  fall: FallKind;
  regime: Regime;
  /** IST hour of the signal, for the time-of-day breakdown (Part 39). */
  istHour: number;
  /** Which side each ATR threshold reached first. Lets every metric below be
   *  re-derived for any threshold without re-running the engine. */
  touch: Record<string, TouchResult>;
  /** Maximum favourable / adverse excursion in ATR units (Part 36). */
  mfeAtr: number;
  maeAtr: number;
  split: Split;
  /** The strongest reason the engine gave, for the failure table (Part 47). */
  topReason: string;
  supportState: string;
}

export interface BacktestMeta {
  commodity: "CRUDEOIL" | "NATURALGAS";
  bars: number;
  firstDate: string | null;
  lastDate: string | null;
  sessions: number;
  evaluated: number;
  /** Always true here -- stated in the payload so the UI cannot forget it. */
  technicalOnly: true;
  newsNote: string;
}

export interface BacktestRun {
  signals: BacktestSignal[];
  meta: BacktestMeta;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Folds 30-minute bars into a coarser timeframe. Causal: only the bars given. */
export function resample(bars: Candle[], per: number): Candle[] {
  if (per <= 1) return bars;
  const out: Candle[] = [];
  for (let i = 0; i < bars.length; i += per) {
    const chunk = bars.slice(i, i + per);
    if (!chunk.length) break;
    out.push({
      date: chunk[0].date,
      open: chunk[0].open,
      high: Math.max(...chunk.map((c) => c.high)),
      low: Math.min(...chunk.map((c) => c.low)),
      close: chunk[chunk.length - 1].close,
      volume: chunk.reduce((s, c) => s + (c.volume ?? 0), 0),
      oi: chunk[chunk.length - 1].oi,
    });
  }
  return out;
}

/** IST hour straight off the stamp -- never via a UTC Date on a UTC runtime. */
function istHourOf(date: string): number {
  if (date.length < 13 || date.charCodeAt(10) !== 84) return 0;
  return (date.charCodeAt(11) - 48) * 10 + (date.charCodeAt(12) - 48);
}

/** Market regime at bar T, from the trailing window only (Part 42). */
export function classifyRegime(window: Candle[]): Regime {
  if (window.length < 20) return "sideways";
  const closes = window.map((c) => c.close);
  const first = closes[0];
  const lastClose = closes[closes.length - 1];
  const changePct = first > 0 ? ((lastClose - first) / first) * 100 : 0;
  const a = atr(window) ?? 0;
  const typical = lastClose > 0 ? (a / lastClose) * 100 : 0;
  // Direction is checked BEFORE width. A strong trend always has an elevated
  // ATR, so testing volatility first would relabel every decisive move as
  // "high volatility" and empty the trend buckets. High volatility here means
  // what it should: a wide range WITHOUT a decisive direction.
  if (changePct >= 4) return "strong_bull";
  if (changePct <= -4) return "strong_bear";
  if (typical > 1.4) return "high_volatility";
  if (changePct >= 1.2) return "weak_bull";
  if (changePct <= -1.2) return "weak_bear";
  return "sideways";
}

/**
 * Walks the FUTURE bars to see which ATR threshold was reached first.
 *
 * This is the only place future data is legitimately used: measuring what
 * happened AFTER a signal is the whole point. It never feeds back into the
 * signal itself.
 */
function measureTouches(future: Candle[], entry: number, atrValue: number): { touch: Record<string, TouchResult>; mfeAtr: number; maeAtr: number } {
  const touch: Record<string, TouchResult> = {};
  for (const k of THRESHOLDS) touch[String(k)] = { dir: "none", bars: null };
  let mfe = 0;
  let mae = 0;
  if (atrValue <= 0) return { touch, mfeAtr: 0, maeAtr: 0 };

  for (let i = 0; i < future.length; i++) {
    const bar = future[i];
    mfe = Math.max(mfe, (bar.high - entry) / atrValue);
    mae = Math.min(mae, (bar.low - entry) / atrValue);
    for (const k of THRESHOLDS) {
      const slot = touch[String(k)];
      if (slot.dir !== "none") continue;
      const up = entry + k * atrValue;
      const down = entry - k * atrValue;
      const hitUp = bar.high >= up;
      const hitDown = bar.low <= down;
      // Both inside one bar: the order is genuinely unknown at this resolution,
      // so it is recorded as ambiguous rather than guessed in the model's favour.
      if (hitUp && hitDown) { slot.dir = "none"; slot.bars = i + 1; }
      else if (hitUp) { slot.dir = "up"; slot.bars = i + 1; }
      else if (hitDown) { slot.dir = "down"; slot.bars = i + 1; }
    }
  }
  return { touch, mfeAtr: r3(mfe), maeAtr: r3(Math.abs(mae)) };
}

export interface RunnerOptions {
  commodity: "CRUDEOIL" | "NATURALGAS";
  /** How many 30-minute bars of context each evaluation sees. Caps the CPU cost. */
  window?: number;
  /** Evaluate every Nth bar. 1 is every bar. */
  step?: number;
  config?: Partial<PullbackConfig>;
}

const DEFAULT_WINDOW = 400;
const MAX_FORWARD_BARS = 29;

/**
 * A chunkable runner, so a phone can do ~1,300 engine evaluations without
 * freezing. Call step() until it returns true, then read result().
 */
export function createBacktestRunner(candles: Candle[], opts: RunnerOptions) {
  const window = opts.window ?? DEFAULT_WINDOW;
  const step = Math.max(1, opts.step ?? 1);
  // 4H needs 30 bars of its own, which is 8 x 30 = 240 thirty-minute bars.
  const start = Math.max(window, MIN_BARS_PER_TF * 8);
  const end = Math.max(start, candles.length - 1);
  const signals: BacktestSignal[] = [];
  let cursor = start;
  let evaluated = 0;

  const totalSteps = Math.max(1, Math.ceil((end - start) / step));

  function evaluateAt(i: number) {
    // THE LOOK-AHEAD BOUNDARY. Everything the engine can see is in here.
    const history = candles.slice(Math.max(0, i - window + 1), i + 1);
    if (history.length < MIN_BARS_PER_TF * 8) return;

    const timeframes: Partial<Record<TfKey, Candle[]>> = {
      "240": resample(history, 8),
      "60": resample(history, 2),
      "30": history,
    };
    const bar = candles[i];
    const result = evaluatePullbackReversal({
      commodity: opts.commodity,
      timeframes,
      currentPrice: bar.close,
      // No news, no fundamentals, no weather: none of it exists for a past bar.
      now: new Date(bar.date).getTime(),
      previousState: signals.length ? signals[signals.length - 1].state : undefined,
      previousStateAt: signals.length ? signals[signals.length - 1].t : undefined,
      config: opts.config,
    });
    evaluated++;

    // A signal is only recorded where there IS a fall to classify -- that is
    // the event the spec asks about, and it keeps the sample meaningful rather
    // than thousands of identical quiet bars.
    if (result.fall.kind === "none") return;

    const atrValue = atr(history) ?? 0;
    if (!(atrValue > 0)) return;

    const future = candles.slice(i + 1, i + 1 + MAX_FORWARD_BARS);
    if (future.length < 2) return;
    const { touch, mfeAtr, maeAtr } = measureTouches(future, bar.close, atrValue);

    signals.push({
      t: new Date(bar.date).getTime(),
      price: r3(bar.close),
      atrValue: r3(atrValue),
      state: result.state,
      confidence: result.confidence,
      bullScore: result.bullishPullbackScore,
      bearScore: result.bearishReversalScore,
      fall: result.fall.kind,
      regime: classifyRegime(history.slice(-40)),
      istHour: istHourOf(bar.date),
      touch,
      mfeAtr,
      maeAtr,
      split: "train",
      topReason: result.reasons[0] ?? result.warnings[0] ?? "No dominant factor.",
      supportState: result.nearestSupport?.state ?? "unknown",
    });
  }

  return {
    totalSteps,
    /** Runs up to `n` evaluations. Returns true when finished. */
    step(n: number): boolean {
      let done = 0;
      while (cursor <= end && done < n) {
        evaluateAt(cursor);
        cursor += step;
        done++;
      }
      return cursor > end;
    },
    progress(): number {
      return clamp(Math.round(((cursor - start) / Math.max(1, end - start)) * 100), 0, 100);
    },
    result(): BacktestRun {
      // Chronological 60/20/20 split (Part 44). Assigned at the end so the
      // boundaries follow the signals that actually exist.
      const n = signals.length;
      const trainEnd = Math.floor(n * 0.6);
      const valEnd = Math.floor(n * 0.8);
      signals.forEach((s, idx) => {
        s.split = idx < trainEnd ? "train" : idx < valEnd ? "validation" : "test";
      });
      const sessions = new Set(candles.map((c) => c.date.slice(0, 10))).size;
      return {
        signals,
        meta: {
          commodity: opts.commodity,
          bars: candles.length,
          firstDate: candles[0]?.date.slice(0, 10) ?? null,
          lastDate: candles[candles.length - 1]?.date.slice(0, 10) ?? null,
          sessions,
          evaluated,
          technicalOnly: true,
          newsNote:
            "Technical only. This app keeps about 48 hours of news in a 60-second cache and no archive, so a past signal cannot know what was reported that day. Replaying today's headlines over old candles would be look-ahead bias, so news, fundamentals and weather are excluded from every backtested signal.",
        },
      };
    },
  };
}

// ---- Scoring (Parts 32, 33, 35) ----

/**
 * Was this signal right?
 *
 * GREEN is right when price reached +k ATR before −k ATR, inside the horizon.
 * RED is the mirror. Anything that reached neither is UNKNOWN and is counted
 * separately -- never folded into the success column (Part 33).
 * YELLOW is a "wait" instruction, not a direction, so it is never scored as a
 * hit or a miss; it is reported on its own.
 */
export function outcomeOf(signal: BacktestSignal, threshold: Threshold, horizonBars: number): Outcome {
  if (signal.state === "uncertain") return "unknown";
  const t = signal.touch[String(threshold)];
  if (!t || t.dir === "none" || t.bars === null || t.bars > horizonBars) return "unknown";
  const wanted = signal.state === "still_bullish" ? "up" : "down";
  return t.dir === wanted ? "success" : "failure";
}

export interface Summary {
  total: number;
  green: number;
  red: number;
  yellow: number;
  greenSuccess: number;
  greenFailure: number;
  redSuccess: number;
  redFailure: number;
  unknown: number;
  falseGreenPct: number | null;
  falseRedPct: number | null;
  precision: number | null;
  recall: number | null;
  f1: number | null;
  balancedAccuracy: number | null;
  avgMfeAtr: number;
  avgMaeAtr: number;
  maxMfeAtr: number;
  maxMaeAtr: number;
  /** Part 46. */
  sampleLabel: "insufficient" | "limited" | "useful";
  sampleNote: string;
}

export function summarise(signals: BacktestSignal[], threshold: Threshold, horizonBars: number): Summary {
  const green = signals.filter((s) => s.state === "still_bullish");
  const red = signals.filter((s) => s.state === "bearish");
  const yellow = signals.filter((s) => s.state === "uncertain");

  const count = (list: BacktestSignal[], o: Outcome) => list.filter((s) => outcomeOf(s, threshold, horizonBars) === o).length;
  const greenSuccess = count(green, "success");
  const greenFailure = count(green, "failure");
  const redSuccess = count(red, "success");
  const redFailure = count(red, "failure");
  const unknown = count(green, "unknown") + count(red, "unknown") + yellow.length;

  const greenDecided = greenSuccess + greenFailure;
  const redDecided = redSuccess + redFailure;

  // Treating GREEN as the positive class: precision is how often a GREEN was
  // right, recall is how many of the real up-moves it caught.
  const truePos = greenSuccess;
  const falsePos = greenFailure;
  const falseNeg = redFailure; // called RED, price went up
  const trueNeg = redSuccess;
  const precision = truePos + falsePos > 0 ? truePos / (truePos + falsePos) : null;
  const recall = truePos + falseNeg > 0 ? truePos / (truePos + falseNeg) : null;
  const f1 = precision !== null && recall !== null && precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : null;
  const sensitivity = recall;
  const specificity = trueNeg + falsePos > 0 ? trueNeg / (trueNeg + falsePos) : null;
  const balancedAccuracy = sensitivity !== null && specificity !== null ? (sensitivity + specificity) / 2 : null;

  const decided = greenDecided + redDecided;
  const sampleLabel = decided < 30 ? "insufficient" : decided < 100 ? "limited" : "useful";
  const sampleNote =
    sampleLabel === "insufficient"
      ? `Only ${decided} signals reached a decision. That is too few to conclude anything — MCX contracts roll monthly, so the history simply is not there yet.`
      : sampleLabel === "limited"
        ? `${decided} decided signals. Enough to see a tendency, not enough to trust a precise percentage.`
        : `${decided} decided signals — a usable sample, though still one contract's worth of market conditions.`;

  const mfes = signals.map((s) => s.mfeAtr);
  const maes = signals.map((s) => s.maeAtr);
  const mean = (a: number[]) => (a.length ? r3(a.reduce((x, y) => x + y, 0) / a.length) : 0);

  return {
    total: signals.length,
    green: green.length,
    red: red.length,
    yellow: yellow.length,
    greenSuccess, greenFailure, redSuccess, redFailure, unknown,
    falseGreenPct: greenDecided > 0 ? Math.round((greenFailure / greenDecided) * 100) : null,
    falseRedPct: redDecided > 0 ? Math.round((redFailure / redDecided) * 100) : null,
    precision, recall, f1, balancedAccuracy,
    avgMfeAtr: mean(mfes),
    avgMaeAtr: mean(maes),
    maxMfeAtr: mfes.length ? r3(Math.max(...mfes)) : 0,
    maxMaeAtr: maes.length ? r3(Math.max(...maes)) : 0,
    sampleLabel, sampleNote,
  };
}

// ---- Confidence calibration (Part 37) ----

export interface CalibrationBand {
  label: string;
  lo: number;
  hi: number;
  signals: number;
  success: number;
  failure: number;
  unknown: number;
  actualPct: number | null;
  /** The model said this; the tape said actualPct. */
  claimedPct: number;
  miscalibrated: boolean;
}

const BANDS: [number, number][] = [[50, 59], [60, 69], [70, 79], [80, 89], [90, 94]];

export function calibration(signals: BacktestSignal[], threshold: Threshold, horizonBars: number): CalibrationBand[] {
  return BANDS.map(([lo, hi]) => {
    const inBand = signals.filter((s) => s.state !== "uncertain" && s.confidence >= lo && s.confidence <= hi);
    const success = inBand.filter((s) => outcomeOf(s, threshold, horizonBars) === "success").length;
    const failure = inBand.filter((s) => outcomeOf(s, threshold, horizonBars) === "failure").length;
    const unknown = inBand.length - success - failure;
    const decided = success + failure;
    const actualPct = decided > 0 ? Math.round((success / decided) * 100) : null;
    const claimedPct = Math.round((lo + hi) / 2);
    return {
      label: `${lo}–${hi}%`, lo, hi,
      signals: inBand.length, success, failure, unknown, actualPct, claimedPct,
      // Only called out on a real sample: a 40-point gap on four signals is noise.
      miscalibrated: actualPct !== null && decided >= 10 && claimedPct - actualPct >= 15,
    };
  });
}

// ---- Breakdowns (Parts 39, 40, 42, 47) ----

export interface Breakdown {
  key: string;
  label: string;
  signals: number;
  success: number;
  failure: number;
  unknown: number;
  successPct: number | null;
}

function breakdown(signals: BacktestSignal[], threshold: Threshold, horizonBars: number, key: string, label: string): Breakdown {
  const success = signals.filter((s) => outcomeOf(s, threshold, horizonBars) === "success").length;
  const failure = signals.filter((s) => outcomeOf(s, threshold, horizonBars) === "failure").length;
  const decided = success + failure;
  return {
    key, label,
    signals: signals.length,
    success, failure,
    unknown: signals.length - success - failure,
    successPct: decided > 0 ? Math.round((success / decided) * 100) : null,
  };
}

const REGIME_LABEL: Record<Regime, string> = {
  strong_bull: "Strong bull", weak_bull: "Weak bull", sideways: "Sideways",
  weak_bear: "Weak bear", strong_bear: "Strong bear", high_volatility: "High volatility",
};

export function byRegime(signals: BacktestSignal[], threshold: Threshold, horizonBars: number): Breakdown[] {
  return (Object.keys(REGIME_LABEL) as Regime[])
    .map((r) => breakdown(signals.filter((s) => s.regime === r), threshold, horizonBars, r, REGIME_LABEL[r]))
    .filter((b) => b.signals > 0);
}

const HOUR_BUCKETS: [string, number, number][] = [
  ["09–12", 9, 12], ["12–15", 12, 15], ["15–17", 15, 17],
  ["17–19", 17, 19], ["19–21", 19, 21], ["21–24", 21, 24],
];

export function byTimeOfDay(signals: BacktestSignal[], threshold: Threshold, horizonBars: number): Breakdown[] {
  return HOUR_BUCKETS
    .map(([label, lo, hi]) => breakdown(signals.filter((s) => s.istHour >= lo && s.istHour < hi), threshold, horizonBars, label, `${label} IST`))
    .filter((b) => b.signals > 0);
}

export function bySplit(signals: BacktestSignal[], threshold: Threshold, horizonBars: number): Breakdown[] {
  return (["train", "validation", "test"] as Split[])
    .map((sp) => breakdown(signals.filter((s) => s.split === sp), threshold, horizonBars, sp, sp === "train" ? "In-sample (60%)" : sp === "validation" ? "Validation (20%)" : "Out-of-sample (20%)"))
    .filter((b) => b.signals > 0);
}

/**
 * Part 45: is the model merely remembering the data it was built on?
 * Only flagged on a real out-of-sample count, so a 10-signal test slice cannot
 * raise a false alarm.
 */
export function overfittingWarning(splits: Breakdown[]): string | null {
  const train = splits.find((s) => s.key === "train");
  const test = splits.find((s) => s.key === "test");
  if (!train?.successPct || !test?.successPct) return null;
  const decidedTest = test.success + test.failure;
  if (decidedTest < 15) return `Out-of-sample has only ${decidedTest} decided signals — too few to judge overfitting either way.`;
  const gap = train.successPct - test.successPct;
  return gap >= 15 ? `Possible overfitting: ${train.successPct}% in-sample against ${test.successPct}% out-of-sample, a ${gap}-point drop.` : null;
}

/** Part 40: price falls to support -- does it hold? */
export function supportTest(signals: BacktestSignal[], threshold: Threshold, horizonBars: number): Breakdown[] {
  const states = ["holding", "testing", "rejected", "broken", "reclaimed", "retesting", "failed_retest"];
  return states
    .map((st) => breakdown(signals.filter((s) => s.supportState === st), threshold, horizonBars, st, st.replace(/_/g, " ")))
    .filter((b) => b.signals > 0);
}

/** Part 47: the signals that were wrong, newest first, with what the engine believed. */
export function failureCases(signals: BacktestSignal[], threshold: Threshold, horizonBars: number, limit = 20): BacktestSignal[] {
  return signals
    .filter((s) => outcomeOf(s, threshold, horizonBars) === "failure")
    .sort((a, b) => b.t - a.t)
    .slice(0, limit);
}

// ---- CSV export (Part 53) ----

export function toCsv(run: BacktestRun, threshold: Threshold, horizonBars: number): string {
  const head = [
    "timestamp", "commodity", "price", "signal", "confidence", "bullScore", "bearScore",
    "fall", "regime", "istHour", "supportState", "atr", "mfeAtr", "maeAtr", "split", "outcome", "barsToOutcome",
  ];
  const rows = run.signals.map((s) => {
    const t = s.touch[String(threshold)];
    return [
      new Date(s.t).toISOString(),
      run.meta.commodity,
      s.price,
      s.state,
      s.confidence,
      s.bullScore,
      s.bearScore,
      s.fall,
      s.regime,
      s.istHour,
      s.supportState,
      s.atrValue,
      s.mfeAtr,
      s.maeAtr,
      s.split,
      outcomeOf(s, threshold, horizonBars),
      t?.bars ?? "",
    ].join(",");
  });
  return [head.join(","), ...rows].join("\n");
}
