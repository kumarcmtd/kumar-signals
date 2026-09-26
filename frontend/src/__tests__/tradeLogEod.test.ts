import { test } from "vitest";
import assert from "node:assert/strict";
import { closeRunningAtSessionEnd, runningBeforeClose, mergeTradeLogEntryLists, type TradeLogEntry } from "../utils/tradeLogCore";
import { exitPriceFor } from "../utils/tradeLogPnl";

const CLOSE = new Date("2026-09-24T23:30:00+05:30").getTime();
const OPENED = new Date("2026-09-24T14:00:00+05:30").getTime();

function trade(over: Partial<TradeLogEntry> = {}): TradeLogEntry {
  return {
    id: over.id ?? "t1",
    strike: 9900,
    optSide: "CE",
    entry: 100,
    targets: [110, 120, 130],
    stop: 90,
    targetsHit: [false, false, false],
    status: "running",
    closed: false,
    openedAt: OPENED,
    closedAt: null,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// End-of-day close
// ---------------------------------------------------------------------------

test("a trade still running at the bell is closed at the last observed premium", () => {
  const logs = { "TWENTY20-CRUDEOIL-LIVE": [trade()] };
  const r = closeRunningAtSessionEnd(logs, "CRUDEOIL", CLOSE, () => 87.5);
  const done = r.logs["TWENTY20-CRUDEOIL-LIVE"][0];
  assert.equal(r.closed, 1);
  assert.equal(done.closed, true);
  assert.equal(done.status, "closed_eod");
  assert.equal(done.exitPrice, 87.5);
  assert.equal(done.closedAt, CLOSE, "it ended at the bell, not whenever the cron ran");
});

// Why this has its own status.
test("P&L books an EOD close at its real premium, not at breakeven", () => {
  const r = closeRunningAtSessionEnd({ "BEST-CRUDEOIL": [trade()] }, "CRUDEOIL", CLOSE, () => 87.5);
  assert.equal(exitPriceFor(r.logs["BEST-CRUDEOIL"][0]), 87.5, "a closed_manual status would have booked 100 and erased the loss");
});

test("a strike with no quote is still closed, but with no invented price", () => {
  const r = closeRunningAtSessionEnd({ "BEST-CRUDEOIL": [trade()] }, "CRUDEOIL", CLOSE, () => null);
  const done = r.logs["BEST-CRUDEOIL"][0];
  assert.equal(done.closed, true);
  assert.equal(done.exitPrice, undefined);
  assert.equal(r.withoutPrice, 1);
  assert.equal(exitPriceFor(done), 100, "books at breakeven rather than guessing");
});

test("a trade opened after the close is left alone", () => {
  const late = trade({ openedAt: CLOSE + 60_000 });
  const r = closeRunningAtSessionEnd({ "BEST-CRUDEOIL": [late] }, "CRUDEOIL", CLOSE, () => 50);
  assert.equal(r.closed, 0);
  assert.equal(r.logs["BEST-CRUDEOIL"][0].closed, false);
});

test("already-closed trades and the other symbol are untouched", () => {
  const logs = {
    "BEST-CRUDEOIL": [trade({ closed: true, status: "sl_hit", closedAt: OPENED + 1000, exitPrice: 89 })],
    "BEST-NATURALGAS": [trade({ id: "g1" })],
  };
  const r = closeRunningAtSessionEnd(logs, "CRUDEOIL", CLOSE, () => 50);
  assert.equal(r.closed, 0);
  assert.equal(r.logs["BEST-CRUDEOIL"][0].exitPrice, 89);
  assert.equal(r.logs["BEST-NATURALGAS"][0].closed, false, "Natural Gas is closed on its own pass");
});

test("only the last entry of a key is ever the open one", () => {
  const logs = { "BEST-CRUDEOIL": [trade({ id: "old", closed: true, status: "target3_hit", closedAt: OPENED }), trade({ id: "new" })] };
  assert.deepEqual(runningBeforeClose(logs, "CRUDEOIL", CLOSE).map((r) => r.entry.id), ["new"]);
});

test("the input logs are not mutated", () => {
  const logs = { "BEST-CRUDEOIL": [trade()] };
  closeRunningAtSessionEnd(logs, "CRUDEOIL", CLOSE, () => 50);
  assert.equal(logs["BEST-CRUDEOIL"][0].closed, false);
});

// ---------------------------------------------------------------------------
// Merge: the lost update the EOD close would otherwise cause
// ---------------------------------------------------------------------------

test("a later breakeven stale-close from a phone cannot overwrite the real EOD close", () => {
  const serverEod = trade({ closed: true, status: "closed_eod", closedAt: CLOSE, exitPrice: 87.5 });
  // Next morning a phone still holding a "running" copy runs its own stale-close.
  const phoneStale = trade({ closed: true, status: "closed_manual", closedAt: CLOSE + 9.5 * 3_600_000 });
  const [merged] = mergeTradeLogEntryLists([phoneStale], [serverEod]);
  assert.equal(merged.status, "closed_eod");
  assert.equal(merged.exitPrice, 87.5);
});

test("when both sides closed, the earlier close wins whichever side it came from", () => {
  const phoneTarget = trade({ closed: true, status: "target3_hit", closedAt: OPENED + 60_000, exitPrice: 131 });
  const serverLater = trade({ closed: true, status: "closed_eod", closedAt: CLOSE, exitPrice: 128 });
  const [merged] = mergeTradeLogEntryLists([phoneTarget], [serverLater]);
  assert.equal(merged.status, "target3_hit", "the phone saw the target first; that is when the trade ended");
});

test("a stale running copy still never reopens a closed trade", () => {
  const serverClosed = trade({ closed: true, status: "closed_eod", closedAt: CLOSE, exitPrice: 87.5 });
  const [merged] = mergeTradeLogEntryLists([trade()], [serverClosed]);
  assert.equal(merged.closed, true);
});

test("a local close still beats a server copy that is running", () => {
  const localClosed = trade({ closed: true, status: "sl_hit", closedAt: OPENED + 1000, exitPrice: 89 });
  const [merged] = mergeTradeLogEntryLists([localClosed], [trade()]);
  assert.equal(merged.status, "sl_hit");
});

// ---------------------------------------------------------------------------
// Merge: two running copies (the cron's own lost update)
// ---------------------------------------------------------------------------

// The exact shape of the cron's write: it re-reads KV and merges with KV as
// "local", so the un-advanced KV copy used to win whole and erase the cron's
// T1 on the very write that recorded it.
test("the cron's T1 hit survives its own re-read-and-merge", () => {
  const kvCopy = trade(); // still says nothing hit
  const cronAdvanced = trade({ targetsHit: [true, false, false], highWaterMark: 111, targetTouches: [1, 0, 0] });
  const [merged] = mergeTradeLogEntryLists([kvCopy], [cronAdvanced]);
  assert.deepEqual(merged.targetsHit, [true, false, false]);
  assert.equal(merged.highWaterMark, 111);
  assert.deepEqual(merged.targetTouches, [1, 0, 0]);
});

test("progress merges the same whichever side is local", () => {
  const a = trade({ targetsHit: [true, false, false], highWaterMark: 112 });
  const b = trade({ targetsHit: [false, false, false], highWaterMark: 115 });
  const ab = mergeTradeLogEntryLists([a], [b])[0];
  const ba = mergeTradeLogEntryLists([b], [a])[0];
  assert.deepEqual(ab.targetsHit, ba.targetsHit);
  assert.equal(ab.highWaterMark, 115);
  assert.equal(ba.highWaterMark, 115);
});

test("a target once hit is never un-hit by a staler copy", () => {
  const phone = trade({ targetsHit: [true, true, false], targetTouches: [2, 1, 0] });
  const stale = trade({ targetsHit: [true, false, false], targetTouches: [1, 0, 0] });
  const [merged] = mergeTradeLogEntryLists([stale], [phone]);
  assert.deepEqual(merged.targetsHit, [true, true, false]);
  assert.deepEqual(merged.targetTouches, [2, 1, 0]);
});

test("entries without the optional progress fields merge without inventing them", () => {
  const [merged] = mergeTradeLogEntryLists([trade()], [trade()]);
  assert.equal(merged.highWaterMark, undefined);
  assert.equal(merged.targetTouches, undefined);
});
