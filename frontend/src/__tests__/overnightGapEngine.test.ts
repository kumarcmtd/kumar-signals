import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bucketForGap, buildGapSessions, studyBucket, latestGap, istHourOf, windowIdFor, analyzeSessionWindows,
  MIN_GAP_SAMPLE, FLAT_GAP_PCT, STRONG_GAP_PCT,
} from "../utils/overnightGapEngine";
import type { Candle } from "../types";

function candle(date: string, open: number, high: number, low: number, close: number, volume = 1000): Candle {
  return { date, open, high, low, close, volume, oi: 0 } as Candle;
}

// Builds a run of daily candles where each session gaps by gapPct from the
// prior close and then closes dayMovePct away from its own open.
function series(specs: { gapPct: number; dayMovePct: number }[], start = 100): Candle[] {
  const out: Candle[] = [candle("2026-01-01T00:00:00+05:30", start, start, start, start)];
  let prevClose = start;
  specs.forEach((s, i) => {
    const open = prevClose * (1 + s.gapPct / 100);
    const close = open * (1 + s.dayMovePct / 100);
    const high = Math.max(open, close) * 1.002;
    const low = Math.min(open, close) * 0.998;
    out.push(candle(`2026-02-${String(i + 1).padStart(2, "0")}T00:00:00+05:30`, open, high, low, close));
    prevClose = close;
  });
  return out;
}

test("gap buckets split on the documented thresholds", () => {
  assert.equal(bucketForGap(0), "flat");
  assert.equal(bucketForGap(FLAT_GAP_PCT - 0.01), "flat");
  assert.equal(bucketForGap(FLAT_GAP_PCT), "up");
  assert.equal(bucketForGap(STRONG_GAP_PCT), "strong_up");
  assert.equal(bucketForGap(-FLAT_GAP_PCT), "down");
  assert.equal(bucketForGap(-STRONG_GAP_PCT), "strong_down");
});

test("the gap is measured as open against the PREVIOUS close, not the same day's close", () => {
  const daily = [
    candle("2026-01-01T00:00:00+05:30", 100, 101, 99, 100),
    candle("2026-01-02T00:00:00+05:30", 102, 103, 101, 101),
  ];
  const [s] = buildGapSessions(daily);
  assert.equal(s.gapPct, 2); // 100 -> 102 open
  assert.equal(s.dayMovePct, -0.98); // 102 open -> 101 close
});

test("follow-through is re-signed so up-gaps and down-gaps read the same way", () => {
  // A down gap that keeps falling is a CONTINUATION, not a negative reading.
  const daily = [
    candle("2026-01-01T00:00:00+05:30", 100, 100, 100, 100),
    candle("2026-01-02T00:00:00+05:30", 98, 98, 96, 96.5),
  ];
  const [s] = buildGapSessions(daily);
  assert.equal(s.bucket, "strong_down");
  assert.ok(s.dayMovePct < 0, "raw move is negative");
  assert.ok(s.followThroughPct > 0, "but as follow-through it is positive");
  assert.equal(s.outcome, "continued");
});

test("a gap that reverses is classified as faded", () => {
  const daily = [
    candle("2026-01-01T00:00:00+05:30", 100, 100, 100, 100),
    candle("2026-01-02T00:00:00+05:30", 102, 102.5, 100, 100.5),
  ];
  const [s] = buildGapSessions(daily);
  assert.equal(s.bucket, "strong_up");
  assert.equal(s.outcome, "faded");
});

test("a day that goes nowhere after the gap is flat, not a weak continuation", () => {
  const daily = [
    candle("2026-01-01T00:00:00+05:30", 100, 100, 100, 100),
    candle("2026-01-02T00:00:00+05:30", 102, 102.2, 101.9, 102.05),
  ];
  assert.equal(buildGapSessions(daily)[0].outcome, "flat");
});

test("favourable and adverse excursions are relative to the gap's direction", () => {
  // Up gap: favourable is the run above the open, adverse the dip below it.
  const up = buildGapSessions([
    candle("2026-01-01T00:00:00+05:30", 100, 100, 100, 100),
    candle("2026-01-02T00:00:00+05:30", 102, 104.04, 100.98, 103),
  ])[0];
  assert.equal(up.favourablePct, 2); // 102 -> 104.04
  assert.equal(up.adversePct, 1); // 102 -> 100.98

  // Down gap: the roles swap, so a falling market still reads "favourable".
  const down = buildGapSessions([
    candle("2026-01-01T00:00:00+05:30", 100, 100, 100, 100),
    candle("2026-01-02T00:00:00+05:30", 98, 98.98, 96.04, 96.5),
  ])[0];
  assert.equal(down.favourablePct, 2); // 98 -> 96.04
  assert.equal(down.adversePct, 1); // 98 -> 98.98
});

test("a bucket that mostly continues is rated follow", () => {
  const specs = Array.from({ length: 12 }, (_, i) => ({ gapPct: 1.5, dayMovePct: i < 9 ? 1 : -1 }));
  const study = studyBucket(buildGapSessions(series(specs)), "strong_up");
  assert.equal(study.sessions, 12);
  assert.equal(study.continued, 9);
  assert.equal(study.continuedPct, 75);
  assert.equal(study.verdict, "follow");
  assert.ok(study.avgFollowThroughPct !== null && study.avgFollowThroughPct > 0);
});

