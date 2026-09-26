// Classic chart-pattern detection, moved out of worker.ts so it can be tested.
//
// The detectors are unchanged in what they look for. What changed is how a
// match is ACCEPTED, because three faults meant a match could be reported that
// no trader looking at the chart would act on:
//
// 1. NO RECENCY CHECK. Each detector reads "the last two or three swings", and
//    nothing asked how long ago those were. On a 270-day daily series a double
//    top from May was reported in September as if it had just formed.
//    A match now needs its final swing within RECENT_SWING_BARS bars.
//
// 2. NO "ALREADY HAPPENED" CHECK. A double top whose neckline broke three
//    weeks ago, and which already reached its measured target, was still shown
//    with "entry at the neckline" -- inviting an entry into a move that was
//    over. A match is now rejected if, since it formed, price has CLOSED
//    beyond the entry (it already broke), touched the target (it already
//    paid), or touched the stop (it already failed).
//
// 3. FIRST MATCH WINS. Detectors ran in a fixed order and the first hit was
//    returned, so Head and Shoulders shadowed a fresher, cleaner pattern
//    further down the list purely by position. Every detector now runs, the
//    survivors are ranked, and the best is returned with the rest attached as
//    alternatives.
//
// Ranking deliberately does NOT use PATTERN_RELIABILITY: those are textbook
// figures for other markets, not measured on these contracts, and letting them
// decide which pattern to show would amplify a number nobody has verified here.

export type PatternDirection = "bullish" | "bearish" | "neutral";

export interface PatternCandle {
  date: string;
  open?: number;
  high: number;
  low: number;
  close: number;
}

export interface PatternResult {
  pattern: string;
  direction: PatternDirection;
  entry: number | string;
  stop: number | string;
  target: number | string;
  note: string;
  reliability?: number | null;
  /** Bars since the pattern's final swing. Absent on "No Clear Pattern". */
  barsSinceFormed?: number;
  /** Other patterns that also qualified, best first. */
  alternatives?: PatternResult[];
}

// Approximate historical success rates commonly cited in technical-analysis
// literature (e.g. Bulkowski-style pattern studies). Educational reference
// figures only -- NOT a backtest of this instrument, NOT a guarantee.
export const PATTERN_RELIABILITY: Record<string, number> = {
  "Double Top": 65,
  "Double Bottom": 66,
  "Head and Shoulders": 83,
  "Inverse Head and Shoulders": 84,
  "Ascending Triangle": 72,
  "Descending Triangle": 71,
  "Symmetrical Triangle": 60,
  "Rising Wedge": 62,
  "Falling Wedge": 68,
  "Bullish Flag / Pennant": 68,
  "Bearish Flag / Pennant": 67,
  "Bullish Rectangle": 60,
  "Bearish Rectangle": 60,
};

/**
 * How recent a pattern's final swing must be to count as current.
 *
 * Swings need two bars on each side to confirm (findSwings look = 2), so the
 * newest possible swing is already 2 bars old. Ten bars leaves room for price
 * to drift toward the trigger after the pattern completes, without letting a
 * setup from weeks ago through.
 */
export const RECENT_SWING_BARS = 10;

function pct(a: number, b: number) {
  return Math.abs(a - b) / ((a + b) / 2);
}
function r2(x: number) {
  return Math.round(x * 100) / 100;
}

export interface Swing {
  i: number;
  price: number;
  date: string;
}

export function findSwings(candles: PatternCandle[], look = 2) {
  const highs: Swing[] = [];
  const lows: Swing[] = [];
  for (let i = look; i < candles.length - look; i++) {
    let isH = true;
    let isL = true;
    for (let j = i - look; j <= i + look; j++) {
      if (j === i) continue;
      if (candles[j].high >= candles[i].high) isH = false;
      if (candles[j].low <= candles[i].low) isL = false;
    }
    if (isH) highs.push({ i, price: candles[i].high, date: candles[i].date });
    if (isL) lows.push({ i, price: candles[i].low, date: candles[i].date });
  }
  return { highs, lows };
}

/**
 * A match plus the numbers needed to judge it. `formedAt` is the index of the
 * last bar the pattern is built from; `levels` are the numeric trigger, stop
 * and target (for a neutral pattern, the two breakout levels).
 */
interface Match {
  result: PatternResult;
  formedAt: number;
  levels:
    | { kind: "directional"; entry: number; stop: number; target: number }
    | { kind: "neutral"; upper: number; lower: number };
}

