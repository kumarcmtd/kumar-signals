import { test } from "node:test";
import assert from "node:assert/strict";
import { readSessionRoom, MIN_SESSIONS_FOR_RANGE } from "../utils/sessionRoomLeft";
import type { Candle } from "../types";

function bar(date: string, hhmm: string, o: number, h: number, l: number, c: number): Candle {
  return { date: `${date}T${hhmm}:00+05:30`, open: o, high: h, low: l, close: c, volume: 1000 };
}

/** A session `rangePct` wide, built as 8 bars so it is never treated as a stub. */
function day(date: string, open: number, rangePct: number): Candle[] {
  const span = (open * rangePct) / 100;
  const out: Candle[] = [];
  for (let i = 0; i < 8; i += 1) {
    const hhmm = `${String(9 + i).padStart(2, "0")}:00`;
    // The first bar carries the open; the extremes are spread across the day.
    const h = i === 2 ? open + span / 2 : open + span / 6;
    const l = i === 5 ? open - span / 2 : open - span / 6;
    out.push(bar(date, hhmm, i === 0 ? open : open, h, l, open));
  }
  return out;
}

function history(count: number, rangePct: number, open = 9000): Candle[] {
  const out: Candle[] = [];
  for (let i = 1; i <= count; i += 1) out.push(...day(`2026-09-${String(i).padStart(2, "0")}`, open, rangePct));
  return out;
}

const TODAY = "2026-09-30";

test("no candles refuses rather than inventing a typical range", () => {
  const r = readSessionRoom([], TODAY);
  assert.equal(r.typicalRangePct, null);
  assert.equal(r.roomLeftPct, null);
  assert.equal(r.thin, true);
  assert.match(r.verdict, /not enough/i);
});

test("the typical range is the median of completed sessions, today excluded", () => {
  const candles = [...history(10, 2), ...day(TODAY, 9000, 5)];
  const r = readSessionRoom(candles, TODAY);
  assert.equal(r.sessionsUsed, 10, "today must not be counted into its own benchmark");
  assert.equal(r.typicalRangePct, 2);
});

// The median is the point of the whole module.
test("one wild news day does not drag the typical range up", () => {
  const candles = [...history(10, 2), ...day("2026-09-20", 9000, 12), ...day(TODAY, 9000, 1)];
  const r = readSessionRoom(candles, TODAY);
  assert.equal(r.typicalRangePct, 2, "a mean would have been dragged well above 2%");
});

test("a quiet morning reports most of a typical day still to come", () => {
  const candles = [...history(12, 2), ...day(TODAY, 9000, 0.5)];
  const r = readSessionRoom(candles, TODAY);
  assert.equal(r.usedPct, 0.5);
  assert.equal(r.usedShare, 25);
  assert.equal(r.roomLeftPct, 1.5);
  assert.ok(r.roomLeftPoints !== null && Math.abs(r.roomLeftPoints - 135) < 1, `1.5% of 9000 is 135, got ${r.roomLeftPoints}`);
  assert.match(r.verdict, /either direction/i);
});

test("a day that has already run says so, and warns about paying up late", () => {
  const candles = [...history(12, 2), ...day(TODAY, 9000, 3)];
  const r = readSessionRoom(candles, TODAY);
  assert.ok(r.usedShare !== null && r.usedShare >= 100);
  assert.equal(r.roomLeftPct, 0, "room left is floored at zero, never negative");
  assert.match(r.verdict, /premium goes to die/i);
});

test("most of the range used is flagged before the day is fully out of room", () => {
  const candles = [...history(12, 2), ...day(TODAY, 9000, 1.6)];
  const r = readSessionRoom(candles, TODAY);
  assert.equal(r.usedShare, 80);
  assert.match(r.verdict, /WHOLE remaining range/i, "the figure must not read as a move in the holder's favour");
});

test("a thin history is labelled thin and refuses to call anything typical", () => {
  const candles = [...history(4, 2), ...day(TODAY, 9000, 1)];
  const r = readSessionRoom(candles, TODAY);
  assert.ok(r.sessionsUsed < MIN_SESSIONS_FOR_RANGE);
  assert.equal(r.thin, true);
  assert.match(r.verdict, /far too few/i);
  assert.match(r.verdict, /a note, not a finding/i);
});

test("holiday half-days are skipped rather than shrinking the benchmark", () => {
  const candles = [
    ...history(10, 2),
    bar("2026-09-25", "09:00", 9000, 9005, 8995, 9000),
    bar("2026-09-25", "10:00", 9000, 9005, 8995, 9000),
    ...day(TODAY, 9000, 1),
  ];
  const r = readSessionRoom(candles, TODAY);
  assert.equal(r.sessionsUsed, 10);
  assert.equal(r.typicalRangePct, 2);
});

test("before today's session starts it reports the benchmark without a room figure", () => {
  const r = readSessionRoom(history(12, 2), TODAY);
  assert.equal(r.typicalRangePct, 2);
  assert.equal(r.usedPct, null);
  assert.match(r.verdict, /has not started/i);
});

test("nothing here is ever phrased as a prediction or a target", () => {
  const cases = [0.5, 1.6, 3];
  for (const used of cases) {
    const r = readSessionRoom([...history(12, 2), ...day(TODAY, 9000, used)], TODAY);
    assert.ok(
      !/will reach|will move|target of|guaranteed|expect price to|sure shot/i.test(r.verdict),
      `a measured range must not be worded as a forecast: ${r.verdict}`
    );
  }
});
