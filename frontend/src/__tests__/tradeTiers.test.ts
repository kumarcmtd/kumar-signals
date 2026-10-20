import { expect, test } from "vitest";
import { quickTier, trustTier, gradeTiers } from "../utils/tradeTiers";
import { advanceCall, maybeOpen } from "../utils/tradeCardLog";
import type { MarketChecklist, CheckItem } from "../utils/checklist";
import type { TradeVerdict } from "../utils/tradeVerdict";
import type { TrustGrade } from "../utils/trustGrade";
import type { Candle } from "../types";

const pad = (n: number) => String(n).padStart(2, "0");
function bars(day: string, tf: number, n: number, move: (i: number) => number, start = 100, vol: (i: number) => number = () => 1000): Candle[] {
  const out: Candle[] = [];
  let p = start;
  for (let i = 0; i < n; i++) {
    const m = 9 * 60 + i * tf;
    const o = p;
    const c = p + move(i);
    out.push({ date: `${day}T${pad(Math.floor(m / 60))}:${pad(m % 60)}:00+05:30`, open: o, high: Math.max(o, c) + 0.05, low: Math.min(o, c) - 0.05, close: c, volume: vol(i) });
    p = c;
  }
  return out;
}
const item = (id: string, state: CheckItem["state"]): CheckItem => ({ id, label: id, state, text: "" });
const mcWith = (items: CheckItem[]): MarketChecklist => ({ sections: [{ title: "x", items }], blocking: [], ok: true, levels: null, plan: null, ngFade: null, bias: "long", atr15: 1 });
const v = { side: "CE", newsSide: "with", checks: [{ key: "trend", label: "", state: "pass", text: "" }] } as unknown as TradeVerdict;
const g = { rules: [] } as unknown as TrustGrade;

test("trust: core must all pass, supporting needs 70% -- one weak indicator no longer blocks", () => {
  const core = ["h1", "m15", "eia", "room", "rr"].map((id) => item(id, "pass"));
  const support = ["rsi", "macd", "div", "vol", "oi", "flat", "sr", "pull", "m5"].map((id, i) => item(id, i < 2 ? "fail" : "pass"));
  const t = trustTier(v, mcWith([...core, ...support]), g, 300);
  expect(t.supportPct).toBe(80); // 8 of 10 (incl. expiry)
  expect(t.ok).toBe(true);
  // a single CORE failure blocks
  expect(trustTier(v, mcWith([...core.slice(1), item("h1", "fail"), ...support]), g, 300).ok).toBe(false);
  // too many weak supporting checks block
  const weak = support.map((x, i) => (i < 5 ? { ...x, state: "fail" as const } : x));
  expect(trustTier(v, mcWith([...core, ...weak]), g, 300).ok).toBe(false);
  // last 45 minutes block
  expect(trustTier(v, mcWith([...core, ...support]), g, 30).ok).toBe(false);
});

test("quick: a strong push, then a resting candle that holds half the push, is a QUICK trade", () => {
  // flat, then 3 strong green candles (push), then a small red resting candle
  const move = (i: number) => (i < 36 ? (i % 2 ? 0.25 : -0.25) : i < 39 ? 0.35 : -0.08);
  const c5 = bars("2026-10-16", 5, 40, move, 100, (i) => (i >= 36 && i < 39 ? 1600 : 1000));
  const c15 = bars("2026-10-15", 15, 40, (i) => (i < 39 ? (i % 2 ? 0.2 : -0.15) : 0.5), 99);
  const now = Date.parse("2026-10-16T12:21:00+05:30");
  const q = quickTier({ symbol: "CRUDEOIL", c5, c15, v: { buyerZone: null, sellerZone: null }, mc: { levels: null, bias: "long", atr15: 2 }, news: null, now, minutesToClose: 600 });
  expect(q.side).toBe("CE");
  expect(q.items.find((i) => i.id === "qpause")!.state).toBe("pass");
  expect(q.ok).toBe(true);
  expect(q.plan!.exitBy).toBe("12:50");
  // stop sits under the push's halfway point, not under the last candle's wick
  const pushStart = c5[35].close;
  const top = Math.max(c5[36].high, c5[37].high, c5[38].high);
  expect(q.plan!.stop).toBeLessThan((pushStart + top) / 2);
  expect(gradeTiers({ ok: false, core: [], support: [], supportPct: 0, failed: [] }, q).tier).toBe("quick");
});

