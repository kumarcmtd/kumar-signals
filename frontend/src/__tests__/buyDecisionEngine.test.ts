import { describe, expect, test } from "vitest";
import { evaluateBuyDecision, type DecisionInput } from "../utils/buyDecisionEngine";
import { closedOnly } from "../utils/decisionPillars";
import { resampleCandles, toIstStamp } from "../utils/candleResample";
import type { Candle } from "../types";

// Synthetic 15-minute sessions, 09:00-23:30 IST, Mon-Fri, ending just before
// Wed 23 Sep 2026 14:00 IST (market open).
const BAR = 15 * 60_000;
const IST = 5.5 * 3600_000;
const NOW = Date.parse("2026-09-23T14:00:00+05:30");

function sessionStarts(days: number): number[] {
  const out: number[] = [];
  const end = NOW;
  for (let d = days; d >= 0; d--) {
    const day = new Date(end - d * 86_400_000 + IST);
    const wd = day.getUTCDay();
    if (wd === 0 || wd === 6) continue;
    const open = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 9, 0) - IST;
    for (let t = open; t < open + 58 * BAR; t += BAR) if (t + BAR <= end) out.push(t);
  }
  return out;
}

/** drift = price change per bar; wobble = deterministic noise. */
/** drift per bar, plus swings of ~10 bars (pullbacks) and small noise. */
function market(drift: (i: number) => number, wobble = 0.6, days = 28, start = 300, wave = 1.1): Candle[] {
  let p = start;
  return sessionStarts(days).map((t, i) => {
    const o = p;
    p = p + drift(i) + Math.sin(i / 3.2) * wave + Math.sin(i * 1.7) * wobble;
    const hi = Math.max(o, p) + 0.25 + Math.abs(Math.cos(i)) * 0.3;
    const lo = Math.min(o, p) - 0.25 - Math.abs(Math.sin(i)) * 0.3;
    return { date: toIstStamp(t), open: o, high: hi, low: lo, close: p, volume: 1000 + ((i * 37) % 400), oi: 0 };
  });
}

function input(c15: Candle[], over: Partial<DecisionInput> = {}): DecisionInput {
  return { c15, c60: resampleCandles(c15, 60), c240: resampleCandles(c15, 240), now: NOW, marketOpen: true, ...over };
}

describe("verdicts", () => {
  test("a steady uptrend on every timeframe is BUY CE", () => {
    const r = evaluateBuyDecision(input(market(() => 0.35)))!;
    expect(r.verdict).toBe("BUY_CE");
    expect(r.timeframes.every((t) => t.direction === "bull")).toBe(true);
    expect(r.plan!.stop).toBeLessThan(r.plan!.entry);
    expect(r.plan!.t1).toBeGreaterThan(r.plan!.entry);
    expect(r.strength).toBeLessThanOrEqual(94);
  });

  test("a steady downtrend is BUY PE", () => {
    const r = evaluateBuyDecision(input(market(() => -0.35)))!;
    expect(r.verdict).toBe("BUY_PE");
    expect(r.plan!.stop).toBeGreaterThan(r.plan!.entry);
  });

  test("a flat, choppy market is WAIT and says what it is waiting for", () => {
    const r = evaluateBuyDecision(input(market(() => 0, 1.2, 28, 300, 0)))!;
    expect(r.verdict).toBe("WAIT");
    expect(r.waitingFor.length).toBeGreaterThan(0);
  });

  test("a 15-minute pop against a falling 1h/4h trend is NOT a buy", () => {
    const all = market(() => -0.3);
    const base = market((i) => (i < all.length - 8 ? -0.3 : 1.2));
    const r = evaluateBuyDecision(input(base))!;
    expect(r.verdict === "BUY_CE").toBe(false);
  });
});

