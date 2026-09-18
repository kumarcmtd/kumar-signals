import { test } from "node:test";
import assert from "node:assert/strict";
import { readPricePressure, readMarketPressure, depthLeanOf } from "../utils/marketPressure";
import { computeDepthPressure } from "../utils/depthPressure";
import type { Candle } from "../types";

// Natural Gas scale (~250) so the ATR thresholds get a realistic workout.
function series(closes: number[], volume = 1000): Candle[] {
  return closes.map((c, i) => ({
    date: new Date(Date.UTC(2026, 8, 15, 4, 0) + i * 15 * 60_000).toISOString(),
    open: i === 0 ? c : closes[i - 1],
    high: Math.max(c, i === 0 ? c : closes[i - 1]) + 0.6,
    low: Math.min(c, i === 0 ? c : closes[i - 1]) - 0.6,
    close: c,
    volume,
  }));
}

function falling(): Candle[] {
  const closes: number[] = [];
  for (let i = 0; i < 30; i += 1) closes.push(260 - i * 0.9);
  return series(closes);
}

function rising(): Candle[] {
  const closes: number[] = [];
  for (let i = 0; i < 30; i += 1) closes.push(230 + i * 0.9);
  return series(closes);
}

function sideways(): Candle[] {
  const closes: number[] = [];
  for (let i = 0; i < 30; i += 1) closes.push(250 + (i % 2 === 0 ? 0.12 : -0.12));
  return series(closes);
}

test("readPricePressure calls a steady decline selling", () => {
  const p = readPricePressure(falling());
  assert.equal(p.pressure, "selling");
  assert.ok(p.changePct !== null && p.changePct < 0);
  assert.ok(p.lowerLows > p.higherHighs);
});

test("readPricePressure calls a steady advance buying", () => {
  const p = readPricePressure(rising());
  assert.equal(p.pressure, "buying");
  assert.ok(p.higherHighs > p.lowerLows);
});

test("readPricePressure calls a flat market sideways, not a trend", () => {
  assert.equal(readPricePressure(sideways()).pressure, "flat");
});

test("readPricePressure reports unknown rather than guessing with no data", () => {
  assert.equal(readPricePressure([]).pressure, "unknown");
  assert.equal(readPricePressure(undefined).pressure, "unknown");
  assert.equal(readPricePressure(null).barsUsed, 0);
});

test("depthLeanOf keeps a near-even book balanced", () => {
  assert.equal(depthLeanOf(80), "buyers");
  assert.equal(depthLeanOf(51), "balanced");
  assert.equal(depthLeanOf(20), "sellers");
});

// ---------------------------------------------------------------------------
// THE TRAP: 80% buy depth while price falls. This is the exact situation that
// cost a real trade, and the whole module exists to make it impossible to read
// as bullish.
// ---------------------------------------------------------------------------

test("80% buy depth while price falls is flagged as a conflict, never bullish", () => {
  const r = readMarketPressure(800, 200, falling());
  assert.ok(r);
  assert.equal(r!.buyPct, 80);
  assert.equal(r!.depthLean, "buyers");
  assert.equal(r!.price.pressure, "selling");
  assert.equal(r!.verdict, "conflict");
  assert.equal(r!.conflict, true);
  assert.match(r!.headline, /price is not/i);
  assert.match(r!.detail, /not a buy signal/i);
});

test("80% sell depth while price rises is the mirror conflict", () => {
  const r = readMarketPressure(200, 800, rising());
  assert.ok(r);
  assert.equal(r!.depthLean, "sellers");
  assert.equal(r!.verdict, "conflict");
  assert.match(r!.detail, /not a sell signal/i);
});

test("book and price agreeing is aligned, and still refuses to stand alone", () => {
  const r = readMarketPressure(800, 200, rising());
  assert.ok(r);
  assert.equal(r!.verdict, "aligned");
  assert.equal(r!.conflict, false);
  assert.match(r!.detail, /never makes one/i);
});

test("a lean price has not confirmed is quiet, not a signal", () => {
  const r = readMarketPressure(800, 200, sideways());
  assert.ok(r);
  assert.equal(r!.verdict, "quiet");
  assert.match(r!.detail, /not yet worth acting on/i);
});

test("no price data yields unknown rather than a confident read", () => {
  const r = readMarketPressure(800, 200, []);
  assert.ok(r);
  assert.equal(r!.verdict, "unknown");
  assert.equal(r!.conflict, false);
  assert.match(r!.detail, /unconfirmed/i);
});

test("an empty book returns null", () => {
  assert.equal(readMarketPressure(0, 0, falling()), null);
});

// ---------------------------------------------------------------------------
// The badge that displayed the misleading number.
// ---------------------------------------------------------------------------

test("a Call is NOT told 'good' when 80% buy depth sits under a falling price", () => {
  const p = computeDepthPressure(800, 200, "CE", falling());
  assert.ok(p);
  assert.equal(p!.tone, "care");
  assert.equal(p!.conflict, true);
  assert.match(p!.detail, /not a buy signal/i);
  assert.match(p!.detail, /Call is not confirmed/i);
});

test("a Call keeps its 'good' tone when price agrees with the book", () => {
  const p = computeDepthPressure(800, 200, "CE", rising());
  assert.ok(p);
  assert.equal(p!.tone, "good");
  assert.equal(p!.conflict, false);
  assert.match(p!.detail, /price is moving that way too/i);
});

test("an unconfirmed lean is neutral for a Call, not good", () => {
  const p = computeDepthPressure(800, 200, "CE", sideways());
  assert.ok(p);
  assert.equal(p!.tone, "neutral");
  assert.equal(p!.conflict, false);
});

test("without candles the badge behaves exactly as before", () => {
  const p = computeDepthPressure(967, 616, "CE");
  assert.ok(p);
  assert.equal(p!.tone, "good");
  assert.equal(p!.conflict, false);
  assert.equal(p!.pressure, null);
  assert.match(p!.detail, /price has not been checked/i);
});
