import { test } from "node:test";
import assert from "node:assert/strict";
import { projectPremiumFromUnderlying } from "../utils/optionProjection";
import type { OptionsAnalytics } from "../types";

const uEntry = 7000, uStop = 6940;
const uTargets: [number, number, number] = [7060, 7100, 7160];

function chain(callDelta?: number, callTheta?: number, putDelta?: number, putTheta?: number): OptionsAnalytics {
  return {
    symbol: "CRUDEOIL", tradingSymbol: "X", expiry: "2026-09-01", spot: 7000, atmStrike: 7000,
    pcr: 1, bias: "bullish", support: null, resistance: null, maxPain: null,
    rows: [{
      strike: 7000,
      call: { ltp: 100, oi: 1, iv: null, volume: 1, change: null, changePercent: null, delta: callDelta, theta: callTheta },
      put: { ltp: 90, oi: 1, iv: null, volume: 1, change: null, changePercent: null, delta: putDelta, theta: putTheta },
    }],
  } as unknown as OptionsAnalytics;
}

test("uses the real per-strike delta, not a flat 0.5", () => {
  const p07 = projectPremiumFromUnderlying("CE", uEntry, uStop, uTargets, chain(0.7, 0));
  const pFallback = projectPremiumFromUnderlying("CE", uEntry, uStop, uTargets, chain());
  assert.equal(p07?.delta, 0.7);
  assert.equal(p07?.targets[0], 142); // 100 + 0.7*60
  assert.ok(p07 !== null && pFallback !== null && p07.targets[0] > pFallback.targets[0]);
  assert.equal(pFallback?.delta, 0.5); // graceful fallback when the chain has no delta
});

test("puts use the magnitude of a negative delta", () => {
  const put = projectPremiumFromUnderlying("PE", 7000, 7060, [6940, 6900, 6840], chain(undefined, undefined, -0.65, -3));
  assert.equal(put?.delta, 0.65);
  assert.ok(put !== null && put.targets[0] > put.entry);
});

test("theta trims the targets, and trims MORE near expiry (bigger theta)", () => {
  const noTheta = projectPremiumFromUnderlying("CE", uEntry, uStop, uTargets, chain(0.6, 0));
  const mild = projectPremiumFromUnderlying("CE", uEntry, uStop, uTargets, chain(0.6, -4));
  const brutal = projectPremiumFromUnderlying("CE", uEntry, uStop, uTargets, chain(0.6, -40));
  assert.ok(noTheta !== null && mild !== null && brutal !== null);
  assert.ok(mild.targets[0] < noTheta.targets[0]);
  assert.ok(brutal.targets[0] < mild.targets[0]);
});

test("reward:risk is measured to Target 2 (~1.67), not the structural 1:1 Target 1", () => {
  const p = projectPremiumFromUnderlying("CE", uEntry, uStop, uTargets, chain(0.5, 0));
  assert.equal(p?.rr, 1.67); // (150-100)/(100-70)
});

test("stop is floored at 35% of premium (max 65% loss)", () => {
  const p = projectPremiumFromUnderlying("CE", 7000, 6000, uTargets, chain(0.9, 0));
  assert.equal(p?.stop, 35);
});
