import { describe, expect, test } from "vitest";
import { expiryBlock, measureV2, openV2Entry, planV2, readV2, v2Guard, v2PushText, v2Window, V2_RULES, type V2Read } from "../utils/twentyV2";
import { measureV2Async } from "../utils/twentyRecordClient";
import { prepare, signalAt } from "../utils/twentyLab";
import { openNewEntry, type TradeLogEntry } from "../utils/tradeLogCore";
import type { Candle, OptionsAnalytics } from "../types";

const utc = (s: string) => Date.parse(s);

describe("v2 window: 10:30-13:15 New York, never after 23:30 IST, weekdays", () => {
  test("winter (EST): 9:00 PM - 11:30 PM IST", () => {
    const before = v2Window(utc("2026-11-11T14:00:00Z")); // 7:30 PM IST Wed
    expect(before.open).toBe(false);
    expect(before.opensAt).toBe(utc("2026-11-11T15:30:00Z"));
    expect(before.label).toBe("9:00 PM – 11:30 PM IST");
    const during = v2Window(utc("2026-11-11T16:00:00Z"));
    expect(during.open).toBe(true);
    expect(during.closesAt).toBe(utc("2026-11-11T18:00:00Z")); // capped at 23:30 IST
    const after = v2Window(utc("2026-11-11T18:30:00Z")); // midnight IST
    expect(after.open).toBe(false);
    expect(after.opensAt).toBe(utc("2026-11-12T15:30:00Z"));
  });
  test("summer (EDT): 8:00 PM - 10:45 PM IST", () => {
    const w = v2Window(utc("2026-10-14T10:00:00Z"));
    expect(w.label).toBe("8:00 PM – 10:45 PM IST");
    expect(w.opensAt).toBe(utc("2026-10-14T14:30:00Z"));
  });
  test("weekend: next window is Monday", () => {
    const w = v2Window(utc("2026-11-14T12:00:00Z")); // Saturday
    expect(w.opensAt).toBe(utc("2026-11-16T15:30:00Z"));
  });
});

function entry(over: Partial<TradeLogEntry>, at: number): TradeLogEntry {
  return { ...openNewEntry({ strike: 5400, optSide: "CE", entry: 180, targets: [198, 209, 220], stop: 168 }, at), ...over };
}

describe("v2 guard", () => {
  const now = utc("2026-11-11T16:00:00Z");
  test("one call at a time", () => {
    expect(v2Guard([entry({}, now - 600_000)], "CE", now).ok).toBe(false);
  });
  test("no calls after two stop-losses in the day", () => {
    const log = [entry({ closed: true, status: "sl_hit", closedAt: now - 3_000_000 }, now - 3_600_000), entry({ closed: true, status: "sl_hit", closedAt: now - 1_200_000 }, now - 1_800_000)];
    const g = v2Guard(log, "PE", now);
    expect(g.ok).toBe(false);
    expect(g.stopsToday).toBe(2);
  });
  test("10-minute pause after a stop on the same side only", () => {
    const log = [entry({ closed: true, status: "sl_hit", closedAt: now - 300_000 }, now - 900_000)];
    expect(v2Guard(log, "CE", now).ok).toBe(false);
    expect(v2Guard(log, "PE", now).ok).toBe(true);
  });
  test("yesterday's stops do not count", () => {
    const y = now - 86_400_000;
    const log = [entry({ closed: true, status: "sl_hit", closedAt: y }, y - 600_000), entry({ closed: true, status: "sl_hit", closedAt: y + 60_000 }, y)];
    expect(v2Guard(log, "CE", now).ok).toBe(true);
  });
});

const read: V2Read = { state: "call", side: "CE", barEnd: utc("2026-11-11T15:35:00Z"), fut: 5412, atr: 12, stopPts: 24, t1Pts: 36, strength: 63, checks: [{ label: "1-hour trend agrees", ok: true, detail: "1-hour trend up" }], headline: "" };
const chain = (delta: number | null): OptionsAnalytics =>
  ({ symbol: "CRUDEOIL", atmStrike: 5400, expiry: "2026-11-17", rows: [{ strike: 5400, call: { ltp: 180, delta }, put: { ltp: 170, delta: delta === null ? null : -delta } }] }) as unknown as OptionsAnalytics;

describe("v2 option plan and entry", () => {
  test("levels move by the leg's delta; Rs per lot from the lot size", () => {
    const p = planV2(read, chain(0.5), "CRUDEOIL")!;
    expect(p.entry).toBe(180);
    expect(p.stop).toBe(168); // 180 - 0.5 x 24
    expect(p.targets).toEqual([198, 208.8, 220.5]); // +0.5 x 36, x1.6, x2.25
    expect(p.riskRs).toBe(1200);
    expect(p.t1Rs).toBe(1800);
  });
  test("a missing or silly delta falls back to 0.5", () => {
    expect(planV2(read, chain(null), "CRUDEOIL")!.delta).toBe(0.5);
    expect(planV2(read, chain(0.02), "CRUDEOIL")!.delta).toBe(0.5);
  });
  test("no plan unless it is a call with a live premium", () => {
    expect(planV2({ ...read, state: "watch" }, chain(0.5), "CRUDEOIL")).toBeNull();
    expect(planV2(read, undefined, "CRUDEOIL")).toBeNull();
  });
  test("page and server write the same entry for the same call", () => {
    const p = planV2(read, chain(0.5), "CRUDEOIL")!;
    const a = openV2Entry(p, read);
    const b = openV2Entry({ ...p, entry: 181 }, read);
    expect(a.id).toBe(b.id);
    expect(a.id).toBe(`5400-CE-${read.barEnd}`);
    expect(a.openedAt).toBe(read.barEnd);
  });
  test("push text: plan, why, record, caution", () => {
    const p = planV2(read, chain(0.5), "CRUDEOIL")!;
    const m = v2PushText({ displayName: "Crude Oil", plan: p, read, record: { trades: 11, avgRs: 2420, days: 15 }, cardLine: "agrees (TRADE CE)", caution: true });
    expect(m.title).toBe("⚡ Ai20-20: Crude Oil 5400 CE @ Rs 180");
    expect(m.body).toContain("Stop Rs 168 (-Rs 1,200/lot)");
    expect(m.body).toContain("T1 Rs 198 (+Rs 1,800/lot)");
    expect(m.body).toContain("Why: 1-hour trend up.");
    expect(m.body).toContain("last 15 days on MCX: 11 calls, average +Rs 2,420/lot");
    expect(m.body).toContain("CAUTION");
    expect(m.body).toContain("Trade Card: agrees (TRADE CE)");
  });
});

