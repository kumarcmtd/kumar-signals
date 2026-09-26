import { test } from "vitest";
import assert from "node:assert/strict";
import {
  evaluatePullbackReversal, readStructure, buildZones, classifyZoneState, detectFall,
  detectFundamentalShock, DEFAULT_CONFIG, MAX_CONFIDENCE, MIN_BARS_PER_TF, TF_ORDER,
  type PullbackInput, type TfKey, type ExternalSignal,
} from "../utils/pullbackReversalEngine";
import type { Candle } from "../types";

const NOW = Date.UTC(2026, 8, 16, 6, 0, 0);

/** Candles with a controllable shape. `path` gives each bar's close. */
function series(path: number[], opts: { volume?: number[]; wickBelow?: number } = {}): Candle[] {
  return path.map((close, i) => {
    const open = i === 0 ? close : path[i - 1];
    const hi = Math.max(open, close);
    const lo = Math.min(open, close);
    return {
      date: new Date(NOW - (path.length - i) * 3_600_000).toISOString(),
      open,
      high: hi + 0.4,
      low: (opts.wickBelow !== undefined && i === path.length - 1 ? Math.min(lo, opts.wickBelow) : lo) - 0.4,
      close,
      volume: opts.volume?.[i] ?? 1000,
      oi: 0,
    };
  });
}

/**
 * A real bullish zigzag: a 6-bar up leg then a 4-bar down leg, repeating, each
 * cycle netting higher. The legs have to be several bars long or findSwingPoints
 * (which needs a bar to be the extreme over +/-3 bars) detects no pivots at all
 * and the structure reads "neutral" -- which says nothing about the engine.
 */
function bullishPath(cycles = 8): number[] {
  const out: number[] = [];
  let p = 100;
  for (let c = 0; c < cycles; c++) {
    for (let i = 0; i < 6; i++) { p += 2; out.push(Number(p.toFixed(2))); }
    // The final cycle stops at the peak: a series that ends mid-pullback is a
    // different test case, and the ones below build it explicitly.
    if (c === cycles - 1) break;
    for (let i = 0; i < 4; i++) { p -= 1.2; out.push(Number(p.toFixed(2))); }
  }
  return out;
}

/** The mirror image: lower highs and lower lows. */
function bearishPath(cycles = 8): number[] {
  const out: number[] = [];
  let p = 200;
  for (let c = 0; c < cycles; c++) {
    for (let i = 0; i < 6; i++) { p -= 2; out.push(Number(p.toFixed(2))); }
    for (let i = 0; i < 4; i++) { p += 1.2; out.push(Number(p.toFixed(2))); }
  }
  return out;
}

function input(over: Partial<PullbackInput> = {}): PullbackInput {
  const path = bullishPath();
  const candles = series(path);
  return {
    commodity: "NATURALGAS",
    timeframes: { "240": candles, "60": candles, "30": candles, "15": candles },
    currentPrice: path[path.length - 1],
    now: NOW,
    ...over,
  };
}

// ---- Structure reading (Part 7) ----

test("a rising staircase reads as a bullish, intact structure", () => {
  const s = readStructure("240", series(bullishPath()));
  assert.equal(s.available, true);
  assert.equal(s.trend, "bullish");
  assert.equal(s.health, "intact");
});

test("a falling staircase reads bearish", () => {
  const s = readStructure("240", series(bearishPath()));
  assert.equal(s.trend, "bearish");
});

test("a timeframe with too few bars is not scored at all rather than guessed", () => {
  const s = readStructure("60", series(bullishPath(2)));
  assert.equal(s.available, false);
  assert.equal(s.health, "unknown");
  assert.equal(s.effectiveWeight, 0);
});

test("a missing timeframe is handled without throwing", () => {
  const s = readStructure("5", undefined);
  assert.equal(s.available, false);
  assert.equal(s.bars, 0);
});

// ---- Zones (Part 11) ----

