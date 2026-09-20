import { test } from "node:test";
import assert from "node:assert/strict";
import { sma, roc, williamsR, stochastic, mfi, keltnerChannels, donchianChannels } from "../utils/indicators";
import { buildTechnicalTable } from "../utils/technicalTable";
import type { Candle } from "../types";

function bar(close: number, high?: number, low?: number, volume?: number): Candle {
  return {
    date: new Date().toISOString(),
    open: close,
    high: high ?? close + 1,
    low: low ?? close - 1,
    close,
    volume,
  };
}

function series(closes: number[], volume?: number): Candle[] {
  return closes.map((c) => bar(c, c + 1, c - 1, volume));
}

function rising(n = 60, start = 100, step = 1): Candle[] {
  return series(Array.from({ length: n }, (_, i) => start + i * step), 1000);
}

function falling(n = 60, start = 160, step = 1): Candle[] {
  return series(Array.from({ length: n }, (_, i) => start - i * step), 1000);
}

/**
 * A net trend that still breathes -- two bars with it, one against.
 *
 * A perfectly straight line is not a useful fixture for the table: it pins RSI
 * at 100, Stochastic above 90 and Williams %R near zero, which the conventional
 * bands correctly read as OVERBOUGHT (i.e. bearish) rather than bullish. Real
 * trends retrace, and that is what the table is read against.
 */
