import { test } from "node:test";
import assert from "node:assert/strict";
import { advanceEntry, withOptionPeak } from "../utils/superTrendProEngine";
import { peakProfitRs, milestoneStates } from "../utils/profitMilestones";
import type { SuperTrendLogEntry } from "../store/appStore";

// A tracked bullish Crude setup with its option leg pinned: ATM 9100 CE
// bought at a premium of 534, which is what the milestone card scores.
function openTrade(over: Partial<SuperTrendLogEntry> = {}): SuperTrendLogEntry {
  return {
    id: "CRUDEOIL-15-1",
    symbol: "CRUDEOIL",
    timeframe: "15",
    direction: "bullish",
    entry: 9400,
    stop: 9340,
    targets: [9440, 9480, 9520, 9560, 9600],
    targetsHit: [false, false, false, false, false],
    confidence: 80,
    status: "running",
    closed: false,
    openedAt: 1_000_000,
    closedAt: null,
    optStrike: 9100,
    optSide: "CE",
    optEntry: 534,
    optHighWaterMark: 534,
    ...over,
  };
}

test("the option peak climbs as the premium rises", () => {
  const t = withOptionPeak(openTrade(), 738);
  assert.equal(t.optHighWaterMark, 738);
});

test("the peak never falls back when the premium retraces", () => {
  const peaked = withOptionPeak(openTrade(), 738);
  const pulledBack = withOptionPeak(peaked, 600);
  assert.equal(pulledBack.optHighWaterMark, 738);
  assert.equal(pulledBack, peaked, "an unchanged peak returns the same object, so no pointless re-render");
});

test("a trade with no option leg is left untouched rather than guessed at", () => {
  const noLeg = openTrade({ optStrike: undefined, optSide: undefined, optEntry: undefined, optHighWaterMark: undefined });
  assert.equal(withOptionPeak(noLeg, 738), noLeg);
  assert.equal(withOptionPeak(noLeg, 738).optHighWaterMark, undefined);
});

test("a missing live premium leaves the stored peak alone", () => {
  const t = openTrade({ optHighWaterMark: 700 });
  assert.equal(withOptionPeak(t, null).optHighWaterMark, 700);
});

test("the peak is captured on the same tick the trade stops out", () => {
  // The premium spiked to 738 and the underlying broke the stop in the same
  // poll. If the close short-circuited before the peak was recorded, the
  // milestone ticks the trade had earned would vanish exactly when they
  // matter most.
  const stopped = advanceEntry(openTrade(), 9300, 738, 2_000_000);
  assert.equal(stopped.closed, true);
  assert.equal(stopped.status, "sl_hit");
  assert.equal(stopped.optHighWaterMark, 738, "peak must survive the stop-out");
});

test("a closed trade keeps its peak and is never advanced again", () => {
  const closed = openTrade({ closed: true, status: "sl_hit", closedAt: 2_000_000, optHighWaterMark: 738 });
  const after = advanceEntry(closed, 9200, 200, 3_000_000);
  assert.equal(after, closed);
  assert.equal(after.optHighWaterMark, 738);
});

test("milestone ticks earned before a stop-out still read from the stored peak", () => {
  const stopped = advanceEntry(openTrade(), 9300, 738, 2_000_000);
  // Crude lot is 100: (738 - 534) x 100 = ₹20,400 at its best.
  const peak = peakProfitRs(stopped.optEntry!, stopped.optHighWaterMark, 210, 100);
  assert.equal(peak, 20_400);
  assert.deepEqual(
    milestoneStates(peak).map((m) => m.hit),
    [true, true, true, true, true],
    "₹20,400 clears every milestone and they stay ticked after the stop"
  );
});

test("a bearish setup tracks its PE leg the same way, since both legs are long the premium", () => {
  const short = openTrade({ direction: "bearish", optSide: "PE", entry: 9400, stop: 9460, targets: [9360, 9320, 9280, 9240, 9200] });
  // Underlying falling is good for the PE, and the premium rising is the
  // same "peak" regardless of which way the underlying went.
  const t = withOptionPeak(short, 690);
  assert.equal(t.optHighWaterMark, 690);
  assert.equal(peakProfitRs(t.optEntry!, t.optHighWaterMark, 400, 100), 15_600);
});

test("futures target and stop logic still behaves after the peak change", () => {
  const hitT1 = advanceEntry(openTrade(), 9445, 560, 2_000_000);
  assert.deepEqual(hitT1.targetsHit, [true, false, false, false, false]);
  assert.equal(hitT1.closed, false);
  assert.equal(hitT1.optHighWaterMark, 560);

  const hitAll = advanceEntry(openTrade(), 9620, 900, 2_000_000);
  assert.equal(hitAll.status, "target5_hit");
  assert.equal(hitAll.closed, true);
});
