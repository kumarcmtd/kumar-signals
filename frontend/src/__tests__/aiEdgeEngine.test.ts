import { test } from "node:test";
import assert from "node:assert/strict";
import { engineForKey, symbolForKey, rupeesFor, flattenEdgeTrades, computeEngineEdges, computeEdgeTotals, ENGINES, MIN_SAMPLE, LOT_SIZE } from "../utils/aiEdgeEngine";
import type { TradeLogEntry } from "../utils/tradeLogCore";

let seq = 0;
function closed(entry: number, exitPrice: number, over: Partial<TradeLogEntry> = {}): TradeLogEntry {
  seq += 1;
  return {
    id: `t${seq}`,
    strike: 8600,
    optSide: "CE",
    entry,
    targets: [entry * 1.2, entry * 1.4, entry * 1.6],
    stop: entry * 0.8,
    targetsHit: [false, false, false],
    status: exitPrice >= entry ? "target3_hit" : "sl_hit",
    closed: true,
    openedAt: 1_000_000,
    closedAt: 2_000_000,
    exitPrice,
    ...over,
  } as TradeLogEntry;
}

test("every configured engine prefix maps back to its own engine", () => {
  for (const e of ENGINES) {
    if (!e.prefix) continue;
    assert.equal(engineForKey(`${e.prefix}-CRUDEOIL-15`)?.id, e.id);
  }
  // The unprefixed engine owns the bare "<SYMBOL>-<tf>" keys.
  assert.equal(engineForKey("CRUDEOIL-15")?.id, "aitest");
  assert.equal(engineForKey("NATURALGAS-1D")?.id, "aitest");
});

test("an unrecognised prefix is ignored, never absorbed into another engine", () => {
  // A future page's keys must not silently inflate AI-Test's numbers.
  assert.equal(engineForKey("SOMETHINGNEW-CRUDEOIL-15"), null);
});

test("symbol is read from anywhere in the key, prefixed or not", () => {
  assert.equal(symbolForKey("BEST-CRUDEOIL-15"), "CRUDEOIL");
  assert.equal(symbolForKey("LEVELCROSS-NATURALGAS-30"), "NATURALGAS");
  assert.equal(symbolForKey("PATTERN-CRUDEOIL"), "CRUDEOIL");
  assert.equal(symbolForKey("GOLD-15"), null);
});

test("rupees use each symbol's own lot size, not a shared points scale", () => {
  // The whole reason this engine exists: +1 premium point is ₹100 on Crude
  // but ₹1,250 on NG, so points are not comparable across symbols.
  assert.equal(rupeesFor(closed(100, 101), "CRUDEOIL"), 100);
  assert.equal(rupeesFor(closed(10, 11), "NATURALGAS"), 1250);
  assert.equal(LOT_SIZE.NATURALGAS / LOT_SIZE.CRUDEOIL, 12.5);
});

test("a losing trade is negative rupees", () => {
  assert.equal(rupeesFor(closed(150, 130), "CRUDEOIL"), -2000);
});

test("open trades are excluded; only closed ones count", () => {
  const logs = {
    "BEST-CRUDEOIL-15": [closed(100, 120), { ...closed(100, 120), closed: false, status: "running" as const }],
  };
  assert.equal(flattenEdgeTrades(logs).length, 1);
});

test("a high win rate with oversized losses is correctly rated DROP", () => {
  // Eight trades, seven small wins and one huge loss: 88% win rate, but it
  // loses money. Win-rate ranking would call this a top engine.
  const entries = [
    ...Array.from({ length: 7 }, () => closed(100, 105)), // +₹500 each = +₹3,500
    closed(100, 20), // -₹8,000
  ];
  const edges = computeEngineEdges({ "AIRISK-CRUDEOIL-15": entries });
  const airisk = edges.find((e) => e.id === "airisk")!;
  assert.equal(airisk.winRatePct, 88);
  assert.equal(airisk.netRs, -4500);
  assert.equal(airisk.verdict, "drop");
  assert.ok(airisk.profitFactor !== null && airisk.profitFactor < 1);
});

test("a steady engine with controlled losses is rated TRUST", () => {
  const entries = [
    ...Array.from({ length: 6 }, () => closed(100, 120)), // +₹2,000 each
    ...Array.from({ length: 3 }, () => closed(100, 95)), // -₹500 each
  ];
  const edges = computeEngineEdges({ "BEST-CRUDEOIL-15": entries });
  const best = edges.find((e) => e.id === "best")!;
  assert.equal(best.netRs, 12000 - 1500);
  assert.equal(best.profitFactor, 8);
  assert.equal(best.avgWinRs, 2000);
  assert.equal(best.avgLossRs, 500);
  assert.equal(best.verdict, "trust");
});

