import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bucketForGap, sessionsFromRecords, studyBucket, istHourOf, windowIdFor, analyzeSessionWindows,
  MIN_GAP_SAMPLE, FLAT_GAP_PCT, STRONG_GAP_PCT, type MorningGapRecord,
} from "../utils/overnightGapEngine";
import type { Candle } from "../types";

// One session's 9:00-11:00 AM window, as the worker's /api/gap-study returns
// it: gapPct is the overnight move, movePct is 11 AM against the 9 AM open.
function rec(gapPct: number, movePct: number, over: Partial<MorningGapRecord> = {}): MorningGapRecord {
  const openPrice = 100;
  return {
    date: "2026-09-08",
    gapPct,
    openPrice,
    closePrice: openPrice * (1 + movePct / 100),
    movePct,
    highPct: Math.max(0, movePct),
    lowPct: Math.max(0, -movePct),
    ...over,
  };
}

function candle(date: string, open: number, high: number, low: number, close: number, volume = 1000): Candle {
  return { date, open, high, low, close, volume, oi: 0 } as Candle;
}

test("gap buckets split on the documented thresholds", () => {
  assert.equal(bucketForGap(0), "flat");
  assert.equal(bucketForGap(FLAT_GAP_PCT - 0.01), "flat");
  assert.equal(bucketForGap(FLAT_GAP_PCT), "up");
  assert.equal(bucketForGap(STRONG_GAP_PCT), "strong_up");
  assert.equal(bucketForGap(-FLAT_GAP_PCT), "down");
  assert.equal(bucketForGap(-STRONG_GAP_PCT), "strong_down");
});

test("the scored move is 11 AM against the 9 AM open, not the session close", () => {
  const [s] = sessionsFromRecords([rec(2, -0.98)]);
  assert.equal(s.gapPct, 2);
  assert.equal(s.movePct, -0.98);
  assert.equal(s.outcome, "faded");
});

test("follow-through is re-signed so up-gaps and down-gaps read the same way", () => {
  // A down gap that keeps falling is a CONTINUATION, not a negative reading.
  const [s] = sessionsFromRecords([rec(-2, -1.5)]);
  assert.equal(s.bucket, "strong_down");
  assert.ok(s.movePct < 0, "raw move is negative");
  assert.ok(s.followThroughPct > 0, "but as follow-through it is positive");
  assert.equal(s.outcome, "continued");
});

test("a gap that reverses within the morning is classified as faded", () => {
  const [s] = sessionsFromRecords([rec(2, -1.2)]);
  assert.equal(s.bucket, "strong_up");
  assert.equal(s.outcome, "faded");
});

test("a morning that goes nowhere is flat, not a weak continuation", () => {
  assert.equal(sessionsFromRecords([rec(2, 0.05)])[0].outcome, "flat");
});

test("a gap can fade by 11 AM even on a session that would later close green", () => {
  // The exact case daily candles got wrong: down 0.9% at 11, up 1.5% by the
  // close. Scored on the close it looks like a continuation; scored on the
  // morning -- the window actually traded -- it is a fade.
  const [s] = sessionsFromRecords([rec(1.4, -0.9)]);
  assert.equal(s.outcome, "faded");
});

test("favourable and adverse excursions are relative to the gap's direction", () => {
  // Up gap: favourable is the run above the open, adverse the dip below it.
  const up = sessionsFromRecords([rec(2, 1, { highPct: 2, lowPct: 1 })])[0];
  assert.equal(up.favourablePct, 2);
  assert.equal(up.adversePct, 1);

  // Down gap: the roles swap, so a falling market still reads "favourable".
  const down = sessionsFromRecords([rec(-2, -1, { highPct: 1, lowPct: 2 })])[0];
  assert.equal(down.favourablePct, 2);
  assert.equal(down.adversePct, 1);
});

test("a bucket that mostly continues is rated follow", () => {
  const study = studyBucket(sessionsFromRecords(Array.from({ length: 12 }, (_, i) => rec(1.5, i < 9 ? 1 : -1))), "strong_up");
  assert.equal(study.sessions, 12);
  assert.equal(study.continued, 9);
  assert.equal(study.continuedPct, 75);
  assert.equal(study.verdict, "follow");
  assert.ok(study.avgFollowThroughPct !== null && study.avgFollowThroughPct > 0);
});