function trending(n: number, start: number, step: number): Candle[] {
  const out: Candle[] = [];
  let p = start;
  for (let i = 0; i < n; i++) {
    p += i % 3 === 2 ? -step * 1.4 : step;
    out.push({ date: new Date().toISOString(), open: p, high: p + 1.2, low: p - 1.2, close: p, volume: 1000 });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Indicator maths, against values that can be checked by hand.
// ---------------------------------------------------------------------------

test("sma averages the last n values", () => {
  assert.equal(sma([1, 2, 3, 4, 5], 5), 3);
  assert.equal(sma([10, 20, 30], 2), 25);
  assert.equal(sma([1, 2], 5), null, "not enough data must be null, not a partial average");
});

test("roc is the percentage move against n bars ago", () => {
  // 110 vs 100 twenty bars earlier = +10%.
  const closes = [100, ...Array.from({ length: 19 }, () => 105), 110];
  const r = roc(closes, 20);
  assert.ok(r !== null);
  assert.ok(Math.abs(r! - 10) < 1e-9, `expected +10%, got ${r}`);
  assert.equal(roc([1, 2, 3], 20), null);
});

test("williamsR is 0 at the high of the range and -100 at the low", () => {
  const atHigh = series([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]).map((c, i, a) =>
    i === a.length - 1 ? { ...c, close: c.high } : c
  );
  const w = williamsR(atHigh, 14);
  assert.ok(w !== null && Math.abs(w!) < 1e-9, `closing at the high should be ~0, got ${w}`);

  const atLow = series([14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]).map((c, i, a) =>
    i === a.length - 1 ? { ...c, close: c.low } : c
  );
  const w2 = williamsR(atLow, 14);
  assert.ok(w2 !== null && Math.abs(w2! + 100) < 1e-9, `closing at the low should be ~-100, got ${w2}`);
});

test("stochastic reads high in an uptrend and low in a downtrend", () => {
  const up = stochastic(rising(), 20, 3);
  const down = stochastic(falling(), 20, 3);
  assert.ok(up && up.k > 80, `uptrend %K should be high, got ${up?.k}`);
  assert.ok(down && down.k < 20, `downtrend %K should be low, got ${down?.k}`);
});

test("stochastic is distinct from stochasticRsi and needs enough bars", () => {
  assert.equal(stochastic(series([1, 2, 3]), 20, 3), null);
});

test("mfi returns null when volume is missing rather than treating it as zero", () => {
  const noVolume = series([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  assert.equal(mfi(noVolume, 14), null, "a real-looking number built from absent volume would be worse than null");
});

test("mfi is high on relentless buying and low on relentless selling", () => {
  const up = mfi(rising(), 14);
  const down = mfi(falling(), 14);
  assert.ok(up !== null && up > 80, `all-up flow should be high, got ${up}`);
  assert.ok(down !== null && down < 20, `all-down flow should be low, got ${down}`);
});

test("keltner bands sit either side of the middle and widen with volatility", () => {
  const calm = keltnerChannels(series(Array.from({ length: 40 }, (_, i) => 100 + (i % 2 ? 0.1 : -0.1))), 20, 2);
  assert.ok(calm);
  assert.ok(calm!.upper > calm!.middle && calm!.middle > calm!.lower);

  const wild = keltnerChannels(
    Array.from({ length: 40 }, (_, i) => bar(100 + (i % 2 ? 5 : -5), 120, 80)),
    20,
    2
  );
  assert.ok(wild);
  assert.ok(wild!.upper - wild!.lower > calm!.upper - calm!.lower, "a wider-ranging market must produce wider bands");
});

test("donchian reports the range and where price sits in it", () => {
  const d = donchianChannels(rising(30, 100, 1), 20);
  assert.ok(d);
  assert.ok(d!.position > 90, `a fresh high should sit near the top of its range, got ${d!.position}`);
  assert.ok(d!.upper > d!.lower);

  const d2 = donchianChannels(falling(30, 160, 1), 20);
  assert.ok(d2 && d2.position < 10, `a fresh low should sit near the bottom, got ${d2?.position}`);
});

// ---------------------------------------------------------------------------
// The table.
// ---------------------------------------------------------------------------

test("a real uptrend reads bullish across the groups", () => {
  const t = buildTechnicalTable(trending(250, 100, 1));
  assert.ok(t.familiesBullish > t.familiesBearish, `expected bullish groups to lead, got ${t.familiesBullish}/${t.familiesBearish}`);
  // The slow averages are the ones that must agree; the 5-period one flips on
  // every retracement bar and is not evidence of a trend either way.
  assert.equal(t.movingAverages.find((m) => m.period === 200)?.indication, "bullish");
  assert.equal(t.crossovers.find((c) => c.term === "Long term")?.indication, "bullish");
});

test("a real downtrend reads bearish across the groups", () => {
  const t = buildTechnicalTable(trending(250, 400, -1));
  assert.ok(t.familiesBearish > t.familiesBullish, `expected bearish groups to lead, got ${t.familiesBullish}/${t.familiesBearish}`);
  assert.equal(t.movingAverages.find((m) => m.period === 200)?.indication, "bearish");
});

// The conventional bands treat a pinned oscillator as overbought, and that is
// the correct reading -- a market that has gone straight up for 250 bars is
// stretched, not freshly bullish. Locked in so nobody "fixes" it later.
test("a vertical move reads overbought on the momentum oscillators", () => {
  const t = buildTechnicalTable(rising(250, 100, 0.5));
  assert.equal(t.indicators.find((r) => r.key === "rsi")?.indication, "bearish");
  assert.match(t.indicators.find((r) => r.key === "rsi")!.note, /overbought/i);
});

test("ADX and ATR are reported as info, never as a direction", () => {
  const t = buildTechnicalTable(trending(250, 100, 1));
  const adxRow = t.indicators.find((r) => r.key === "adx");
  const atrRow = t.indicators.find((r) => r.key === "atr");
  assert.equal(adxRow?.indication, "info", "ADX measures strength, not direction");
  assert.equal(atrRow?.indication, "info", "ATR measures volatility, not direction");
});

test("missing volume shows MFI as unavailable rather than inventing a reading", () => {
  const t = buildTechnicalTable(series(Array.from({ length: 60 }, (_, i) => 100 + i)));
  const mfiRow = t.indicators.find((r) => r.key === "mfi");
  assert.equal(mfiRow?.indication, "unavailable");
  assert.equal(mfiRow?.value, null);
  assert.match(mfiRow!.note, /volume data isn't available/i);
});

test("too little data yields unavailable rows, never fabricated numbers", () => {
  const t = buildTechnicalTable(series([100, 101, 102]));
  assert.ok(t.unavailableCount > 0);
  assert.equal(t.movingAverages.find((m) => m.period === 200)?.sma, null);
  assert.equal(t.familiesCounted === 0 || t.summaryLabel.length > 0, true);
});

test("an empty candle list does not throw", () => {
  const t = buildTechnicalTable([]);
  assert.equal(t.price, null);
  assert.equal(t.summaryLabel, "Not enough data");
});

// The whole reason the summary leads with groups rather than a raw count.
test("the summary warns that the raw count overstates the case", () => {
  const t = buildTechnicalTable(trending(250, 100, 1));
  assert.match(t.summaryNote, /overstates/i);
  assert.match(t.summaryLabel, /groups/i);
  assert.ok(t.familiesCounted <= 5, "there are five families, so this can never exceed five");
});

test("group count is smaller than the raw bullish count in a clean trend", () => {
  const t = buildTechnicalTable(trending(250, 100, 1));
  assert.ok(
    t.familiesBullish < t.bullishCount,
    "counting correlated indicators separately is exactly the inflation this guards against"
  );
});
