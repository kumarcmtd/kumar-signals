import { test } from "node:test";
import assert from "node:assert/strict";
import {
  istMinutesOfStamp, slotStartOf, slotKey, slotLabel, allSlotStarts,
  buildSlotSessions, buildTimeProfile, bestWindows, quietWindows,
  directionZ, directionVerdict, liveWindow, istMinutesNow,
  conditionalFadeClaim, gapContinuationClaim, testClaims,
  tzOffsetMinutes, easternToInstant, scheduledEvents, istSlotOf, eventProfile,
  plainDirection, plainBusyness, plainMultiple,
  SESSION_START_MIN, SESSION_END_MIN, SLOT_MINUTES, MIN_SESSIONS_FOR_VERDICT, STRONG_Z, LEANING_Z,
  type SlotSession,
} from "../utils/timeProfileEngine";
import type { Candle } from "../types";

// A 30-minute bar stamped the way Upstox actually stamps MCX data: local
// exchange time with an explicit +05:30 offset.
function bar(date: string, hhmm: string, open: number, high: number, low: number, close: number, volume = 100): Candle {
  return { date: `${date}T${hhmm}:00+05:30`, open, high, low, close, volume, oi: 0 };
}

/** n sessions of a flat, boring day with one loud slot at `loudAt`. */
function syntheticDays(n: number, opts: { loudAt?: string; loudRange?: number; drift?: (day: number) => number } = {}): Candle[] {
  const { loudAt, loudRange = 4, drift } = opts;
  const out: Candle[] = [];
  for (let d = 0; d < n; d++) {
    const date = `2026-0${Math.floor(d / 28) + 6}-${String((d % 28) + 1).padStart(2, "0")}`;
    for (let m = SESSION_START_MIN; m < SESSION_END_MIN; m += SLOT_MINUTES) {
      const hh = String(Math.floor(m / 60)).padStart(2, "0");
      const mm = String(m % 60).padStart(2, "0");
      const key = `${hh}:${mm}`;
      const open = 100;
      const loud = key === loudAt;
      const range = loud ? loudRange : 1;
      const close = drift && loud ? open + drift(d) : open;
      out.push(bar(date, key, open, open + range / 2, open - range / 2, close));
    }
  }
  return out;
}

// ---- Time parsing: the thing that silently breaks everything if wrong ----

test("the IST hour is read off the stamp, not off a UTC Date", () => {
  // A worker running in UTC that parsed this would see 15:30 and file the
  // 9 PM bar under the afternoon.
  assert.equal(istMinutesOfStamp("2026-09-11T21:00:00+05:30"), 21 * 60);
  assert.equal(istMinutesOfStamp("2026-09-11T09:30:00+05:30"), 9 * 60 + 30);
  assert.equal(istMinutesOfStamp("garbage"), null);
});

test("slots snap to the half hour and label readably", () => {
  assert.equal(slotStartOf(21 * 60 + 17), 21 * 60);
  assert.equal(slotStartOf(21 * 60 + 47), 21 * 60 + 30);
  assert.equal(slotKey(21 * 60 + 30), "21:30");
  assert.equal(slotLabel(21 * 60), "9:00 PM – 9:30 PM");
  assert.equal(slotLabel(12 * 60), "12:00 PM – 12:30 PM");
  assert.equal(slotLabel(9 * 60), "9:00 AM – 9:30 AM");
});

test("the session covers 9:00 AM to 11:30 PM in half hours", () => {
  const starts = allSlotStarts();
  assert.equal(starts.length, 29);
  assert.equal(starts[0], SESSION_START_MIN);
  assert.equal(starts[starts.length - 1], SESSION_END_MIN - SLOT_MINUTES);
});

test("bars outside the MCX session are dropped rather than folded in", () => {
  const candles = [
    bar("2026-09-11", "08:30", 100, 101, 99, 100), // pre-open
    bar("2026-09-11", "09:00", 100, 101, 99, 100),
    bar("2026-09-11", "23:30", 100, 101, 99, 100), // at the close boundary
  ];
  const rows = buildSlotSessions(candles);
  assert.deepEqual(rows.map((r) => r.startMin), [SESSION_START_MIN]);
});

test("a zero or missing open is dropped instead of producing an infinite percentage", () => {
  const rows = buildSlotSessions([bar("2026-09-11", "10:00", 0, 1, 0, 1)]);
  assert.equal(rows.length, 0);
});

