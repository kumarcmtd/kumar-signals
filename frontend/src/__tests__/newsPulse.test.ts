import { expect, test } from "vitest";
import { newsPulseFor, newsVsSide } from "../utils/newsPulse";
import type { ScoredNewsArticle } from "../utils/newsScoring";

const NOW = Date.parse("2026-10-13T20:00:00+05:30");
const art = (bull: number, bear: number, impactScale: number, minsAgo: number, market: "CRUDE" | "NG" = "CRUDE") =>
  ({
    headline: `story ${bull}-${bear}`, summary: "", source: "Reuters", url: `u${bull}${bear}${minsAgo}`,
    publishedAt: new Date(NOW - minsAgo * 60_000).toISOString(),
    affectedMarket: market, importance: 80, bullishScore: bull, bearishScore: bear, confidence: 70,
    sourceQualityPct: 90, recencyPct: 90, relevancePct: 90, marketImpactPct: 80, impactScale,
  }) as unknown as ScoredNewsArticle;

test("bullish war headlines read bullish for crude, with the strongest fresh story on top", () => {
  const n = newsPulseFor("CRUDEOIL", [art(90, 5, 4, 10), art(70, 10, 2, 50), art(10, 60, -1, 30, "NG")], null, new Date(NOW - 3 * 60_000).toISOString(), NOW);
  expect(n.direction).toBe("bullish");
  expect(n.highImpactFresh).toBe(1);
  expect(n.top!.ageMin).toBe(10);
  expect(n.feedAgeMin).toBe(3);
  expect(newsVsSide(n, "CE")).toBe("with");
  expect(newsVsSide(n, "PE")).toBe("strongly_against");
});

test("no relevant news is neutral, never a block", () => {
  const n = newsPulseFor("NATURALGAS", [art(90, 5, 4, 10)], null, null, NOW);
  expect(n.available).toBe(false);
  expect(newsVsSide(n, "CE")).toBe("neutral");
});
