import { describe, expect, test } from "vitest";
import { DEFAULT_PLAN, dayBudget, lotsFor, perTradeRs, sanitizePlan } from "../utils/twentyV3/riskPlan";
import { buildTicket, pickStrike } from "../utils/twentyV3/ticket";
import { callWindow, dayEvents } from "../utils/twentyV3/dayPlan";
import { stepsOf, v3CallPushText, v3DaySummaryText, v3StepPushText } from "../utils/twentyV3/push";
import type { OptionsAnalytics } from "../types";
import type { TradeLogEntry } from "../utils/tradeLogCore";

const ist = (s: string) => Date.parse(`${s}+05:30`);

function chain(over: Partial<OptionsAnalytics> = {}): OptionsAnalytics {
  const rows = [5300, 5350, 5400, 5450, 5500].map((strike) => ({
    strike,
    call: { ltp: Math.max(5, 5400 - strike + 150), oi: 1000, iv: 30, volume: 500, change: 0, changePercent: 0, delta: strike === 5400 ? 0.51 : strike === 5350 ? 0.6 : strike === 5300 ? 0.68 : strike === 5450 ? 0.42 : 0.33 },
    put: { ltp: Math.max(5, strike - 5400 + 150), oi: 1000, iv: 30, volume: 500, change: 0, changePercent: 0, delta: strike === 5400 ? -0.49 : strike === 5450 ? -0.58 : strike === 5500 ? -0.67 : strike === 5350 ? -0.4 : -0.32 },
  }));
  return { symbol: "CRUDEOIL", tradingSymbol: "CRUDEOIL", expiry: "2026-11-24", spot: 5402, atmStrike: 5400, pcr: 1, bias: "neutral", support: 5300, resistance: 5500, maxPain: 5400, rows, ...over } as OptionsAnalytics;
}

const entry = (over: Partial<TradeLogEntry> = {}): TradeLogEntry => ({
  id: "x",
  strike: 5400,
  optSide: "CE",
  entry: 150,
  targets: [162, 169.2, 177],
  stop: 142,
  targetsHit: [false, false, false],
  status: "running",
  closed: false,
  openedAt: ist("2026-11-16T21:05:00"),
  closedAt: null,
  ...over,
});

describe("my trade plan", () => {
  test("lots come from the per-trade risk; zero when one lot's stop is bigger than the budget", () => {
    expect(perTradeRs(DEFAULT_PLAN)).toBe(1000);
    expect(lotsFor(DEFAULT_PLAN, 800, 15_000).lots).toBe(1);
    expect(lotsFor({ ...DEFAULT_PLAN, riskPct: 2 }, 800, 15_000).lots).toBe(2);
    const none = lotsFor(DEFAULT_PLAN, 1500, 15_000);
    expect(none.lots).toBe(0);
    expect(none.why).toMatch(/more than your ₹1,000/);
    // Never more than half the capital in premium, never above max lots.
    expect(lotsFor({ ...DEFAULT_PLAN, riskPct: 3, maxLots: 10 }, 200, 30_000).lots).toBe(1);
    expect(lotsFor({ ...DEFAULT_PLAN, riskPct: 3, maxLots: 2 }, 200, 5_000).lots).toBe(2);
  });

  test("silly settings are pulled back into a safe range", () => {
    const p = sanitizePlan({ capitalRs: -5, riskPct: 50, dayLossPct: 0, maxTradesPerDay: 99, maxLots: 0 });
    expect(p).toEqual({ capitalRs: 10_000, riskPct: 3, dayLossPct: 1, maxTradesPerDay: 5, maxLots: 1 });
    expect(sanitizePlan(null)).toEqual(DEFAULT_PLAN);
  });

  test("the day stops at the loss limit or the trade cap", () => {
    const now = ist("2026-11-16T22:30:00");
    const lost = [entry({ closed: true, status: "sl_hit", closedAt: now - 60_000, exitPrice: 120 })]; // -30 x 100 = -3,000
    const b = dayBudget(DEFAULT_PLAN, lost, 100, 1, now);
    expect(b.bookedRs).toBe(-3000);
    expect(b.stopped).toMatch(/loss limit/);
    const three = [1, 2, 3].map((k) => entry({ id: `e${k}`, closed: true, status: "target3_hit", exitPrice: 177 }));
    expect(dayBudget(DEFAULT_PLAN, three, 100, 1, now).stopped).toMatch(/daily maximum/);
    expect(dayBudget(DEFAULT_PLAN, [], 100, 1, now).stopped).toBeNull();
  });
});