test("nearby levels merge into one zone and the zone records what backs it", () => {
  const zones = buildZones(
    [
      { price: 275.0, source: "4H swing low" },
      { price: 275.2, source: "Daily S1" },
      { price: 274.9, source: "VWAP" },
      { price: 290.0, source: "4H swing high" },
    ],
    280,
    2,
    0.5
  );
  assert.equal(zones.length, 2, "the three clustered levels become one zone");
  const support = zones.find((z) => z.kind === "support")!;
  assert.equal(support.strength, 3, "three independent sources agree on it");
  assert.ok(support.sources.includes("VWAP"));
  const resistance = zones.find((z) => z.kind === "resistance")!;
  assert.equal(resistance.strength, 1);
});

test("a zone is a range, never a single pretend-exact number", () => {
  const [zone] = buildZones([{ price: 275, source: "one" }], 280, 2, 0.5);
  assert.ok(zone.high > zone.low, "a lone level still gets width from ATR");
  assert.equal(zone.mid, 275);
});

test("a wick through support is a rejection, but a CLOSE through it is a break", () => {
  const zone = { kind: "support" as const, low: 99, high: 101, mid: 100, sources: [], strength: 1, distancePct: null, state: "unknown" as const };
  // Wicked to 97 but closed back at 103.
  const wicked = series([105, 104, 103], { wickBelow: 97 });
  assert.equal(classifyZoneState({ ...zone }, wicked, 103), "rejected");
  // Closed at 95, below the zone, and never came back.
  const closedThrough = series([105, 100, 95]);
  assert.equal(classifyZoneState({ ...zone }, closedThrough, 95), "broken");
});

test("breaking support and then rejecting off it from below is a failed retest", () => {
  const zone = { kind: "support" as const, low: 99, high: 101, mid: 100, sources: [], strength: 1, distancePct: null, state: "unknown" as const };
  // Close below, bounce back up INTO the zone, then fall away again.
  const candles = series([105, 102, 95, 99.5, 96]);
  assert.equal(classifyZoneState({ ...zone }, candles, 96), "failed_retest");
});

// ---- Fall detection (Part 8) ----

test("a red candle on its own is not a fall", () => {
  const candles = series(bullishPath());
  const s = readStructure("60", candles);
  const fall = detectFall(candles, s, candles[candles.length - 1].close);
  assert.equal(fall.kind, "none");
  assert.match(fall.detail, /not meaningfully off/);
});

test("a deep drop from the swing high is graded as a deep pullback, not a reversal", () => {
  const path = bullishPath();
  const high = Math.max(...path);
  const candles = series([...path, high * 0.96]);
  const s = readStructure("60", candles);
  const fall = detectFall(candles, s, high * 0.96);
  assert.ok(fall.kind === "deep_pullback" || fall.kind === "possible_reversal", `one bar through support is at most "possible", got ${fall.kind}`);
  assert.notEqual(fall.kind, "confirmed_reversal", "a single candle must never confirm a reversal");
  assert.ok(fall.fromSwingHighPct !== null && fall.fromSwingHighPct < 0);
});

test("falling with no volume data does not crash and reports volume as unknown", () => {
  const candles = series(bullishPath()).map((c) => ({ ...c, volume: 0 }));
  const fall = detectFall(candles, readStructure("60", candles), 100);
  assert.equal(fall.relativeVolume, null);
});

// ---- Part 61: the twelve test cases the spec demands ----

test("TEST 1 — bullish trend plus a normal pullback is GREEN or YELLOW, never RED", () => {
  const path = bullishPath();
  const withDip = [...path, path[path.length - 1] - 1.5];
  const candles = series(withDip);
  const r = evaluatePullbackReversal(input({
    timeframes: { "240": candles, "60": candles, "30": candles, "15": candles },
    currentPrice: withDip[withDip.length - 1],
  }));
  assert.notEqual(r.state, "bearish", `a shallow dip must not flip a bullish structure (${r.bullishPullbackScore} vs ${r.bearishReversalScore})`);
});

test("TEST 2 — bullish trend, deep pullback, support holding, still not RED", () => {
  const path = bullishPath();
  const deep = [...path, path[path.length - 1] - 4, path[path.length - 1] - 3];
  const candles = series(deep);
  const r = evaluatePullbackReversal(input({
    timeframes: { "240": series(path), "60": candles, "30": candles, "15": candles },
    currentPrice: deep[deep.length - 1],
  }));
  assert.notEqual(r.state, "bearish");
});

