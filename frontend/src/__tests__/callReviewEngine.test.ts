import { test } from "node:test";
import assert from "node:assert/strict";
import { reviewCall, medianWinnerMinutes, formatMinutes, MIN_WINNERS_FOR_MEDIAN, TOO_EARLY_MIN, type ReviewInput } from "../utils/callReviewEngine";
import type { Candle } from "../types";

const NOW = Date.UTC(2026, 8, 11, 6, 0, 0);
const minsAgo = (m: number) => NOW - m * 60_000;

// A rising 5-minute series, so superTrend reads bullish and ADX sees a trend.
function trendingCandles(dir: "up" | "down", n = 60): Candle[] {
  const out: Candle[] = [];
  let price = 100;
  for (let i = 0; i < n; i++) {
    const step = dir === "up" ? 0.6 : -0.6;
    const open = price;
    price += step;
    out.push({
      date: new Date(NOW - (n - i) * 5 * 60_000).toISOString(),
      open,
      high: Math.max(open, price) + 0.15,
      low: Math.min(open, price) - 0.15,
      close: price,
      volume: 1000,
      oi: 0,
    } as Candle);
  }
  return out;
}

// Crude: lot 100, entry ₹200 premium, ₹2000 goal = a 20-point premium move.
function call(over: Partial<ReviewInput> = {}): ReviewInput {
  return {
    optSide: "CE",
    direction: "bullish",
    entry: 200,
    stop: 180,
    targets: [220, 240, 260],
    targetsHit: [false, false, false],
    current: 210,
    peak: 210,
    openedAt: minsAgo(30),
    lotSize: 100,
    goalRs: 2000,
    thetaPerDay: -4,
    candles: trendingCandles("up"),
    medianWinnerMinutes: 20,
    now: NOW,
    ...over,
  };
}

const factor = (r: ReturnType<typeof reviewCall>, id: string) => r.factors.find((f) => f.id === id);

test("a call barely open is not judged at all", () => {
  const r = reviewCall(call({ openedAt: minsAgo(1) }));
  assert.equal(r.verdict, "early");
  assert.match(r.reason, /too soon to tell/);
});

test(`${TOO_EARLY_MIN} minutes is old enough to review`, () => {
  assert.notEqual(reviewCall(call({ openedAt: minsAgo(TOO_EARLY_MIN) })).verdict, "early");
});

test("profit and peak are rupees at one lot, not premium points", () => {
  // entry 200 -> now 210 on a 100 lot = ₹1,000; peak 224 = ₹2,400.
  const r = reviewCall(call({ current: 210, peak: 224 }));
  assert.equal(r.pnlRs, 1000);
  assert.equal(r.peakRs, 2400);
  assert.equal(r.goalProgressPct, 50);
});

test("give-back is measured against the RUN, not against the premium", () => {
  // Peaked +₹2,400, now +₹900: 1,500/2,400 = 62.5%, which rounds to 63.
  const r = reviewCall(call({ current: 209, peak: 224 }));
  assert.equal(r.giveBackPct, 63);
});

test("handing back a run that already cleared the goal is an exit", () => {
  const r = reviewCall(call({ current: 209, peak: 224 }));
  assert.equal(r.verdict, "exit");
  assert.match(r.headline, /Profit is coming down/i);
  assert.match(r.reason, /done its job/);
});

test("reaching the flat goal says take it, rather than inventing a new target", () => {
  const r = reviewCall(call({ current: 220, peak: 220 }));
  assert.equal(r.verdict, "trim");
  assert.match(r.headline, /Target reached/);
});

test("a rolled-over run short of the goal is a trim, not an exit", () => {
  // Peaked +₹1,500 (under the ₹2,000 goal), now +₹400 = 73% given back.
  const r = reviewCall(call({ current: 204, peak: 215 }));
  assert.equal(r.verdict, "trim");
  assert.match(r.headline, /The move has stopped/);
});

test("the tape flipping against a losing call is the clearest exit there is", () => {
  const r = reviewCall(call({ current: 195, peak: 202, candles: trendingCandles("down") }));
  assert.equal(r.verdict, "exit");
  assert.match(r.headline, /The move has turned/);
  assert.equal(factor(r, "tape")?.side, "against");
});

test("give-back does not apply once the call is underwater", () => {
  // Peaked +₹200, now -₹500. Naively that is "350% given back", which used to
  // out-rank the tape check and report a losing call as a momentum trim.
  const r = reviewCall(call({ current: 195, peak: 202 }));
  assert.equal(r.giveBackPct, null);
  assert.notEqual(r.verdict, "trim");
});

