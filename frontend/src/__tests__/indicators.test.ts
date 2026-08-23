import { test } from "node:test";
import assert from "node:assert/strict";
import { rsi, atr, adx, superTrend } from "../utils/indicators";
import type { Candle } from "../types";

function mk(o: number, h: number, l: number, c: number): Candle {
  return { date: new Date().toISOString(), open: o, high: h, low: l, close: c, volume: 1000, oi: 1000 };
}

// StockCharts' published 14-period RSI worked example -- the canonical vector.
const CLOSES = [
  44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08,
  45.89, 46.03, 45.61, 46.28, 46.28, 46.00, 46.03, 46.41, 46.22, 45.64,
  46.21, 46.25, 45.71, 46.45, 45.78, 45.35, 44.03, 44.18, 44.22, 44.57,
  43.42, 42.66, 43.13,
];

test("Wilder RSI matches the StockCharts textbook (first value 70.53)", () => {
  const first = rsi(CLOSES.slice(0, 15), 14);
  assert.ok(first !== null && Math.abs(first - 70.53) < 0.4, `got ${first}`);
});

test("Wilder RSI last value matches the published downtrend (37.77)", () => {
  const last = rsi(CLOSES, 14);
  assert.ok(last !== null && Math.abs(last - 37.77) < 2, `got ${last}`);
});

function trendCandles(): Candle[] {
  const out: Candle[] = [];
  let p = 100;
  for (let i = 0; i < 60; i++) { const o = p; p += 1; out.push(mk(o, p + 0.5, o - 0.3, p)); }
  return out;
}

test("ATR is positive and sane on a steady uptrend", () => {
  const a = atr(trendCandles(), 14);
  assert.ok(a !== null && a > 0 && a < 5, `atr=${a}`);
});

test("ADX reads a strong trend (>40) on a clean uptrend", () => {
  const d = adx(trendCandles(), 14);
  assert.ok(d !== null && d > 40, `adx=${d}`);
});

test("SuperTrend is bullish on an uptrend with the line below price", () => {
  const t = trendCandles();
  const st = superTrend(t, 10, 3);
  assert.equal(st?.direction, "bullish");
  assert.ok(st !== null && st.value < t[t.length - 1].close);
});

test("SuperTrend is bearish on a downtrend with the line above price", () => {
  const out: Candle[] = [];
  let q = 200;
  for (let i = 0; i < 60; i++) { const o = q; q -= 1; out.push(mk(o, o + 0.3, q - 0.5, q)); }
  const st = superTrend(out, 10, 3);
  assert.equal(st?.direction, "bearish");
  assert.ok(st !== null && st.value > out[out.length - 1].close);
});

test("SuperTrend flips to bearish after a real reversal (persistence bug fixed)", () => {
  const rev = trendCandles();
  let r = rev[rev.length - 1].close;
  for (let i = 0; i < 20; i++) { const o = r; r -= 4; rev.push(mk(o, o + 0.3, r - 1, r)); }
  assert.equal(superTrend(rev, 10, 3)?.direction, "bearish");
});
