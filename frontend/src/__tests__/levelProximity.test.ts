import { test } from "node:test";
import assert from "node:assert/strict";
import { detectLevelProximity } from "../utils/levelProximity";
import type { Candle } from "../types";

let t = 0;
function c(open: number, high: number, low: number, close: number, volume = 1000): Candle {
  t += 3_600_000;
  return { date: new Date(1_700_000_000_000 + t).toISOString(), open, high, low, close, volume };
}

// Builds a series that repeatedly tests ~100 as resistance (swing highs) and
// ~90 as support (swing lows), then ends the series wherever `endClose` says.
function seriesEndingAt(endClose: number, prevClose = endClose): Candle[] {
  t = 0;
  const out: Candle[] = [];
  // several oscillations touching 90 (support) and 100 (resistance)
  for (let k = 0; k < 5; k++) {
    out.push(c(95, 95.3, 90.0, 92)); // dip to support 90
    out.push(c(92, 93, 91.5, 95));
    out.push(c(95, 100.0, 94.7, 98)); // spike to resistance 100
    out.push(c(98, 98.5, 96, 95));
    out.push(c(95, 96, 90.1, 93)); // dip to support 90
    out.push(c(93, 94, 92, 96));
    out.push(c(96, 99.9, 95.5, 97)); // spike to resistance 100
    out.push(c(97, 97.5, 95, 94));
  }
  // tail: a few calm bars, then the second-last and last close we control
  for (let k = 0; k < 6; k++) out.push(c(95, 95.6, 94.4, 95));
  out.push(c(95, 96, 94, prevClose));
  out.push(c(prevClose, Math.max(prevClose, endClose) + 0.2, Math.min(prevClose, endClose) - 0.2, endClose));
  return out;
}

test("warns when price is closing in on resistance", () => {
  const a = detectLevelProximity(seriesEndingAt(99.6));
  assert.ok(a, "expected an alert near resistance");
  assert.equal(a!.kind, "near_resistance");
  assert.ok(a!.price >= 99 && a!.price <= 101);
});

test("warns when price is closing in on support", () => {
  const a = detectLevelProximity(seriesEndingAt(90.5));
  assert.ok(a, "expected an alert near support");
  assert.equal(a!.kind, "near_support");
});

test("flags a fresh breakout above resistance", () => {
  const a = detectLevelProximity(seriesEndingAt(100.8, 99.5)); // prev below 100, now above
  assert.ok(a);
  assert.equal(a!.kind, "breakout_up");
});

test("no alert when price sits mid-range, far from any level", () => {
  const a = detectLevelProximity(seriesEndingAt(95.0));
  assert.equal(a, null);
});

test("returns null on too few candles", () => {
  assert.equal(detectLevelProximity(seriesEndingAt(99.6).slice(-10)), null);
});
