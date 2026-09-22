import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildSessions, buildFollowThroughStudy, studyBand, bandFor, istDateOf,
  WINDOWS, MIN_SESSIONS_PER_BAND,
} from "../utils/overnightFollowThrough";
import type { Candle } from "../types";

/** One 30-minute bar, stamped in IST exactly as Upstox sends them. */
function bar(date: string, hhmm: string, o: number, h: number, l: number, c: number): Candle {
  return { date: `${date}T${hhmm}:00+05:30`, open: o, high: h, low: l, close: c, volume: 1000 };
}

/** A full session: `path` is each bar's close, walked from `open`. */
function session(date: string, open: number, path: number[]): Candle[] {
  const out: Candle[] = [];
  let prev = open;
  const times = ["09:00", "10:00", "11:00", "12:30", "15:30", "18:00", "19:30", "21:30", "23:00"];
  path.forEach((close, i) => {
    const hhmm = times[Math.min(i, times.length - 1)];
    out.push(bar(date, hhmm, i === 0 ? open : prev, Math.max(prev, close), Math.min(prev, close), close));
    prev = close;
  });
  return out;
}

test("istDateOf reads the calendar day straight off the stamp", () => {
  assert.equal(istDateOf("2026-09-18T21:30:00+05:30"), "2026-09-18");
});

test("the windows cover the whole MCX session without gaps or overlaps", () => {
  assert.equal(WINDOWS[0].from, 9 * 60);
  assert.equal(WINDOWS[WINDOWS.length - 1].to, 23 * 60 + 30);
  for (let i = 1; i < WINDOWS.length; i += 1) {
    assert.equal(WINDOWS[i].from, WINDOWS[i - 1].to, `${WINDOWS[i].id} must start where ${WINDOWS[i - 1].id} ends`);
  }
});

test("gap bands follow the stated thresholds", () => {
  assert.equal(bandFor(2.4), "big_up");
  assert.equal(bandFor(1.5), "big_up");
  assert.equal(bandFor(0.9), "up");
  assert.equal(bandFor(0.2), "flat");
  assert.equal(bandFor(-0.2), "flat");
  assert.equal(bandFor(-0.9), "down");
  assert.equal(bandFor(-2.1), "big_down");
});

// ---------------------------------------------------------------------------
// The measurement itself.
// ---------------------------------------------------------------------------

test("the overnight gap is yesterday's close against today's open", () => {
  const candles = [
    ...session("2026-09-16", 100, [100, 101, 102, 103, 104, 105, 106, 107, 100]),
    ...session("2026-09-17", 98, [98, 97, 96, 95, 94, 93, 92, 91, 90]),
  ];
  const s = buildSessions(candles);
  assert.equal(s.length, 1, "the first session has no previous close, so it is skipped");
  // Previous close 100 -> open 98 = -2%.
  assert.equal(s[0].gapPct, -2);
  assert.equal(s[0].band, "big_down");
});

test("a gap down that keeps falling is recorded as continuing", () => {
  const candles = [
    ...session("2026-09-16", 100, [100, 100, 100, 100, 100, 100, 100, 100, 100]),
    ...session("2026-09-17", 98, [98, 97, 96, 95, 94, 93, 92, 91, 90]),
  ];
  const [s] = buildSessions(candles);
  assert.equal(s.continued, true);
  assert.ok(s.extensionPct > 7, `should have run well past the open, got ${s.extensionPct}%`);
  assert.equal(s.filled, false, "it never traded back above the open");
  assert.ok(s.closeVsOpenPct > 0, "closing with the gap is a positive figure");
});

test("a gap that reverses is recorded as filled, not as continuing", () => {
  const candles = [
    ...session("2026-09-16", 100, [100, 100, 100, 100, 100, 100, 100, 100, 100]),
    // Gaps down to 98, then climbs straight back through the open.
    ...session("2026-09-17", 98, [98, 99, 100, 101, 102, 103, 104, 105, 106]),
  ];
  const [s] = buildSessions(candles);
  assert.equal(s.filled, true);
  assert.ok(s.closeVsOpenPct < 0, "closing against the gap must read negative");
});

test("the peak window says how far into the day the move ran", () => {
  const candles = [
    ...session("2026-09-16", 100, [100, 100, 100, 100, 100, 100, 100, 100, 100]),
    // Falls all day, furthest point on the last bar (23:00 = late US window).
    ...session("2026-09-17", 98, [98, 97.5, 97, 96.5, 96, 95.5, 95, 94.5, 94]),
  ];
  const [s] = buildSessions(candles);
  assert.equal(s.peakWindowId, "late");
  assert.match(s.peakWindowLabel!, /late US/i);
});

test("an early peak is attributed to the morning, not the whole day", () => {
  const candles = [
    ...session("2026-09-16", 100, [100, 100, 100, 100, 100, 100, 100, 100, 100]),
    // Furthest down on the 10:00 bar, then recovers.
    ...session("2026-09-17", 98, [98, 96, 97, 97.5, 97.6, 97.7, 97.8, 97.9, 97.9]),
  ];
  const [s] = buildSessions(candles);
  assert.equal(s.peakWindowId, "open");
});

