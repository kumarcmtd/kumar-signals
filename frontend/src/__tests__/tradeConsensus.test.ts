import { test } from "node:test";
import assert from "node:assert/strict";
import { computeConsensus } from "../utils/tradeConsensus";

const base = { symbolName: "Crude Oil", cePages: [] as string[], pePages: [] as string[], overnightLean: null as null | "bullish" | "bearish" | "neutral", volatilityPct: 0.3 };

test("clear one-sided agreement is GREEN with the side", () => {
  const up = computeConsensus({ ...base, cePages: ["Best Call"], overnightLean: "bullish" });
  assert.equal(up.light, "green");
  assert.equal(up.side, "CE");

  const down = computeConsensus({ ...base, pePages: ["Ai20-20"], overnightLean: "bearish" });
  assert.equal(down.light, "green");
  assert.equal(down.side, "PE");
});

test("CE & PE both live is RED (app split)", () => {
  const r = computeConsensus({ ...base, cePages: ["Best Call"], pePages: ["Ai20-20"], overnightLean: "bullish", volatilityPct: 0.3 });
  assert.equal(r.light, "red");
  assert.equal(r.side, null);
  assert.match(r.headline, /split/i);
});

test("too volatile with no clear side is RED", () => {
  const r = computeConsensus({ ...base, volatilityPct: 1.4 });
  assert.equal(r.light, "red");
  assert.match(r.headline, /volatile/i);
});

test("aligned but very choppy downgrades to YELLOW", () => {
  const r = computeConsensus({ ...base, cePages: ["Best Call", "Level Cross"], overnightLean: "bullish", volatilityPct: 1.2 });
  assert.equal(r.light, "yellow");
  assert.equal(r.side, "CE");
});

test("a weak single-vote lean is YELLOW", () => {
  const r = computeConsensus({ ...base, cePages: ["Best Call"] });
  assert.equal(r.light, "yellow");
});

test("nothing live and no lean is YELLOW (no edge)", () => {
  const r = computeConsensus({ ...base });
  assert.equal(r.light, "yellow");
  assert.match(r.headline, /no edge/i);
});

test("two pages agreeing (no overnight) still greens", () => {
  const r = computeConsensus({ ...base, cePages: ["Best Call", "Ai20-20"], volatilityPct: 0.4 });
  assert.equal(r.light, "green");
  assert.equal(r.side, "CE");
});
