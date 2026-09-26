import { test } from "vitest";
import assert from "node:assert/strict";
import {
  usDstForSession, mcxCloseMinutes, mcxSessionAt, lastMcxClose, expiryStillLive, closeLabel,
  CLOSE_US_DST_MIN, CLOSE_US_STD_MIN, istParts,
} from "../utils/mcxSession";

/** An IST wall-clock instant. */
function ist(date: string, hhmm: string): number {
  return new Date(`${date}T${hhmm}:00+05:30`).getTime();
}

// ---------------------------------------------------------------------------
// DST-aware close
// ---------------------------------------------------------------------------

test("2026: the late 23:55 close starts on Monday 2 November", () => {
  assert.equal(usDstForSession(2026, 10, 30), true, "Friday 30 Oct is still US daylight time");
  assert.equal(mcxCloseMinutes(2026, 10, 30), CLOSE_US_DST_MIN);
  assert.equal(usDstForSession(2026, 11, 2), false, "Monday 2 Nov follows the 1 Nov switch");
  assert.equal(mcxCloseMinutes(2026, 11, 2), CLOSE_US_STD_MIN);
});

test("2026: the early 23:30 close returns on Monday 9 March", () => {
  // US DST starts on the second Sunday of March: 8 March 2026.
  assert.equal(mcxCloseMinutes(2026, 3, 6), CLOSE_US_STD_MIN, "Friday 6 Mar is still standard time");
  assert.equal(mcxCloseMinutes(2026, 3, 9), CLOSE_US_DST_MIN, "Monday 9 Mar is daylight time");
});

test("the rule holds in other years, not just 2026", () => {
  // 2027: DST 14 Mar - 7 Nov.
  assert.equal(mcxCloseMinutes(2027, 3, 12), CLOSE_US_STD_MIN);
  assert.equal(mcxCloseMinutes(2027, 3, 15), CLOSE_US_DST_MIN);
  assert.equal(mcxCloseMinutes(2027, 11, 5), CLOSE_US_DST_MIN);
  assert.equal(mcxCloseMinutes(2027, 11, 8), CLOSE_US_STD_MIN);
  assert.equal(mcxCloseMinutes(2027, 1, 15), CLOSE_US_STD_MIN, "January is always standard time");
  assert.equal(mcxCloseMinutes(2027, 7, 15), CLOSE_US_DST_MIN, "July is always daylight time");
});

test("closeLabel renders the close the way a person reads it", () => {
  assert.equal(closeLabel(CLOSE_US_DST_MIN), "11:30 PM");
  assert.equal(closeLabel(CLOSE_US_STD_MIN), "11:55 PM");
});

// ---------------------------------------------------------------------------
// Open / closed
// ---------------------------------------------------------------------------

test("the 23:30-23:55 window is open in winter and shut in summer", () => {
  // The exact disagreement five separate constants used to have.
  assert.equal(mcxSessionAt(ist("2026-09-24", "23:40")).isOpen, false, "September: US on DST, MCX shut at 23:30");
  assert.equal(mcxSessionAt(ist("2026-11-04", "23:40")).isOpen, true, "November: US on standard time, MCX open to 23:55");
  assert.equal(mcxSessionAt(ist("2026-11-04", "23:55")).isOpen, false, "the close minute itself is shut");
});

test("open at 09:00, pre-open from 08:30, shut all weekend", () => {
  assert.equal(mcxSessionAt(ist("2026-09-24", "09:00")).isOpen, true);
  assert.equal(mcxSessionAt(ist("2026-09-24", "08:59")).isOpen, false);
  assert.equal(mcxSessionAt(ist("2026-09-24", "08:45")).isPreOpen, true);
  assert.equal(mcxSessionAt(ist("2026-09-26", "12:00")).isOpen, false, "Saturday");
  assert.equal(mcxSessionAt(ist("2026-09-27", "12:00")).isOpen, false, "Sunday");
});

test("IST parts are computed without the host's timezone", () => {
  // 18:00 UTC is 23:30 IST -- a UTC-hosted Worker must still read 23:30.
  const p = istParts(Date.UTC(2026, 8, 24, 18, 0));
  assert.equal(p.minutes, 23 * 60 + 30);
  assert.equal(p.date, "2026-09-24");
});

// ---------------------------------------------------------------------------
// Last close (what the EOD force-close keys off)
// ---------------------------------------------------------------------------

test("after tonight's close, the last close is tonight's", () => {
  const r = lastMcxClose(ist("2026-09-24", "23:45"));
  assert.equal(r.date, "2026-09-24");
  assert.equal(r.closeAt, ist("2026-09-24", "23:30"));
});

test("during the session, the last close is yesterday's", () => {
  assert.equal(lastMcxClose(ist("2026-09-24", "14:00")).date, "2026-09-23");
});

test("on Saturday and on Monday morning, the last close is Friday's", () => {
  assert.equal(lastMcxClose(ist("2026-09-26", "10:00")).date, "2026-09-25");
  assert.equal(lastMcxClose(ist("2026-09-28", "10:00")).date, "2026-09-25");
});

test("the winter close is 23:55, so 23:40 in November is still before it", () => {
  assert.equal(lastMcxClose(ist("2026-11-04", "23:40")).date, "2026-11-03");
  assert.equal(lastMcxClose(ist("2026-11-04", "23:56")).date, "2026-11-04");
});

// ---------------------------------------------------------------------------
// Expiry day
// ---------------------------------------------------------------------------

test("an expiry is still live all through its own expiry day", () => {
  // The old `+new Date(e) >= now` parsed "2026-10-15" as 05:30 IST and dropped
  // the contract from breakfast time on the day it was still trading.
  assert.equal(expiryStillLive("2026-10-15", ist("2026-10-15", "05:31")), true);
  assert.equal(expiryStillLive("2026-10-15", ist("2026-10-15", "14:00")), true);
  assert.equal(expiryStillLive("2026-10-15", ist("2026-10-15", "23:29")), true);
});

test("an expiry stops being live at that day's close, DST-aware", () => {
  assert.equal(expiryStillLive("2026-10-15", ist("2026-10-15", "23:30")), false, "October closes at 23:30");
  assert.equal(expiryStillLive("2026-11-17", ist("2026-11-17", "23:40")), true, "November still trading at 23:40");
  assert.equal(expiryStillLive("2026-11-17", ist("2026-11-17", "23:55")), false);
});

test("a past expiry is not live, a future one is", () => {
  assert.equal(expiryStillLive("2026-09-18", ist("2026-09-24", "10:00")), false);
  assert.equal(expiryStillLive("2026-10-15", ist("2026-09-24", "10:00")), true);
});
