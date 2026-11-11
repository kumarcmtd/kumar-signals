import { describe, expect, test } from "vitest";
import { buildPageReport, groupLabel, periodStart } from "../utils/pageReport";
import { ENGINES } from "../utils/aiEdgeEngine";
import type { TradeLogEntry } from "../store/appStore";

const now = Date.parse("2026-11-11T16:00:00Z"); // 21:30 IST
const H = 3600_000;
let n = 0;
function e(o: Partial<TradeLogEntry> & { openedAt: number }): TradeLogEntry {
  n++;
  return { id: `id${n}`, strike: 310, optSide: "CE", entry: 16, targets: [18, 19, 20], stop: 14, targetsHit: [false, false, false], status: "running", closed: false, closedAt: null, ...o } as TradeLogEntry;
}
const today = ENGINES.find((x) => x.id === "today")!;

describe("page trade report", () => {
  const logs: Record<string, TradeLogEntry[]> = {
    // NG 1h: a win (T2 hit, exit at T1 = 18), a stop (exit 13.9), a day-end close at 16.4
    "TODAY-NATURALGAS-60": [
      e({ openedAt: now - 30 * H, closedAt: now - 28 * H, closed: true, status: "stopped_after_t1", targetsHit: [true, true, false], exitPrice: 18 }),
      e({ openedAt: now - 6 * H, closedAt: now - 5 * H, closed: true, status: "sl_hit", exitPrice: 13.9 }),
      e({ openedAt: now - 3 * H, closedAt: now - 2 * H, closed: true, status: "closed_eod", exitPrice: 16.4 }),
      e({ openedAt: now - 1 * H }), // running
    ],
    // Crude 5m: two stops in a row today, the latest one closing last
    "TODAY-CRUDEOIL-5": [
      e({ strike: 5400, entry: 180, targets: [196, 207, 219], stop: 168, openedAt: now - 4 * H, closedAt: now - 3.5 * H, closed: true, status: "sl_hit", exitPrice: 167 }),
      e({ strike: 5400, entry: 180, targets: [196, 207, 219], stop: 168, openedAt: now - 1.5 * H, closedAt: now - 1 * H, closed: true, status: "sl_hit", exitPrice: 168 }),
    ],
    // Another page's log -- never in Ai-Today's report
    "TWENTY20-CRUDEOIL-V2": [e({ openedAt: now - 2 * H, closedAt: now - H, closed: true, status: "target3_hit", exitPrice: 300 })],
  };

  test("only this page's calls, counted like the cards, in Rs per lot after costs", () => {
    const r = buildPageReport(logs, today, { period: "all", market: "ALL", now });
    expect(r.closed).toBe(5);
    expect(r.running).toBe(1);
    expect(r.won).toBe(1);
    expect(r.stopped).toBe(3);
    expect(r.other).toBe(1);
    expect(r.winPct).toBe(25);
    expect(r.t1Pct).toBe(20);
    // NG lot 1250: (18-16) = +2500, (13.9-16) = -2625, (16.4-16) = +500. Crude lot 100: -1300, -1200.
    expect(r.grossRs).toBe(2500 - 2625 + 500 - 1300 - 1200);
    expect(r.netRs).toBe(r.grossRs - 3 * 200 - 2 * 150);
    expect(r.best?.rs).toBe(2500);
    expect(r.worst?.rs).toBe(-2625);
  });

  test("groups by timeframe and market; days newest first", () => {
    const r = buildPageReport(logs, today, { period: "all", market: "ALL", now });
    expect(r.groups.map((g) => g.label).sort()).toEqual(["1h", "5m"]);
    expect(r.markets.map((m) => m.label)).toEqual(["Crude Oil", "Natural Gas"]);
    expect(r.days[0].day >= r.days[r.days.length - 1].day).toBe(true);
  });

  test("the current run: three stop-losses in a row (the break-even is skipped)", () => {
    const r = buildPageReport(logs, today, { period: "all", market: "ALL", now });
    expect(r.streak).toEqual({ kind: "stopped", n: 3 });
  });

  test("period and market filters", () => {
    const todayOnly = buildPageReport(logs, today, { period: "today", market: "ALL", now });
    expect(todayOnly.closed).toBe(4); // the 30-hours-ago win is yesterday (IST)
    const ng = buildPageReport(logs, today, { period: "all", market: "NATURALGAS", now });
    expect(ng.closed).toBe(3);
    expect(ng.running).toBe(1);
    expect(periodStart("all", now)).toBeNull();
    expect(periodStart("today", now)).toBe(Date.parse("2026-11-10T18:30:00Z")); // IST midnight
  });

  test("a duplicate copy of one call from a second phone is skipped", () => {
    const dup = { ...logs["TODAY-NATURALGAS-60"][1], id: "dupcopy", openedAt: logs["TODAY-NATURALGAS-60"][1].openedAt + 60_000 };
    const withDup = { ...logs, "TODAY-NATURALGAS-60": [...logs["TODAY-NATURALGAS-60"].slice(0, 2), dup, ...logs["TODAY-NATURALGAS-60"].slice(2)] };
    const r = buildPageReport(withDup, today, { period: "all", market: "ALL", now });
    expect(r.closed).toBe(5);
    expect(r.duplicatesSkipped).toBe(1);
  });

  test("group labels from keys", () => {
    expect(groupLabel("TODAY-NATURALGAS-60", "NATURALGAS")).toBe("1h");
    expect(groupLabel("TWENTY20-CRUDEOIL-V2", "CRUDEOIL")).toBe("v2 rules");
    expect(groupLabel("TWENTY20-CRUDEOIL-LIVE", "CRUDEOIL")).toBe("old rules");
    expect(groupLabel("BEST-CRUDEOIL", "CRUDEOIL")).toBe("All calls");
    expect(groupLabel("CRUDEOIL-240", "CRUDEOIL")).toBe("4h");
  });

  test("Ai-Trust: calls from its own log are reported as-is (scoped), by tier", () => {
    const trust = { id: "trust", label: "Ai-Trust", prefix: "TRUST", route: "/ai-trust" };
    const scopedLogs = {
      "TRUST-CRUDEOIL-quick": [e({ strike: 5400, entry: 180, targets: [192, 200, 200], stop: 172, openedAt: now - 3 * H, closedAt: now - 2.5 * H, closed: true, status: "stopped_after_t1", targetsHit: [true, false, false], exitPrice: 192 })],
    };
    const r = buildPageReport(scopedLogs, trust, { period: "all", market: "ALL", now, scoped: true });
    expect(r.closed).toBe(1);
    expect(r.groups[0].label).toBe("Quick trades");
    expect(r.netRs).toBe(1200 - 150);
    // Without scoped, an unknown prefix is never claimed.
    expect(buildPageReport(scopedLogs, trust, { period: "all", market: "ALL", now }).closed).toBe(0);
  });
});
