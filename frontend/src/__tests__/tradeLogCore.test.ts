import { test } from "node:test";
import assert from "node:assert/strict";
import { advanceOpenEntry, mergeTradeLogs, openNewEntry, symbolOfTradeLogKey, type TradeLogEntry } from "../utils/tradeLogCore";
import { exitPriceFor, flattenClosedTrades } from "../utils/tradeLogPnl";

const now = Date.now();
const proj = { strike: 7000, optSide: "CE" as const, entry: 10, targets: [14, 18, 24] as [number, number, number], stop: 6 };

test("stop close records the REAL fill, not the stop level (honest losses)", () => {
  const stopped = advanceOpenEntry(openNewEntry(proj, now), 4.2, now + 1000); // gapped below the ₹6 stop
  assert.equal(stopped.status, "sl_hit");
  assert.equal(stopped.exitPrice, 4.2);
  assert.equal(exitPriceFor(stopped), 4.2);
  assert.equal(Number((exitPriceFor(stopped) - stopped.entry).toFixed(2)), -5.8);
});

test("target3 close records the real fill (may exceed the target)", () => {
  const won = advanceOpenEntry(openNewEntry(proj, now), 25.5, now + 1000);
  assert.equal(won.status, "target3_hit");
  assert.equal(won.exitPrice, 25.5);
});

test("legacy entry without exitPrice falls back to the rule level", () => {
  const legacy: TradeLogEntry = { ...openNewEntry(proj, now), status: "sl_hit", closed: true, closedAt: now + 1 };
  delete (legacy as { exitPrice?: number }).exitPrice;
  assert.equal(exitPriceFor(legacy), 6);
});

test("the resurrect race: a client push cannot reopen a Cron-closed trade", () => {
  const openCopy = openNewEntry(proj, now);
  const serverClosed: TradeLogEntry = { ...openCopy, status: "sl_hit", closed: true, closedAt: now + 5000, exitPrice: 5.5 };
  const afterPost = mergeTradeLogs({ "BEST-CRUDEOIL": [openCopy] }, { "BEST-CRUDEOIL": [serverClosed] });
  assert.equal(afterPost["BEST-CRUDEOIL"][0].closed, true);
  assert.equal(afterPost["BEST-CRUDEOIL"][0].exitPrice, 5.5);
});

test("merge preserves a brand-new client key the Cron never saw", () => {
  const openCopy = openNewEntry(proj, now);
  const serverClosed: TradeLogEntry = { ...openCopy, status: "sl_hit", closed: true, closedAt: now + 5000 };
  const merged = mergeTradeLogs(
    { "BEST-CRUDEOIL": [openCopy], "TWENTY20-NATURALGAS-15": [openNewEntry({ ...proj, strike: 270 }, now + 100)] },
    { "BEST-CRUDEOIL": [serverClosed] }
  );
  assert.ok(merged["TWENTY20-NATURALGAS-15"]);
  assert.equal(merged["BEST-CRUDEOIL"][0].closed, true);
});

test("symbol recovery from any key shape", () => {
  assert.equal(symbolOfTradeLogKey("BEST-CRUDEOIL"), "CRUDEOIL");
  assert.equal(symbolOfTradeLogKey("TWENTY20-NATURALGAS-15"), "NATURALGAS");
  assert.equal(symbolOfTradeLogKey("LEVELCROSS-CRUDEOIL"), "CRUDEOIL");
  assert.equal(symbolOfTradeLogKey("nonsense"), null);
});

test("flattenClosedTrades uses the real fill for net points", () => {
  const stopped = advanceOpenEntry(openNewEntry(proj, now), 4.2, now + 1000);
  const realized = flattenClosedTrades({ "BEST-CRUDEOIL": [stopped] });
  assert.equal(realized.length, 1);
  assert.equal(realized[0].pnlPoints, -5.8);
});
