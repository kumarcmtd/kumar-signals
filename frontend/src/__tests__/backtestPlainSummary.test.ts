import { test } from "vitest";
import assert from "node:assert/strict";
import { buildPlainSummary, BREAK_EVEN_PCT } from "../utils/backtestPlainSummary";
import type { Summary, CalibrationBand, Breakdown } from "../utils/backtestEngine";

function summary(over: Partial<Summary> = {}): Summary {
  return {
    total: 1111,
    green: 715,
    red: 228,
    yellow: 168,
    greenSuccess: 355,
    greenFailure: 315,
    redSuccess: 94,
    redFailure: 130,
    unknown: 215,
    falseGreenPct: 47,
    falseRedPct: 58,
    precision: 0.527,
    recall: 0.73,
    f1: 0.61,
    balancedAccuracy: 0.5,
    avgMfeAtr: 3.84,
    avgMaeAtr: 2.91,
    maxMfeAtr: 18.8,
    maxMaeAtr: 14.4,
    sampleLabel: "useful",
    sampleNote: "896 decided signals",
    ...over,
  } as Summary;
}

function band(lo: number, hi: number, actualPct: number | null, signals: number, miscalibrated = false): CalibrationBand {
  return { label: `${lo}-${hi}%`, lo, hi, signals, success: 0, failure: 0, unknown: 0, actualPct, claimedPct: (lo + hi) / 2, miscalibrated } as CalibrationBand;
}

function split(key: string, label: string, successPct: number | null, signals = 300): Breakdown {
  return { key, label, signals, success: 0, failure: 0, unknown: 0, successPct };
}

function hour(label: string, successPct: number, signals = 200): Breakdown {
  return { key: label, label, signals, success: 0, failure: 0, unknown: 0, successPct };
}

// The real numbers from the first Crude Oil run, so the wording is checked
// against an actual result rather than an invented one.
const REAL_BANDS = [
  band(50, 59, 57, 183),
  band(60, 69, 46, 271, true),
  band(70, 79, 50, 368, true),
  band(80, 89, 48, 121, true),
  band(90, 94, null, 0),
];
const REAL_SPLITS = [split("train", "In-Sample (60%)", 50), split("validation", "Validation (20%)", 57), split("test", "Out-Of-Sample (20%)", 44)];
const REAL_HOURS = [
  hour("09-12 IST", 37, 219),
  hour("12-15 IST", 49, 225),
  hour("15-17 IST", 53, 153),
  hour("17-19 IST", 50, 162),
  hour("19-21 IST", 51, 164),
  hour("21-24 IST", 64, 188),
];

test("a losing result is graded poor and says so in the first line", () => {
  const p = buildPlainSummary(summary(), REAL_BANDS, REAL_SPLITS, REAL_HOURS, 1, "4 hours");
  assert.equal(p.grade, "poor");
  assert.match(p.verdict, /did not make money/i);
  assert.match(p.verdictDetail, /53%/, "should quote what it actually achieved");
});

test("break-even is stated and an option buyer's extra cost is added on top", () => {
  const p = buildPlainSummary(summary(), REAL_BANDS, REAL_SPLITS, REAL_HOURS, 1, "4 hours");
  assert.equal(p.breakEvenPct, BREAK_EVEN_PCT);
  const coinFlip = p.points.find((x) => /coin flip/i.test(x.question));
  assert.ok(coinFlip);
  assert.match(coinFlip!.meaning, /56%/, "50% break-even plus the option buyer's buffer");
  assert.match(coinFlip!.meaning, /time decay|premium lost/i);
});

test("an inverted confidence scale is called out as backwards", () => {
  const p = buildPlainSummary(summary(), REAL_BANDS, REAL_SPLITS, REAL_HOURS, 1, "4 hours");
  const conf = p.points.find((x) => /confidence/i.test(x.question));
  assert.ok(conf);
  assert.match(conf!.answer, /^No —/, "57% at low confidence beating 48% at high confidence must read as 'no'");
  assert.match(conf!.meaning, /backwards/i);
  assert.equal(conf!.tone, "bad");
});

test("a properly calibrated engine is not accused of overclaiming", () => {
  const good = [band(50, 59, 55, 200), band(60, 69, 64, 200), band(70, 79, 74, 200), band(80, 89, 83, 200)];
  const p = buildPlainSummary(summary({ precision: 0.7 }), good, [split("test", "Out-Of-Sample (20%)", 68)], REAL_HOURS, 1, "4 hours");
  const conf = p.points.find((x) => /confidence/i.test(x.question));
  assert.match(conf!.answer, /^Yes/);
  assert.equal(conf!.tone, "good");
});