test("the tape flipping while ahead is a trim, not a panic exit", () => {
  const r = reviewCall(call({ current: 212, peak: 213, candles: trendingCandles("down") }));
  assert.equal(r.verdict, "trim");
  assert.match(r.headline, /but you are in profit/);
});

test("a PE is judged against a falling tape, mirroring the CE case", () => {
  // Falling underlying is what a PE wants: the tape is WITH it.
  const r = reviewCall(call({ optSide: "PE", direction: "bearish", candles: trendingCandles("down"), current: 210, peak: 210 }));
  assert.equal(factor(r, "tape")?.side, "for");
  assert.equal(r.verdict, "hold");
});

test("a working call with the tape onside is simply held", () => {
  const r = reviewCall(call({ current: 208, peak: 208 }));
  assert.equal(r.verdict, "hold");
  assert.match(r.reason, /way to the ₹2,000 target/);
});

test("an early slip from the high is a warning, not yet an instruction", () => {
  // Peaked +₹1,200, now +₹700 = 42% back: past the warn line, under the exit one.
  const r = reviewCall(call({ current: 207, peak: 212 }));
  assert.equal(r.verdict, "watch");
  assert.match(r.headline, /Coming down from the high/);
});

test("time decay is reported in rupees for the time actually held", () => {
  // |theta| 4/day x (30/1440) of a day = 0.083 premium points, x lot 100 = ₹8.
  const r = reviewCall(call({ thetaPerDay: -4, openedAt: minsAgo(30) }));
  assert.equal(r.thetaBurnedRs, 8);
  assert.match(factor(r, "theta")!.detail, /30 min/);
});

test("no live premium reviews nothing rather than guessing", () => {
  const r = reviewCall(call({ current: null }));
  assert.equal(r.verdict, "unknown");
  assert.equal(r.pnlRs, null);
  assert.equal(r.health, 0);
  assert.match(r.reason, /No number here is made up/);
});

test("a losing call open far longer than this page's winners is flagged as stale", () => {
  const r = reviewCall(call({ current: 196, peak: 201, openedAt: minsAgo(90), medianWinnerMinutes: 20 }));
  assert.equal(factor(r, "stale")?.side, "against");
  assert.match(factor(r, "stale")!.detail, /double the 20 min/);
});

test("health rises with profit and falls when the run is handed back", () => {
  const winning = reviewCall(call({ current: 218, peak: 218 })).health;
  const givenBack = reviewCall(call({ current: 202, peak: 218 })).health;
  assert.ok(winning > givenBack, `${winning} should beat ${givenBack}`);
});

test("the invalidation line names the real stop and the next paying level", () => {
  const r = reviewCall(call({ targetsHit: [true, false, false] }));
  assert.match(r.invalidation, /falls back to ₹180\.00, close this call/);
  assert.match(r.invalidation, /₹240\.00 is the next profit level/);
});

test("the median winner hold needs a real sample before it is used", () => {
  const few = Array.from({ length: MIN_WINNERS_FOR_MEDIAN - 1 }, (_, i) => ({ status: "target3_hit", openedAt: 0, closedAt: (i + 1) * 60_000 }));
  assert.equal(medianWinnerMinutes(few), null);

  const enough = Array.from({ length: MIN_WINNERS_FOR_MEDIAN }, (_, i) => ({ status: "target3_hit", openedAt: 0, closedAt: (i + 1) * 60_000 }));
  assert.equal(medianWinnerMinutes(enough), 3);
});

test("only winners count toward the typical hold, and unclosed trades are skipped", () => {
  const mixed = [
    ...Array.from({ length: MIN_WINNERS_FOR_MEDIAN }, () => ({ status: "target3_hit", openedAt: 0, closedAt: 10 * 60_000 })),
    // Losses and still-running trades say nothing about how long a WIN takes.
    { status: "sl_hit", openedAt: 0, closedAt: 999 * 60_000 },
    { status: "target3_hit", openedAt: 0, closedAt: null },
  ];
  assert.equal(medianWinnerMinutes(mixed), 10);
});

test("minute formatting stays readable past an hour", () => {
  assert.equal(formatMinutes(42), "42 min");
  assert.equal(formatMinutes(60), "1h");
  assert.equal(formatMinutes(95), "1h 35m");
});
