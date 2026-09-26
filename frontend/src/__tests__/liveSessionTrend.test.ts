import { test } from "vitest";
import assert from "node:assert/strict";
import { readLiveSessionTrend, timeLabelOf, fmtPrice, MIN_BARS } from "../utils/liveSessionTrend";
import type { Candle } from "../types";

const TODAY = "2026-09-23";
const YESTERDAY = "2026-09-22";

/** One 15-minute bar, stamped in IST exactly as Upstox sends them. */
function bar(date: string, hhmm: string, o: number, h: number, l: number, c: number, volume = 5000): Candle {
  return { date: `${date}T${hhmm}:00+05:30`, open: o, high: h, low: l, close: c, volume };
}

/** Sequential 15-minute slots from 09:00. */
function slot(i: number): string {
  const m = 9 * 60 + i * 15;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/**
 * A session built from each bar's close, walked from `open`.
 *
 * `spread` is the wick size around each bar's body. It defaults to something
 * small so the bar's high/low follow its direction rather than swamping it.
 */
function session(date: string, open: number, closes: number[], opts: { spread?: number; volumes?: number[] } = {}): Candle[] {
  const spread = opts.spread ?? 0.5;
  let prev = open;
  return closes.map((close, i) => {
    const o = i === 0 ? open : prev;
    const c = bar(date, slot(i), o, Math.max(o, close) + spread, Math.min(o, close) - spread, close, opts.volumes?.[i] ?? 5000);
    prev = close;
    return c;
  });
}

/** A flat prior day, so today has a previous close to gap from. */
function priorDay(level: number): Candle[] {
  return session(YESTERDAY, level, Array(10).fill(level));
}

test("the clock label is read off the stamp, never through a Date", () => {
  // A Date round-trip on a UTC machine would turn this into 16:15 the day before.
  assert.equal(timeLabelOf("2026-09-23T21:45:00+05:30"), "21:45");
});

test("prices are formatted at a precision that suits the contract", () => {
  assert.equal(fmtPrice(9020), "9,020");
  assert.equal(fmtPrice(251.4), "251.4");
  assert.equal(fmtPrice(24.55), "24.55");
});

// ---------------------------------------------------------------------------
// Refusing to speak too early.
// ---------------------------------------------------------------------------

test("no candles produces a plain refusal, not a fabricated read", () => {
  const t = readLiveSessionTrend([]);
  assert.equal(t.state, "no_session");
  assert.equal(t.openPrice, null);
  assert.equal(t.movePct, null);
});

test("one or two bars after the open is too early to call a direction", () => {
  const candles = [...priorDay(9000), ...session(TODAY, 9000, [9040, 9080])];
  const t = readLiveSessionTrend(candles, { marketOpen: true, today: TODAY });
  assert.equal(t.state, "too_early");
  assert.ok(t.bars < MIN_BARS);
  assert.match(t.advice, /noise/i);
});

test("a quiet session is reported as no direction rather than a tiny trend", () => {
  // Crude drifting a couple of rupees around the open is not a trend.
  const candles = [...priorDay(9000), ...session(TODAY, 9000, [9001, 8999, 9000, 9001, 8999, 9000])];
  const t = readLiveSessionTrend(candles, { marketOpen: true, today: TODAY });
  assert.equal(t.state, "no_direction");
  assert.equal(t.direction, 0);
  assert.match(t.advice, /noise/i);
});

// ---------------------------------------------------------------------------
// The three states the page exists to show.
// ---------------------------------------------------------------------------

test("a session making new highs all the way reads as still extending", () => {
  const candles = [...priorDay(9000), ...session(TODAY, 9010, [9030, 9055, 9075, 9100, 9125, 9150, 9175])];
  const t = readLiveSessionTrend(candles, { marketOpen: true, today: TODAY });
  assert.equal(t.state, "extending");
  assert.equal(t.direction, 1);
  assert.equal(t.directionWord, "up");
  assert.equal(t.barsSinceExtreme, 0, "the newest bar IS the session high");
  assert.equal(t.warnings.length, 0);
  assert.match(t.headline, /still pushing/i);
});

// Natural Gas near Rs.250, so a two-rupee bar here is the same event as a
// seventy-rupee bar in Crude. The ATR floor is what makes the two comparable.
test("a down session making new lows reads as extending, in the down direction", () => {
  const candles = [...priorDay(250), ...session(TODAY, 249, [247, 245, 243, 241, 239, 237, 235], { spread: 0.1 })];
  const t = readLiveSessionTrend(candles, { marketOpen: true, today: TODAY });
  assert.equal(t.state, "extending");
  assert.equal(t.direction, -1);
  assert.equal(t.directionWord, "down");
});

test("a move that stalls for three bars is reported as weakening, not as a reversal", () => {
  //                                      run up ............  then four flat bars
  const closes = [9040, 9080, 9120, 9160, 9158, 9156, 9157, 9155];
  const candles = [...priorDay(9000), ...session(TODAY, 9000, closes, { spread: 1 })];
  const t = readLiveSessionTrend(candles, { marketOpen: true, today: TODAY });
  assert.equal(t.state, "weakening");
  assert.equal(t.direction, 1, "the direction has NOT flipped -- it is still an up session");
  assert.ok(t.barsSinceExtreme >= 3, `should have stalled, got ${t.barsSinceExtreme} bars`);
  assert.match(t.headline, /fading/i);
  assert.match(t.advice, /warning, not a forecast/i);
});

test("handing a third of the run back is a warning even while price is still up", () => {
  const closes = [9050, 9100, 9150, 9200, 9150, 9120];
  const candles = [...priorDay(9000), ...session(TODAY, 9000, closes, { spread: 1 })];
  const t = readLiveSessionTrend(candles, { marketOpen: true, today: TODAY });
  assert.equal(t.state, "weakening");
  assert.ok(t.givebackPct !== null && t.givebackPct >= 35, `expected a real giveback, got ${t.givebackPct}%`);
  assert.ok(t.lastPrice! > t.openPrice!, "price is still above the open");
});

test("closing back through the opening price is reported as turned", () => {
  const closes = [9050, 9100, 9150, 9100, 9040, 8990, 8960];
  const candles = [...priorDay(9000), ...session(TODAY, 9000, closes, { spread: 1 })];
  const t = readLiveSessionTrend(candles, { marketOpen: true, today: TODAY });
  assert.equal(t.state, "turned");
  assert.match(t.headline, /turned back through the open/i);
  assert.match(t.advice, /no longer exists/i);
});

test("giving back nearly all of the run is turned even without crossing the open", () => {
  const closes = [9050, 9120, 9200, 9150, 9080, 9020, 9012];
  const candles = [...priorDay(9000), ...session(TODAY, 9000, closes, { spread: 1 })];
  const t = readLiveSessionTrend(candles, { marketOpen: true, today: TODAY });
  assert.equal(t.state, "turned");
  assert.ok(t.lastPrice! > t.openPrice!, "still fractionally above the open");
  assert.ok(t.givebackPct !== null && t.givebackPct >= 70);
});

/**
 * The rule that makes the whole card useful, locked down.
 *
 * Direction used to be read off "last close vs open", and a session that ran
 * up and then reversed hard through the open came back as a DOWN session that
 * was "still pushing" -- because its low was on the newest bar. That is the
 * exact opposite of the warning a trader holding the morning's CE needs.
 */
test("a session that ran up and reversed stays an UP session that has turned", () => {
  const closes = [9060, 9130, 9180, 9090, 9000, 8930, 8880];
  const candles = [...priorDay(9000), ...session(TODAY, 9000, closes, { spread: 1 })];
  const t = readLiveSessionTrend(candles, { marketOpen: true, today: TODAY });
  assert.equal(t.direction, 1, "it opened and went UP; that fact does not un-happen");
  assert.equal(t.state, "turned");
  assert.ok(t.extremePrice! > 9170, "the extreme must still be the morning high, not the afternoon low");
  assert.equal(t.extremeTime, "09:30");
});

// ---------------------------------------------------------------------------
// The individual checks -- these are what the user actually reads.
// ---------------------------------------------------------------------------

test("a wick through the open does not count as turning back", () => {
  // The 10:00 bar dips below 9000 intraday but closes well above it.
  const bars = [
    bar(TODAY, slot(0), 9000, 9030, 8998, 9025),
    bar(TODAY, slot(1), 9025, 9040, 8980, 9030),
    bar(TODAY, slot(2), 9030, 9060, 9025, 9055),
    bar(TODAY, slot(3), 9055, 9090, 9050, 9085),
    bar(TODAY, slot(4), 9085, 9120, 9080, 9115),
    bar(TODAY, slot(5), 9115, 9150, 9110, 9145),
  ];
  const t = readLiveSessionTrend([...priorDay(9000), ...bars], { marketOpen: true, today: TODAY });
  assert.equal(t.state, "extending");
  const aboveOpen = t.checks.find((c) => c.id === "above_open")!;
  assert.equal(aboveOpen.ok, true);
  assert.match(aboveOpen.detail, /dipped through it earlier and recovered/i);
});

test("shrinking bars are called out even while price still creeps higher", () => {
  // Big early bars, then three tiny ones that still tick up.
  const bars = [
    bar(TODAY, slot(0), 9000, 9060, 8995, 9055),
    bar(TODAY, slot(1), 9055, 9115, 9050, 9110),
    bar(TODAY, slot(2), 9110, 9170, 9105, 9165),
    bar(TODAY, slot(3), 9165, 9170, 9163, 9167),
    bar(TODAY, slot(4), 9167, 9172, 9165, 9169),
    bar(TODAY, slot(5), 9169, 9174, 9167, 9172),
  ];
  const t = readLiveSessionTrend([...priorDay(9000), ...bars], { marketOpen: true, today: TODAY });
  const size = t.checks.find((c) => c.id === "bar_size")!;
  assert.equal(size.ok, false);
  assert.match(size.detail, /running out of range/i);
});

test("volume drying up is reported, and is skipped entirely when volume is missing", () => {
  const closes = [9040, 9080, 9120, 9160, 9200, 9240];
  const withVol = [...priorDay(9000), ...session(TODAY, 9000, closes, { spread: 1, volumes: [9000, 9000, 9000, 900, 900, 900] })];
  const t = readLiveSessionTrend(withVol, { marketOpen: true, today: TODAY });
  const vol = t.checks.find((c) => c.id === "volume")!;
  assert.equal(vol.ok, false);
  assert.match(vol.detail, /fewer people are pushing it/i);

  const noVol = withVol.map((c) => ({ ...c, volume: undefined }));
  const t2 = readLiveSessionTrend(noVol, { marketOpen: true, today: TODAY });
  assert.equal(t2.checks.find((c) => c.id === "volume"), undefined, "a missing input must drop the check, never invent a number");
});

test("healthy counts only the checks that are actually passing", () => {
  const candles = [...priorDay(9000), ...session(TODAY, 9010, [9030, 9055, 9075, 9100, 9125, 9150, 9175], { spread: 1 })];
  const t = readLiveSessionTrend(candles, { marketOpen: true, today: TODAY });
  assert.equal(t.healthy, t.checks.length);
  assert.equal(t.warnings.length, 0);
});

// ---------------------------------------------------------------------------
// Live vs finished, and the forming bar.
// ---------------------------------------------------------------------------

test("a session from a past date is marked stale and says so in the headline", () => {
  const candles = [...priorDay(9000), ...session(TODAY, 9010, [9030, 9055, 9075, 9100, 9125, 9150])];
  const t = readLiveSessionTrend(candles, { marketOpen: false, today: "2026-09-24" });
  assert.equal(t.stale, true);
  assert.equal(t.forming, false);
  assert.match(t.headline, /last completed session, not live/i);
});

test("while the market is open the newest bar is flagged as still forming", () => {
  const candles = [...priorDay(9000), ...session(TODAY, 9010, [9030, 9055, 9075, 9100, 9125, 9150])];
  const t = readLiveSessionTrend(candles, { marketOpen: true, today: TODAY });
  assert.equal(t.forming, true);
  assert.equal(t.stale, false);
  assert.match(t.checks.find((c) => c.id === "recent_bars")!.detail, /still forming/i);
});

test("the gap against yesterday's close is carried through", () => {
  const candles = [...priorDay(9000), ...session(TODAY, 9090, [9110, 9130, 9150, 9170, 9190, 9210])];
  const t = readLiveSessionTrend(candles, { marketOpen: true, today: TODAY });
  assert.equal(t.prevClose, 9000);
  assert.equal(t.gapPct, 1);
});

test("bar spacing is measured from the data, not assumed", () => {
  const candles = [...priorDay(9000), ...session(TODAY, 9010, [9030, 9055, 9075, 9100, 9125, 9150])];
  const t = readLiveSessionTrend(candles, { marketOpen: true, today: TODAY });
  assert.equal(t.barMinutes, 15);
});

// ---------------------------------------------------------------------------
// Honesty.
// ---------------------------------------------------------------------------

test("no reading ever promises what price will do next", () => {
  const cases: Candle[][] = [
    [...priorDay(9000), ...session(TODAY, 9010, [9030, 9055, 9075, 9100, 9125, 9150])],
    [...priorDay(9000), ...session(TODAY, 9000, [9040, 9080, 9120, 9160, 9158, 9156, 9157, 9155], { spread: 1 })],
    [...priorDay(9000), ...session(TODAY, 9000, [9050, 9100, 9150, 9100, 9040, 8990, 8960], { spread: 1 })],
  ];
  for (const candles of cases) {
    const t = readLiveSessionTrend(candles, { marketOpen: true, today: TODAY });
    const text = `${t.headline} ${t.advice} ${t.story} ${t.checks.map((c) => c.detail).join(" ")}`;
    assert.ok(
      !/guaranteed|sure shot|will rise|will fall|certain profit|100% accurate|risk-free|safe bet/i.test(text),
      `a description of past bars must not be worded as a prediction: ${text}`
    );
  }
});

test("the story names the open, the extreme, its time and where price is now", () => {
  const candles = [...priorDay(9000), ...session(TODAY, 9000, [9050, 9100, 9150, 9100, 9060, 9040], { spread: 1 })];
  const t = readLiveSessionTrend(candles, { marketOpen: true, today: TODAY });
  assert.match(t.story, /Opened 9,000/);
  assert.match(t.story, /9,15\d/, "the session high belongs in the story");
  assert.ok(t.extremeTime, "the time of the high must be recorded");
  assert.match(t.story, new RegExp(t.extremeTime!));
});