test("a bucket that mostly reverses is rated fade", () => {
  const study = studyBucket(sessionsFromRecords(Array.from({ length: 12 }, (_, i) => rec(1.5, i < 9 ? -1 : 1))), "strong_up");
  assert.equal(study.fadedPct, 75);
  assert.equal(study.verdict, "fade");
});

test("an evenly split bucket is rated mixed, never forced into a direction", () => {
  const study = studyBucket(sessionsFromRecords(Array.from({ length: 12 }, (_, i) => rec(1.5, i % 2 === 0 ? 1 : -1))), "strong_up");
  assert.equal(study.verdict, "mixed");
  assert.match(study.verdictReason, /No reliable edge/);
});

test("a thin sample gets no verdict, however lopsided it looks", () => {
  // Five perfect continuations must not print a confident "follow".
  const study = studyBucket(sessionsFromRecords(Array.from({ length: 5 }, () => rec(1.5, 1))), "strong_up");
  assert.equal(study.sessions, 5);
  assert.equal(study.verdict, "insufficient");
  assert.match(study.verdictReason, /too few to call/);
});

test(`exactly ${MIN_GAP_SAMPLE} matching sessions is enough to be judged`, () => {
  assert.equal(studyBucket(sessionsFromRecords(Array.from({ length: MIN_GAP_SAMPLE }, () => rec(1.5, 1))), "strong_up").verdict, "follow");
});

test("a bucket with no matching sessions says so rather than dividing by zero", () => {
  const study = studyBucket(sessionsFromRecords([rec(1.5, 1)]), "strong_down");
  assert.equal(study.sessions, 0);
  assert.equal(study.continuedPct, null);
  assert.equal(study.avgFollowThroughPct, null);
  assert.equal(study.verdict, "insufficient");
});

test("a flat overnight is never dressed up as a signal", () => {
  const study = studyBucket(sessionsFromRecords(Array.from({ length: 12 }, () => rec(0.05, 1))), "flat");
  assert.equal(study.verdict, "mixed");
  assert.match(study.verdictReason, /no directional lean/);
});

test("a record with no usable open is skipped rather than dividing by zero", () => {
  assert.equal(sessionsFromRecords([rec(1.5, 1, { openPrice: 0 })]).length, 0);
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

// ---- Global benchmark vs MCX ----

import { compareGlobalToMcx, REACTION_TOLERANCE_PCT } from "../utils/overnightGapEngine";

test("a matching move reads as already priced in", () => {
  const c = compareGlobalToMcx(1.2, 1.25)!;
  assert.equal(c.verdict, "priced_in");
  assert.equal(c.diffPct, 0.05);
});

test("MCX travelling less of the same move is an under-reaction", () => {
  // Global +1.20%, MCX +0.35% -- the exact shape of a morning where MCX has
  // not yet caught up.
  const c = compareGlobalToMcx(1.2, 0.35)!;
  assert.equal(c.verdict, "under");
  assert.equal(c.diffPct, -0.85);
  assert.match(c.detail, /0\.85% short/);
});

test("MCX travelling further than global is an over-reaction", () => {
  const c = compareGlobalToMcx(0.4, 1.5)!;
  assert.equal(c.verdict, "over");
  assert.match(c.detail, /1\.10% beyond/);
});

test("under and over are judged on magnitude, so they work on down moves too", () => {
  // Global -2%, MCX -0.5%: MCX has fallen less, which is still under-reacting.
  assert.equal(compareGlobalToMcx(-2, -0.5)!.verdict, "under");
  assert.equal(compareGlobalToMcx(-0.5, -2)!.verdict, "over");
});

test("opposite directions are called out rather than forced into under/over", () => {
  const c = compareGlobalToMcx(1.5, -0.8)!;
  assert.equal(c.verdict, "against");
  assert.match(c.detail, /rupee/);
});

test("a move just inside the tolerance is priced in, just outside is not", () => {
  assert.equal(compareGlobalToMcx(1, 1 + REACTION_TOLERANCE_PCT)!.verdict, "priced_in");
  assert.equal(compareGlobalToMcx(1, 1 + REACTION_TOLERANCE_PCT + 0.01)!.verdict, "over");
});

test("a missing benchmark yields no comparison rather than a fabricated one", () => {
  assert.equal(compareGlobalToMcx(null, 0.35), null);
  assert.equal(compareGlobalToMcx(1.2, null), null);
  assert.equal(compareGlobalToMcx(undefined, undefined), null);
  assert.equal(compareGlobalToMcx(NaN, 1), null);
});
