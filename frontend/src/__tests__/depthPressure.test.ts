import { test } from "node:test";
import assert from "node:assert/strict";
import { computeDepthPressure } from "../utils/depthPressure";

test("buyers dominating is a CARE flag against a Put", () => {
  const p = computeDepthPressure(967, 616, "PE"); // 61% buy (the screenshot)
  assert.ok(p);
  assert.equal(p!.lean, "buyers");
  assert.equal(p!.tone, "care");
  assert.equal(p!.buyPct, 61);
  assert.match(p!.detail, /against your Put/i);
});

test("buyers dominating is GOOD for a Call", () => {
  const p = computeDepthPressure(967, 616, "CE");
  assert.ok(p);
  assert.equal(p!.tone, "good");
  assert.equal(p!.headline, "Buyers are more");
});

test("sellers dominating is GOOD for a Put", () => {
  const p = computeDepthPressure(400, 900, "PE"); // ~31% buy
  assert.ok(p);
  assert.equal(p!.lean, "sellers");
  assert.equal(p!.tone, "good");
  assert.equal(p!.headline, "Sellers are more");
});

test("a roughly even book is neutral", () => {
  const p = computeDepthPressure(510, 490, "PE"); // 51% buy
  assert.ok(p);
  assert.equal(p!.lean, "balanced");
  assert.equal(p!.tone, "neutral");
});

test("returns null with no book quantity", () => {
  assert.equal(computeDepthPressure(0, 0, "CE"), null);
});

test("buy% and sell% always sum to 100", () => {
  const p = computeDepthPressure(723, 277, "CE");
  assert.equal(p!.buyPct + p!.sellPct, 100);
});