function directional(result: PatternResult, formedAt: number, entry: number, stop: number, target: number): Match {
  return { result, formedAt, levels: { kind: "directional", entry, stop, target } };
}

function detectDoubleTop(highs: Swing[], lows: Swing[]): Match | null {
  if (highs.length < 2) return null;
  const h1 = highs[highs.length - 2];
  const h2 = highs[highs.length - 1];
  if (pct(h1.price, h2.price) > 0.025) return null;
  const between = lows.filter((l) => l.i > h1.i && l.i < h2.i);
  if (!between.length) return null;
  const neckline = Math.min(...between.map((l) => l.price));
  const height = (h1.price + h2.price) / 2 - neckline;
  if (height <= 0) return null;
  const entry = r2(neckline * 0.998);
  const stop = r2(Math.max(h1.price, h2.price) * 1.01);
  const target = r2(neckline - height);
  return directional(
    { pattern: "Double Top", direction: "bearish", entry, stop, target, note: `Twin peaks near ${r2(h1.price)} & ${r2(h2.price)}, neckline support around ${r2(neckline)}.` },
    h2.i, entry, stop, target
  );
}

function detectDoubleBottom(highs: Swing[], lows: Swing[]): Match | null {
  if (lows.length < 2) return null;
  const l1 = lows[lows.length - 2];
  const l2 = lows[lows.length - 1];
  if (pct(l1.price, l2.price) > 0.025) return null;
  const between = highs.filter((h) => h.i > l1.i && h.i < l2.i);
  if (!between.length) return null;
  const neckline = Math.max(...between.map((h) => h.price));
  const height = neckline - (l1.price + l2.price) / 2;
  if (height <= 0) return null;
  const entry = r2(neckline * 1.002);
  const stop = r2(Math.min(l1.price, l2.price) * 0.99);
  const target = r2(neckline + height);
  return directional(
    { pattern: "Double Bottom", direction: "bullish", entry, stop, target, note: `Twin troughs near ${r2(l1.price)} & ${r2(l2.price)}, neckline resistance around ${r2(neckline)}.` },
    l2.i, entry, stop, target
  );
}

function detectHeadShoulders(highs: Swing[], lows: Swing[]): Match | null {
  if (highs.length < 3) return null;
  const [L, H, R] = highs.slice(-3);
  if (!(H.price > L.price * 1.008 && H.price > R.price * 1.008)) return null;
  if (pct(L.price, R.price) > 0.035) return null;
  const leftT = lows.filter((l) => l.i > L.i && l.i < H.i);
  const rightT = lows.filter((l) => l.i > H.i && l.i < R.i);
  if (!leftT.length || !rightT.length) return null;
  const neckline = (leftT[leftT.length - 1].price + rightT[0].price) / 2;
  const height = H.price - neckline;
  if (height <= 0) return null;
  const entry = r2(neckline * 0.997);
  const stop = r2(R.price * 1.012);
  const target = r2(neckline - height);
  return directional(
    { pattern: "Head and Shoulders", direction: "bearish", entry, stop, target, note: `Left shoulder ${r2(L.price)}, head ${r2(H.price)}, right shoulder ${r2(R.price)}, neckline ${r2(neckline)}.` },
    R.i, entry, stop, target
  );
}

function detectInverseHeadShoulders(highs: Swing[], lows: Swing[]): Match | null {
  if (lows.length < 3) return null;
  const [L, H, R] = lows.slice(-3);
  if (!(H.price < L.price * 0.992 && H.price < R.price * 0.992)) return null;
  if (pct(L.price, R.price) > 0.035) return null;
  const leftP = highs.filter((h) => h.i > L.i && h.i < H.i);
  const rightP = highs.filter((h) => h.i > H.i && h.i < R.i);
  if (!leftP.length || !rightP.length) return null;
  const neckline = (leftP[leftP.length - 1].price + rightP[0].price) / 2;
  const height = neckline - H.price;
  if (height <= 0) return null;
  const entry = r2(neckline * 1.003);
  const stop = r2(R.price * 0.988);
  const target = r2(neckline + height);
  return directional(
    { pattern: "Inverse Head and Shoulders", direction: "bullish", entry, stop, target, note: `Left shoulder ${r2(L.price)}, head ${r2(H.price)}, right shoulder ${r2(R.price)}, neckline ${r2(neckline)}.` },
    R.i, entry, stop, target
  );
}

