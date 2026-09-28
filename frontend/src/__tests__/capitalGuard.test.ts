import { expect, test } from "vitest";
import { checkPosition, dayStatus, reviewTrades, sizePosition, type GuardPosition } from "../utils/capitalGuard";

test("sizing: lots come from the risk budget, capped by cost", () => {
  // ₹1L, 2% = ₹2,000. Crude 100/lot, premium 150, stop 135 -> ₹1,500/lot -> 1 lot.
  const r = sizePosition({ capital: 100_000, riskPct: 2, premium: 150, stopPremium: 135, lotSize: 100 });
  expect(r.riskBudget).toBe(2000);
  expect(r.riskPerLot).toBe(1500);
  expect(r.lots).toBe(1);
  expect(r.verdict).toBe("ok");
});

test("sizing: one NG lot with a 30% stop is too big for ₹1L at 2%, and says which stop would fit", () => {
  const r = sizePosition({ capital: 100_000, riskPct: 2, premium: 15, stopPremium: 10.5, lotSize: 1250 });
  expect(r.riskPerLot).toBe(5625);
  expect(r.lots).toBe(0);
  expect(r.verdict).toBe("too-big");
  expect(r.stopForOneLot).toBe(13.4); // 15 - 2000/1250
  expect(r.riskPctOfOneLot).toBeCloseTo(5.625);
});

test("sizing: cost cap stops one option eating the account", () => {
  const r = sizePosition({ capital: 100_000, riskPct: 50, premium: 200, stopPremium: 190, lotSize: 1250 });
  expect(r.lotsByCost).toBe(0); // one lot costs ₹2.5L
  expect(r.lots).toBe(0);
});

test("sizing: nonsense input is refused, not guessed", () => {
  expect(sizePosition({ capital: 100_000, riskPct: 2, premium: 10, stopPremium: 12, lotSize: 100 }).verdict).toBe("invalid");
});

// The user's own screenshot: 3 x NG 315 CE @ 20.50 (LTP 12.10), 2 x NG 310 CE @ 15 (LTP 13.70).
const p315: GuardPosition = { id: "a", symbol: "NATURALGAS", strike: 315, side: "CE", lots: 3, avg: 20.5, addedAt: 1 };
const p310: GuardPosition = { id: "b", symbol: "NATURALGAS", strike: 310, side: "CE", lots: 2, avg: 15, addedAt: 2 };

test("position check reproduces the broker's P&L and flags the rule breaks", () => {
  const c = checkPosition(p315, { ltp: 12.1, theta: -0.35 }, 100_000, 2, "PE", [p315, p310]);
  expect(c.pnl).toBeCloseTo(-31_500);
  expect(c.ruleStop).toBeCloseTo(19.97, 2); // 20.5 - 2000/3750
  expect(c.pastRuleStop).toBe(true);
  expect(c.decayPerDay).toBeCloseTo(1312.5);
  expect(c.chart).toBe("against");
  const text = c.flags.map((f) => f.text).join(" ");
  expect(text).toContain("rule stop");
  expect(text).toContain("32%"); // 31,500 of 1,00,000
  expect(text).toContain("averaging down");

  const d = checkPosition(p310, { ltp: 13.7, theta: null }, 100_000, 2, null, [p315, p310]);
  expect(d.pnl).toBeCloseTo(-3_250);
  expect(d.chart).toBe("unclear");
});

test("no live price: no P&L is invented", () => {
  const c = checkPosition(p315, null, 100_000, 2, null, [p315]);
  expect(c.pnl).toBeNull();
  expect(c.pastRuleStop).toBe(false);
});

test("daily limit states", () => {
  expect(dayStatus(100_000, 3, 500).state).toBe("ok");
  expect(dayStatus(100_000, 3, -2000).state).toBe("careful");
  expect(dayStatus(100_000, 3, -3000).state).toBe("stop");
  expect(dayStatus(100_000, 3, -29_125).usedPct).toBeCloseTo(970.8, 0);
});

test("journal review finds the leaks", () => {
  const t = (entry: string, exit: string, pnl: number) => ({ entryDate: entry, exitDate: exit, pnl, status: "CLOSED" as const });
  const r = reviewTrades(
    [
      t("2026-09-21T10:00:00+05:30", "2026-09-21T14:00:00+05:30", 3000),
      t("2026-09-21T15:00:00+05:30", "2026-09-21T18:00:00+05:30", 2500),
      t("2026-09-22T20:00:00+05:30", "2026-09-23T11:00:00+05:30", -9000),
      t("2026-09-24T20:00:00+05:30", "2026-09-25T10:00:00+05:30", -7000),
      { entryDate: "2026-09-26T10:00:00+05:30", status: "OPEN" as const },
    ],
    100_000
  );
  expect(r.closed).toBe(4);
  expect(r.winRate).toBe(50);
  expect(r.overnight).toEqual({ count: 2, pnl: -16000 });
  expect(r.sameDay).toEqual({ count: 2, pnl: 5500 });
  expect(r.lessons.join(" ")).toContain("average loss");
  expect(r.lessons.join(" ")).toContain("overnight");
  expect(r.lessons.join(" ")).toContain("9%");
});