test("a gap UP measures its extension from the highs", () => {
  const candles = [
    ...session("2026-09-16", 100, [100, 100, 100, 100, 100, 100, 100, 100, 100]),
    ...session("2026-09-17", 102, [102, 103, 104, 105, 106, 107, 108, 109, 110]),
  ];
  const [s] = buildSessions(candles);
  assert.equal(s.gapPct, 2);
  assert.equal(s.band, "big_up");
  assert.equal(s.continued, true);
  assert.equal(s.filled, false);
});

test("stub sessions are skipped rather than distorting the averages", () => {
  const candles = [
    ...session("2026-09-16", 100, [100, 100, 100, 100, 100, 100, 100, 100, 100]),
    // A two-bar holiday half-day.
    bar("2026-09-17", "09:00", 98, 98, 98, 98),
    bar("2026-09-17", "10:00", 98, 98, 98, 98),
  ];
  assert.equal(buildSessions(candles).length, 0);
});

// ---------------------------------------------------------------------------
// Aggregation and honesty.
// ---------------------------------------------------------------------------

/**
 * `count` consecutive sessions that each gap 2% in `gapDir`.
 *
 * The chaining matters: each day's gap is measured against the PREVIOUS day's
 * close, so the open has to be derived from where the last session actually
 * finished. Anchoring every day to a fixed 100 produced one gap down followed
 * by nine gaps UP, which is the opposite of what the test claimed to set up.
 */
function manySessions(count: number, gapDir: number, follows: boolean): Candle[] {
  const out: Candle[] = [];
  let lastClose = 100;
  out.push(...session("2026-09-01", lastClose, Array(9).fill(lastClose)));

  for (let i = 1; i <= count; i += 1) {
    const date = `2026-09-${String(i + 1).padStart(2, "0")}`;
    const open = Number((lastClose * (1 + gapDir * 0.02)).toFixed(2));
    const step = open * 0.005;
    const path = Array.from({ length: 9 }, (_, k) => Number((open + (follows ? gapDir : -gapDir) * k * step).toFixed(2)));
    out.push(...session(date, open, path));
    lastClose = path[path.length - 1];
  }
  return out;
}

test("a band that always continued reads as continuing, with its usual window", () => {
  const study = buildFollowThroughStudy(manySessions(10, -1, true));
  const band = study.bands.find((b) => b.band === "big_down")!;
  assert.equal(band.sessions, 10);
  assert.equal(band.continuedPct, 100);
  assert.equal(band.thin, false);
  assert.match(band.verdict, /kept going lower/i);
  assert.ok(band.usualPeakWindow, "a consistent pattern must name the window it ran into");
});

test("a band that always reversed is reported as fading", () => {
  const study = buildFollowThroughStudy(manySessions(10, -1, false));
  const band = study.bands.find((b) => b.band === "big_down")!;
  assert.equal(band.filledPct, 100);
  assert.match(band.verdict, /mostly faded/i);
  assert.match(band.verdict, /wrong side/i);
});

// The rule that stops this becoming a bad tip.
test("a thin band is labelled thin and refuses to state a pattern", () => {
  const study = buildFollowThroughStudy(manySessions(3, -1, true));
  const band = study.bands.find((b) => b.band === "big_down")!;
  assert.equal(band.sessions, 3);
  assert.ok(band.sessions < MIN_SESSIONS_PER_BAND);
  assert.equal(band.thin, true);
  assert.match(band.verdict, /far too few/i);
  assert.match(band.verdict, /a note, not a finding/i);
});

test("an empty band says so rather than showing zeroes as a result", () => {
  const b = studyBand([], "big_up");
  assert.equal(b.sessions, 0);
  assert.equal(b.continuedPct, null);
  assert.equal(b.medianExtensionPct, null);
  assert.match(b.verdict, /no sessions of this kind/i);
});

test("no candles produces an empty study rather than throwing", () => {
  const study = buildFollowThroughStudy([]);
  assert.equal(study.sessions.length, 0);
  assert.equal(study.firstDate, null);
  assert.equal(study.bands.length, 5, "every band is still listed, each reporting zero");
});

test("recent sessions are newest first", () => {
  const study = buildFollowThroughStudy(manySessions(6, 1, true));
  assert.ok(study.recent.length > 1);
  assert.ok(study.recent[0].date > study.recent[1].date, "newest must lead");
});

test("no band verdict ever promises a repeat", () => {
  const study = buildFollowThroughStudy(manySessions(12, -1, true));
  for (const b of study.bands) {
    assert.ok(
      !/guaranteed|always will|will definitely|sure shot|certain/i.test(b.verdict),
      `a past pattern must not be stated as a future certainty: ${b.verdict}`
    );
  }
});