function detectAscendingTriangle(highs: Swing[], lows: Swing[]): Match | null {
  if (highs.length < 3 || lows.length < 3) return null;
  const h = highs.slice(-3);
  const l = lows.slice(-3);
  const flatRes = pct(h[0].price, h[1].price) < 0.015 && pct(h[1].price, h[2].price) < 0.015;
  const risingLows = l[0].price < l[1].price * 0.999 && l[1].price < l[2].price * 0.999;
  if (!flatRes || !risingLows) return null;
  const resistance = (h[0].price + h[1].price + h[2].price) / 3;
  const height = resistance - l[0].price;
  if (height <= 0) return null;
  const entry = r2(resistance * 1.003);
  const stop = r2(l[2].price * 0.99);
  const target = r2(resistance + height);
  return directional(
    { pattern: "Ascending Triangle", direction: "bullish", entry, stop, target, note: `Flat resistance near ${r2(resistance)} with rising swing lows — bullish breakout setup.` },
    Math.max(h[2].i, l[2].i), entry, stop, target
  );
}

function detectDescendingTriangle(highs: Swing[], lows: Swing[]): Match | null {
  if (highs.length < 3 || lows.length < 3) return null;
  const h = highs.slice(-3);
  const l = lows.slice(-3);
  const flatSup = pct(l[0].price, l[1].price) < 0.015 && pct(l[1].price, l[2].price) < 0.015;
  const fallingHighs = h[0].price > h[1].price * 1.001 && h[1].price > h[2].price * 1.001;
  if (!flatSup || !fallingHighs) return null;
  const support = (l[0].price + l[1].price + l[2].price) / 3;
  const height = h[0].price - support;
  if (height <= 0) return null;
  const entry = r2(support * 0.997);
  const stop = r2(h[2].price * 1.01);
  const target = r2(support - height);
  return directional(
    { pattern: "Descending Triangle", direction: "bearish", entry, stop, target, note: `Flat support near ${r2(support)} with falling swing highs — bearish breakdown setup.` },
    Math.max(h[2].i, l[2].i), entry, stop, target
  );
}

function detectRisingWedge(highs: Swing[], lows: Swing[]): Match | null {
  if (highs.length < 3 || lows.length < 3) return null;
  const h = highs.slice(-3);
  const l = lows.slice(-3);
  if (!(h[0].price < h[1].price && h[1].price < h[2].price)) return null;
  if (!(l[0].price < l[1].price && l[1].price < l[2].price)) return null;
  const widthStart = h[0].price - l[0].price;
  const widthEnd = h[2].price - l[2].price;
  if (!(widthEnd < widthStart * 0.75)) return null;
  const entry = r2(l[2].price * 0.995);
  const stop = r2(h[2].price * 1.01);
  const target = r2(l[2].price - widthStart);
  return directional(
    { pattern: "Rising Wedge", direction: "bearish", entry, stop, target, note: `Converging rising channel (width shrank from ${r2(widthStart)} to ${r2(widthEnd)}) — bearish reversal risk.` },
    Math.max(h[2].i, l[2].i), entry, stop, target
  );
}

function detectFallingWedge(highs: Swing[], lows: Swing[]): Match | null {
  if (highs.length < 3 || lows.length < 3) return null;
  const h = highs.slice(-3);
  const l = lows.slice(-3);
  if (!(h[0].price > h[1].price && h[1].price > h[2].price)) return null;
  if (!(l[0].price > l[1].price && l[1].price > l[2].price)) return null;
  const widthStart = h[0].price - l[0].price;
  const widthEnd = h[2].price - l[2].price;
  if (!(widthEnd < widthStart * 0.75)) return null;
  const entry = r2(h[2].price * 1.005);
  const stop = r2(l[2].price * 0.99);
  const target = r2(h[2].price + widthStart);
  return directional(
    { pattern: "Falling Wedge", direction: "bullish", entry, stop, target, note: `Converging falling channel (width shrank from ${r2(widthStart)} to ${r2(widthEnd)}) — bullish reversal setup.` },
    Math.max(h[2].i, l[2].i), entry, stop, target
  );
}