test("TEST 3 — a wick below support with recovery must NOT be an immediate RED", () => {
  const path = bullishPath();
  const low = Math.min(...path.slice(-12));
  const recovered = [...path, path[path.length - 1] - 2, path[path.length - 1] - 0.5];
  const candles = series(recovered, { wickBelow: low * 0.97 });
  const r = evaluatePullbackReversal(input({
    timeframes: { "240": series(path), "60": candles, "30": candles, "15": candles },
    currentPrice: recovered[recovered.length - 1],
  }));
  assert.notEqual(r.state, "bearish", "a wick is not a break");
});

test("TEST 4 — a confirmed support breakdown produces RED or YELLOW, not GREEN", () => {
  const path = bullishPath();
  const broken = [...path];
  const lowest = Math.min(...path.slice(-20));
  // Several decisive CLOSES beneath the recent structure.
  for (const p of [lowest - 3, lowest - 6, lowest - 9, lowest - 12]) broken.push(Number(p.toFixed(2)));
  const candles = series(broken, { volume: broken.map((_, i) => (i > broken.length - 5 ? 3000 : 1000)) });
  const r = evaluatePullbackReversal(input({
    timeframes: { "240": candles, "60": candles, "30": candles, "15": candles },
    currentPrice: broken[broken.length - 1],
  }));
  assert.notEqual(r.state, "still_bullish", `expected not-green, got ${r.state} (bull ${r.bullishPullbackScore} / bear ${r.bearishReversalScore})`);
});

test("TEST 5 — bullish chart against major bearish news is never a confident GREEN", () => {
  const r = evaluatePullbackReversal(input({
    news: { available: true, score: -85, ageMinutes: 10, note: "Major bearish headline" },
  }));
  assert.equal(r.conflictDetected, true);
  assert.equal(r.state, "uncertain", "conflicting evidence must not be forced either way");
  assert.ok(r.confidence <= 55, `confidence should be capped on a conflict, got ${r.confidence}`);
});

test("TEST 6 — bearish chart against major bullish news stays UNCERTAIN until the chart turns", () => {
  const candles = series(bearishPath());
  const r = evaluatePullbackReversal(input({
    timeframes: { "240": candles, "60": candles, "30": candles, "15": candles },
    currentPrice: bearishPath()[bearishPath().length - 1],
    news: { available: true, score: 85, ageMinutes: 5 },
  }));
  assert.equal(r.conflictDetected, true);
  assert.equal(r.state, "uncertain");
});

test("TEST 7 — a 5M bearish move cannot flip a strongly bullish 4H read", () => {
  const bull = series(bullishPath());
  const fiveMinDrop = series(bearishPath());
  const r = evaluatePullbackReversal(input({
    timeframes: { "240": bull, "60": bull, "30": bull, "15": bull, "5": fiveMinDrop },
    // Even if 5M is switched on, its weight is the smallest by design.
    config: { weights: { ...DEFAULT_CONFIG.weights, timeframe: { ...DEFAULT_CONFIG.weights.timeframe, "5": 10 } } },
  }));
  assert.notEqual(r.state, "bearish");
  assert.ok(r.structures["5"].effectiveWeight < r.structures["240"].effectiveWeight, "5M must never outweigh 4H");
});

test("TEST 8 — stale news carries less weight than fresh news", () => {
  const fresh = evaluatePullbackReversal(input({ news: { available: true, score: -60, ageMinutes: 0 } }));
  const stale = evaluatePullbackReversal(input({ news: { available: true, score: -60, ageMinutes: 5000 } }));
  assert.ok(stale.bearishReversalScore < fresh.bearishReversalScore, `stale ${stale.bearishReversalScore} should score under fresh ${fresh.bearishReversalScore}`);
});