describe("order ticket", () => {
  test("picks the strike nearest delta 0.55; a little in the money near expiry", () => {
    const far = pickStrike(chain(), "CE", ist("2026-11-16T21:00:00"));
    expect(far?.strike).toBe(5400); // 0.51 is closer to 0.55 than 0.60
    const near = pickStrike(chain(), "CE", ist("2026-11-22T21:00:00")); // 2 days left -> aim 0.62
    expect(near?.strike).toBe(5350);
    expect(near?.why).toMatch(/in the money/);
    const put = pickStrike(chain(), "PE", ist("2026-11-16T21:00:00"));
    expect(put?.strike).toBe(5450); // put delta 0.58 is nearer 0.55 than the at-the-money 0.49
    expect(put?.inMoney).toBe(1);
  });

  test("illiquid in-the-money strikes are skipped; no chain, no ticket", () => {
    const c = chain();
    c.rows[1].call.oi = 10; // 5350 CE barely trades
    expect(pickStrike(c, "CE", ist("2026-11-22T21:00:00"))?.strike).not.toBe(5350);
    expect(pickStrike(undefined, "CE")).toBeNull();
    expect(pickStrike({ ...chain(), error: "down" } as OptionsAnalytics, "CE")).toBeNull();
  });

  test("levels move to the option by its delta, with rupees per lot", () => {
    const choice = pickStrike(chain(), "CE", ist("2026-11-16T21:00:00"))!;
    const t = buildTicket({ setup: "trend", side: "CE", stopPts: 20, t1Pts: 30, manage: "steps" }, choice, "CRUDEOIL");
    expect(t.entry).toBe(150);
    expect(t.stop).toBe(Number((150 - 0.51 * 20).toFixed(2)));
    expect(t.targets[0]).toBe(Number((150 + 0.51 * 30).toFixed(2)));
    expect(t.riskPerLot).toBe(Math.round((150 - t.stop) * 100));
    expect(t.maxPay).toBeLessThan(t.targets[0]);
    expect(t.maxPay).toBeGreaterThan(t.entry);
  });
});

