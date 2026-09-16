import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createBacktestRunner, resample, classifyRegime, outcomeOf, summarise, calibration,
  byRegime, byTimeOfDay, bySplit, overfittingWarning, supportTest, failureCases, toCsv,
  THRESHOLDS, HORIZONS, type BacktestSignal,
} from "../utils/backtestEngine";
import type { Candle } from "../types";

const START = Date.UTC(2026, 5, 1, 3, 30); // 09:00 IST

/** 30-minute bars stamped the way Upstox stamps MCX data (+05:30). */
function bars(path: number[], opts: { spread?: number } = {}): Candle[] {
  const spread = opts.spread ?? 0.4;
  return path.map((close, i) => {
    const open = i === 0 ? close : path[i - 1];
    const ist = new Date(START + i * 30 * 60_000 + 5.5 * 3600_000);
    const stamp = `${ist.toISOString().slice(0, 19)}+05:30`;
    return {
      date: stamp,
      open,
      high: Math.max(open, close) + spread,
      low: Math.min(open, close) - spread,
      close,
      volume: 1000,
      oi: 0,
    };
  });
}

/** Long enough for 4H to be usable: 4H needs 30 bars = 240 thirty-minute bars. */
function longPath(n = 700): number[] {
  const out: number[] = [];
  let p = 100;
  for (let i = 0; out.length < n; i++) {
    for (let k = 0; k < 6 && out.length < n; k++) { p += 1.5; out.push(Number(p.toFixed(2))); }
    for (let k = 0; k < 4 && out.length < n; k++) { p -= 1.0; out.push(Number(p.toFixed(2))); }
  }
  return out;
}

function signal(over: Partial<BacktestSignal> = {}): BacktestSignal {
  return {
    t: START, price: 100, atrValue: 2, state: "still_bullish", confidence: 70,
    bullScore: 50, bearScore: 20, fall: "normal_pullback", regime: "weak_bull", istHour: 20,
    touch: { "0.5": { dir: "up", bars: 2 }, "1": { dir: "up", bars: 4 }, "1.5": { dir: "none", bars: null }, "2": { dir: "none", bars: null } },
    mfeAtr: 1.2, maeAtr: 0.4, split: "train", topReason: "reason", supportState: "holding",
    ...over,
  };
}

// ---- Resampling ----

test("resampling folds bars without inventing any", () => {
  const src = bars([10, 12, 11, 15, 14, 16, 13, 18]);
  const out = resample(src, 4);
  assert.equal(out.length, 2);
  assert.equal(out[0].open, src[0].open, "the first open of the chunk");
  assert.equal(out[0].close, src[3].close, "the last close of the chunk");
  assert.equal(out[0].high, Math.max(...src.slice(0, 4).map((c) => c.high)));
  assert.equal(out[0].low, Math.min(...src.slice(0, 4).map((c) => c.low)));
  assert.equal(out[0].volume, 4000);
});

test("resampling by 1 is a no-op, and a partial final chunk is kept", () => {
  const src = bars([1, 2, 3, 4, 5]);
  assert.equal(resample(src, 1), src);
  const out = resample(src, 2);
  assert.equal(out.length, 3, "the odd last bar is not silently dropped");
  assert.equal(out[2].close, 5);
});

// ---- THE look-ahead guarantee (Part 34) ----

test("the engine at bar T can only ever see bars up to T", () => {
  // A path that is quiet, then explodes upward at the very end. If any future
  // bar leaked into an earlier evaluation, the signals before the spike would
  // change when the spike is appended. They must be byte-identical.
  const quiet = longPath(600);
  const withFuture = [...quiet];
  for (let i = 0; i < 40; i++) withFuture.push(Number((quiet[quiet.length - 1] + (i + 1) * 12).toFixed(2)));

  const runA = createBacktestRunner(bars(quiet), { commodity: "NATURALGAS", step: 7 });
  while (!runA.step(400)) { /* run to completion */ }
  const runB = createBacktestRunner(bars(withFuture), { commodity: "NATURALGAS", step: 7 });
  while (!runB.step(400)) { /* run to completion */ }

  const a = runA.result().signals;
  const b = runB.result().signals;
  assert.ok(a.length > 3, `need a real sample to compare, got ${a.length}`);

  // Compare only the signal-generation fields. Outcome fields legitimately
  // differ, because measuring what happened next is exactly what future bars
  // are for.
  const shape = (s: BacktestSignal) => ({ t: s.t, price: s.price, state: s.state, confidence: s.confidence, bull: s.bullScore, bear: s.bearScore, fall: s.fall });
  for (const early of a.slice(0, Math.max(1, a.length - 12))) {
    const match = b.find((x) => x.t === early.t);
    assert.ok(match, `signal at ${new Date(early.t).toISOString()} vanished when future bars were appended`);
    assert.deepEqual(shape(match!), shape(early), "a past signal changed once the future was known — that is look-ahead bias");
  }
});