// Random-walk 5-min candles in MCX hours, with slow drifts so trends form.
function walk(days: number, seed: number): Candle[] {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const out: Candle[] = [];
  let px = 5400;
  let drift = 0;
  const start = utc("2026-10-01T00:00:00Z") - 5.5 * 3600_000;
  for (let d = 0; out.length < days * 174; d++) {
    const wd = new Date(start + d * 86_400_000 + 5.5 * 3600_000).getUTCDay();
    if (wd === 0 || wd === 6) continue;
    for (let m = 9 * 60; m < 23 * 60 + 30; m += 5) {
      if (rnd() < 0.02) drift = (rnd() - 0.5) * 3;
      const o = px;
      let h = o;
      let l = o;
      for (let k = 0; k < 5; k++) {
        px += drift / 5 + (rnd() + rnd() + rnd() - 1.5) * 3;
        h = Math.max(h, px);
        l = Math.min(l, px);
      }
      out.push({ date: new Date(start + d * 86_400_000 + m * 60_000).toISOString(), open: o, high: h, low: l, close: px, volume: 1000 });
    }
  }
  return out;
}

describe("v2 live read matches the lab's rules exactly", () => {
  const c = walk(14, 42);
  test("a call is made on exactly the candles where the lab's rule fires", () => {
    const p = prepare(c);
    let calls = 0;
    for (let i = c.length - 400; i < c.length; i++) {
      const now = Date.parse(c[i].date) + 5 * 60_000;
      const r = readV2(c.slice(0, i + 1), "CRUDEOIL", now);
      const lab = signalAt(p, i, V2_RULES);
      expect(r.state === "call").toBe(lab !== null);
      if (lab) {
        calls++;
        expect(r.side).toBe(lab);
        expect(r.stopPts).toBeCloseTo(2 * p.atr[i], 6);
      }
    }
    expect(calls).toBeGreaterThan(0);
  });
  test("the forming candle is ignored", () => {
    const now = Date.parse(c[c.length - 1].date) + 2 * 60_000; // last candle only 2 minutes old
    expect(readV2(c, "CRUDEOIL", now).barEnd).toBe(Date.parse(c[c.length - 2].date) + 5 * 60_000);
  });
  test("NG is off; too little history waits", () => {
    expect(readV2(c, "NATURALGAS", Date.parse(c[c.length - 1].date) + 300_000).state).toBe("off");
    const inWindow = utc("2026-11-11T16:00:00Z");
    expect(readV2(c.slice(0, 300), "CRUDEOIL", inWindow).state).toBe("no_data");
    // Market shut (no candles) outside the window: say when calls can come, not "loading".
    const shut = readV2([], "CRUDEOIL", utc("2026-11-11T00:30:00Z"));
    expect(shut.state).toBe("window_closed");
    expect(shut.headline).toContain("Next window opens 9:00 PM");
    expect(readV2([], "NATURALGAS", inWindow).state).toBe("off");
  });
  test("the measured record re-runs the v2 rules and the old rules", () => {
    const m = measureV2(c, "CRUDEOIL")!;
    expect(m.v2.trades).toBe(m.trades.length);
    expect(m.old!.trades).toBeGreaterThan(m.v2.trades);
    expect(m.caution).toBe(m.recent.trades >= 8 && (m.recent.avgRs ?? 0) < -300);
    expect(m.recent.trades).toBeLessThanOrEqual(m.v2.trades);
  });
});

describe("expiry day and the background record", () => {
  test("no new calls on the option's expiry day (IST date); the day before is fine", () => {
    const at = utc("2026-11-17T14:00:00Z"); // 19:30 IST on 17 Nov
    expect(expiryBlock({ ...chain(0.5), expiry: "2026-11-17" } as OptionsAnalytics, at)).toContain("expires today");
    expect(expiryBlock({ ...chain(0.5), expiry: "2026-11-18" } as OptionsAnalytics, at)).toBeNull();
    expect(expiryBlock(undefined, at)).toBeNull();
  });

  test("the record worked out off the page (no Worker in tests -> main-thread fallback) matches measureV2", async () => {
    const c = walk(12, 7);
    const direct = measureV2(c, "CRUDEOIL")!;
    const viaClient = (await measureV2Async(c, "CRUDEOIL"))!;
    expect(viaClient.v2).toEqual(direct.v2);
    expect(viaClient.old).toEqual(direct.old);
    expect(viaClient.caution).toBe(direct.caution);
    expect(viaClient.trades).toEqual([]); // the heavy list stays behind
  });
});