test("quick: while the candles are still spiking, it waits (no buying the top)", () => {
  const move = (i: number) => (i < 36 ? (i % 2 ? 0.25 : -0.25) : 0.35); // push AND the last candle strong
  const c5 = bars("2026-10-16", 5, 40, move, 100, () => 1600);
  const c15 = bars("2026-10-15", 15, 40, (i) => (i < 39 ? (i % 2 ? 0.2 : -0.15) : 0.5), 99);
  const q = quickTier({ symbol: "CRUDEOIL", c5, c15, v: { buyerZone: null, sellerZone: null }, mc: { levels: null, bias: "long", atr15: 2 }, news: null, now: Date.parse("2026-10-16T12:21:00+05:30"), minutesToClose: 600 });
  expect(q.items.find((i) => i.id === "qpause")!.state).toBe("fail");
  expect(q.ok).toBe(false);
});

test("quick: no push, or a counter-trend push without news support, is not a trade", () => {
  const flat = bars("2026-10-16", 5, 40, (i) => (i % 2 ? 0.1 : -0.1));
  const c15 = bars("2026-10-15", 15, 40, (i) => (i % 2 ? 0.2 : -0.15), 99);
  const now = Date.parse("2026-10-16T12:21:00+05:30");
  expect(quickTier({ symbol: "CRUDEOIL", c5: flat, c15, v: { buyerZone: null, sellerZone: null }, mc: { levels: null, bias: null, atr15: 2 }, news: null, now, minutesToClose: 600 }).ok).toBe(false);
  const down = bars("2026-10-16", 5, 40, (i) => (i < 37 ? (i % 2 ? 0.1 : -0.1) : -0.4), 100, (i) => (i < 39 ? 1000 : 1600));
  const c15d = bars("2026-10-15", 15, 40, (i) => (i < 39 ? (i % 2 ? 0.15 : -0.2) : -0.5), 101);
  const q = quickTier({ symbol: "CRUDEOIL", c5: down, c15: c15d, v: { buyerZone: null, sellerZone: null }, mc: { levels: null, bias: "long", atr15: 2 }, news: null, now, minutesToClose: 600 });
  expect(q.side).toBe("PE");
  expect(q.counterTrend).toBe(true);
  expect(q.ok).toBe(false); // against the 1-hour trend needs news WITH it
});

test("a quick call that stalls is closed at its time stop", () => {
  const last = { date: "2026-10-16T12:15:00+05:30", open: 100, high: 100.5, low: 99.9, close: 100.4 };
  const call = maybeOpen([], "CRUDEOIL", { action: "TRADE_CE", side: "CE", stop: 99.5, t1: 102, reason: "" }, last, { tier: "quick", exitByIso: new Date(Date.parse("2026-10-16T12:50:00+05:30")).toISOString() })[0];
  const after = bars("2026-10-16", 5, 50, () => 0.01, 100.4).filter((c) => c.date >= "2026-10-16T12:20");
  const done = advanceCall(call, after, false);
  expect(done).toMatchObject({ closed: true, result: "time_exit", tier: "quick" });
  expect(Date.parse(done.closedAt!)).toBe(Date.parse("2026-10-16T12:50:00+05:30"));
});

test("circuit breaker: 60-min cool-off after a stop on that market, done for the day after 2 stops", async () => {
  const { dayGuard } = await import("../utils/tradeCardLog");
  const stopAt = (sym: "CRUDEOIL" | "NATURALGAS", iso: string) =>
    ({ id: sym + iso, symbol: sym, side: "CE", candleAt: "", openedAt: iso, entry: 1, stop: 0, t1: 2, reason: "", closed: true, result: "stop", exit: 0, closedAt: iso, pnlPts: -1, r: -1, bestPts: 0 }) as const;
  const one = [stopAt("CRUDEOIL", "2026-10-20T04:00:00.000Z")]; // 09:30 IST
  expect(dayGuard(one, "CRUDEOIL", Date.parse("2026-10-20T04:30:00.000Z")).blocked).toBe(true); // 10:00
  expect(dayGuard(one, "CRUDEOIL", Date.parse("2026-10-20T05:01:00.000Z")).blocked).toBe(false); // 10:31
  expect(dayGuard(one, "NATURALGAS", Date.parse("2026-10-20T04:30:00.000Z")).blocked).toBe(false); // other market fine
  const two = [...one, stopAt("NATURALGAS", "2026-10-20T06:00:00.000Z")];
  const g = dayGuard(two, "CRUDEOIL", Date.parse("2026-10-20T12:00:00.000Z"));
  expect(g.blocked).toBe(true);
  expect(g.reason).toMatch(/2 stop-losses today/);
  expect(dayGuard(two, "CRUDEOIL", Date.parse("2026-10-21T04:00:00.000Z")).blocked).toBe(false); // next day
});