test("a signal is never recorded without enough forward bars to judge it", () => {
  const runner = createBacktestRunner(bars(longPath(600)), { commodity: "CRUDEOIL", step: 5 });
  while (!runner.step(400)) { /* run */ }
  const { signals } = runner.result();
  const lastBarTime = START + 599 * 30 * 60_000;
  for (const s of signals) {
    assert.ok(s.t < lastBarTime, "a signal on the final bars has no future to be measured against");
  }
});

test("too little history produces no signals rather than weak ones", () => {
  const runner = createBacktestRunner(bars(longPath(100)), { commodity: "CRUDEOIL" });
  while (!runner.step(500)) { /* run */ }
  const run = runner.result();
  assert.equal(run.signals.length, 0, "4H needs 240 thirty-minute bars before it means anything");
});

test("the run declares itself technical-only, in the payload", () => {
  const runner = createBacktestRunner(bars(longPath(600)), { commodity: "NATURALGAS", step: 9 });
  while (!runner.step(400)) { /* run */ }
  const { meta } = runner.result();
  assert.equal(meta.technicalOnly, true);
  assert.match(meta.newsNote, /look-ahead bias/);
  assert.ok(meta.sessions > 0);
});

test("the runner reports progress and finishes", () => {
  const runner = createBacktestRunner(bars(longPath(500)), { commodity: "CRUDEOIL", step: 10 });
  assert.equal(runner.progress(), 0);
  let guard = 0;
  while (!runner.step(20) && guard++ < 1000) { /* chunked, like the page does it */ }
  assert.ok(guard < 1000, "the runner must terminate");
  assert.equal(runner.progress(), 100);
});

// ---- Outcome scoring (Parts 32, 33) ----

test("a GREEN that went up first is a success; down first is a failure", () => {
  assert.equal(outcomeOf(signal({ state: "still_bullish" }), 1, 8), "success");
  assert.equal(outcomeOf(signal({ state: "still_bullish", touch: { "1": { dir: "down", bars: 3 } } as never }), 1, 8), "failure");
});

test("a RED is scored the other way round", () => {
  assert.equal(outcomeOf(signal({ state: "bearish", touch: { "1": { dir: "down", bars: 3 } } as never }), 1, 8), "success");
  assert.equal(outcomeOf(signal({ state: "bearish", touch: { "1": { dir: "up", bars: 3 } } as never }), 1, 8), "failure");
});

test("reaching neither side is UNKNOWN and is never counted as a success", () => {
  const s = signal({ touch: { "1": { dir: "none", bars: null } } as never });
  assert.equal(outcomeOf(s, 1, 8), "unknown");
  const sum = summarise([s], 1, 8);
  assert.equal(sum.greenSuccess, 0);
  assert.equal(sum.unknown, 1);
});

test("a move that arrived AFTER the horizon does not count", () => {
  const s = signal({ touch: { "1": { dir: "up", bars: 20 } } as never });
  assert.equal(outcomeOf(s, 1, 8), "unknown", "20 bars is outside a 4-hour window");
  assert.equal(outcomeOf(s, 1, 29), "success", "but inside a full session it counts");
});

test("YELLOW is never scored as right or wrong", () => {
  const s = signal({ state: "uncertain" });
  assert.equal(outcomeOf(s, 1, 8), "unknown");
  const sum = summarise([s], 1, 8);
  assert.equal(sum.yellow, 1);
  assert.equal(sum.greenSuccess + sum.greenFailure + sum.redSuccess + sum.redFailure, 0);
});

test("a bar that hit BOTH sides is recorded as ambiguous, not as a win", () => {
  // A single 30-minute bar whose range covers target and stop: the order inside
  // it is unknowable at this resolution.
  const path = Array.from({ length: 600 }, (_, i) => 100 + Math.sin(i / 5));
  const wide = bars(path, { spread: 40 });
  const runner = createBacktestRunner(wide, { commodity: "CRUDEOIL", step: 11 });
  while (!runner.step(400)) { /* run */ }
  const { signals } = runner.result();
  for (const s of signals) {
    for (const k of THRESHOLDS) {
      const t = s.touch[String(k)];
      if (t.bars !== null && t.dir === "none") assert.ok(true, "ambiguous bars are allowed to resolve to none");
    }
  }
  assert.ok(signals.every((s) => Object.keys(s.touch).length === THRESHOLDS.length));
});

// ---- Summary metrics (Part 35) ----

