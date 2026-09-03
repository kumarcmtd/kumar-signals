import { test } from "node:test";
import assert from "node:assert/strict";
import { detectReversal } from "../utils/reversalCatchEngine";
import type { Candle } from "../types";

let t = 0;
function c(open: number, high: number, low: number, close: number, volume = 1000): Candle {
  t += 900_000;
  return { date: new Date(1_700_000_000_000 + t).toISOString(), open, high, low, close, volume };
}

// Flat base, then a sharp fall into a low, then a strong bullish reversal bar.
function fallThenBounce(): Candle[] {
  const out: Candle[] = [];
  t = 0;
  for (let i = 0; i < 32; i++) out.push(c(100, 100.4, 99.6, 100, 1000)); // calm base ~100
  // sharp fall 100 -> ~90 over 8 bars
  const fall = [98.5, 97, 95.5, 94, 92.5, 91, 90.2, 89.6];
  let prev = 100;
  for (const px of fall) {
    out.push(c(prev, prev + 0.2, px - 0.3, px, 1500));
    prev = px;
  }
  // one more small red (the low bar area)
  out.push(c(89.6, 89.8, 89.4, 89.7, 1600));
  // strong bullish reversal bar (engulfs, big green, high volume)
  out.push(c(89.75, 92.2, 89.7, 92.0, 3500));
  return out;
}

function rallyThenFade(): Candle[] {
  const out: Candle[] = [];
  t = 0;
  for (let i = 0; i < 32; i++) out.push(c(100, 100.4, 99.6, 100, 1000));
  const rally = [101.5, 103, 104.5, 106, 107.5, 109, 109.8, 110.4];
  let prev = 100;
  for (const px of rally) {
    out.push(c(prev, px + 0.3, prev - 0.2, px, 1500));
    prev = px;
  }
  out.push(c(110.4, 110.6, 110.2, 110.3, 1600));
  // strong bearish reversal bar (big red, high volume)
  out.push(c(110.25, 110.3, 108.0, 108.2, 3500));
  return out;
}

function flat(): Candle[] {
  const out: Candle[] = [];
  t = 0;
  for (let i = 0; i < 45; i++) out.push(c(100, 100.5, 99.5, 100 + (i % 2 === 0 ? 0.1 : -0.1), 1000));
  return out;
}

test("catches a bullish bounce after a sharp fall", () => {
  const r = detectReversal(fallThenBounce());
  assert.ok(r.setup, `expected a setup, got: ${r.waitingReason}`);
  assert.equal(r.setup!.direction, "bullish");
  assert.equal(r.setup!.optSide, "CE");
  assert.ok(r.setup!.moveAtr >= 2.2);
  // targets ascend above entry (catching the retrace up)
  assert.ok(r.setup!.targets[0] > r.setup!.entry);
  assert.ok(r.setup!.targets[1] > r.setup!.targets[0]);
  assert.ok(r.setup!.targets[2] > r.setup!.targets[1]);
  // stop sits below the entry for a long
  assert.ok(r.setup!.stop < r.setup!.entry);
});

test("catches a bearish fade after a sharp rally", () => {
  const r = detectReversal(rallyThenFade());
  assert.ok(r.setup, `expected a setup, got: ${r.waitingReason}`);
  assert.equal(r.setup!.direction, "bearish");
  assert.equal(r.setup!.optSide, "PE");
  // targets descend below entry (catching the retrace down)
  assert.ok(r.setup!.targets[0] < r.setup!.entry);
  assert.ok(r.setup!.targets[2] < r.setup!.targets[1]);
  assert.ok(r.setup!.stop > r.setup!.entry);
});

test("no setup on a flat, moveless market", () => {
  const r = detectReversal(flat());
  assert.equal(r.setup, null);
});

test("needs enough candles before it will fire", () => {
  const r = detectReversal(fallThenBounce().slice(-20));
  assert.equal(r.setup, null);
});
