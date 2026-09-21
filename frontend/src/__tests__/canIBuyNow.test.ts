import { test } from "node:test";
import assert from "node:assert/strict";
import { canIBuyNow, type BuyCheckInput } from "../utils/canIBuyNow";

/** A clean, everything-passing setup. Individual tests break one thing. */
function base(over: Partial<BuyCheckInput> = {}): BuyCheckInput {
  return {
    livePremium: 1035.1,
    stop: 1023.1,
    target: 1055.1,
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
  // Entered 2 rupees higher than the signal's own price, so both sides change.
  const a = canIBuyNow(base({ livePremium: 1037 }));
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

test("a premium already past the target is chasing", () => {
  const a = canIBuyNow(base({ livePremium: 1060 }));
  assert.equal(a.verdict, "no");
  assert.match(a.reason, /chasing/i);
});

test("a stop inside normal candle noise blocks the entry", () => {
  // Stop 12 away, but a normal candle moves 20.
  const a = canIBuyNow(base({ premiumSwingPerCandle: 20 }));
  assert.equal(a.verdict, "no");
  assert.match(a.reason, /normal candle move away/i);
  assert.match(a.reason, /ordinary wobble/i);
});

test("entering too late is blocked on risk/reward even when direction is right", () => {
  // At 1051 you risk 2790 to make only 410.
  const a = canIBuyNow(base({ livePremium: 1051 }));
  assert.equal(a.verdict, "no");
  assert.match(a.reason, /spoiled the trade/i);
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