test("the out-of-sample slice is reported as the number that counts", () => {
  const p = buildPlainSummary(summary(), REAL_BANDS, REAL_SPLITS, REAL_HOURS, 1, "4 hours");
  const oos = p.points.find((x) => /never saw/i.test(x.question));
  assert.ok(oos);
  assert.match(oos!.answer, /44%/);
  assert.match(oos!.meaning, /did not hold up/i);
  assert.equal(oos!.tone, "bad");
});

test("best and worst trading hours are surfaced", () => {
  const p = buildPlainSummary(summary(), REAL_BANDS, REAL_SPLITS, REAL_HOURS, 1, "4 hours");
  const when = p.points.find((x) => /when did it work/i.test(x.question));
  assert.ok(when);
  assert.match(when!.answer, /21-24 IST was best at 64%/);
  assert.match(when!.answer, /09-12 IST was worst at 37%/);
});

test("thinly sampled hours are excluded from the best/worst claim", () => {
  const thin = [hour("02-03 IST", 100, 3), hour("09-12 IST", 40, 200), hour("21-24 IST", 55, 200)];
  const p = buildPlainSummary(summary(), REAL_BANDS, REAL_SPLITS, thin, 1, "4 hours");
  const when = p.points.find((x) => /when did it work/i.test(x.question));
  assert.ok(when && !/02-03 IST/.test(when.answer), "a 3-signal window must not be called the best hour");
});

test("a genuinely good result is graded good", () => {
  const good = [band(50, 59, 55, 200), band(70, 79, 74, 200)];
  const p = buildPlainSummary(
    summary({ precision: 0.68 }),
    good,
    [split("train", "In-Sample (60%)", 66), split("test", "Out-Of-Sample (20%)", 64)],
    REAL_HOURS,
    1,
    "4 hours"
  );
  assert.equal(p.grade, "good");
  assert.match(p.verdict, /cleared the bar/i);
  assert.match(p.verdictDetail, /not mean proven/i, "a good result must still carry its caveat");
});

test("an insufficient sample is never graded, good or bad", () => {
  const p = buildPlainSummary(summary({ sampleLabel: "insufficient" }), [], [], [], 1, "4 hours");
  assert.equal(p.grade, "unusable");
  assert.match(p.verdict, /not enough/i);
});

test("no precision at all does not crash and reports honestly", () => {
  const p = buildPlainSummary(summary({ precision: null }), [], [], [], 1, "4 hours");
  assert.equal(p.actualPct, null);
  assert.equal(p.grade, "unusable");
  assert.ok(p.points.length > 0);
});

test("a poor result tells the user not to size up", () => {
  const p = buildPlainSummary(summary(), REAL_BANDS, REAL_SPLITS, REAL_HOURS, 1, "4 hours");
  assert.ok(p.actions.some((a) => /do not size up/i.test(a)));
  assert.ok(p.actions.some((a) => /weaker ones/i.test(a)), "with an inverted scale it should say why");
});

test("a wider target is suggested when price ran further in favour", () => {
  const p = buildPlainSummary(summary({ avgMfeAtr: 3.84, avgMaeAtr: 2.91 }), REAL_BANDS, REAL_SPLITS, REAL_HOURS, 1, "4 hours");
  assert.ok(p.actions.some((a) => /wider target/i.test(a)));
});

test("no wider-target suggestion when price ran further against", () => {
  const p = buildPlainSummary(summary({ avgMfeAtr: 1.2, avgMaeAtr: 2.9 }), REAL_BANDS, REAL_SPLITS, REAL_HOURS, 1, "4 hours");
  assert.ok(!p.actions.some((a) => /wider target/i.test(a)));
  const far = p.points.find((x) => /how far/i.test(x.question));
  assert.equal(far!.tone, "bad");
});

test("nothing in a poor summary reads as a promise", () => {
  const p = buildPlainSummary(summary(), REAL_BANDS, REAL_SPLITS, REAL_HOURS, 1, "4 hours");
  const all = [p.verdict, p.verdictDetail, ...p.points.flatMap((x) => [x.answer, x.meaning]), ...p.actions].join(" ");
  assert.ok(!/guaranteed|sure shot|will definitely|100% accurate|certain profit/i.test(all));
});
