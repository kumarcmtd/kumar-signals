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

// ---------------------------------------------------------------------------
// Fast IST day keys: must equal the Intl-based code they replaced, exactly.
// ---------------------------------------------------------------------------
import { istDayNumber, sessionDayNumber, dayNumberToKey, lastRunStart } from "../utils/mcxSession";
import { sessionDayKey } from "../utils/tradeLogStats";

// The implementations these replaced, kept verbatim as the reference.
const OLD_IST_DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" });
const OLD_IST_FMT = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false });
function oldSessionDayKey(ts: number): string {
  const map: Record<string, string> = {};
  for (const p of OLD_IST_FMT.formatToParts(ts)) map[p.type] = p.value;
  const year = parseInt(map.year, 10), month = parseInt(map.month, 10), day = parseInt(map.day, 10);
  let hour = parseInt(map.hour, 10);
  if (hour === 24) hour = 0;
  if (hour < 9) {
    const prev = new Date(Date.UTC(year, month - 1, day));
    prev.setUTCDate(prev.getUTCDate() - 1);
    return prev.toISOString().slice(0, 10);
  }
  return `${map.year}-${map.month}-${map.day}`;
}

test("arithmetic IST day equals the Intl formatter on 50,000 random instants", () => {
  let seed = 3;
  for (let i = 0; i < 50_000; i += 1) {
    seed = (seed * 16807) % 2147483647;
    const ms = Date.UTC(2020, 0, 1) + (seed / 2147483647) * 10 * 365 * 86_400_000;
    assert.equal(dayNumberToKey(istDayNumber(ms)), OLD_IST_DATE.format(new Date(ms)));
    assert.equal(sessionDayKey(ms), oldSessionDayKey(ms));
  }
});

test("the boundaries are exact: midnight IST and the 09:00 session cut", () => {
  const at = (s: string) => new Date(s).getTime();
  assert.equal(sessionDayKey(at("2026-09-24T08:59:59.999+05:30")), "2026-09-23");
  assert.equal(sessionDayKey(at("2026-09-24T09:00:00+05:30")), "2026-09-24");
  assert.equal(dayNumberToKey(istDayNumber(at("2026-09-23T23:59:59.999+05:30"))), "2026-09-23");
  assert.equal(dayNumberToKey(istDayNumber(at("2026-09-24T00:00:00+05:30"))), "2026-09-24");
  assert.equal(sessionDayKey(at("2026-09-24T09:00:00+05:30")), oldSessionDayKey(at("2026-09-24T09:00:00+05:30")));
});

test("backward scan finds the same session start as the old forward Intl scan", () => {
  // 14 days of 15-minute bars, 09:00-23:30, plus a partial last day.
  const bars: { date: string }[] = [];
  for (let d = 1; d <= 15; d += 1) {
    if ([6, 7, 13, 14].includes(d)) continue; // weekends
    const end = d === 15 ? 12 * 60 : 23 * 60 + 30;
    for (let m = 9 * 60; m < end; m += 15) bars.push({ date: `2026-09-${String(d).padStart(2, "0")}T${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}:00+05:30` });
  }
  const ms = (b: { date: string }) => new Date(b.date).getTime();
  const lastDay = OLD_IST_DATE.format(new Date(bars[bars.length - 1].date));
  const oldIdx = bars.findIndex((c) => OLD_IST_DATE.format(new Date(c.date)) === lastDay);
  assert.equal(lastRunStart(bars, (b) => istDayNumber(ms(b))), oldIdx);
  const lastKey = oldSessionDayKey(ms(bars[bars.length - 1]));
  const oldSessionIdx = bars.findIndex((c) => oldSessionDayKey(ms(c)) === lastKey);
  assert.equal(lastRunStart(bars, (b) => sessionDayNumber(ms(b))), oldSessionIdx);
});

test("lastRunStart handles empty and single-day input", () => {
  assert.equal(lastRunStart([], () => 0), -1);
  assert.equal(lastRunStart([1, 1, 1], (x) => x), 0);
});