function detectFlagPennant(candles: PatternCandle[]): Match | null {
  const n = candles.length;
  if (n < 25) return null;
  const poleStart = candles[n - 20];
  const poleEnd = candles[n - 8];
  const poleMove = poleEnd.close - poleStart.close;
  const poleRange = Math.abs(poleMove);
  if (poleRange / poleStart.close < 0.03) return null;
  const recent = candles.slice(n - 7);
  const recentHigh = Math.max(...recent.map((c) => c.high));
  const recentLow = Math.min(...recent.map((c) => c.low));
  if (recentHigh - recentLow > poleRange * 0.5) return null;
  // The consolidation IS the last seven bars, so a flag is current by
  // construction; it forms at the start of that window.
  const formedAt = n - 7;
  if (poleMove > 0) {
    const entry = r2(recentHigh * 1.003);
    const stop = r2(recentLow * 0.99);
    const target = r2(recentHigh + poleRange);
    return directional(
      { pattern: "Bullish Flag / Pennant", direction: "bullish", entry, stop, target, note: `Sharp rally of ~${r2(poleRange)} then tight consolidation between ${r2(recentLow)}-${r2(recentHigh)} — continuation setup.` },
      formedAt, entry, stop, target
    );
  }
  const entry = r2(recentLow * 0.997);
  const stop = r2(recentHigh * 1.01);
  const target = r2(recentLow - poleRange);
  return directional(
    { pattern: "Bearish Flag / Pennant", direction: "bearish", entry, stop, target, note: `Sharp decline of ~${r2(poleRange)} then tight consolidation between ${r2(recentLow)}-${r2(recentHigh)} — continuation setup.` },
    formedAt, entry, stop, target
  );
}

function detectRectangle(highs: Swing[], lows: Swing[], candles: PatternCandle[]): Match | null {
  if (highs.length < 2 || lows.length < 2) return null;
  const h = highs.slice(-3);
  const l = lows.slice(-3);
  if (h.length < 2 || l.length < 2) return null;
  const flatRes = h.every((x, idx) => idx === 0 || pct(x.price, h[0].price) < 0.015);
  const flatSup = l.every((x, idx) => idx === 0 || pct(x.price, l[0].price) < 0.015);
  if (!flatRes || !flatSup) return null;
  const resistance = h.reduce((s, x) => s + x.price, 0) / h.length;
  const support = l.reduce((s, x) => s + x.price, 0) / l.length;
  const height = resistance - support;
  if (height <= 0 || height / support > 0.15) return null;
  const startIdx = Math.min(h[0].i, l[0].i);
  const formedAt = Math.max(h[h.length - 1].i, l[l.length - 1].i);
  const prior = candles.slice(Math.max(0, startIdx - 15), startIdx);
  const priorUp = prior.length > 2 ? prior[prior.length - 1].close > prior[0].close : true;
  if (priorUp) {
    const entry = r2(resistance * 1.003);
    const stop = r2(support * 0.99);
    const target = r2(resistance + height);
    return directional(
      { pattern: "Bullish Rectangle", direction: "bullish", entry, stop, target, note: `Range-bound between ${r2(support)} and ${r2(resistance)} after an uptrend — continuation setup on an upside break.` },
      formedAt, entry, stop, target
    );
  }
  const entry = r2(support * 0.997);
  const stop = r2(resistance * 1.01);
  const target = r2(support - height);
  return directional(
    { pattern: "Bearish Rectangle", direction: "bearish", entry, stop, target, note: `Range-bound between ${r2(support)} and ${r2(resistance)} after a downtrend — continuation setup on a downside break.` },
    formedAt, entry, stop, target
  );
}

function detectSymmetricalTriangle(highs: Swing[], lows: Swing[]): Match | null {
  if (highs.length < 3 || lows.length < 3) return null;
  const h = highs.slice(-3);
  const l = lows.slice(-3);
  if (!(h[0].price > h[1].price && h[1].price > h[2].price)) return null;
  if (!(l[0].price < l[1].price && l[1].price < l[2].price)) return null;
  const height = h[0].price - l[0].price;
  const upper = r2(h[2].price * 1.003);
  const lower = r2(l[2].price * 0.997);
  return {
    result: {
      pattern: "Symmetrical Triangle",
      direction: "neutral",
      entry: `${upper} (bullish break) / ${lower} (bearish break)`,
      stop: "Opposite side of whichever breakout triggers",
      target: `± ${r2(height)} projected from the breakout price`,
      note: `Converging highs & lows — wait for confirmation above ${r2(h[2].price)} or below ${r2(l[2].price)}.`,
    },
    formedAt: Math.max(h[2].i, l[2].i),
    levels: { kind: "neutral", upper, lower },
  };
}

