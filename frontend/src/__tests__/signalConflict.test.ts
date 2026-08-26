import { test } from "node:test";
import assert from "node:assert/strict";
import { detectSignalConflicts, pageLabelForKey } from "../utils/signalConflict";
import type { TradeLogEntry } from "../store/appStore";

// Minimal open/closed trade-log entry factory -- only the fields the
// conflict detector actually reads matter here.
function entry(optSide: "CE" | "PE", closed: boolean, openedAt = 1_000, strike = 7850, e = 250): TradeLogEntry {
  return {
    id: `${optSide}-${openedAt}`,
    strike,
    optSide,
    entry: e,
    stop: 100,
    targets: [300, 350, 400],
    targetsHit: [false, false, false],
    targetTouches: [0, 0, 0],
    openedAt,
    closedAt: closed ? openedAt + 100 : null,
    closed,
    status: closed ? "closed_manual" : "running",
  } as unknown as TradeLogEntry;
}

test("flags a CE-vs-PE conflict on the same symbol across two pages", () => {
  const logs = {
    "BEST-CRUDEOIL": [entry("CE", false)],
    "TWENTY20-CRUDEOIL-15": [entry("PE", false)],
  };
  const conflicts = detectSignalConflicts(logs);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].symbol, "CRUDEOIL");
  assert.deepEqual(
    conflicts[0].ceSources.map((s) => s.page),
    ["Best Call"]
  );
  assert.deepEqual(
    conflicts[0].peSources.map((s) => s.page),
    ["Ai20-20"]
  );
});

test("no conflict when both live legs agree on direction", () => {
  const logs = {
    "BEST-CRUDEOIL": [entry("CE", false)],
    "LEVELCROSS-CRUDEOIL": [entry("CE", false)],
  };
  assert.equal(detectSignalConflicts(logs).length, 0);
});

test("a closed opposite leg does not count as a live conflict", () => {
  const logs = {
    "BEST-CRUDEOIL": [entry("CE", false)],
    "TWENTY20-CRUDEOIL-15": [entry("PE", true)], // already closed
  };
  assert.equal(detectSignalConflicts(logs).length, 0);
});

test("only the latest entry per key is considered open", () => {
  const logs = {
    // an older closed PE followed by a live CE -> this key is a live CE
    "AIOWN-CRUDEOIL": [entry("PE", true, 500), entry("CE", false, 900)],
    "BEST-CRUDEOIL": [entry("PE", false, 1000)],
  };
  const conflicts = detectSignalConflicts(logs);
  assert.equal(conflicts.length, 1);
  assert.deepEqual(conflicts[0].ceSources.map((s) => s.page).sort(), ["AI Own"]);
  assert.deepEqual(conflicts[0].peSources.map((s) => s.page).sort(), ["Best Call"]);
});

test("conflicts are detected per symbol independently", () => {
  const logs = {
    "BEST-CRUDEOIL": [entry("CE", false)],
    "TWENTY20-CRUDEOIL-15": [entry("PE", false)],
    "BEST-NATURALGAS": [entry("CE", false)],
    "LEVELCROSS-NATURALGAS": [entry("CE", false)], // NG agrees -> no conflict
  };
  const conflicts = detectSignalConflicts(logs);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].symbol, "CRUDEOIL");
});

test("multiple pages on the same side are de-duped to unique page labels", () => {
  const logs = {
    "TWENTY20-CRUDEOIL-15": [entry("CE", false, 800)],
    "TWENTY20-CRUDEOIL-30": [entry("CE", false, 900)], // same page, two TFs
    "BEST-CRUDEOIL": [entry("PE", false, 1000)],
  };
  const conflicts = detectSignalConflicts(logs);
  assert.equal(conflicts.length, 1);
  // Ai20-20 appears once despite two open timeframes
  assert.deepEqual(conflicts[0].ceSources.map((s) => s.page), ["Ai20-20"]);
});

test("pageLabelForKey maps known prefixes and falls back to AI Test", () => {
  assert.equal(pageLabelForKey("GATECE-CRUDEOIL-30"), "Directional");
  assert.equal(pageLabelForKey("KUMARAI-NATURALGAS-15"), "Kumar AI");
  assert.equal(pageLabelForKey("SHOOT-CRUDEOIL-15"), "AI-Shoot");
  assert.equal(pageLabelForKey("CRUDEOIL-15"), "AI Test"); // default/unprefixed
});
