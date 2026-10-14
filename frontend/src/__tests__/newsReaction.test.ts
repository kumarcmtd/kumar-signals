import { expect, test } from "vitest";
import { newsReaction } from "../utils/newsReaction";
import type { Candle } from "../types";

const pad = (n: number) => String(n).padStart(2, "0");
const at = (min: number) => `2026-10-14T${pad(Math.floor(min / 60))}:${pad(min % 60)}:00+05:30`;
/** 5-minute candles from 10:00; each 1 point tall, so ATR ~1.2 and a typical hour ~4 points. */
function series(n: number, close: (i: number) => number): Candle[] {
  const out: Candle[] = [];
  let p = 100;
  for (let i = 0; i < n; i++) {
    const o = p;
    const c = close(i);
    out.push({ date: at(600 + i * 5), open: o, high: Math.max(o, c) + 0.5, low: Math.min(o, c) - 0.5, close: c });
    p = c;
  }
  return out;
}
const flatThen = (from: number, step: number) => (i: number) => (i < from ? 100 + (i % 2) * 0.2 : 100 + (i - from + 1) * step);

test("little move since the headline -> room left", () => {
  const c = series(40, flatThen(36, 0.2)); // headline at candle 35
  const r = newsReaction(c, at(600 + 35 * 5 + 2), 1)!;
  expect(r.read).toBe("room_left");
  expect(r.sinceAt).toBe("12:57");
  expect(r.gapFromClose).toBe(false);
});

test("a large move in the news direction -> done; partway -> partly priced", () => {
  expect(newsReaction(series(50, flatThen(36, 1)), at(600 + 35 * 5 + 2), 1)!.read).toBe("done");
  expect(newsReaction(series(40, flatThen(36, 0.8)), at(600 + 35 * 5 + 2), 1)!.read).toBe("partly_priced");
});

test("spiked then gave it back -> faded; went the other way -> ignored", () => {
  const spike = series(48, (i) => (i < 36 ? 100 + (i % 2) * 0.2 : i < 42 ? 100 + (i - 35) * 1.2 : 107.2 - (i - 41) * 1.1));
  expect(newsReaction(spike, at(600 + 35 * 5 + 2), 1)!.read).toBe("faded");
  expect(newsReaction(series(42, flatThen(36, -0.6)), at(600 + 35 * 5 + 2), 1)!.read).toBe("ignored");
});

test("a headline before any candle gives nothing", () => {
  expect(newsReaction(series(40, () => 100), "2026-10-14T05:00:00+05:30", 1)).toBeNull();
});