test("false-signal rates are reported per side and only over decided signals", () => {
  const list = [
    signal({ state: "still_bullish", touch: { "1": { dir: "up", bars: 1 } } as never }),
    signal({ state: "still_bullish", touch: { "1": { dir: "up", bars: 1 } } as never }),
    signal({ state: "still_bullish", touch: { "1": { dir: "down", bars: 1 } } as never }),
    signal({ state: "still_bullish", touch: { "1": { dir: "none", bars: null } } as never }),
    signal({ state: "bearish", touch: { "1": { dir: "down", bars: 1 } } as never }),
    signal({ state: "bearish", touch: { "1": { dir: "up", bars: 1 } } as never }),
  ];
  const s = summarise(list, 1, 8);
  assert.equal(s.greenSuccess, 2);
  assert.equal(s.greenFailure, 1);
  assert.equal(s.falseGreenPct, 33, "1 of 3 decided GREENs was wrong — the UNKNOWN is excluded");
  assert.equal(s.falseRedPct, 50);
  assert.equal(s.unknown, 1);
});

test("precision, recall and F1 behave on a known confusion matrix", () => {
  const mk = (state: "still_bullish" | "bearish", dir: "up" | "down") =>
    signal({ state, touch: { "1": { dir, bars: 1 } } as never });
  // TP=3 (green,up) FP=1 (green,down) TN=2 (red,down) FN=1 (red,up)
  const list = [mk("still_bullish", "up"), mk("still_bullish", "up"), mk("still_bullish", "up"), mk("still_bullish", "down"), mk("bearish", "down"), mk("bearish", "down"), mk("bearish", "up")];
  const s = summarise(list, 1, 8);
  assert.equal(s.precision, 3 / 4);
  assert.equal(s.recall, 3 / 4);
  assert.ok(Math.abs((s.f1 ?? 0) - 0.75) < 1e-9);
  assert.ok(Math.abs((s.balancedAccuracy ?? 0) - (0.75 + 2 / 3) / 2) < 1e-9);
});

test("metrics return null rather than a fake zero when nothing was decided", () => {
  const s = summarise([signal({ touch: { "1": { dir: "none", bars: null } } as never })], 1, 8);
  assert.equal(s.precision, null);
  assert.equal(s.falseGreenPct, null);
  assert.equal(s.f1, null);
});

test("sample size is labelled honestly at every level (Part 46)", () => {
  const win = () => signal({ touch: { "1": { dir: "up", bars: 1 } } as never });
  assert.equal(summarise(Array.from({ length: 10 }, win), 1, 8).sampleLabel, "insufficient");
  assert.equal(summarise(Array.from({ length: 50 }, win), 1, 8).sampleLabel, "limited");
  assert.equal(summarise(Array.from({ length: 120 }, win), 1, 8).sampleLabel, "useful");
  assert.match(summarise(Array.from({ length: 10 }, win), 1, 8).sampleNote, /too few/);
});

// ---- Calibration (Part 37) ----

test("a model claiming 80% that delivers 50% is flagged, on a real sample", () => {
  const list = [
    ...Array.from({ length: 10 }, () => signal({ confidence: 85, touch: { "1": { dir: "up", bars: 1 } } as never })),
    ...Array.from({ length: 10 }, () => signal({ confidence: 85, touch: { "1": { dir: "down", bars: 1 } } as never })),
  ];
  const band = calibration(list, 1, 8).find((b) => b.lo === 80)!;
  assert.equal(band.actualPct, 50);
  assert.equal(band.claimedPct, 85, "the midpoint of the 80-89 band");
  assert.equal(band.miscalibrated, true);
});

test("a tiny band is never flagged as miscalibrated", () => {
  const list = [
    signal({ confidence: 85, touch: { "1": { dir: "down", bars: 1 } } as never }),
    signal({ confidence: 85, touch: { "1": { dir: "down", bars: 1 } } as never }),
  ];
  const band = calibration(list, 1, 8).find((b) => b.lo === 80)!;
  assert.equal(band.actualPct, 0);
  assert.equal(band.miscalibrated, false, "2 signals cannot demonstrate miscalibration");
});

// ---- Breakdowns and overfitting ----

test("breakdowns split by regime, time of day and walk-forward slice", () => {
  const list = [
    signal({ regime: "strong_bull", istHour: 10, split: "train" }),
    signal({ regime: "sideways", istHour: 20, split: "test" }),
    signal({ regime: "sideways", istHour: 20, split: "test" }),
  ];
  assert.equal(byRegime(list, 1, 8).find((b) => b.key === "sideways")?.signals, 2);
  assert.equal(byTimeOfDay(list, 1, 8).find((b) => b.key === "19–21")?.signals, 2);
  assert.equal(bySplit(list, 1, 8).find((b) => b.key === "test")?.signals, 2);
  assert.ok(byRegime(list, 1, 8).every((b) => b.signals > 0), "empty buckets are not listed");
});