test("two bars inside one half hour merge into a single slot", () => {
  const rows = buildSlotSessions([
    bar("2026-09-11", "10:00", 100, 102, 99, 101, 50),
    bar("2026-09-11", "10:15", 101, 105, 100, 104, 70),
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].open, 100, "the first open is kept");
  assert.equal(rows[0].close, 104, "the last close is kept");
  assert.equal(rows[0].high, 105);
  assert.equal(rows[0].low, 99);
  assert.equal(rows[0].volume, 120);
});

// ---- The statistical honesty this page lives or dies on ----

test("a coin flip is reported as a coin flip, not as an edge", () => {
  // 15 up out of 25 is 60% -- exactly the kind of number that looks like a
  // pattern and is not one.
  const v = directionVerdict(15, 25);
  assert.equal(v.bias, "coin_flip");
  assert.equal(v.confidence, "coin_flip");
  assert.ok(Math.abs(v.z) < LEANING_Z, `z=${v.z} should be under the leaning bar`);
});

test("the significance bar is set above 2 sigma because 29 slots are tested at once", () => {
  assert.ok(STRONG_Z > 2, "a plain 2-sigma bar would flag ~1.5 slots by luck every load");
  // 2.2 sigma: real by the textbook bar, still only "leaning" here.
  const total = 100;
  const up = Math.round(total / 2 + (2.2 * Math.sqrt(0.25 * total)));
  assert.equal(directionVerdict(up, total).confidence, "leaning");
});

test("a genuinely lopsided sample does clear the bar", () => {
  const v = directionVerdict(45, 60); // 75%
  assert.equal(v.bias, "up");
  assert.equal(v.confidence, "reliable");
});

test("below the minimum session count there is no verdict at all", () => {
  const v = directionVerdict(MIN_SESSIONS_FOR_VERDICT - 1, MIN_SESSIONS_FOR_VERDICT - 1);
  assert.equal(v.confidence, "insufficient", "100% of 9 sessions is still not evidence");
  assert.equal(v.bias, "coin_flip");
});

test("the z-score is signed the way the labels read", () => {
  assert.ok(directionZ(80, 100) > 0);
  assert.ok(directionZ(20, 100) < 0);
  assert.equal(directionZ(50, 100), 0);
  assert.equal(directionZ(0, 0), 0, "an empty sample must not divide by zero");
});

// ---- Profile building ----

test("the loud slot is ranked first and scored against the typical half hour", () => {
  const profile = buildTimeProfile(buildSlotSessions(syntheticDays(30, { loudAt: "21:00", loudRange: 4 })));
  const loud = profile.slots.find((s) => s.key === "21:00")!;
  const quietOne = profile.slots.find((s) => s.key === "14:00")!;
  assert.equal(loud.rangeRank, 1);
  assert.ok(Math.abs(loud.movementIndex - 4) < 0.01, `expected ~4x typical, got ${loud.movementIndex}`);
  assert.ok(Math.abs(quietOne.movementIndex - 1) < 0.01);
  assert.equal(profile.sessionsAnalyzed, 30);
});

test("the typical-range yardstick ignores slots with too little history", () => {
  // One day carries an extra, near-dead slot; it must not drag the yardstick
  // down and make every other slot look explosive.
  const candles = syntheticDays(30, { loudAt: "21:00" });
  candles.push(bar("2026-09-11", "09:30", 100, 100.001, 99.999, 100));
  const profile = buildTimeProfile(buildSlotSessions(candles));
  assert.ok(profile.typicalRangePct > 0.9 && profile.typicalRangePct < 1.1, `yardstick skewed to ${profile.typicalRangePct}`);
});

test("an unbiased loud slot reports big movement but no direction", () => {
  // Alternating up/down days: real movement, zero directional edge.
  const profile = buildTimeProfile(buildSlotSessions(syntheticDays(30, { loudAt: "21:00", drift: (d) => (d % 2 === 0 ? 1 : -1) })));
  const loud = profile.slots.find((s) => s.key === "21:00")!;
  assert.ok(loud.movementIndex > 2, "movement should still register");
  assert.equal(loud.bias, "coin_flip");
  assert.equal(loud.upRatePct, 50);
});

test("best and quiet windows both require enough sessions to be named", () => {
  const profile = buildTimeProfile(buildSlotSessions(syntheticDays(30, { loudAt: "21:00" })));
  assert.equal(bestWindows(profile, 3)[0].key, "21:00");
  assert.ok(bestWindows(profile).every((s) => s.sessions >= MIN_SESSIONS_FOR_VERDICT));
  assert.ok(quietWindows(profile).every((s) => s.sessions >= MIN_SESSIONS_FOR_VERDICT && s.avgRangePct > 0));
});