test("a bucket that mostly reverses is rated fade", () => {
  const specs = Array.from({ length: 12 }, (_, i) => ({ gapPct: 1.5, dayMovePct: i < 9 ? -1 : 1 }));
  const study = studyBucket(buildGapSessions(series(specs)), "strong_up");
  assert.equal(study.fadedPct, 75);
  assert.equal(study.verdict, "fade");
});

test("an evenly split bucket is rated mixed, never forced into a direction", () => {
  const specs = Array.from({ length: 12 }, (_, i) => ({ gapPct: 1.5, dayMovePct: i % 2 === 0 ? 1 : -1 }));
  const study = studyBucket(buildGapSessions(series(specs)), "strong_up");
  assert.equal(study.verdict, "mixed");
  assert.match(study.verdictReason, /No reliable edge/);
});

test("a thin sample gets no verdict, however lopsided it looks", () => {
  // Five perfect continuations must not print a confident "follow".
  const specs = Array.from({ length: 5 }, () => ({ gapPct: 1.5, dayMovePct: 1 }));
  const study = studyBucket(buildGapSessions(series(specs)), "strong_up");
  assert.equal(study.sessions, 5);
  assert.equal(study.verdict, "insufficient");
  assert.match(study.verdictReason, /too few to call/);
});

test(`exactly ${MIN_GAP_SAMPLE} matching sessions is enough to be judged`, () => {
  const specs = Array.from({ length: MIN_GAP_SAMPLE }, () => ({ gapPct: 1.5, dayMovePct: 1 }));
  assert.equal(studyBucket(buildGapSessions(series(specs)), "strong_up").verdict, "follow");
});

test("a bucket with no matching sessions says so rather than dividing by zero", () => {
  const study = studyBucket(buildGapSessions(series([{ gapPct: 1.5, dayMovePct: 1 }])), "strong_down");
  assert.equal(study.sessions, 0);
  assert.equal(study.continuedPct, null);
  assert.equal(study.avgFollowThroughPct, null);
  assert.equal(study.verdict, "insufficient");
});

test("a flat overnight is never dressed up as a signal", () => {
  const specs = Array.from({ length: 12 }, () => ({ gapPct: 0.05, dayMovePct: 1 }));
  const study = studyBucket(buildGapSessions(series(specs)), "flat");
  assert.equal(study.verdict, "mixed");
  assert.match(study.verdictReason, /no directional lean/);
});

test("latestGap reads the most recent session and needs two candles", () => {
  assert.equal(latestGap([]), null);
  assert.equal(latestGap([candle("2026-01-01T00:00:00+05:30", 100, 100, 100, 100)]), null);
  const g = latestGap([
    candle("2026-01-01T00:00:00+05:30", 100, 100, 100, 100),
    candle("2026-01-02T00:00:00+05:30", 101.5, 102, 101, 101.8),
  ])!;
  assert.equal(g.gapPct, 1.5);
  assert.equal(g.bucket, "strong_up");
  assert.equal(g.date, "2026-01-02T00:00:00+05:30");
});

test("session hour is read off the exchange's own +05:30 stamp, not the local clock", () => {
  assert.equal(istHourOf("2026-09-08T09:15:00+05:30"), 9.25);
  assert.equal(istHourOf("2026-09-08T18:30:00+05:30"), 18.5);
  assert.equal(istHourOf("garbage"), null);
});

test("window boundaries put each hour in exactly one session", () => {
  assert.equal(windowIdFor(9), "morning");
  assert.equal(windowIdFor(12.4), "morning");
  assert.equal(windowIdFor(12.5), "europe");
  assert.equal(windowIdFor(17.9), "europe");
  assert.equal(windowIdFor(18), "us");
  assert.equal(windowIdFor(23.5), "us");
  assert.equal(windowIdFor(8), null); // pre-open
});

test("window shares measure where the day's real volume happens", () => {
  // One full day: 10% morning, 30% Europe, 60% US.
  const day = [
    candle("2026-09-08T10:00:00+05:30", 100, 101, 100, 100, 100),
    candle("2026-09-08T14:00:00+05:30", 100, 101, 100, 100, 300),
    candle("2026-09-08T20:00:00+05:30", 100, 101, 100, 100, 600),
  ];
  const study = analyzeSessionWindows(day);
  assert.equal(study.available, true);
  assert.equal(study.sessions, 1);
  assert.deepEqual(study.shares.map((s) => s.volumeSharePct), [10, 30, 60]);
});

test("a part-finished day is excluded so the morning cannot look like the whole session", () => {
  // Today, mid-morning: only the morning window has traded. Counting it would
  // report the morning as 100% of the day's activity.
  const partial = [candle("2026-09-09T10:00:00+05:30", 100, 101, 100, 100, 100)];
  const study = analyzeSessionWindows(partial);
  assert.equal(study.available, false);
  assert.equal(study.sessions, 0);
});

test("no intraday data reports unavailable instead of zeroes that look like findings", () => {
  const study = analyzeSessionWindows([]);
  assert.equal(study.available, false);
  assert.deepEqual(study.shares, []);
});
