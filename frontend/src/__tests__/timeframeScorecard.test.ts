import { expect, test } from "vitest";
import { computeTimeframeScorecard, timeframeForKey } from "../utils/timeframeScorecard";
import type { TradeLogEntry } from "../utils/tradeLogCore";

let n = 0;
function closed(entry: number, exit: number): TradeLogEntry {
  n++;
  return {
    id: `t${n}`, strike: 300, optSide: "CE", entry, targets: [entry + 3, entry + 6, entry + 9], stop: entry - 3,
    targetsHit: [false, false, false], status: exit > entry ? "target3_hit" : "sl_hit", closed: true,
    openedAt: n * 1000, closedAt: n * 1000 + 500, exitPrice: exit,
  } as TradeLogEntry;
}
const many = (count: number, entry: number, exit: number) => Array.from({ length: count }, () => closed(entry, exit));

test("timeframe comes from the key, whatever the engine prefix", () => {
  expect(timeframeForKey("TWENTY20-NATURALGAS-15", "NATURALGAS")).toBe("15");
  expect(timeframeForKey("CRUDEOIL-240", "CRUDEOIL")).toBe("240");
  expect(timeframeForKey("AIRISK-CRUDEOIL-60", "CRUDEOIL")).toBe("60");
  expect(timeframeForKey("TWENTY20-NATURALGAS-LIVE", "NATURALGAS")).toBe("LIVE");
  expect(timeframeForKey("BEST-CRUDEOIL", "CRUDEOIL")).toBe("multi");
  expect(timeframeForKey("KIMI-CRUDEOIL-Breakout-30", "CRUDEOIL")).toBe("30");
});

test("pools every engine by timeframe, per symbol, in rupees at one lot", () => {
  const logs = {
    // NG 60m: 10 trades, 7 wins of +2 (₹2,500) and 3 losses of -1.5 (₹-1,875) -> net ₹11,875
    "NATURALGAS-60": [...many(7, 10, 12), ...many(3, 10, 8.5)],
    // NG 15m: 9 losers of -1 across two engines -> net ₹-11,250
    "SHOOT-NATURALGAS-15": many(5, 10, 9),
    "AIRISK-NATURALGAS-15": many(4, 10, 9),
    // NG 240m: only 3 trades -> too few to judge
    "NATURALGAS-240": many(3, 10, 14),
    // Crude 15m: 8 winners of +5 points (₹500 each)
    "CRUDEOIL-15": many(8, 100, 105),
  };
  const s = computeTimeframeScorecard(logs);
  const ng = s.NATURALGAS;
  expect(ng.rows.map((r) => r.tf)).toEqual(["240", "60", "15"]); // by net: 15,000 / 11,875 / -11,250
  const h1 = ng.rows.find((r) => r.tf === "60")!;
  expect(h1.net).toBe(11875);
  expect(h1.winRate).toBe(70);
  expect(h1.verdict).toBe("profitable");
  expect(ng.rows.find((r) => r.tf === "240")!.verdict).toBe("insufficient");
  const m15 = ng.rows.find((r) => r.tf === "15")!;
  expect(m15.verdict).toBe("losing");
  expect(m15.engines.map((e) => e.label).sort()).toEqual(["AI-Risk", "AI-Shoot"]);
  // The best is the best with ENOUGH trades, not the 3-trade 4-hour row.
  expect(ng.best!.tf).toBe("60");
  expect(s.CRUDEOIL.best!.tf).toBe("15");
  expect(s.CRUDEOIL.rows[0].net).toBe(4000);
});

test("no trades -> no best, no invented verdict", () => {
  const s = computeTimeframeScorecard({});
  expect(s.NATURALGAS.best).toBeNull();
  expect(s.CRUDEOIL.rows).toEqual([]);
});
