import { test } from "node:test";
import assert from "node:assert/strict";
import { paceEtaMin, historicalHold, formatDuration } from "../utils/holdTime";
import type { TradeLogEntry } from "../store/appStore";

function closed(entry: number, exit: number, openedAt: number, closedAt: number): TradeLogEntry {
  const status = exit > entry ? "target3_hit" : "sl_hit";
  return {
    id: `${openedAt}`,
    strike: 100,
    optSide: "CE",
    entry,
    stop: entry - 20,
    targets: [exit, exit + 5, exit + 10],
    targetsHit: [true, false, false],
    targetTouches: [1, 0, 0],
    openedAt,
    closedAt,
    closed: true,
    status,
    exitPrice: exit,
  } as unknown as TradeLogEntry;
}

test("paceEtaMin extrapolates remaining time from realized pace", () => {
  // entered at 200, now 220 after 10 min => 2/min; 20 more to 240 => ~10 min
  const eta = paceEtaMin(200, 220, Date.now() - 10 * 60000, 240);
  assert.ok(eta !== null);
  assert.ok(eta! >= 8 && eta! <= 12, `got ${eta}`);
});

test("paceEtaMin returns null when not progressing or too soon", () => {
  assert.equal(paceEtaMin(200, 195, Date.now() - 10 * 60000, 240), null); // below entry
  assert.equal(paceEtaMin(200, 210, Date.now() - 2 * 60000, 240), null); // too soon
  assert.equal(paceEtaMin(200, 245, Date.now() - 10 * 60000, 240), null); // already past target
});

test("historicalHold needs 3+ winners and returns their median duration", () => {
  assert.equal(historicalHold([]), null);
  const base = 1_000_000_000_000;
  const wins = [
    closed(100, 130, base, base + 30 * 60000), // 30 min
    closed(100, 130, base, base + 60 * 60000), // 60 min
    closed(100, 130, base, base + 90 * 60000), // 90 min
    closed(100, 80, base, base + 5 * 60000), // a loss, ignored
  ];
  const h = historicalHold(wins);
  assert.ok(h);
  assert.equal(h!.winCount, 3);
  assert.equal(h!.medianWinMin, 60);
});

test("formatDuration reads in plain minutes/hours", () => {
  assert.equal(formatDuration(45), "45 min");
  assert.equal(formatDuration(60), "1h");
  assert.equal(formatDuration(95), "1h 35m");
});
