import { describe, expect, test } from "vitest";
import { prepare, simulate, signalAt, statsOf, ruleGrid, rulesLabel, CURRENT_RULES, LAB_COST_RS, type LabRules } from "../utils/twentyLab";
import type { Candle } from "../types";

// IST 2026-09-01 (Tue) as UTC ms for minute m of the day.
const day0 = Date.UTC(2026, 8, 1) - 5.5 * 3600_000;
const at = (d: number, m: number) => new Date(day0 + d * 86_400_000 + m * 60_000).toISOString();

/** Flat candles around 6000 from 09:00, then the given path from `fromMin`. */
function series(path: { o: number; h: number; l: number; c: number }[], fromMin = 18 * 60, days = 1): Candle[] {
  const out: Candle[] = [];
  for (let d = 0; d < days; d++) {
    for (let m = 9 * 60; m < 23 * 60 + 30; m += 5) {
      const k = d === days - 1 && m >= fromMin ? path[(m - fromMin) / 5] : undefined;
      out.push(k ? { date: at(d, m), open: k.o, high: k.h, low: k.l, close: k.c, volume: 300 } : { date: at(d, m), open: 6000, high: 6001, low: 5999, close: 6000, volume: 100 });
    }
  }
  return out;
}

// A rule set whose signal we control: breakout fires on a wide close above the last hour.
const BREAKOUT: LabRules = { signal: "breakout", mode: "always", minScore: 58, htf: "none", chop: "none", hours: "all", exits: "fixed", timeStop: false };

describe("Ai20-20 rules lab", () => {
  test("a clean run to T3 books +2.25 x Rs 2000 less costs, and the stop rule counts first on a two-sided candle", () => {
    // Breakout candle at 18:00 (close 6010, wide), then +40 (T1) ... +90 (T3) futures points for Crude at delta 0.5.
    const c = series([
      { o: 6000, h: 6010, l: 5999, c: 6010 },
      { o: 6010, h: 6052, l: 6009, c: 6050 }, // T1 (6050) hit
      { o: 6050, h: 6075, l: 6049, c: 6074 }, // T2 (6074) hit
      { o: 6074, h: 6101, l: 6073, c: 6100 }, // T3 (6100) hit
    ]);
    const p = prepare(c, false);
    const t = simulate(p, BREAKOUT, "CRUDEOIL");
    expect(t.length).toBeGreaterThanOrEqual(1); // a fresh breakout may re-enter after T3, as the page does
    expect(t[0].exit).toBe("t3");
    expect(t[0].t1).toBe(true);
    // 0.5 x 90 x 100 = 4500, less Rs 150 and 3 candles (15 min) of decay.
    expect(t[0].rs).toBe(Math.round(4500 - LAB_COST_RS.CRUDEOIL - 50 * 0.25));
  });

  test("stop first when one candle touches both; after T1 a fall to entry exits at breakeven", () => {
    const both = series([
      { o: 6000, h: 6010, l: 5999, c: 6010 },
      { o: 6010, h: 6060, l: 5980, c: 6000 }, // touches T1 and the stop (5986) -- counts as the stop
    ]);
    const t1 = simulate(prepare(both, false), BREAKOUT, "CRUDEOIL");
    expect(t1[0].exit).toBe("sl");
    expect(t1[0].rs).toBeLessThan(-1000);

    const be = series([
      { o: 6000, h: 6010, l: 5999, c: 6010 },
      { o: 6010, h: 6052, l: 6011, c: 6040 }, // T1
      { o: 6040, h: 6041, l: 6005, c: 6006 }, // back through entry -> breakeven
    ]);
    const t2 = simulate(prepare(be, false), BREAKOUT, "CRUDEOIL");
    expect(t2[0].exit).toBe("breakeven");
    expect(t2[0].t1).toBe(true);
    expect(t2[0].rs).toBeLessThan(0); // costs still paid
    expect(t2[0].rs).toBeGreaterThan(-300);
  });

  test("never held overnight: an open trade closes at the day's last candle", () => {
    const c = series([{ o: 6000, h: 6010, l: 5999, c: 6010 }, ...Array.from({ length: 60 }, () => ({ o: 6012, h: 6015, l: 6008, c: 6012 }))], 18 * 60, 2);
    const t = simulate(prepare(c, false), BREAKOUT, "CRUDEOIL");
    expect(t[0].exit).toBe("day_end");
    expect(t[0].closeIdx).toBeGreaterThan(t[0].openIdx);
  });

  test("filters only ever remove trades, and the evening filter keeps entries between 17:30 and 23:00 IST", () => {
    const c = series([{ o: 6000, h: 6010, l: 5999, c: 6010 }], 15 * 60);
    const p = prepare(c, false);
    const i = p.c.findIndex((k) => k.date === at(0, 15 * 60));
    expect(signalAt(p, i, BREAKOUT)).toBe("CE");
    expect(signalAt(p, i, { ...BREAKOUT, hours: "evening" })).toBeNull();
    expect(signalAt(p, i, { ...BREAKOUT, chop: "adx" })).toBeNull(); // flat morning: ADX far below 20
  });

  test("the grid covers the current rules once, and stats add up", () => {
    const labels = ruleGrid().map(rulesLabel);
    expect(labels.filter((l) => l === rulesLabel(CURRENT_RULES))).toHaveLength(1);
    expect(new Set(labels).size).toBe(labels.length);
    const c = series([
      { o: 6000, h: 6010, l: 5999, c: 6010 },
      { o: 6010, h: 6011, l: 5980, c: 5985 },
    ]);
    const p = prepare(c, false);
    const trades = simulate(p, BREAKOUT, "CRUDEOIL");
    const s = statsOf(trades, p, "x");
    expect(trades[0].exit).toBe("sl");
    expect(s.trades).toBe(trades.length);
    expect(s.netRs).toBe(trades.reduce((a, t) => a + t.rs, 0));
    expect(s.winPct).toBe(Math.round((trades.filter((t) => t.rs > 0).length / trades.length) * 100));
  });

  test("book half at T1: half earns T1, the rest exits at entry; one extra order charged", () => {
    const c = series([
      { o: 6000, h: 6010, l: 5999, c: 6010 },
      { o: 6010, h: 6052, l: 6011, c: 6040 }, // T1 (+40)
      { o: 6040, h: 6041, l: 6005, c: 6006 }, // back to entry
    ]);
    const t = simulate(prepare(c, false), { ...BREAKOUT, manage: "half" }, "CRUDEOIL");
    // 0.5 x (0.5 x 40 + 0.5 x 0) x 100 = 1000, less Rs150 + Rs50 and 10 min of decay
    expect(t[0].exit).toBe("breakeven");
    expect(t[0].rs).toBe(Math.round(1000 - 150 - 50 - 50 * (10 / 60)));
  });

  test("ATR trail: no targets; the stop follows the best earlier price", () => {
    const up = [{ o: 6000, h: 6010, l: 5999, c: 6010 }];
    for (let k = 1; k <= 8; k++) up.push({ o: 6010 + (k - 1) * 10, h: 6010 + k * 10 + 1, l: 6010 + (k - 1) * 10 - 1, c: 6010 + k * 10 });
    up.push({ o: 6090, h: 6091, l: 6040, c: 6045 }); // a sharp drop hits the trail
    const t = simulate(prepare(series(up), false), { ...BREAKOUT, manage: "chandelier", trailAtr: 3 }, "CRUDEOIL");
    expect(t[0].exit).toBe("after_t1"); // closed by the trail in profit, not at a fixed target
    expect(t[0].rs).toBeGreaterThan(0);
    expect(t[0].t1).toBe(true);
  });
});