describe("stability", () => {
  test("a spike on the candle still forming changes nothing", () => {
    const c15 = market(() => 0.35);
    const before = evaluateBuyDecision(input(c15))!;
    const last = c15[c15.length - 1];
    const forming = { ...last, date: toIstStamp(Date.parse(last.date) + BAR), open: last.close, high: last.close, low: last.close - 40, close: last.close - 40 };
    const after = evaluateBuyDecision(input([...c15, forming], { now: Date.parse(forming.date) + 5 * 60_000 }))!;
    expect(after.verdict).toBe(before.verdict);
    expect(after.bull).toBe(before.bull);
  });

  test("one bad closed candle inside an uptrend does not cancel the BUY", () => {
    const c15 = market(() => 0.35);
    const last = c15[c15.length - 1];
    const bad = { ...last, date: toIstStamp(Date.parse(last.date) + BAR), open: last.close, high: last.close + 0.2, low: last.close - 2.5, close: last.close - 2.2 };
    const r = evaluateBuyDecision(input([...c15, bad], { now: Date.parse(bad.date) + BAR }))!;
    expect(r.verdict).toBe("BUY_CE");
  });

  test("closedOnly drops only a bar that has not finished", () => {
    const c = market(() => 0.1).slice(-3);
    const lastStart = Date.parse(c[2].date);
    expect(closedOnly(c, 15, lastStart + 5 * 60_000, true)).toHaveLength(2);
    expect(closedOnly(c, 15, lastStart + BAR, true)).toHaveLength(3);
    expect(closedOnly(c, 15, lastStart + 5 * 60_000, false)).toHaveLength(3);
  });

  test("a BUY needs two qualifying closes: history shows when it started", () => {
    const r = evaluateBuyDecision(input(market(() => 0.35)))!;
    expect(r.since).not.toBeNull();
    expect(r.history.length).toBeGreaterThan(2);
  });
});

describe("overrides", () => {
  test("EIA within 45 minutes holds a BUY back", () => {
    const r = evaluateBuyDecision(input(market(() => 0.35), { eia: { minutesAway: 20, minutesSince: 9000, label: "EIA crude report" } }))!;
    expect(r.verdict).toBe("EVENT_WAIT");
    expect(r.cautions[0]).toContain("EIA");
  });

  test("market closed shows the last close's read, not a live BUY", () => {
    const r = evaluateBuyDecision(input(market(() => 0.35), { marketOpen: false }))!;
    expect(r.verdict).toBe("CLOSED");
  });

  test("too little history gives no verdict rather than a guess", () => {
    expect(evaluateBuyDecision(input(market(() => 0.35).slice(-30)))).toBeNull();
  });
});

describe("replayed candle by candle", () => {
  test("verdicts do not flicker, and never jump straight from CE to PE", () => {
    // Uptrend, a turn, then a downtrend -- with pullbacks throughout.
    const all = market((i) => (i < 700 ? 0.3 : -0.3), 0.8, 40);
    const seen: string[] = [];
    for (let end = 500; end <= 1000; end += 1) {
      const c15 = all.slice(0, end);
      const now = Date.parse(c15[c15.length - 1].date) + BAR;
      const r = evaluateBuyDecision(input(c15, { now }));
      if (r) seen.push(r.verdict.startsWith("BUY") ? r.verdict : "WAIT");
    }
    const runs: { v: string; n: number }[] = [];
    for (const v of seen) {
      if (runs.length && runs[runs.length - 1].v === v) runs[runs.length - 1].n++;
      else runs.push({ v, n: 1 });
    }
    // No direct CE <-> PE jump without a WAIT between them.
    for (let i = 1; i < runs.length; i++) expect(runs[i - 1].v !== "WAIT" && runs[i].v !== "WAIT").toBe(false);
    // BUY stretches last many candles, not one or two.
    const buys = runs.filter((r) => r.v !== "WAIT");
    expect(buys.length).toBeGreaterThan(0);
    const avg = buys.reduce((s, r) => s + r.n, 0) / buys.length;
    expect(avg).toBeGreaterThanOrEqual(6);
    expect(seen).toContain("BUY_CE");
    expect(seen).toContain("BUY_PE");
  });
});