test("an empty history produces an empty profile rather than throwing", () => {
  const profile = buildTimeProfile([]);
  assert.equal(profile.sessionsAnalyzed, 0);
  assert.equal(profile.firstDate, null);
  assert.equal(profile.typicalRangePct, 0);
  assert.ok(profile.slots.every((s) => s.sessions === 0 && s.movementIndex === 0));
});

// ---- How far it goes each way, and what the candle before says ----

test("up and down reach are measured separately, not collapsed into one range", () => {
  // Opens 100, runs to 101 but only dips to 99.5: the swing is NOT symmetric,
  // and a single 1.5% range number would hide that completely.
  const rows = buildSlotSessions(Array.from({ length: 20 }, (_, i) =>
    bar(`2026-06-${String(i + 1).padStart(2, "0")}`, "17:30", 100, 101, 99.5, 100.4)
  ));
  const slot = buildTimeProfile(rows).slots.find((s) => s.key === "17:30")!;
  assert.ok(Math.abs(slot.avgUpReachPct - 1) < 0.001, `up reach ${slot.avgUpReachPct}`);
  assert.ok(Math.abs(slot.avgDownReachPct - 0.5) < 0.001, `down reach ${slot.avgDownReachPct}`);
  assert.ok(Math.abs(slot.avgRangePct - 1.5) < 0.001, "the range is still the sum of both sides");
});

test("gain and loss sizes are averaged only over the days that actually went that way", () => {
  const rows = buildSlotSessions([
    ...Array.from({ length: 12 }, (_, i) => bar(`2026-06-${String(i + 1).padStart(2, "0")}`, "17:30", 100, 103, 97, 102)),
    ...Array.from({ length: 8 }, (_, i) => bar(`2026-06-${String(i + 13).padStart(2, "0")}`, "17:30", 100, 103, 97, 99)),
  ]);
  const slot = buildTimeProfile(rows).slots.find((s) => s.key === "17:30")!;
  assert.equal(slot.upDays, 12);
  assert.equal(slot.downDays, 8);
  assert.ok(Math.abs(slot.avgGainPct - 2) < 0.001, "green days gained 2%");
  assert.ok(Math.abs(slot.avgLossPct - 1) < 0.001, "red days lost 1%, reported as a positive size");
});

test("a slot that never trades reports zeros rather than NaN", () => {
  const slot = buildTimeProfile([]).slots[0];
  assert.equal(slot.avgUpReachPct, 0);
  assert.equal(slot.avgGainPct, 0);
  assert.equal(slot.avgLossPct, 0);
});

/** Builds days where slot `at` follows the previous slot's colour, or flips it. */
function prevLinkDays(n: number, at: string, mode: "continue" | "reverse" | "random"): Candle[] {
  const atMin = Number(at.slice(0, 2)) * 60 + Number(at.slice(3));
  const out: Candle[] = [];
  for (let d = 0; d < n; d++) {
    const date = `2026-06-${String((d % 28) + 1).padStart(2, "0")}`;
    const prevGreen = d % 2 === 0;
    for (let m = SESSION_START_MIN; m < SESSION_END_MIN; m += SLOT_MINUTES) {
      const hh = String(Math.floor(m / 60)).padStart(2, "0");
      const mm = String(m % 60).padStart(2, "0");
      let close = 100;
      if (m === atMin - SLOT_MINUTES) close = prevGreen ? 101 : 99;
      if (m === atMin) {
        if (mode === "continue") close = prevGreen ? 101 : 99;
        else if (mode === "reverse") close = prevGreen ? 99 : 101;
        else close = d % 4 < 2 ? 101 : 99; // unrelated to the previous candle
      }
      out.push(bar(date, `${hh}:${mm}`, 100, 102, 98, close));
    }
  }
  return out;
}

test("a slot that follows the candle before it is reported as continuing", () => {
  const link = buildTimeProfile(buildSlotSessions(prevLinkDays(40, "18:00", "continue"))).prevLinks.find((l) => l.key === "18:00")!;
  assert.equal(link.prevKey, "17:30");
  assert.equal(link.verdict, "continues");
  assert.equal(link.afterGreen.upRatePct, 100);
  assert.equal(link.afterRed.upRatePct, 0);
  assert.match(link.summary, /tends to carry on/);
});

