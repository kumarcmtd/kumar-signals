import { expect, test } from "vitest";
import { trendPulse } from "../utils/trendPulse";
import type { Candle } from "../types";

const pad = (n: number) => String(n).padStart(2, "0");
/** 5-minute candles from 09:00 IST; `move(i)` is each candle's close - open. */
function bars(n: number, move: (i: number) => number, start = 100): Candle[] {
  const out: Candle[] = [];
  let p = start;
  for (let i = 0; i < n; i++) {
    const m = 9 * 60 + i * 5;
    const o = p;
    const c = p + move(i);
    out.push({ date: `2026-10-13T${pad(Math.floor(m / 60))}:${pad(m % 60)}:00+05:30`, open: o, high: Math.max(o, c) + 0.1, low: Math.min(o, c) - 0.1, close: c });
    p = c;
  }
  return out;
}
const nowAfter = (n: number) => Date.parse(`2026-10-13T09:00:00+05:30`) + n * 5 * 60_000 + 60_000; // inside the next candle

test("a clean run of up candles is STEADY UP; mirrored down", () => {
  const up = bars(40, (i) => (i < 30 ? (i % 2 ? 0.3 : -0.3) : 0.5));
  expect(trendPulse(up, nowAfter(40))!.state).toBe("STEADY_UP");
  const down = bars(40, (i) => (i < 30 ? (i % 2 ? 0.3 : -0.3) : -0.5));
  expect(trendPulse(down, nowAfter(40))!.state).toBe("STEADY_DOWN");
});

test("candles flipping up and down are CHOPPY", () => {
  const chop = bars(40, (i) => (i % 2 ? 0.5 : -0.5));
  const p = trendPulse(chop, nowAfter(40))!;
  expect(p.state).toBe("CHOPPY");
  expect(p.bars.filter((b) => b === "up").length).toBe(3);
});

test("price far above its 20-EMA is STRETCHED, with a pullback level", () => {
  const run = bars(40, (i) => (i < 30 ? (i % 2 ? 0.3 : -0.3) : 1.2));
  const p = trendPulse(run, nowAfter(40))!;
  expect(p.stretched?.side).toBe("up");
  expect(p.stretched!.pullbackTo).toBeLessThan(run[run.length - 1].close);
});

test("the forming candle is ignored, and too little history gives nothing", () => {
  const up = bars(41, (i) => (i < 30 ? (i % 2 ? 0.3 : -0.3) : i === 40 ? -5 : 0.5));
  expect(trendPulse(up, nowAfter(40))!.state).toBe("STEADY_UP"); // the -5 bar is still forming
  expect(trendPulse(bars(10, () => 0.5), nowAfter(10))).toBeNull();
});
