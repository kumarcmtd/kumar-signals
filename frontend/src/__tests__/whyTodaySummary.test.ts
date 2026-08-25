import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyNewsDuration, leanFromScore } from "../utils/whyTodaySummary";

// classifyNewsDuration picks the MOST DURABLE bucket among all matched rules:
// structural beats "a few days" beats temporary. This is what lets a single
// war/OPEC headline correctly override a pile of inventory-print noise.
test("classifyNewsDuration: structural rule wins outright", () => {
  const r = classifyNewsDuration(["inventoryDraw", "coldWinter", "opecCut"]);
  assert.equal(r.bucket, "structural");
  assert.equal(r.read, "Longer-lasting");
});

test("classifyNewsDuration: 'days' beats temporary when no structural present", () => {
  const r = classifyNewsDuration(["inventoryDraw", "coldWinter"]);
  assert.equal(r.bucket, "days");
  assert.equal(r.read, "A few days");
});

test("classifyNewsDuration: pure inventory/data prints are temporary", () => {
  const r = classifyNewsDuration(["inventoryDraw", "storageBuild"]);
  assert.equal(r.bucket, "temporary");
  assert.equal(r.read, "Temporary");
});

test("classifyNewsDuration: any conflict/sanction rule is structural", () => {
  for (const rule of ["war", "hormuz", "sanctions", "redSea", "pipelineExplosion"]) {
    assert.equal(classifyNewsDuration([rule]).bucket, "structural", `${rule} should be structural`);
  }
});

test("classifyNewsDuration: unknown or empty rules default to temporary", () => {
  assert.equal(classifyNewsDuration([]).bucket, "temporary");
  assert.equal(classifyNewsDuration(["somethingWeNeverMapped"]).bucket, "temporary");
});

test("classifyNewsDuration: order does not matter for structural precedence", () => {
  const a = classifyNewsDuration(["opecCut", "inventoryDraw"]);
  const b = classifyNewsDuration(["inventoryDraw", "opecCut"]);
  assert.equal(a.bucket, "structural");
  assert.equal(b.bucket, "structural");
});

// leanFromScore uses a dead-band so tiny net scores read Neutral rather than
// flipping the whole card bullish/bearish on noise.
test("leanFromScore: crosses the dead-band correctly", () => {
  assert.equal(leanFromScore(2.5), "bullish");
  assert.equal(leanFromScore(-3), "bearish");
  assert.equal(leanFromScore(0), "neutral");
  assert.equal(leanFromScore(0.5), "neutral"); // exactly on the edge stays neutral
  assert.equal(leanFromScore(-0.5), "neutral");
  assert.equal(leanFromScore(0.51), "bullish");
  assert.equal(leanFromScore(-0.51), "bearish");
});
