import { test } from "node:test";
import assert from "node:assert/strict";
import { assessCallStrength } from "../utils/callStrength";
import type { Candle } from "../types";

// Build a candle series with a controllable per-bar drift so we can make the
// underlying trend clearly up or clearly down.
function series(driftPerBar: number, n = 60, start = 100): Candle[] {
  const out: Candle[] = [];
  let px = start;
  for (let i = 0; i < n; i++) {
    const open = px;
    px = Number((px + driftPerBar).toFixed(2));
    const close = px;
    out.push({
      date: new Date(Date.now() - (n - i) * 900_000).toISOString(),
      open,
      high: Math.max(open, close) + 0.5,
      low: Math.min(open, close) - 0.5,
      close,
      volume: 1000 + i,
    });
  }
  return out;
}

const ctxNow = (over: Partial<Parameters<typeof assessCallStrength>[2]> = {}) => ({
  entry: 200,
  stop: 150,
  targets: [230, 260, 290],
  targetsHit: [false, false, false],
  current: 205,
  openedAt: Date.now(),
  ...over,
});

test("returns null when there are too few candles", () => {
  assert.equal(assessCallStrength(series(1, 10), "bullish", ctxNow()), null);
});

test("a strong uptrend scores a bullish (CE) call as strong", () => {
  const r = assessCallStrength(series(1.0), "bullish", ctxNow());
  assert.ok(r);
  assert.ok(r!.score >= 68, `expected strong, got ${r!.score}`);
  assert.equal(r!.tier, "strong");
});

test("a strong uptrend scores a bearish (PE) call as weak", () => {
  const r = assessCallStrength(series(1.0), "bearish", ctxNow());
  assert.ok(r);
  assert.ok(r!.score < 50, `expected weak/weakening, got ${r!.score}`);
});

test("a strong downtrend scores a bearish (PE) call as strong", () => {
  const r = assessCallStrength(series(-1.0), "bearish", ctxNow());
  assert.ok(r);
  assert.ok(r!.score >= 68, `expected strong, got ${r!.score}`);
  assert.equal(r!.tier, "strong");
});

test("premium sitting near the stop drags the score down vs sitting near target", () => {
  const nearStop = assessCallStrength(series(1.0), "bullish", ctxNow({ current: 155 }));
  const nearTarget = assessCallStrength(series(1.0), "bullish", ctxNow({ current: 225 }));
  assert.ok(nearStop && nearTarget);
  assert.ok(nearTarget!.score > nearStop!.score);
});

test("a call open for days adds a theta-decay caution reason", () => {
  const r = assessCallStrength(series(1.0), "bullish", ctxNow({ openedAt: Date.now() - 3 * 86_400_000, current: 190 }));
  assert.ok(r);
  assert.ok(r!.reasons.some((x) => /decay|theta/i.test(x.text)));
  assert.ok(r!.daysOpen >= 2.9);
});