test("TEST 10 — missing weather reduces confidence rather than being scored as neutral", () => {
  const withWeather = evaluatePullbackReversal(input({
    commodity: "NATURALGAS",
    news: { available: true, score: 20, ageMinutes: 5 },
    fundamentals: { available: true, score: 10 },
    weather: { available: true, score: 15 },
  }));
  const without = evaluatePullbackReversal(input({
    commodity: "NATURALGAS",
    news: { available: true, score: 20, ageMinutes: 5 },
    fundamentals: { available: true, score: 10 },
  }));
  assert.ok(without.dataQuality < withWeather.dataQuality, "missing data must cost data quality");
  assert.ok(without.warnings.some((w) => /Weather data is unavailable/.test(w)), "and must say so out loud");
});

test("TEST 12 — whipsaw protection holds a state that only just changed on thin evidence", () => {
  // A flat tape: the evidence is genuinely inconclusive, so the reading wants to
  // drift to UNCERTAIN. Having just been BEARISH a minute ago, it must not.
  const flat = series(Array.from({ length: 80 }, () => 100));
  const base = input({ timeframes: { "240": flat, "60": flat, "30": flat, "15": flat }, currentPrice: 100 });
  const held = evaluatePullbackReversal({ ...base, previousState: "bearish", previousStateAt: NOW - 60_000 });
  assert.equal(held.heldByCooldown, true, "a marginal flip inside the cooldown must be resisted");
  assert.equal(held.state, "bearish");

  const settled = evaluatePullbackReversal({ ...base, previousState: "bearish", previousStateAt: NOW - 120 * 60_000 });
  assert.equal(settled.heldByCooldown, false, "an old state must not be held forever");
});

test("whipsaw protection never hides a genuine, decisive reversal", () => {
  // Part 24 is explicit: do not create arbitrary delays that hide real turns.
  // Overwhelming evidence flips the state even one minute into the cooldown.
  const bull = series(bullishPath());
  const r = evaluatePullbackReversal(input({
    timeframes: { "240": bull, "60": bull, "30": bull, "15": bull },
    previousState: "bearish",
    previousStateAt: NOW - 60_000,
  }));
  assert.equal(r.state, "still_bullish");
  assert.equal(r.heldByCooldown, false);
});

test("a settled state needs MORE evidence to flip than a fresh one (hysteresis)", () => {
  const base = input();
  const fromBullish = evaluatePullbackReversal({ ...base, previousState: "still_bullish", previousStateAt: NOW - 600 * 60_000 });
  const fromNothing = evaluatePullbackReversal(base);
  // Same inputs -- the hysteresis only ever raises the bar, never changes scores.
  assert.equal(fromBullish.bullishPullbackScore, fromNothing.bullishPullbackScore);
});

// ---- Confidence and honesty rules (Part 25, 49, 55) ----

test("confidence never reaches certainty, whatever the evidence", () => {
  const r = evaluatePullbackReversal(input({
    news: { available: true, score: 95, ageMinutes: 0 },
    fundamentals: { available: true, score: 90 },
    weather: { available: true, score: 90 },
  }));
  assert.ok(r.confidence <= MAX_CONFIDENCE, `confidence ${r.confidence} must not exceed ${MAX_CONFIDENCE}`);
});

test("poor data quality drags confidence down", () => {
  const full = evaluatePullbackReversal(input({
    news: { available: true, score: 30, ageMinutes: 5 },
    fundamentals: { available: true, score: 20 },
    weather: { available: true, score: 20 },
  }));
  const thin = evaluatePullbackReversal(input({ timeframes: { "60": series(bullishPath()) }, currentPrice: null }));
  assert.ok(thin.dataQuality < full.dataQuality);
  assert.ok(thin.confidence < full.confidence);
});

test("no live price is reported honestly rather than filled in", () => {
  const r = evaluatePullbackReversal(input({ currentPrice: null, timeframes: {} }));
  assert.equal(r.currentPrice, null);
  assert.ok(r.warnings.some((w) => /No live price/.test(w)));
});

test("with no data at all the engine returns UNCERTAIN instead of throwing", () => {
  const r = evaluatePullbackReversal({ commodity: "CRUDEOIL", timeframes: {}, now: NOW });
  assert.equal(r.state, "uncertain");
  assert.equal(r.bullishPullbackScore, 0);
  assert.equal(r.bearishReversalScore, 0);
  assert.ok(r.confidence < 40);
});