describe("day plan", () => {
  test("the window is in IST and moves to the next weekday once today's is over", () => {
    const w = callWindow(["trend"], ist("2026-11-16T12:00:00"))!; // Monday, US winter
    expect(w.open).toBe(false);
    expect(w.label).toBe("9:05 PM – 11:30 PM IST");
    const fri = callWindow(["trend"], ist("2026-11-20T23:45:00"))!; // after Friday's window
    expect(new Date(fri.from + 5.5 * 3600_000).getUTCDay()).toBe(1);
    expect(callWindow([], Date.now())).toBeNull();
  });

  test("the all-day line watches 9:00 AM to the bell in IST; new calls stop 30 minutes before it", () => {
    const w = callWindow(["trendDay"], ist("2026-11-16T10:00:00"))!; // Monday, US winter: bell 11:55 PM
    expect(w.open).toBe(true);
    expect(w.label).toBe("9:00 AM – 11:55 PM IST");
    expect(w.to).toBe(ist("2026-11-16T23:25:00"));
    expect(w.bell).toBe(ist("2026-11-16T23:55:00"));
    const summer = callWindow(["trendDay"], ist("2026-07-13T10:00:00"))!; // US summer: bell 11:30 PM
    expect(summer.label).toBe("9:00 AM – 11:30 PM IST");
    expect(summer.to).toBe(ist("2026-07-13T23:00:00"));
    const early = callWindow(["trendDay"], ist("2026-11-17T08:30:00"))!;
    expect(early.open).toBe(false);
    expect(early.from).toBe(ist("2026-11-17T09:00:00"));
    const late = callWindow(["trendDay"], ist("2026-11-20T23:30:00"))!; // Friday, after the last new call
    expect(late.from).toBe(ist("2026-11-23T09:00:00"));
    // The opening drive alone is one moment; with the all-day line the page window spans the day.
    expect(callWindow(["driveStrict"], ist("2026-11-16T10:00:00"))!.label).toBe("at 8:00 PM IST");
    expect(callWindow(["driveStrict", "trendDay"], ist("2026-11-16T10:00:00"))!.label).toBe("9:00 AM – 11:55 PM IST");
  });

  test("Wednesday shows the EIA time in IST; expiry within 3 days is flagged", () => {
    const ev = dayEvents(chain({ expiry: "2026-11-20" }), ist("2026-11-18T10:00:00"));
    expect(ev.some((e) => e.label.includes("9:00 PM IST"))).toBe(true);
    expect(ev.some((e) => /expires in 2 days/.test(e.label))).toBe(true);
    expect(dayEvents(chain({ expiry: "2026-11-17" }), ist("2026-11-17T12:00:00")).some((e) => /expiry day/.test(e.label))).toBe(true);
  });
});

describe("phone alerts", () => {
  test("the call push carries the exact order and sizing; steps fire once each", () => {
    const choice = pickStrike(chain(), "CE", ist("2026-11-16T21:00:00"))!;
    const t = buildTicket({ setup: "trend", side: "CE", stopPts: 15, t1Pts: 22.5, manage: "steps" }, choice, "CRUDEOIL");
    const m = v3CallPushText({ displayName: "Crude Oil", t, setup: "trend", regime: "1-hour trend up", record: { trades: 9, avgRs: 900 } });
    expect(m.title).toContain("5400 CE");
    expect(m.body).toContain(`Stop Rs ${t.stop}`);
    expect(m.body).toMatch(/1 lot/);
    expect(m.body).not.toMatch(/guarantee|sure shot|100%/i);
    expect(stepsOf(entry())).toEqual([]);
    expect(stepsOf(entry({ targetsHit: [true, false, false] }))).toEqual(["t1"]);
    const t1 = v3StepPushText("Crude Oil", entry({ targetsHit: [true, false, false] }), "t1", 100);
    expect(t1.body).toMatch(/MOVE YOUR STOP UP TO YOUR ENTRY Rs 150/);
    const sl = v3StepPushText("Crude Oil", entry({ closed: true, status: "sl_hit", exitPrice: 141 }), "closed", 100);
    expect(sl.title).toContain("-Rs 900/lot");
    expect(sl.priority).toBe("urgent");
  });

  test("day summary adds up the day", () => {
    const s = v3DaySummaryText("Crude Oil", [entry({ closed: true, status: "target3_hit", exitPrice: 177 }), entry({ id: "y", closed: true, status: "sl_hit", exitPrice: 142 })], 100);
    expect(s.title).toBe("Ai20-20 Crude Oil today: +Rs 1,900/lot");
    expect(v3DaySummaryText("Crude Oil", [], 100).title).toMatch(/no call today/);
  });
});

