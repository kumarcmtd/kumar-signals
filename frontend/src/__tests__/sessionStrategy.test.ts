import { test } from "node:test";
import assert from "node:assert/strict";
import { sessionStateFor, evaluateSessionSetup, POWER_WINDOWS } from "../utils/sessionStrategyEngine";
import type { TimeframeAnalysis } from "../utils/timeframeEngine";
import type { PriceSpeedReading } from "../utils/priceSpeed";

const HM = (h: number, m = 0) => h * 60 + m;
const WED = 3, THU = 4, MON = 1;

test("resolves the active window when inside one", () => {
  const s = sessionStateFor(HM(19, 20), MON); // 7:20pm -> US Market Open
  assert.equal(s.active?.id, "us-open");
  assert.equal(s.minutesToNext, 0);
});

test("between windows, reports the next window and countdown", () => {
  const s = sessionStateFor(HM(14, 0), MON); // 2:00pm -> before the 3:45 Europe push
  assert.equal(s.active, null);
  assert.equal(s.next?.id, "eu-momentum");
  assert.equal(s.minutesToNext, HM(15, 45) - HM(14, 0));
});

test("EIA crude window is only active on Wednesday", () => {
  const wed = sessionStateFor(HM(20, 10), WED);
  assert.equal(wed.active?.id, "eia-crude");
  assert.equal(wed.activeImpact, "very-high");
  assert.equal(wed.eiaTodayFor, "CRUDEOIL");

  const mon = sessionStateFor(HM(20, 10), MON); // same clock, not a report day
  assert.notEqual(mon.active?.id, "eia-crude");
  assert.equal(mon.eiaTodayFor, null);
});

test("EIA natural-gas window is only active on Thursday", () => {
  const thu = sessionStateFor(HM(20, 10), THU);
  assert.equal(thu.active?.id, "eia-natgas");
  assert.equal(thu.eiaTodayFor, "NATURALGAS");
});

// ---- setup gating ----
function analysis(over: Partial<TimeframeAnalysis> = {}): TimeframeAnalysis {
  return {
    tf: "15", label: "15 Minutes", insufficient: null, overallScore: 88, decision: "STRONG BUY",
    bias: "bullish", optSide: "CE", reasons: ["EMA stack bullish", "MACD rising"], vetoes: [], hitProbability: 72,
    confidenceLabel: "Good", signalStrength: "strong",
    categories: null, underlyingEntry: 7000, underlyingStop: 6960, underlyingTargets: [7040, 7080, 7120],
    holdingTime: "—", ignition: null, entryQuality: null, ...over,
  } as unknown as TimeframeAnalysis;
}
const speed = (score: number): PriceSpeedReading => ({ score, label: score > 55 ? "Volatile" : "Normal", color: "#000", atrValue: 1, atrPct: 1, lastRange: 1, ratio: 1, estPremiumSwing: null });

test("outside a window: always WAIT with a reason, whatever the read says", () => {
  const s = sessionStateFor(HM(14, 0), MON);
  const r = evaluateSessionSetup(s, analysis(), speed(90));
  assert.equal(r.decision, "WAIT");
  assert.ok(r.waitingReason && /Outside a high-movement window/.test(r.waitingReason));
});

test("in a window but calm price: WAIT (a window is necessary, not sufficient)", () => {
  const s = sessionStateFor(HM(19, 20), MON);
  const r = evaluateSessionSetup(s, analysis(), speed(20));
  assert.equal(r.decision, "WAIT");
  assert.ok(r.waitingReason && /isn't moving/.test(r.waitingReason));
});

test("in a window, directional and moving: fires a call with a window-boosted confidence", () => {
  const s = sessionStateFor(HM(19, 20), MON); // high-impact US open
  const r = evaluateSessionSetup(s, analysis(), speed(60));
  assert.equal(r.optSide, "CE");
  assert.ok(["BUY", "STRONG BUY"].includes(r.decision));
  assert.ok(r.confidence !== null && r.confidence > 72); // boosted above the raw hitProbability
});

test("the EIA window boosts confidence more than a moderate window (same read)", () => {
  const wed = evaluateSessionSetup(sessionStateFor(HM(20, 10), WED), analysis(), speed(60)); // very-high
  const eu = evaluateSessionSetup(sessionStateFor(HM(12, 45), MON), analysis(), speed(60)); // moderate eu-open
  assert.ok(wed.confidence !== null && eu.confidence !== null && wed.confidence > eu.confidence);
});

test("bearish read in a window produces a PE call", () => {
  const s = sessionStateFor(HM(21, 30), MON);
  const r = evaluateSessionSetup(s, analysis({ bias: "bearish", optSide: "PE", decision: "STRONG SELL" }), speed(60));
  assert.equal(r.optSide, "PE");
  assert.ok(["SELL", "STRONG SELL"].includes(r.decision));
});

test("every window has a driver explanation and a valid time range", () => {
  for (const w of POWER_WINDOWS) {
    assert.ok(w.driver.length > 20, `${w.id} needs a real driver`);
    assert.ok(w.endMin > w.startMin);
  }
});