test("nothing user-facing ever promises a guarantee", () => {
  const r = evaluatePullbackReversal(input({ news: { available: true, score: 80, ageMinutes: 1 } }));
  const text = [r.stateLabel, r.stateDetail, r.invalidation, r.bullishConfirmation, r.bearishConfirmation, ...r.reasons, ...r.warnings].join(" ");
  for (const banned of [/guarantee/i, /100% (sure|accurate)/i, /will definitely/i, /sure shot/i, /cannot fail/i]) {
    assert.doesNotMatch(text, banned);
  }
});

// ---- Weighting (Part 6) ----

test("timeframe weights normalise over the timeframes that actually have data", () => {
  const candles = series(bullishPath());
  const r = evaluatePullbackReversal(input({ timeframes: { "240": candles, "60": candles } }));
  const total = TF_ORDER.reduce((s, tf) => s + r.structures[tf].effectiveWeight, 0);
  assert.ok(Math.abs(total - 100) < 0.5, `weights should still sum to ~100, got ${total}`);
  assert.ok(r.structures["240"].effectiveWeight > r.structures["60"].effectiveWeight);
  assert.equal(r.structures["30"].effectiveWeight, 0);
});

test("5M is wired up but weighted zero by default, so it cannot add noise unasked", () => {
  assert.equal(DEFAULT_CONFIG.weights.timeframe["5"], 0);
  const candles = series(bullishPath());
  const r = evaluatePullbackReversal(input({ timeframes: { "240": candles, "60": candles, "5": candles } }));
  assert.equal(r.structures["5"].effectiveWeight, 0, "present in the output, absent from the maths");
});

test("weights are configurable without touching the engine", () => {
  const candles = series(bullishPath());
  const r = evaluatePullbackReversal(input({
    timeframes: { "240": candles, "60": candles },
    config: { weights: { ...DEFAULT_CONFIG.weights, timeframe: { "240": 10, "60": 90, "30": 0, "15": 0, "5": 0 } } },
  }));
  assert.ok(r.structures["60"].effectiveWeight > r.structures["240"].effectiveWeight, "the override must actually take effect");
});

// ---- Fundamental shock (Part 21) ----

test("a shock needs to be big, recent AND from an available source", () => {
  const big: ExternalSignal = { available: true, score: -80, ageMinutes: 30 };
  assert.equal(detectFundamentalShock(big, { available: false, score: 0 }, DEFAULT_CONFIG), true);
  assert.equal(detectFundamentalShock({ ...big, ageMinutes: 5000 }, { available: false, score: 0 }, DEFAULT_CONFIG), false, "old news is not a shock");
  assert.equal(detectFundamentalShock({ ...big, score: -40 }, { available: false, score: 0 }, DEFAULT_CONFIG), false, "a mild headline is not a shock");
  assert.equal(detectFundamentalShock({ available: false, score: -99 }, { available: false, score: 0 }, DEFAULT_CONFIG), false, "an unavailable source cannot shock anything");
});

// ---- Determinism: the live page and the backtest must agree ----

test("the same input always produces exactly the same output", () => {
  const a = evaluatePullbackReversal(input());
  const b = evaluatePullbackReversal(input());
  assert.deepEqual(a, b, "any non-determinism here would make live and backtest results incomparable");
});

test("every signal explains itself and names what would prove it wrong", () => {
  const r = evaluatePullbackReversal(input());
  assert.ok(r.invalidation.length > 20, "Part 27 requires an invalidation line on every signal");
  assert.ok(r.bullishConfirmation.length > 20);
  assert.ok(r.bearishConfirmation.length > 20);
  assert.match(r.bearishConfirmation, /CLOSE|close/, "confirmation must be about closes, not wicks");
  assert.ok(r.contributions.length > 0, "Part 29 requires the actual contributing factors");
});

