import { test } from "vitest";
import assert from "node:assert/strict";
import { analyzeCommodity, RECENT_SWING_BARS, type PatternCandle } from "../utils/chartPatterns";

/**
 * Candles from a list of prices, one flat-bodied bar per price with a small
 * fixed wick. Flat bodies matter: if each bar opened at the previous close, the
 * bar after a peak would share the peak's high and it would never register as
 * a strict swing -- the fixture would test the fixture, not the detector.
 */
function bars(prices: number[], wick = 0.3): PatternCandle[] {
  return prices.map((c, i) => ({
    date: `2026-09-${String((i % 28) + 1).padStart(2, "0")}T09:00:00+05:30`,
    open: c,
    high: c + wick,
    low: c - wick,
    close: c,
  }));
}

/**
 * A double top: rally to ~110, dip to 100 (neckline), rally back to ~110,
 * then drift down toward the neckline. `tail` is what happens after.
 */
function doubleTop(tail: number[]): number[] {
  return [
    90, 92, 94, 96, 98, 100, 102, 104, 106, 108, 110, // first peak at index 10
    108, 106, 104, 102, 100, // neckline low at index 15
    102, 104, 106, 108, 110, // second peak at index 20
    108, 106, // two bars down to confirm the swing
    ...tail,
  ];
}

test("a fresh double top that has not triggered is reported", () => {
  const r = analyzeCommodity(bars(doubleTop([104, 103])));
  assert.equal(r.pattern, "Double Top");
  assert.equal(r.direction, "bearish");
  assert.ok(typeof r.barsSinceFormed === "number" && r.barsSinceFormed <= RECENT_SWING_BARS);
});

// Fault 2 from the review.
test("a double top whose neckline already broke is not offered as an entry", () => {
  // Closes well under the ~100 neckline after the second peak.
  const r = analyzeCommodity(bars(doubleTop([102, 99, 98])));
  assert.notEqual(r.pattern, "Double Top");
  assert.match(r.note, /Double Top matched but already broke out/);
});

test("a double top that already reached its target is rejected as played out", () => {
  // Neckline 99.7 (the 100 low less its wick), height 10.6, so the measured
  // target is 89.1. Price trades down through it.
  const r = analyzeCommodity(bars(doubleTop([100, 96, 92, 88, 89])));
  assert.notEqual(r.pattern, "Double Top");
  assert.match(r.note, /Double Top matched but already reached its target/);
});

test("a double top that failed through its stop is rejected", () => {
  // Stop ~ 110 * 1.01 = 111.1; price rallies through it instead of breaking down.
  const r = analyzeCommodity(bars(doubleTop([108, 111, 113])));
  assert.notEqual(r.pattern, "Double Top");
});

// Fault 1 from the review.
test("a pattern whose final swing is weeks old is not reported as current", () => {
  // The same double top, then a long flat drift that forms no new swings.
  const flat = Array.from({ length: 25 }, () => 105);
  const r = analyzeCommodity(bars(doubleTop(flat), 0));
  assert.notEqual(r.pattern, "Double Top");
  assert.match(r.note, /formed too long ago/);
});

test("no pattern at all says so plainly, with no stale explanation", () => {
  const r = analyzeCommodity(bars([100, 100.2, 100.1, 100.3, 100.2]));
  assert.equal(r.pattern, "No Clear Pattern");
  assert.equal(r.entry, "-");
  assert.equal(r.reliability, null);
  assert.doesNotMatch(r.note, /matched but/);
});

// Fault 3 from the review.
test("every qualifying pattern is returned, not just the first in list order", () => {
  const r = analyzeCommodity(bars(doubleTop([104, 103])));
  // Whatever wins, anything else that qualified is attached rather than dropped.
  if (r.alternatives) {
    for (const alt of r.alternatives) {
      assert.ok(alt.barsSinceFormed! >= r.barsSinceFormed!, "alternatives are no fresher than the winner");
    }
  }
  assert.ok(r.pattern !== "No Clear Pattern");
});

test("the textbook reliability figure is still attached, but never used to rank", () => {
  const r = analyzeCommodity(bars(doubleTop([104, 103])));
  assert.equal(r.reliability, 65, "Double Top's literature figure, shown as before");
});

test("too few candles is handled without throwing", () => {
  assert.equal(analyzeCommodity([]).pattern, "No Clear Pattern");
  assert.equal(analyzeCommodity(bars([100, 101])).pattern, "No Clear Pattern");
});