test("a thin-margin engine is WATCH, not TRUST", () => {
  const entries = [
    ...Array.from({ length: 5 }, () => closed(100, 110)), // +₹1,000 each = 5,000
    ...Array.from({ length: 4 }, () => closed(100, 91)), // -₹900 each = 3,600
  ];
  const edges = computeEngineEdges({ "TWENTY20-CRUDEOIL-15": entries });
  const t = edges.find((e) => e.id === "twenty20")!;
  assert.equal(t.profitFactor, 1.39);
  assert.equal(t.verdict, "watch");
});

test("a tiny sample gets no verdict at all, however good it looks", () => {
  // Three perfect trades must never print a confident TRUST.
  const edges = computeEngineEdges({ "AIUP-CRUDEOIL-15": [closed(100, 200), closed(100, 200), closed(100, 200)] });
  const up = edges.find((e) => e.id === "aiup")!;
  assert.equal(up.trades, 3);
  assert.equal(up.verdict, "insufficient");
  assert.match(up.verdictReason, /too few to judge/);
});

test(`exactly ${MIN_SAMPLE} trades is enough to be judged`, () => {
  const edges = computeEngineEdges({ "AIUP-CRUDEOIL-15": Array.from({ length: MIN_SAMPLE }, () => closed(100, 120)) });
  assert.equal(edges.find((e) => e.id === "aiup")!.verdict, "trust");
});

test("an engine with wins and no losses is TRUST, and says so rather than printing infinity", () => {
  const edges = computeEngineEdges({ "SHOOT-CRUDEOIL-15": Array.from({ length: MIN_SAMPLE }, () => closed(100, 110)) });
  const shoot = edges.find((e) => e.id === "shoot")!;
  assert.equal(shoot.profitFactor, null);
  assert.equal(shoot.verdict, "trust");
  assert.match(shoot.verdictReason, /No losing trades/);
});

test("engines with no trades report that honestly and sort last", () => {
  const edges = computeEngineEdges({ "BEST-CRUDEOIL-15": Array.from({ length: MIN_SAMPLE }, () => closed(100, 120)) });
  assert.equal(edges[0].id, "best");
  const empty = edges.filter((e) => e.trades === 0);
  assert.ok(empty.length > 0);
  for (const e of empty) {
    assert.equal(e.verdict, "insufficient");
    assert.equal(e.verdictReason, "No closed trades yet.");
    assert.equal(e.netRs, 0);
  }
});

test("engines are ranked by the rupees they actually contributed", () => {
  const edges = computeEngineEdges({
    "BEST-CRUDEOIL-15": Array.from({ length: 8 }, () => closed(100, 130)), // +₹3,000 x8
    "TWENTY20-CRUDEOIL-15": Array.from({ length: 8 }, () => closed(100, 110)), // +₹1,000 x8
    "AIRISK-CRUDEOIL-15": Array.from({ length: 8 }, () => closed(100, 90)), // -₹1,000 x8
  });
  assert.deepEqual(edges.slice(0, 3).map((e) => e.id), ["best", "twenty20", "airisk"]);
});

test("NG and Crude trades combine on one honest rupee scale", () => {
  // 1 NG point (₹1,250) must outweigh 1 Crude point (₹100), not tie with it.
  const edges = computeEngineEdges({
    "BEST-NATURALGAS-15": [closed(10, 11)],
    "TWENTY20-CRUDEOIL-15": [closed(100, 101)],
  });
  assert.equal(edges.find((e) => e.id === "best")!.netRs, 1250);
  assert.equal(edges.find((e) => e.id === "twenty20")!.netRs, 100);
});

test("totals show what the losing engines cost and what dropping them would save", () => {
  const edges = computeEngineEdges({
    "BEST-CRUDEOIL-15": Array.from({ length: 8 }, () => closed(100, 130)), // +₹24,000
    "AIRISK-CRUDEOIL-15": Array.from({ length: 8 }, () => closed(100, 90)), // -₹8,000
  });
  const totals = computeEdgeTotals(edges);
  assert.equal(totals.trades, 16);
  assert.equal(totals.netRs, 16000);
  assert.equal(totals.droppedCount, 1);
  assert.equal(totals.droppedCostRs, -8000);
  assert.equal(totals.netWithoutDroppedRs, 24000, "cutting the losing engine should recover its full cost");
  assert.equal(totals.bestEngine?.id, "best");
  assert.equal(totals.worstEngine?.id, "airisk");
});

test("a date filter keeps only trades closed inside the window", () => {
  const old = { ...closed(100, 120), closedAt: 1_000 };
  const recent = { ...closed(100, 120), closedAt: 9_000 };
  assert.equal(flattenEdgeTrades({ "BEST-CRUDEOIL-15": [old, recent] }, 5_000).length, 1);
});

test("empty logs produce zeroed totals, not NaN", () => {
  const totals = computeEdgeTotals(computeEngineEdges({}));
  assert.equal(totals.trades, 0);
  assert.equal(totals.netRs, 0);
  assert.equal(totals.profitFactor, null);
  assert.equal(totals.expectancyRs, null);
  assert.equal(totals.bestEngine, null);
});
