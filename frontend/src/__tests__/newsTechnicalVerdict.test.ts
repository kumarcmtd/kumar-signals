import { test } from "node:test";
import assert from "node:assert/strict";
import { combineNewsAndTechnical, newsSideOf, techSideOf, MAX_CONFIDENCE } from "../utils/newsTechnicalVerdict";
import type { NewsTilt } from "../utils/claudeNewsAnalytics";
import type { PullbackResult, PullbackState } from "../utils/pullbackReversalEngine";

function tilt(over: Partial<NewsTilt> = {}): NewsTilt {
  return {
    commodity: "CRUDE",
    direction: "neutral",
    strength: "flat",
    score: 0,
    sampleSize: 10,
    bullishCount: 3,
    bearishCount: 3,
    neutralCount: 4,
    label: "Crude Oil news is balanced",
    note: "",
    ...over,
  };
}

function pullback(state: PullbackState, over: Partial<PullbackResult> = {}): PullbackResult {
  return {
    commodity: "CRUDEOIL",
    timestamp: Date.now(),
    currentPrice: 9000,
    state,
    stateLabel: state === "still_bullish" ? "STILL BULLISH" : state === "bearish" ? "BEARISH" : "UNCERTAIN",
    stateDetail: "Pullback may be possible",
    pullbackProbability: 40,
    reversalProbability: 30,
    confidence: 70,
    structures: {} as PullbackResult["structures"],
    supportZones: [],
    resistanceZones: [],
    nearestSupport: null,
    majorSupport: null,
    nearestResistance: null,
    majorResistance: null,
    pullbackZone: null,
    fall: { kind: "none", label: "No significant fall", detail: "", fromSwingHighPct: null, atrMultiple: null },
    bullishPullbackScore: 50,
    bearishReversalScore: 30,
    contributions: [],
    bullishConfirmation: "A close back above 9,050",
    bearishConfirmation: "A close below 8,950",
    invalidation: "price closes below 8,900.",
    conflictDetected: false,
    majorFundamentalShock: false,
    dataQuality: 9,
    dataAgeMinutes: 2,
    reasons: [],
    warnings: [],
    ...over,
  } as PullbackResult;
}

test("newsSideOf treats a thin sample as no read at all", () => {
  assert.equal(newsSideOf(tilt({ direction: "bullish", sampleSize: 2 })), "unknown");
  assert.equal(newsSideOf(tilt({ direction: "bullish", sampleSize: 20 })), "bullish");
  assert.equal(newsSideOf(null), "unknown");
});

test("techSideOf maps the pullback state onto a side", () => {
  assert.equal(techSideOf(pullback("still_bullish")), "bullish");
  assert.equal(techSideOf(pullback("bearish")), "bearish");
  assert.equal(techSideOf(pullback("uncertain")), "neutral");
  assert.equal(techSideOf(null), "unknown");
});

// The rule the whole module exists for.
test("news bullish + chart bearish is a conflict, NOT a buy", () => {
  const v = combineNewsAndTechnical("CRUDEOIL", tilt({ direction: "bullish", score: 40, sampleSize: 15 }), pullback("bearish"));
  assert.equal(v.kind, "conflict");
  assert.equal(v.tone, "amber");
  assert.match(v.headline, /disagree/i);
  assert.match(v.detail, /chop/i);
  assert.ok(v.cautions.some((c) => /opposite ways/i.test(c)));
});

test("news bearish + chart bullish is the mirror conflict", () => {
  const v = combineNewsAndTechnical("NATURALGAS", tilt({ direction: "bearish", score: -40, sampleSize: 15 }), pullback("still_bullish"));
  assert.equal(v.kind, "conflict");
  assert.match(v.headline, /Natural Gas/);
});

test("a conflict scores lower confidence than agreement", () => {
  const agree = combineNewsAndTechnical("CRUDEOIL", tilt({ direction: "bullish", score: 40, sampleSize: 15 }), pullback("still_bullish"));
  const clash = combineNewsAndTechnical("CRUDEOIL", tilt({ direction: "bullish", score: 40, sampleSize: 15 }), pullback("bearish"));
  assert.ok(clash.confidence < agree.confidence);
});

test("both bullish is a confirmed bullish read", () => {
  const v = combineNewsAndTechnical("CRUDEOIL", tilt({ direction: "bullish", score: 45, sampleSize: 20 }), pullback("still_bullish"));
  assert.equal(v.kind, "bullish_confirmed");
  assert.equal(v.tone, "green");
  assert.ok(v.agrees.some((a) => /same way/i.test(a)));
});