test("a slot that flips against the candle before it is reported as reversing", () => {
  const link = buildTimeProfile(buildSlotSessions(prevLinkDays(40, "18:00", "reverse"))).prevLinks.find((l) => l.key === "18:00")!;
  assert.equal(link.verdict, "reverses");
  assert.equal(link.afterGreen.upRatePct, 0);
  assert.equal(link.afterRed.upRatePct, 100);
  assert.match(link.summary, /tends to flip/);
});

test("when the candle before makes no difference, the page says so instead of inventing a link", () => {
  const link = buildTimeProfile(buildSlotSessions(prevLinkDays(60, "18:00", "random"))).prevLinks.find((l) => l.key === "18:00")!;
  assert.equal(link.verdict, "none");
  assert.match(link.summary, /no real difference/);
});

test("the previous-candle check needs enough days on BOTH sides before it answers", () => {
  const link = buildTimeProfile(buildSlotSessions(prevLinkDays(8, "18:00", "continue"))).prevLinks.find((l) => l.key === "18:00")!;
  assert.equal(link.verdict, "insufficient");
  assert.match(link.summary, /Not enough days to compare/);
});

test("the first slot of the session has no candle before it, so it gets no link", () => {
  const links = buildTimeProfile(buildSlotSessions(syntheticDays(30))).prevLinks;
  assert.ok(!links.some((l) => l.startMin === SESSION_START_MIN), "9:00 AM cannot have a previous half hour");
  assert.ok(links.some((l) => l.key === "09:30"));
});

test("a flat previous candle counts as neither green nor red", () => {
  // Every previous candle closes exactly at its open, so both buckets are empty.
  const candles: Candle[] = [];
  for (let d = 0; d < 30; d++) {
    const date = `2026-06-${String(d + 1).padStart(2, "0")}`;
    candles.push(bar(date, "17:30", 100, 101, 99, 100));
    candles.push(bar(date, "18:00", 100, 101, 99, 101));
  }
  const link = buildTimeProfile(buildSlotSessions(candles)).prevLinks.find((l) => l.key === "18:00")!;
  assert.equal(link.afterGreen.sessions, 0);
  assert.equal(link.afterRed.sessions, 0);
  assert.equal(link.verdict, "insufficient");
});

// ---- Plain language ----

test("the words on screen match the maths behind them", () => {
  assert.equal(plainDirection("up", "reliable"), "Usually goes UP");
  assert.equal(plainDirection("down", "reliable"), "Usually goes DOWN");
  assert.match(plainDirection("down", "leaning"), /not always/);
  assert.match(plainDirection("coin_flip", "coin_flip"), /50\/50/);
  assert.match(plainDirection("coin_flip", "insufficient"), /Not enough days/);
  // No jargon survives into the user-facing strings.
  for (const b of ["up", "down", "coin_flip"] as const) {
    for (const c of ["reliable", "leaning", "coin_flip", "insufficient"] as const) {
      assert.doesNotMatch(plainDirection(b, c), /sigma|z-score|significan|edge|bias/i);
    }
  }
});

test("busyness reads as words, and the multiple reads either way round", () => {
  assert.equal(plainBusyness(2), "Very busy");
  assert.equal(plainBusyness(1.3), "Busy");
  assert.equal(plainBusyness(1), "Normal");
  assert.equal(plainBusyness(0.5), "Quiet");
  assert.equal(plainBusyness(0), "No data");
  assert.match(plainMultiple(1.9), /1\.9× the normal half hour/);
  assert.match(plainMultiple(0.5), /2\.0× quieter than normal/);
  assert.match(plainMultiple(1), /About the same/);
});

// ---- Live window ----

const AT = (istHour: number, istMin = 0) => Date.UTC(2026, 8, 11, istHour - 5, istMin - 30);

test("the live window names the slot you are actually in", () => {
  const profile = buildTimeProfile(buildSlotSessions(syntheticDays(30, { loudAt: "21:00" })));
  const live = liveWindow(profile, AT(21, 12));
  assert.equal(live.inSession, true);
  assert.equal(live.current?.key, "21:00");
  assert.equal(live.minutesIntoSlot, 12);
  assert.equal(live.next?.key, "21:30");
});

