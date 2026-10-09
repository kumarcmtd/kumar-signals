import { expect, test } from "vitest";
import { liveMomentum } from "../utils/liveMomentum";
import type { Candle } from "../types";
import type { DecisionResult } from "../utils/buyDecisionEngine";

const pad = (n: number) => String(n).padStart(2, "0");
const at = (h: number, m: number) => `2026-10-08T${pad(h)}:${pad(m)}:00+05:30`;
const NOW = Date.parse(at(21, 37)); // forming 15-min candle started 21:30

/** Closed 15-min candles 09:00..21:15 around 100, each 1 point tall, then the forming 21:30 bar. */
function c15(formingClose: number): Candle[] {
  const out: Candle[] = [];
  for (let t = 9 * 60; t <= 21 * 60 + 15; t += 15) out.push({ date: at(Math.floor(t / 60), t % 60), open: 100, high: 100.5, low: 99.5, close: 100 });
  out.push({ date: at(21, 30), open: 100, high: Math.max(100, formingClose), low: Math.min(100, formingClose), close: formingClose });
  return out;
}
const five = (moves: [number, number][]): Candle[] => moves.map(([o, c], i) => ({ date: at(21, 30 + i * 5), open: o, high: Math.max(o, c), low: Math.min(o, c), close: c }));

const result = (verdict: DecisionResult["verdict"], side: "CE" | "PE" | null, stop?: number) =>
  ({ verdict, side, plan: stop !== undefined && side ? { side, entry: 100, stop, t1: 103, t2: 105, riskPts: 1, stopBasis: "", t1Basis: "" } : null }) as unknown as DecisionResult;

test("a CE buy still rising is HOLDING; the 5-minute candles are listed", () => {
  const r = liveMomentum(c15(101), five([[100, 100.6], [100.6, 101]]), result("BUY_CE", "CE", 98), NOW, true)!;
  expect(r.action).toBe("HOLDING");
  expect(r.sinceAt).toBe("21:15");
  expect(r.detail).toContain("since the 21:15 candle closed");
  expect(r.closesAt).toBe("21:45");
  expect(r.fiveMin).toEqual(["up", "up"]);
  expect(r.brokeHigh).toBe(true);
  expect(r.movePts).toBeCloseTo(1);
});

test("a CE setup dropping through the last candle's low is REVERSING", () => {
  const r = liveMomentum(c15(99.2), five([[100, 99.6], [99.6, 99.2]]), result("FORMING_CE", "CE"), NOW, true)!;
  expect(r.action).toBe("REVERSING");
  expect(r.tone).toBe("bad");
  expect(r.headline).toContain("don't buy");
});

test("a hair below the last candle's low is WEAKENING, not REVERSING", () => {
  // The last closed candle (21:15) is narrow: 99.9..100.1.
  const bars = c15(99.85).map((c) => (c.date === at(21, 15) ? { ...c, high: 100.1, low: 99.9 } : c));
  const r = liveMomentum(bars, [], result("BUY_CE", "CE", 98), NOW, true)!;
  expect(r.brokeLow).toBe(true);
  expect(r.action).toBe("WEAKENING");
});

test("a small dip against the side is WEAKENING, a flat tape is NO CHANGE", () => {
  const weak = liveMomentum(c15(99.8), five([[100, 99.8]]), result("BUY_CE", "CE", 98), NOW, true)!;
  expect(weak.action).toBe("WEAKENING");
  const flat = liveMomentum(c15(100.05), five([[100, 100.05]]), result("BUY_PE", "PE", 102), NOW, true)!;
  expect(flat.action).toBe("NO_CHANGE");
});

test("a PE buy is mirrored, and a broken stop overrides everything", () => {
  const pe = liveMomentum(c15(99), five([[100, 99.5], [99.5, 99]]), result("BUY_PE", "PE", 102), NOW, true)!;
  expect(pe.action).toBe("HOLDING");
  const stop = liveMomentum(c15(97.5), five([[100, 97.5]]), result("BUY_CE", "CE", 98), NOW, true)!;
  expect(stop.action).toBe("STOP_BROKEN");
});

test("WAIT shows plain direction; closed market or stale data gives nothing", () => {
  expect(liveMomentum(c15(101), five([[100, 101]]), result("WAIT", null), NOW, true)!.action).toBe("BULLISH");
  expect(liveMomentum(c15(101), [], result("WAIT", null), NOW, false)).toBeNull();
  expect(liveMomentum(c15(101), [], result("WAIT", null), Date.parse("2026-10-09T15:00:00+05:30"), true)).toBeNull();
});
