import { test } from "node:test";
import assert from "node:assert/strict";
import { mcxClosesSince, readAnchorFreshness } from "../utils/overnightAnchor";

/** An IST wall-clock instant, written the way a trader would say it. */
function ist(date: string, hhmm: string): number {
  return new Date(`${date}T${hhmm}:00+05:30`).getTime();
}

// 2026-09-21 is a Monday, so 21-25 Sep are Mon-Fri and 26/27 are Sat/Sun.

test("an anchor taken tonight is current tomorrow morning", () => {
  const taken = ist("2026-09-23", "23:32");
  const now = ist("2026-09-24", "09:30");
  assert.equal(mcxClosesSince(taken, now), 0);
  assert.equal(readAnchorFreshness(new Date(taken).toISOString(), now).current, true);
});

test("an anchor is still current right up to the next close", () => {
  const taken = ist("2026-09-23", "23:32");
  assert.equal(mcxClosesSince(taken, ist("2026-09-24", "23:29")), 0);
});

test("once the next close passes, the anchor is no longer last night's", () => {
  const taken = ist("2026-09-23", "23:32");
  assert.equal(mcxClosesSince(taken, ist("2026-09-24", "23:31")), 1);
});

// The case this module exists for.
test("a night where the snapshot failed is caught the morning after", () => {
  // Taken Tuesday night; Wednesday night's snapshot never wrote.
  const taken = ist("2026-09-22", "23:32");
  const now = ist("2026-09-24", "09:30");
  assert.equal(mcxClosesSince(taken, now), 1, "Wednesday's 23:30 close happened in between");
  const f = readAnchorFreshness(new Date(taken).toISOString(), now);
  assert.equal(f.current, false);
  assert.match(f.warning!, /span more than one night/i);
  assert.match(f.warning!, /holidays/i, "a market holiday is the other honest explanation");
});

// The case a naive age-in-hours check would get WRONG.
test("Friday's anchor is still current on Monday morning", () => {
  // MCX does not close on Saturday or Sunday, so Friday 23:30 IS the most
  // recent close -- even though the snapshot is ~58 hours old by Monday.
  const taken = ist("2026-09-25", "23:32"); // Friday
  const now = ist("2026-09-28", "09:30"); // Monday
  const ageHours = (now - taken) / 3_600_000;
  assert.ok(ageHours > 50, `this is a genuinely old snapshot (${ageHours.toFixed(0)}h) that is nonetheless correct`);
  assert.equal(mcxClosesSince(taken, now), 0);
  assert.equal(readAnchorFreshness(new Date(taken).toISOString(), now).current, true);
});

test("by Monday night's close, Friday's anchor has gone stale", () => {
  const taken = ist("2026-09-25", "23:32");
  assert.equal(mcxClosesSince(taken, ist("2026-09-28", "23:35")), 1);
});

test("a whole missed week counts every weekday close", () => {
  const taken = ist("2026-09-21", "23:32"); // Monday night
  const now = ist("2026-09-26", "09:30"); // Saturday morning
  // Tue, Wed, Thu, Fri closes all passed.
  assert.equal(mcxClosesSince(taken, now), 4);
});

test("time going backwards or standing still reports nothing rather than throwing", () => {
  const taken = ist("2026-09-23", "23:32");
  assert.equal(mcxClosesSince(taken, taken), 0);
  assert.equal(mcxClosesSince(taken, taken - 86_400_000), 0);
});

test("a missing or unreadable timestamp is reported, never guessed at", () => {
  assert.equal(readAnchorFreshness(null).current, false);
  assert.equal(readAnchorFreshness(null).warning, null, "no anchor at all is the card's own case, not a staleness warning");

  const bad = readAnchorFreshness("not-a-date");
  assert.equal(bad.current, false);
  assert.match(bad.warning!, /unreadable/i);
});

test("a corrupt far-past timestamp is bounded rather than looping", () => {
  const f = readAnchorFreshness("1999-01-01T00:00:00.000Z", ist("2026-09-24", "09:30"));
  assert.equal(f.current, false);
  assert.ok(f.missedCloses > 0);
});