test("outside the session nothing is claimed about a current slot", () => {
  const profile = buildTimeProfile(buildSlotSessions(syntheticDays(30, { loudAt: "21:00" })));
  const live = liveWindow(profile, AT(3));
  assert.equal(live.inSession, false);
  assert.equal(live.current, null);
  assert.equal(live.next, null);
});

test("the next active window looks forward only, and only at real movers", () => {
  const profile = buildTimeProfile(buildSlotSessions(syntheticDays(30, { loudAt: "21:00" })));
  const before = liveWindow(profile, AT(14));
  assert.equal(before.nextBigMover?.key, "21:00");
  assert.equal(before.minutesToBigMover, 7 * 60);
  const after = liveWindow(profile, AT(22));
  assert.equal(after.nextBigMover, null, "a window already passed is not 'next'");
});

test("IST minutes-now converts from a UTC clock correctly", () => {
  assert.equal(istMinutesNow(AT(21, 30)), 21 * 60 + 30);
});

// ---- Claim testing: the point of the page ----

test("a claim with too little history says so instead of guessing", () => {
  const profile = buildTimeProfile(buildSlotSessions(syntheticDays(4)));
  const claims = testClaims(profile, buildSlotSessions(syntheticDays(4)), []);
  assert.ok(claims.every((c) => c.verdict === "insufficient"), claims.map((c) => `${c.id}:${c.verdict}`).join(", "));
});

test("a movement claim is supported only when the window genuinely stands out", () => {
  const loud = buildSlotSessions(syntheticDays(30, { loudAt: "21:00", loudRange: 4 }));
  const supported = testClaims(buildTimeProfile(loud), loud, []).find((c) => c.id === "nine-to-ten")!;
  assert.equal(supported.verdict, "supported");
  assert.match(supported.finding, /Yes\./);

  // Same claim, flat day: it must come back "no".
  const flat = buildSlotSessions(syntheticDays(30));
  const denied = testClaims(buildTimeProfile(flat), flat, []).find((c) => c.id === "nine-to-ten")!;
  assert.equal(denied.verdict, "not_supported");
  assert.match(denied.finding, /Not in this data/);
});

test("the conditional 5 PM to 6 PM fade is tested on the conditioned sample, not the whole one", () => {
  // 30 sessions, but only the even-numbered ones have an up 5-6 PM. Of those,
  // every one fades afterwards -- so the claim is true AND the sample is 15.
  const candles: Candle[] = [];
  for (let d = 0; d < 30; d++) {
    const date = `2026-06-${String(d + 1).padStart(2, "0")}`;
    const eveningUp = d % 2 === 0;
    for (let m = SESSION_START_MIN; m < SESSION_END_MIN; m += SLOT_MINUTES) {
      const hh = String(Math.floor(m / 60)).padStart(2, "0");
      const mm = String(m % 60).padStart(2, "0");
      let close = 100;
      if (m >= 17 * 60 && m < 18 * 60) close = eveningUp ? 101 : 99;
      if (m === 18 * 60) close = eveningUp ? 99 : 101; // fade after an up evening
      candles.push(bar(date, `${hh}:${mm}`, 100, 102, 98, close));
    }
  }
  const result = conditionalFadeClaim(buildSlotSessions(candles), "claim");
  assert.equal(result.sessions, 15, "only the up-evening days count");
  assert.equal(result.verdict, "supported");
  assert.match(result.caveat ?? "", /halves the sample/);
});

test("a fade that happens half the time is called a coin flip, not a rule", () => {
  const candles: Candle[] = [];
  for (let d = 0; d < 40; d++) {
    const date = `2026-06-${String((d % 28) + 1).padStart(2, "0")}`;
    for (let m = SESSION_START_MIN; m < SESSION_END_MIN; m += SLOT_MINUTES) {
      const hh = String(Math.floor(m / 60)).padStart(2, "0");
      const mm = String(m % 60).padStart(2, "0");
      let close = 100;
      if (m >= 17 * 60 && m < 18 * 60) close = 101; // every evening up
      if (m === 18 * 60) close = d % 2 === 0 ? 99 : 101; // fades half the time
      candles.push(bar(date, `${hh}:${mm}`, 100, 102, 98, close));
    }
  }
  const result = conditionalFadeClaim(buildSlotSessions(candles), "claim");
  assert.equal(result.verdict, "not_supported");
  assert.match(result.finding, /coin flip/);
});