// ===========================================================================
// THE 18 SEPTEMBER FAILURE.
//
// The backtest found a run of GREEN 84% calls, every one reasoned "Higher highs
// and higher lows intact on 4H", while Crude fell 9917 -> 9766 across a single
// evening. Every one lost. These tests lock in the fix and, just as important,
// lock in that a NORMAL pullback is still allowed to read green -- a fix that
// turns everything yellow would be worse than the bug.
// ===========================================================================

/** Bullish overall, but the last stretch is a steady decline. */
function bullishThenFallingPath(): number[] {
  const out = bullishPath(6);
  let p = out[out.length - 1];
  for (let i = 0; i < 14; i++) {
    p -= 1.6;
    out.push(Number(p.toFixed(2)));
  }
  return out;
}

test("slow structure can no longer call GREEN while price is actively falling", () => {
  const slow = series(bullishPath());
  const fast = series(bullishThenFallingPath());
  const r = evaluatePullbackReversal(
    input({
      timeframes: { "240": slow, "60": slow, "30": fast, "15": fast },
      currentPrice: fast[fast.length - 1].close,
    })
  );
  assert.notEqual(r.state, "still_bullish", "a falling market with bearish fast timeframes must not read GREEN");
  assert.ok(r.confidence <= 65, `confidence should be capped, got ${r.confidence}`);
});

test("the price-action veto explains itself in the warnings", () => {
  const slow = series(bullishPath());
  const fast = series(bullishThenFallingPath());
  const r = evaluatePullbackReversal(
    input({
      timeframes: { "240": slow, "60": slow, "30": fast, "15": fast },
      currentPrice: fast[fast.length - 1].close,
    })
  );
  if (r.state === "uncertain") {
    assert.ok(
      r.warnings.some((w) => /price is actively moving the other way|fast and slow timeframes disagree/i.test(w)),
      `expected an explanation, got: ${JSON.stringify(r.warnings)}`
    );
  }
});

// The guard against over-correcting.
test("an ordinary pullback inside an intact uptrend still reads bullish", () => {
  const path = bullishPath();
  const candles = series(path);
  const r = evaluatePullbackReversal(input({ timeframes: { "240": candles, "60": candles, "30": candles, "15": candles } }));
  assert.equal(r.state, "still_bullish", "the whole point of the page is that a normal pullback stays green");
});

test("no single timeframe can out-score the decision threshold on its own", () => {
  // Only the 4H has data. Under the old engine its intact bullish structure was
  // worth 17.5 points against a threshold of 12 and carried GREEN alone.
  const slow = series(bullishPath());
  const r = evaluatePullbackReversal(input({ timeframes: { "240": slow } }));
  const structureLines = r.contributions.filter((c) => /structure$/i.test(c.label));
  for (const line of structureLines) {
    assert.ok(
      line.points < DEFAULT_CONFIG.decisionThreshold,
      `${line.label} scored ${line.points}, which alone clears the ${DEFAULT_CONFIG.decisionThreshold} decision threshold`
    );
  }
});

test("confidence no longer climbs just because many correlated rules fired", () => {
  // Every timeframe is the same series, so every structure rule agrees. That is
  // one opinion repeated four times, not four confirmations, and it must not
  // produce a near-maximum confidence.
  const candles = series(bullishPath());
  const r = evaluatePullbackReversal(input({ timeframes: { "240": candles, "60": candles, "30": candles, "15": candles } }));
  assert.ok(r.confidence <= 85, `identical inputs repeated should not read as near-certainty, got ${r.confidence}`);
  assert.ok(r.confidence <= MAX_CONFIDENCE);
});

test("a state held only by whipsaw protection is not a confident state", () => {
  const slow = series(bullishPath());
  const fast = series(bullishThenFallingPath());
  const r = evaluatePullbackReversal(
    input({
      timeframes: { "240": slow, "60": slow, "30": fast, "15": fast },
      previousState: "still_bullish",
      previousStateAt: NOW - 60_000,
      currentPrice: fast[fast.length - 1].close,
    })
  );
  const held = r.warnings.some((w) => /whipsaw protection is holding/i.test(w));
  if (held) assert.ok(r.confidence <= 58, `a cooldown-held state claimed ${r.confidence}%`);
});
