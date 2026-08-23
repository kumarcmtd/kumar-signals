import { test } from "node:test";
import assert from "node:assert/strict";
import { findConfluenceCalls } from "../utils/confluenceEngine";
import type { TradeLogEntry } from "../utils/tradeLogCore";

function entry(o: Partial<TradeLogEntry> = {}): TradeLogEntry {
  return {
    id: Math.random().toString(), strike: 7000, optSide: "CE", entry: 10,
    targets: [14, 18, 24], stop: 6, targetsHit: [false, false, false],
    status: "running", closed: false, openedAt: Date.now(), closedAt: null, ...o,
  };
}

test("fires only when all three engines hold an open call on the same side", () => {
  const calls = findConfluenceCalls({
    "BEST-CRUDEOIL": [entry({ entry: 10 })],
    "LEVELCROSS-CRUDEOIL": [entry({ entry: 10.5 })],
    "TWENTY20-CRUDEOIL-15": [entry({ entry: 9.8 })],
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].symbol, "CRUDEOIL");
  assert.ok(calls[0].confidence >= 60 && calls[0].confidence <= 100);
});

test("extra confirming Ai20-20 timeframes raise the confidence", () => {
  const base = {
    "BEST-CRUDEOIL": [entry()], "LEVELCROSS-CRUDEOIL": [entry()], "TWENTY20-CRUDEOIL-15": [entry()],
  };
  const c1 = findConfluenceCalls(base)[0].confidence;
  const c2 = findConfluenceCalls({ ...base, "TWENTY20-CRUDEOIL-30": [entry()] })[0].confidence;
  assert.ok(c2 > c1, `${c2} !> ${c1}`);
});

test("does NOT fire when the sides disagree", () => {
  const calls = findConfluenceCalls({
    "BEST-CRUDEOIL": [entry({ optSide: "CE" })],
    "LEVELCROSS-CRUDEOIL": [entry({ optSide: "PE" })],
    "TWENTY20-CRUDEOIL-15": [entry({ optSide: "CE" })],
  });
  assert.equal(calls.length, 0);
});

test("does NOT fire with only two of the three engines", () => {
  assert.equal(findConfluenceCalls({ "BEST-CRUDEOIL": [entry()], "LEVELCROSS-CRUDEOIL": [entry()] }).length, 0);
});

test("does NOT fire when one source's trade is already closed", () => {
  const calls = findConfluenceCalls({
    "BEST-CRUDEOIL": [entry({ closed: true })],
    "LEVELCROSS-CRUDEOIL": [entry()],
    "TWENTY20-CRUDEOIL-15": [entry()],
  });
  assert.equal(calls.length, 0);
});

test("suggested stop/targets are the safest merge (tightest stop, nearest targets)", () => {
  const calls = findConfluenceCalls({
    "BEST-CRUDEOIL": [entry({ stop: 6, targets: [14, 18, 24] })],
    "LEVELCROSS-CRUDEOIL": [entry({ stop: 6.5, targets: [13, 17, 22] })],
    "TWENTY20-CRUDEOIL-15": [entry({ stop: 5.8, targets: [15, 19, 25] })],
  });
  assert.equal(calls[0].suggestedStop, 6.5); // highest stop = caps loss soonest
  assert.deepEqual(calls[0].suggestedTargets, [13, 17, 22]); // lowest = reached soonest
});
