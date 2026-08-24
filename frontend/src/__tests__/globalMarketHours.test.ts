import { test } from "node:test";
import assert from "node:assert/strict";
import { cmeEnergyOpen, globalEnergyVenues, moveDirection, aggregateBias } from "../utils/globalMarketHours";

test("moveDirection: neutral band around zero, else bullish/bearish", () => {
  assert.equal(moveDirection(0.05), "neutral"); // chop
  assert.equal(moveDirection(-0.1), "neutral");
  assert.equal(moveDirection(0.9), "bullish");
  assert.equal(moveDirection(-1.6), "bearish");
  assert.equal(moveDirection(null), "neutral");
});

test("aggregateBias averages the crude read (WTI + Brent)", () => {
  const b = aggregateBias([-1.4, -1.6]); // both down -> bearish
  assert.equal(b.dir, "bearish");
  assert.equal(b.avgPct, -1.5);
  assert.equal(aggregateBias([null, undefined]).avgPct, null);
});


// Build a Date at a specific US Eastern wall-clock moment by searching for the
// UTC instant whose America/New_York rendering matches. Simpler: use known
// fixed UTC instants and reason about their ET rendering.
// 2026-08-23 is a Sunday. ET is EDT (UTC-4) in August.
const utc = (iso: string) => new Date(iso);

test("CME energy is CLOSED early Sunday (before 6pm ET)", () => {
  // 2026-08-23 01:00 UTC = Sat 21:00 ET -> weekend closed
  assert.equal(cmeEnergyOpen(utc("2026-08-23T01:00:00Z")), false);
  // Sunday 20:00 UTC = 16:00 ET (before the 6pm reopen) -> still closed
  assert.equal(cmeEnergyOpen(utc("2026-08-23T20:00:00Z")), false);
});

test("CME energy REOPENS Sunday evening ET", () => {
  // Sunday 2026-08-23 23:00 UTC = 19:00 ET (after 6pm reopen) -> open
  assert.equal(cmeEnergyOpen(utc("2026-08-23T23:00:00Z")), true);
});

test("CME energy is OPEN mid-week outside the daily halt", () => {
  // Wed 2026-08-26 15:00 UTC = 11:00 ET -> open
  assert.equal(cmeEnergyOpen(utc("2026-08-26T15:00:00Z")), true);
});

test("CME energy is CLOSED during the daily 5-6pm ET maintenance halt", () => {
  // Wed 2026-08-26 21:30 UTC = 17:30 ET -> inside the halt -> closed
  assert.equal(cmeEnergyOpen(utc("2026-08-26T21:30:00Z")), false);
});

test("CME energy is CLOSED for the weekend after 5pm ET Friday", () => {
  // Fri 2026-08-28 21:30 UTC = 17:30 ET -> weekend close begun
  assert.equal(cmeEnergyOpen(utc("2026-08-28T21:30:00Z")), false);
  // Saturday any time -> closed
  assert.equal(cmeEnergyOpen(utc("2026-08-29T15:00:00Z")), false);
});

test("the venue list marks NYMEX/ICE open even when MCX is passed closed", () => {
  // Sunday 23:00 UTC = early Monday IST (~4:30am) -> MCX closed, CME open.
  const venues = globalEnergyVenues(utc("2026-08-23T23:00:00Z"), false);
  const mcx = venues.find((v) => v.id === "mcx");
  const nymex = venues.find((v) => v.id === "nymex-cl");
  assert.equal(mcx?.open, false);
  assert.equal(nymex?.open, true);
  assert.equal(venues.length, 4);
});