test("gap continuation only counts sessions that actually gapped", () => {
  const gaps = [
    ...Array.from({ length: 20 }, (_, i) => ({ date: `d${i}`, gapPct: 1, movePct: 1 })),
    // Flat opens tell you nothing about continuation and must be excluded.
    ...Array.from({ length: 40 }, (_, i) => ({ date: `f${i}`, gapPct: 0.05, movePct: -2 })),
  ];
  const result = gapContinuationClaim(gaps, "claim");
  assert.equal(result.sessions, 20);
  assert.equal(result.verdict, "supported");
  assert.match(result.caveat ?? "", /does not test whether WTI caused the gap/);
});

test("gap continuation reports the honest answer when fading was as good as following", () => {
  const gaps = Array.from({ length: 40 }, (_, i) => ({ date: `d${i}`, gapPct: 1, movePct: i % 2 === 0 ? 1 : -1 }));
  const result = gapContinuationClaim(gaps, "claim");
  assert.equal(result.verdict, "not_supported");
  assert.match(result.finding, /fading the gap was as good as following/);
});

// ---- EIA release timing: the DST trap ----

test("US Eastern offset is resolved from the calendar, not assumed", () => {
  // July: EDT, UTC-4. January: EST, UTC-5.
  assert.equal(tzOffsetMinutes("America/New_York", Date.UTC(2026, 6, 15, 12)), -240);
  assert.equal(tzOffsetMinutes("America/New_York", Date.UTC(2026, 0, 15, 12)), -300);
});

test("10:30 AM Eastern lands at 8 PM IST in summer and 9 PM IST in winter", () => {
  const summer = easternToInstant(2026, 6, 15, 10, 30); // July
  const winter = easternToInstant(2026, 0, 15, 10, 30); // January
  assert.equal(new Date(summer).toISOString(), "2026-07-15T14:30:00.000Z");
  assert.equal(new Date(winter).toISOString(), "2026-01-15T15:30:00.000Z");
  assert.equal(istSlotOf(summer), 20 * 60, "8:00 PM IST");
  assert.equal(istSlotOf(winter), 21 * 60, "9:00 PM IST");
});

test("the next EIA releases fall on the right Eastern weekdays and are in the future", () => {
  const now = Date.UTC(2026, 8, 14, 6, 0);
  const [crude, storage] = scheduledEvents(now);
  const etDay = (iso: string) => new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short" }).format(new Date(iso));
  assert.equal(etDay(crude.atIso), "Wed");
  assert.equal(etDay(storage.atIso), "Thu");
  assert.ok(new Date(crude.atIso).getTime() > now);
  assert.ok(new Date(storage.atIso).getTime() > now);
  assert.equal(crude.affects, "CRUDEOIL");
  assert.equal(storage.affects, "NATURALGAS");
});

test("a release profile refuses to describe 'what usually happens' from a handful of releases", () => {
  const sessions: SlotSession[] = Array.from({ length: 4 }, (_, i) => ({
    date: `2026-09-${String(2 + i * 7).padStart(2, "0")}`, startMin: 20 * 60, open: 100, high: 105, low: 95, close: 103, volume: 10,
  }));
  const event = scheduledEvents(Date.UTC(2026, 8, 14))[1];
  const profile = eventProfile(sessions, { ...event, slotStartMin: 20 * 60 }, 3);
  assert.equal(profile.verdict, "insufficient");
  assert.match(profile.note, /nowhere near enough/);
});

test("a release half hour that really is louder is reported with its multiple and no direction claim", () => {
  // Twelve weeks of real calendar dates. The release weekday is derived the
  // same way eventProfile derives it, rather than assumed from an index.
  const sessions: SlotSession[] = [];
  for (let i = 0; i < 84; i++) {
    const d = new Date(Date.UTC(2026, 5, 1) + i * 86_400_000);
    const weekday = d.getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    const date = d.toISOString().slice(0, 10);
    const loud = weekday === 3; // Wednesday = the crude release day
    sessions.push({ date, startMin: 20 * 60, open: 100, high: loud ? 103 : 100.5, low: loud ? 97 : 99.5, close: loud ? 102 : 100.1, volume: 10 });
  }
  const event = scheduledEvents(Date.UTC(2026, 8, 14))[0];
  const profile = eventProfile(sessions, { ...event, slotStartMin: 20 * 60 }, 3);
  assert.equal(profile.verdict, "louder");
  assert.ok(profile.multiple >= 1.3, `expected a clear multiple, got ${profile.multiple}`);
  assert.match(profile.note, /says nothing about WHICH way it goes/);
});
