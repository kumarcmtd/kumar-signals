import { test } from "node:test";
import assert from "node:assert/strict";
import { canIBuyNow, type BuyCheckInput } from "../utils/canIBuyNow";

/** A clean, everything-passing setup. Individual tests break one thing. */
function base(over: Partial<BuyCheckInput> = {}): BuyCheckInput {
  return {
    livePremium: 1035.1,
    signalEntry: 1035.1,
    stop: 1023.1,
    targets: [1055.1, 1067.1, 1080.1],
    lotSize: 100,
    marketOpen: true,
    timingTier: "good",
    conflict: false,
    netScore: -45,
    optSide: "PE",
    premiumSwingPerCandle: 5,
    istHour: 20,
    signalAgeMinutes: 10,
    ...over,
  };
}

test("a clean setup answers yes and prints the plan", () => {
  const a = canIBuyNow(base());
  assert.equal(a.verdict, "yes");
  assert.ok(a.plan);
  assert.equal(a.plan!.entry, 1035.1);
  assert.equal(a.plan!.stop, 1023.1);
  assert.equal(a.plan!.target, 1055.1);
});

test("risk and reward are in rupees, from the LIVE price not the original entry", () => {
  // The signal itself was created at 1037, so this is on time -- the point
  // here is only that the maths uses the live price, not a stale one.
  const a = canIBuyNow(base({ livePremium: 1037, signalEntry: 1037 }));
  // (1037 - 1023.1) * 100 = 1390 risked; (1055.1 - 1037) * 100 = 1810 to make.
  assert.equal(a.plan!.riskPerLot, 1390);
  assert.equal(a.plan!.rewardPerLot, 1810);
  assert.equal(a.plan!.riskReward, 1.3);
});

// The whole reason this exists.
test("THE SCREENSHOT CASE: a flagged conflict can no longer read as buy", () => {
  const a = canIBuyNow(base({ conflict: true }));
  assert.equal(a.verdict, "no", "the card showed green 'Buy Now' directly above a red CONFLICT warning");
  assert.match(a.reason, /opposite ways/i);
  assert.equal(a.plan, null, "a NO must not print an entry plan to act on");
});

test("a fresh signal is not treated as a buy just because the move has not started", () => {
  // timingTier "excellent" is what a 0%-progressed signal reports. On its own
  // it must not carry the answer past the other gates.
  const a = canIBuyNow(base({ timingTier: "excellent", conflict: true }));
  assert.equal(a.verdict, "no");
});

test("a score pointing the other way from the option side blocks it", () => {
  // A Put with a BULLISH combined score is the wrong side.
  const a = canIBuyNow(base({ optSide: "PE", netScore: 40 }));
  assert.equal(a.verdict, "no");
  assert.match(a.reason, /OTHER way/i);
});

test("the same score is fine for the opposite option side", () => {
  assert.equal(canIBuyNow(base({ optSide: "CE", netScore: 40 })).verdict, "yes");
});

test("a closed market is always no", () => {
  const a = canIBuyNow(base({ marketOpen: false }));
  assert.equal(a.verdict, "no");
  assert.match(a.headline, /closed/i);
  assert.equal(a.plan, null);
});

test("no live premium yields no answer rather than a guess", () => {
  const a = canIBuyNow(base({ livePremium: null }));
  assert.equal(a.verdict, "no");
  assert.equal(a.plan, null);
  assert.match(a.reason, /no honest answer/i);
});

test("a premium already past the stop is an exit, not an entry", () => {
  const a = canIBuyNow(base({ livePremium: 1020 }));
  assert.equal(a.verdict, "no");
  assert.match(a.reason, /exit, not an entry/i);
});

test("a premium past one target simply aims at the next one", () => {
  // 1060 is past Target 1 (1055.1) but Target 2 (1067.1) is still ahead.
  const a = canIBuyNow(base({ livePremium: 1060, signalEntry: 1035.1, premiumSwingPerCandle: 3 }));
  assert.equal(a.plan?.target, 1067.1);
  assert.equal(a.plan?.targetNumber, 2);
});

test("every target already reached means the move is finished", () => {
  const a = canIBuyNow(base({ livePremium: 1090, signalEntry: 1035.1 }));
  assert.equal(a.verdict, "no");
  assert.match(a.reason, /already been reached/i);
  assert.match(a.reason, /wait for a fresh call/i);
  assert.equal(a.plan, null);
});

test("a stop inside normal candle noise blocks the entry", () => {
  // Stop 12 away, but a normal candle moves 20.
  const a = canIBuyNow(base({ premiumSwingPerCandle: 20 }));
  assert.equal(a.verdict, "no");
  assert.match(a.reason, /normal candle move away/i);
  assert.match(a.reason, /ordinary wobble/i);
});

// ===========================================================================
// THE LATE-ENTRY CASE. The call fires while he is at work; he looks two hours
// later with price already part-way to target. Getting this wrong produced a
// "risk ₹3,125 to make ₹75" answer that described a trade nobody was offered.
// ===========================================================================