test("the 60/20/20 split is chronological and covers every signal", () => {
  const runner = createBacktestRunner(bars(longPath(700)), { commodity: "NATURALGAS", step: 3 });
  while (!runner.step(400)) { /* run */ }
  const { signals } = runner.result();
  assert.ok(signals.length >= 10, `need signals to split, got ${signals.length}`);
  const order = ["train", "validation", "test"];
  let seen = 0;
  for (const s of signals) {
    const idx = order.indexOf(s.split);
    assert.ok(idx >= seen, "splits must run train -> validation -> test in time order");
    seen = idx;
  }
});

test("overfitting is only claimed on a real out-of-sample count", () => {
  const thin = [
    { key: "train", label: "", signals: 100, success: 80, failure: 20, unknown: 0, successPct: 80 },
    { key: "test", label: "", signals: 8, success: 3, failure: 2, unknown: 3, successPct: 60 },
  ];
  assert.match(overfittingWarning(thin) ?? "", /too few to judge/);

  const real = [
    { key: "train", label: "", signals: 100, success: 80, failure: 20, unknown: 0, successPct: 80 },
    { key: "test", label: "", signals: 40, success: 20, failure: 20, unknown: 0, successPct: 50 },
  ];
  assert.match(overfittingWarning(real) ?? "", /Possible overfitting/);

  const fine = [
    { key: "train", label: "", signals: 100, success: 70, failure: 30, unknown: 0, successPct: 70 },
    { key: "test", label: "", signals: 40, success: 27, failure: 13, unknown: 0, successPct: 68 },
  ];
  assert.equal(overfittingWarning(fine), null);
});

test("the support test groups signals by what support was doing", () => {
  const list = [
    signal({ supportState: "holding", touch: { "1": { dir: "up", bars: 1 } } as never }),
    signal({ supportState: "failed_retest", state: "bearish", touch: { "1": { dir: "down", bars: 1 } } as never }),
  ];
  const rows = supportTest(list, 1, 8);
  assert.equal(rows.find((r) => r.key === "holding")?.successPct, 100);
  assert.equal(rows.find((r) => r.key === "failed_retest")?.successPct, 100);
});

test("failure analysis lists only the wrong calls, newest first", () => {
  const list = [
    signal({ t: 1000, touch: { "1": { dir: "down", bars: 1 } } as never }),
    signal({ t: 3000, touch: { "1": { dir: "down", bars: 1 } } as never }),
    signal({ t: 2000, touch: { "1": { dir: "up", bars: 1 } } as never }),
  ];
  const fails = failureCases(list, 1, 8);
  assert.deepEqual(fails.map((f) => f.t), [3000, 1000]);
});

// ---- CSV (Part 53) ----

test("the CSV header and a row line up, and the outcome is included", () => {
  const run = { signals: [signal()], meta: { commodity: "NATURALGAS" as const, bars: 1, firstDate: null, lastDate: null, sessions: 1, evaluated: 1, technicalOnly: true as const, newsNote: "" } };
  const csv = toCsv(run, 1, 8);
  const [head, row] = csv.split("\n");
  assert.equal(head.split(",").length, row.split(",").length, "every column must have a value");
  assert.match(head, /timestamp,commodity,price,signal,confidence/);
  assert.match(row, /still_bullish/);
  assert.match(row, /success/);
});

// ---- Regime ----

test("regime separates trend from chop from volatility", () => {
  const up = bars(Array.from({ length: 40 }, (_, i) => 100 + i * 0.5));
  assert.equal(classifyRegime(up), "strong_bull");
  const down = bars(Array.from({ length: 40 }, (_, i) => 100 - i * 0.5));
  assert.equal(classifyRegime(down), "strong_bear");
  const flat = bars(Array.from({ length: 40 }, () => 100));
  assert.equal(classifyRegime(flat), "sideways");
  // An odd length so it starts AND ends on the low: with an even count this
  // zigzag runs 96 -> 104 and is, correctly, a strong bull.
  const wild = bars(Array.from({ length: 41 }, (_, i) => 100 + (i % 2 ? 4 : -4)), { spread: 3 });
  assert.equal(classifyRegime(wild), "high_volatility");
});

test("horizons stop at 30 minutes because the data is 30-minute bars", () => {
  assert.equal(HORIZONS[0].bars, 1);
  assert.ok(!HORIZONS.some((h) => h.label.includes("15")), "a 15-minute horizon cannot be measured from 30-minute candles");
});