test("both bearish is a confirmed bearish read", () => {
  const v = combineNewsAndTechnical("CRUDEOIL", tilt({ direction: "bearish", score: -45, sampleSize: 20 }), pullback("bearish"));
  assert.equal(v.kind, "bearish_confirmed");
  assert.equal(v.tone, "red");
});

test("even full agreement never exceeds the confidence cap", () => {
  const v = combineNewsAndTechnical("CRUDEOIL", tilt({ direction: "bullish", score: 90, sampleSize: 40 }), pullback("still_bullish", { confidence: 94 }));
  assert.ok(v.confidence <= MAX_CONFIDENCE, `confidence ${v.confidence} must not exceed ${MAX_CONFIDENCE}`);
});

test("one side leaning with the other flat is a bias, not a confirmation", () => {
  const v = combineNewsAndTechnical("CRUDEOIL", tilt({ direction: "bullish", score: 30, sampleSize: 15 }), pullback("uncertain"));
  assert.equal(v.kind, "bullish_bias");
  assert.equal(v.tone, "amber");
  assert.match(v.headline, /needs confirmation/i);
  assert.match(v.nextStep, /wait for the chart/i);
});

test("chart leaning with no usable news is still only a bias", () => {
  const v = combineNewsAndTechnical("CRUDEOIL", tilt({ direction: "neutral", sampleSize: 0, bullishCount: 0, bearishCount: 0, neutralCount: 0 }), pullback("bearish"));
  assert.equal(v.kind, "bearish_bias");
  assert.match(v.nextStep, /wait for the news/i);
});

test("no news and no chart is reported as insufficient, never as neutral", () => {
  const v = combineNewsAndTechnical("CRUDEOIL", tilt({ sampleSize: 0, bullishCount: 0, bearishCount: 0, neutralCount: 0 }), null);
  assert.equal(v.kind, "insufficient");
  assert.equal(v.confidence, 0);
  assert.match(v.detail, /absence of information, not a signal/i);
});

test("both sides flat is an explicit wait, not a trade", () => {
  const v = combineNewsAndTechnical("CRUDEOIL", tilt({ direction: "neutral", sampleSize: 12 }), pullback("uncertain"));
  assert.equal(v.kind, "wait");
  assert.match(v.nextStep, /nothing to act on/i);
});

test("a missing news feed is called out as missing information", () => {
  const v = combineNewsAndTechnical("CRUDEOIL", tilt({ sampleSize: 0, bullishCount: 0, bearishCount: 0, neutralCount: 0 }), pullback("still_bullish"));
  assert.ok(v.cautions.some((c) => /missing information, not a calm market/i.test(c)));
});

test("poor chart data quality is surfaced as a caution", () => {
  const v = combineNewsAndTechnical("CRUDEOIL", tilt({ direction: "bullish", score: 40, sampleSize: 15 }), pullback("still_bullish", { dataQuality: 4 }));
  assert.ok(v.cautions.some((c) => /data quality is 4\/10/i.test(c)));
});

test("a flagged fundamental shock is surfaced as a caution", () => {
  const v = combineNewsAndTechnical("CRUDEOIL", tilt({ direction: "bullish", score: 40, sampleSize: 15 }), pullback("still_bullish", { majorFundamentalShock: true }));
  assert.ok(v.cautions.some((c) => /fundamental shock/i.test(c)));
});

test("every verdict carries a next step and never promises an outcome", () => {
  const cases = [
    combineNewsAndTechnical("CRUDEOIL", tilt({ direction: "bullish", score: 40, sampleSize: 15 }), pullback("still_bullish")),
    combineNewsAndTechnical("CRUDEOIL", tilt({ direction: "bullish", score: 40, sampleSize: 15 }), pullback("bearish")),
    combineNewsAndTechnical("CRUDEOIL", tilt({ direction: "neutral", sampleSize: 12 }), pullback("uncertain")),
    combineNewsAndTechnical("CRUDEOIL", tilt({ sampleSize: 0, bullishCount: 0, bearishCount: 0, neutralCount: 0 }), null),
  ];
  const banned = /guaranteed|100% accurate|sure shot|will definitely|certain profit/i;
  for (const v of cases) {
    assert.ok(v.nextStep.length > 0, `${v.kind} must say what to do next`);
    assert.ok(!banned.test(`${v.headline} ${v.detail} ${v.nextStep}`), `${v.kind} must not promise an outcome`);
    assert.ok(v.confidence <= MAX_CONFIDENCE);
  }
});
