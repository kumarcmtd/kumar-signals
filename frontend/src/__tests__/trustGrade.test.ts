import { expect, test } from "vitest";
import { trustGrade } from "../utils/trustGrade";
import type { TradeVerdict } from "../utils/tradeVerdict";

const pass = (key: string) => ({ key, label: key, state: "pass", text: "" }) as TradeVerdict["checks"][number];
const best: Parameters<typeof trustGrade>[0] = {
  action: "TRADE_CE",
  side: "CE",
  checks: ["trend", "candles", "strength", "news", "zone", "oi"].map(pass),
  passed: 6,
  rr: 2.4,
  strength: 82,
  newsSide: "with",
  oiKind: "long-buildup",
  bounce: false,
};
const ctx = { minutesToClose: 300, optionDaysToExpiry: 6 };

test("a TRADE with every trust rule is a trust call, 11 of 11", () => {
  const g = trustGrade(best, ctx);
  expect(g).toMatchObject({ trusted: true, isTrade: true, score: 11, outOf: 11 });
});

test("each trust rule on its own blocks the trust grade", () => {
  expect(trustGrade({ ...best, strength: 70 }, ctx).trusted).toBe(false);
  expect(trustGrade({ ...best, newsSide: "neutral" }, ctx).trusted).toBe(false);
  expect(trustGrade({ ...best, oiKind: "no-data" }, ctx).trusted).toBe(false);
  expect(trustGrade({ ...best, oiKind: "short-covering" }, ctx).trusted).toBe(false);
  expect(trustGrade({ ...best, rr: 1.8 }, ctx).trusted).toBe(false);
  expect(trustGrade(best, { ...ctx, minutesToClose: 30 }).trusted).toBe(false);
  expect(trustGrade(best, { ...ctx, optionDaysToExpiry: 0 }).trusted).toBe(false);
});

test("a zone bounce may have the pullback's long unwinding; a WAIT is never trusted", () => {
  expect(trustGrade({ ...best, bounce: true, oiKind: "long-unwinding" }, ctx).trusted).toBe(true);
  expect(trustGrade({ ...best, action: "WAIT_CE" }, ctx)).toMatchObject({ trusted: false, isTrade: false });
  expect(trustGrade({ ...best, side: "PE", action: "TRADE_PE", oiKind: "short-buildup" }, ctx).trusted).toBe(true);
});
