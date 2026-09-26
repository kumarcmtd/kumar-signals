import { test } from "vitest";
import assert from "node:assert/strict";
import { resampleCandles, toIstStamp, sessionBucketStart } from "../utils/candleResample";
import { istMinutesOfStamp } from "../utils/timeProfileEngine";

/** One 1-minute candle at an IST wall-clock time. */
function m1(date: string, hhmm: string, price: number, extra: { volume?: number; oi?: number } = {}) {
  return { date: `${date}T${hhmm}:00+05:30`, open: price, high: price + 1, low: price - 1, close: price, volume: extra.volume ?? 10, oi: extra.oi ?? 0 };
}

/** Every minute from `from` for `count` minutes, price rising 1 per minute. */
function minutes(date: string, from: string, count: number, startPrice = 100) {
  const [h, m] = from.split(":").map(Number);
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const total = h * 60 + m + i;
    const hhmm = `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
    out.push(m1(date, hhmm, startPrice + i, { oi: 5000 + i }));
  }
  return out;
}

test("stamps come out in Upstox's own +05:30 form, not UTC", () => {
  const ms = new Date("2026-09-24T09:00:00+05:30").getTime();
  assert.equal(toIstStamp(ms), "2026-09-24T09:00:00+05:30");
});

// The headline bug.
test("60-minute bars start at 09:00 IST, matching the MCX open and TradingView", () => {
  const bars = resampleCandles(minutes("2026-09-24", "09:00", 180), 60);
  assert.deepEqual(
    bars.map((b) => b.date),
    ["2026-09-24T09:00:00+05:30", "2026-09-24T10:00:00+05:30", "2026-09-24T11:00:00+05:30"],
    "the old epoch alignment produced 08:30 / 09:30 / 10:30 / 11:30"
  );
  assert.equal(bars[0].open, 100, "the first bar opens on the 09:00 minute");
  assert.equal(bars[0].close, 159, "and closes on the 09:59 minute");
});

test("240-minute bars are anchored to the open too", () => {
  const bars = resampleCandles(minutes("2026-09-24", "09:00", 8 * 60), 240);
  assert.deepEqual(bars.map((b) => b.date), ["2026-09-24T09:00:00+05:30", "2026-09-24T13:00:00+05:30"]);
});

test("15- and 30-minute bars are unchanged by the fix", () => {
  const b15 = resampleCandles(minutes("2026-09-24", "09:00", 45), 15);
  assert.deepEqual(b15.map((b) => b.date.slice(11, 16)), ["09:00", "09:15", "09:30"]);
  const b30 = resampleCandles(minutes("2026-09-24", "09:00", 60), 30);
  assert.deepEqual(b30.map((b) => b.date.slice(11, 16)), ["09:00", "09:30"]);
});

test("the anchor resets every session, so the next day starts at 09:00 again", () => {
  const bars = resampleCandles([...minutes("2026-09-24", "22:30", 60), ...minutes("2026-09-25", "09:00", 60)], 60);
  assert.deepEqual(bars.map((b) => b.date), [
    "2026-09-24T22:00:00+05:30",
    "2026-09-24T23:00:00+05:30",
    "2026-09-25T09:00:00+05:30",
  ]);
});

test("a bucket size that does not divide 24 hours still anchors to the open", () => {
  // 45 minutes -- epoch alignment would drift day to day; session anchoring cannot.
  const start = sessionBucketStart(new Date("2026-09-25T09:10:00+05:30").getTime(), 45);
  assert.equal(toIstStamp(start), "2026-09-25T09:00:00+05:30");
});

test("high, low, close and volume aggregate correctly", () => {
  const bars = resampleCandles(minutes("2026-09-24", "09:00", 15), 15);
  assert.equal(bars.length, 1);
  assert.equal(bars[0].open, 100);
  assert.equal(bars[0].high, 115, "the last minute's high");
  assert.equal(bars[0].low, 99, "the first minute's low");
  assert.equal(bars[0].close, 114);
  assert.equal(bars[0].volume, 150);
});

test("a bar's OI is the reading at its close, not its open", () => {
  const bars = resampleCandles(minutes("2026-09-24", "09:00", 15), 15);
  assert.equal(bars[0].oi, 5014, "the old code reported 5000, the previous bar's level");
});

test("a zero OI placeholder never overwrites a genuine reading", () => {
  const candles = [m1("2026-09-24", "09:00", 100, { oi: 7000 }), m1("2026-09-24", "09:01", 101, { oi: 7050 }), m1("2026-09-24", "09:02", 102, { oi: 0 })];
  assert.equal(resampleCandles(candles, 15)[0].oi, 7050);
});

test("resampled stamps read back to the right IST clock time", () => {
  // The consumer that exposed the UTC-stamp bug: hand-parsing the text.
  const bars = resampleCandles(minutes("2026-09-24", "09:00", 30), 15);
  assert.equal(istMinutesOfStamp(bars[1].date), 9 * 60 + 15, "09:15, not 03:45");
});

test("no candles gives no bars", () => {
  assert.deepEqual(resampleCandles([], 15), []);
});