describe("hold-to-close calls (opening drive)", () => {
  test("the stop never moves, T3 does not close it, the first stop does", async () => {
    const { advanceOpenEntry, effectiveStopFor } = await import("../utils/tradeLogCore");
    const now = ist("2026-11-16T20:10:00");
    let e = entry({ manage: "hold" });
    e = advanceOpenEntry(e, 163, now); // past T1
    expect(e.targetsHit[0]).toBe(true);
    expect(effectiveStopFor(e)).toBe(142);
    e = advanceOpenEntry(e, 180, now + 60_000); // past T3: still running
    expect(e.closed).toBe(false);
    e = advanceOpenEntry(e, 150, now + 120_000); // back at entry: a steps call would be out
    expect(e.closed).toBe(false);
    e = advanceOpenEntry(e, 141, now + 180_000);
    expect(e.closed).toBe(true);
    expect(e.status).toBe("sl_hit");
  });

  test("alerts: profit marks say hold; 15 minutes before the bell says sell", () => {
    const e = entry({ manage: "hold", targetsHit: [true, false, false] });
    expect(stepsOf(e, 40)).toEqual(["t1"]);
    expect(stepsOf(e, 12)).toEqual(["t1", "bell"]);
    expect(v3StepPushText("Crude Oil", e, "t1", 100).body).toMatch(/HOLDS TO THE CLOSE/);
    expect(v3StepPushText("Crude Oil", e, "bell", 100).body).toMatch(/SELL IT NOW/);
    expect(stepsOf(entry({ targetsHit: [true, false, false] }), 12)).toEqual(["t1"]); // steps calls: no bell alert
  });
});

describe("waiting before the evening window", () => {
  test("in the Indian morning the setup line gives the IST time of the next check", async () => {
    const { readV3 } = await import("../utils/twentyV3/live");
    const { prepare } = await import("../utils/twentyLab");
    const { computeFeatures } = await import("../utils/twentyV3/features");
    // A Monday morning: candles up to 9:40 AM IST from earlier sessions are enough for the read.
    const now = ist("2026-11-16T09:43:00");
    const c = [];
    let px = 5400;
    for (let d = 20; d >= 0; d--) {
      const day = Date.parse("2026-11-16T00:00:00+05:30") - d * 86_400_000;
      const wd = new Date(day + 5.5 * 3600_000).getUTCDay();
      if (wd === 0 || wd === 6) continue;
      for (let m = 9 * 60; m < 23 * 60 + 55; m += 5) {
        const t = day + m * 60_000;
        if (t + 5 * 60_000 > now) break;
        const o = px;
        px += Math.sin(t / 3.7e6) * 3;
        c.push({ date: new Date(t).toISOString(), open: o, high: Math.max(o, px) + 2, low: Math.min(o, px) - 2, close: px, volume: 100 });
      }
    }
    const p = prepare(c, 3);
    const r = readV3(c, "CRUDEOIL", now, { p, f: computeFeatures(p) });
    expect(r.state).toBe("window_closed");
    expect(r.setups[0].line).toBe("Checks once today at 8:00 PM IST (9:30 AM New York) — nothing to do before then.");
    // The all-day line is already watching at 9:43 AM.
    const { ENGINE_DAY } = await import("../utils/twentyV3/engines");
    const d = readV3(c, "CRUDEOIL", now, { p, f: computeFeatures(p) }, ENGINE_DAY);
    expect(["watch", "call"]).toContain(d.state);
    if (d.state === "watch") expect(d.setups[0].line).toMatch(/^Strength .* · new calls until 11:25 PM IST\.$/);
    // Before the 9:00 AM open it says when it starts, in IST, with no New York time.
    const before = ist("2026-11-16T08:30:00");
    const c0 = c.filter((k) => Date.parse(k.date) + 5 * 60_000 <= before);
    const p0 = prepare(c0, 3);
    const b = readV3(c0, "CRUDEOIL", before, { p: p0, f: computeFeatures(p0) }, ENGINE_DAY);
    expect(b.state).toBe("window_closed");
    expect(b.headline).toBe("Next check today at 9:00 AM IST.");
    expect(b.setups[0].line).toBe("Watches from today at 9:00 AM IST until the 11:55 PM IST bell (no new calls in its last 30 minutes) — nothing to do before then.");
  });
});
