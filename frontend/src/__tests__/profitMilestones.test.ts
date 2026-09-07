import { test } from "node:test";
import assert from "node:assert/strict";
import { peakProfitRs, milestoneStates, milestonesHitCount } from "../utils/profitMilestones";

test("peak profit uses the high-water mark, not the current premium", () => {
  // Crude: lot 100. Entry 250, peaked at 265 (+15 -> ₹1500), now back to 255.
  const rs = peakProfitRs(250, 265, 255, 100);
  assert.equal(rs, 1500);
});

test("peak survives an SL close (current below entry)", () => {
  // Peaked +20 (₹2000) then reversed to a loss; peak profit still ₹2000.
  const rs = peakProfitRs(250, 270, 240, 100);
  assert.equal(rs, 2000);
});

test("a call that only ever lost shows ₹0, never negative", () => {
  const rs = peakProfitRs(250, 250, 240, 100);
  assert.equal(rs, 0);
});

test("natural gas lot size (1250) converts small premium moves to big rupees", () => {
  // +0.8 premium x 1250 = ₹1000
  const rs = peakProfitRs(10, 10.8, 10.8, 1250);
  assert.equal(rs, 1000);
});

test("milestones tick at or above each ₹ level", () => {
  const states = milestoneStates(2300);
  assert.deepEqual(
    states.map((s) => s.hit),
    [true, true, true, false, false] // 500,1000,2000 hit; 3000,5000 not
  );
  assert.equal(milestonesHitCount(2300), 3);
});

test("exactly on a milestone counts as hit", () => {
  assert.equal(milestoneStates(500)[0].hit, true);
  assert.equal(milestonesHitCount(5000), 5);
});