test("a late entry gets a stop measured from TODAY'S price, not the original", () => {
  const a = canIBuyNow(base({ signalEntry: 1035.1, livePremium: 1050, premiumSwingPerCandle: 3 }));
  assert.ok(a.plan, "a late entry with a target ahead must still produce a plan");
  assert.equal(a.plan!.late, true);
  assert.equal(a.plan!.stopMovedUp, true);
  // 1050 - 2 * 3 = 1044, well above the original 1023.1.
  assert.equal(a.plan!.stop, 1044);
  assert.ok(a.plan!.stop > 1023.1, "the replacement stop must be tighter than the original, never looser");
});

test("the late stop turns an impossible risk/reward into a real one", () => {
  const withOldStop = (1050 - 1023.1) * 100; // 2,690 risked under the old logic
  const a = canIBuyNow(base({ signalEntry: 1035.1, livePremium: 1050, premiumSwingPerCandle: 3 }));
  assert.ok(a.plan!.riskPerLot < withOldStop, `risk should fall from ${withOldStop}, got ${a.plan!.riskPerLot}`);
  assert.equal(a.plan!.riskPerLot, 600);
  assert.ok(a.plan!.riskReward >= 1, `a late entry that survives must still pay for its risk, got ${a.plan!.riskReward}:1`);
});

test("a target about to be touched is skipped for the one beyond it", () => {
  // At 1050 with a stop at 1044, Target 1 (1055.1) pays only 0.85:1 -- what a
  // trader would actually do here is aim at Target 2, and so does this.
  const a = canIBuyNow(base({ signalEntry: 1035.1, livePremium: 1050, premiumSwingPerCandle: 3 }));
  assert.equal(a.plan!.target, 1067.1);
  assert.equal(a.plan!.targetNumber, 2);
  assert.equal(a.plan!.rewardPerLot, 1710);
});

test("what was already missed is reported, not hidden", () => {
  const a = canIBuyNow(base({ signalEntry: 1035.1, livePremium: 1050, premiumSwingPerCandle: 3 }));
  assert.equal(a.plan!.missedPerLot, 1490); // (1050 - 1035.1) * 100
});

test("an on-time entry keeps the original stop untouched", () => {
  const a = canIBuyNow(base({ signalEntry: 1035.1, livePremium: 1035.1 }));
  assert.equal(a.plan!.late, false);
  assert.equal(a.plan!.stopMovedUp, false);
  assert.equal(a.plan!.stop, 1023.1);
});

test("a late entry with no room left is still blocked", () => {
  // Target 3 is 1080.1; entering at 1079.5 leaves 6 paise of room.
  const a = canIBuyNow(base({ signalEntry: 1035.1, livePremium: 1079.5, premiumSwingPerCandle: 3 }));
  assert.equal(a.verdict, "no");
  assert.match(a.reason, /not enough of this move left/i);
});

test("with no candle-swing data a late entry keeps the original stop rather than inventing one", () => {
  const a = canIBuyNow(base({ signalEntry: 1035.1, livePremium: 1050, premiumSwingPerCandle: null }));
  assert.equal(a.plan?.stopMovedUp ?? false, false);
});

test("one soft warning downgrades to wait but still shows the numbers", () => {
  const a = canIBuyNow(base({ istHour: 10 }));
  assert.equal(a.verdict, "wait");
  assert.ok(a.plan, "a wait still shows what the trade would look like");
  assert.match(a.reason, /morning window/i);
});

test("two soft warnings is a plain wait", () => {
  const a = canIBuyNow(base({ istHour: 10, signalAgeMinutes: 200 }));
  assert.equal(a.verdict, "wait");
  assert.equal(a.blockers.length, 2);
});

test("a stale signal is flagged", () => {
  const a = canIBuyNow(base({ signalAgeMinutes: 120 }));
  assert.equal(a.verdict, "wait");
  assert.match(a.blockers.join(" "), /minutes old/i);
});

test("a missing score is skipped, never assumed to agree", () => {
  const a = canIBuyNow(base({ netScore: null }));
  const gate = a.gates.find((g) => /score backs/i.test(g.name));
  assert.match(gate!.detail, /skipped rather than assumed/i);
});

// Language rules that must hold whatever the inputs.
test("the word 'safe' is never used to describe a yes", () => {
  const a = canIBuyNow(base());
  const all = `${a.headline} ${a.reason}`;
  assert.ok(!/\bsafe\b|\bsafely\b/i.test(all), `a YES must not call the trade safe: "${all}"`);
});

test("every yes carries the rupee loss and the 'not safe' warning", () => {
  const a = canIBuyNow(base());
  assert.match(a.riskNote, /valid does not mean safe/i);
  assert.match(a.riskNote, /₹/);
});

test("no verdict ever promises an outcome", () => {
  const cases = [
    base(),
    base({ conflict: true }),
    base({ istHour: 10 }),
    base({ marketOpen: false }),
    base({ livePremium: 1060 }),
  ].map(canIBuyNow);
  for (const a of cases) {
    const all = `${a.headline} ${a.reason} ${a.riskNote} ${a.blockers.join(" ")}`;
    assert.ok(!/guaranteed|sure shot|will definitely|100% accurate|certain profit|risk[- ]free/i.test(all), `bad wording in: ${all}`);
  }
});

test("every gate explains itself", () => {
  const a = canIBuyNow(base({ conflict: true, istHour: 10 }));
  for (const g of a.gates) {
    assert.ok(g.name.length > 0);
    assert.ok(g.detail.length > 10, `gate "${g.name}" needs a real explanation`);
  }
});