export type RejectReason = "stale" | "already_broke" | "target_hit" | "stop_hit";

/**
 * Is a match still an actionable setup? Judged only on bars AFTER it formed.
 *
 * "Already broke" uses CLOSES: price pokes through a neckline intraday all the
 * time, and a wick is not a breakout. Target and stop use highs and lows,
 * because touching either is enough to end the premise of the trade.
 */
export function judgeMatch(m: Match, candles: PatternCandle[]): RejectReason | null {
  const barsSince = candles.length - 1 - m.formedAt;
  if (barsSince > RECENT_SWING_BARS) return "stale";
  const after = candles.slice(m.formedAt + 1);
  if (m.levels.kind === "neutral") {
    const { upper, lower } = m.levels;
    if (after.some((c) => c.close > upper || c.close < lower)) return "already_broke";
    return null;
  }
  const { entry, stop, target } = m.levels;
  const bearish = m.result.direction === "bearish";
  if (bearish) {
    if (after.some((c) => c.low <= target)) return "target_hit";
    if (after.some((c) => c.high >= stop)) return "stop_hit";
    if (after.some((c) => c.close < entry)) return "already_broke";
  } else {
    if (after.some((c) => c.high >= target)) return "target_hit";
    if (after.some((c) => c.low <= stop)) return "stop_hit";
    if (after.some((c) => c.close > entry)) return "already_broke";
  }
  return null;
}

/** Distance from the last close to the trigger, as a fraction of price. */
function distanceToTrigger(m: Match, lastClose: number): number {
  if (!(lastClose > 0)) return Number.POSITIVE_INFINITY;
  if (m.levels.kind === "neutral") {
    return Math.min(Math.abs(m.levels.upper - lastClose), Math.abs(lastClose - m.levels.lower)) / lastClose;
  }
  return Math.abs(m.levels.entry - lastClose) / lastClose;
}

const REJECT_WORDS: Record<RejectReason, string> = {
  stale: "formed too long ago to be current",
  already_broke: "already broke out, so its entry is behind price",
  target_hit: "already reached its target",
  stop_hit: "already failed through its stop",
};

export function analyzeCommodity(candles: PatternCandle[]): PatternResult {
  const { highs, lows } = findSwings(candles, 2);
  const detectors = [
    () => detectHeadShoulders(highs, lows),
    () => detectInverseHeadShoulders(highs, lows),
    () => detectDoubleTop(highs, lows),
    () => detectDoubleBottom(highs, lows),
    () => detectAscendingTriangle(highs, lows),
    () => detectDescendingTriangle(highs, lows),
    () => detectRisingWedge(highs, lows),
    () => detectFallingWedge(highs, lows),
    () => detectFlagPennant(candles),
    () => detectRectangle(highs, lows, candles),
    () => detectSymmetricalTriangle(highs, lows),
  ];

  const live: Match[] = [];
  const rejected: { name: string; reason: RejectReason }[] = [];
  for (const d of detectors) {
    const m = d();
    if (!m) continue;
    const reason = judgeMatch(m, candles);
    if (reason) rejected.push({ name: m.result.pattern, reason });
    else live.push(m);
  }

  const lastClose = candles.length ? candles[candles.length - 1].close : 0;
  // Freshest first; among equally fresh, the one whose trigger is nearest
  // current price is the most actionable.
  live.sort((a, b) => b.formedAt - a.formedAt || distanceToTrigger(a, lastClose) - distanceToTrigger(b, lastClose));

  const finish = (m: Match): PatternResult => ({
    ...m.result,
    reliability: PATTERN_RELIABILITY[m.result.pattern] ?? null,
    barsSinceFormed: candles.length - 1 - m.formedAt,
  });

  if (live.length) {
    const [best, ...rest] = live;
    const out = finish(best);
    if (rest.length) out.alternatives = rest.map(finish);
    return out;
  }

  const why = rejected.length
    ? ` ${rejected.map((r) => `A ${r.name} matched but ${REJECT_WORDS[r.reason]}`).join("; ")}.`
    : "";
  return {
    pattern: "No Clear Pattern",
    direction: "neutral",
    entry: "-",
    stop: "-",
    target: "-",
    reliability: null,
    note: `Price action doesn't currently match a live, well-defined chart pattern. Best to wait for clearer structure.${why}`,
  };
}
