import { expect, test } from "vitest";
import { scoreArticle } from "../utils/newsScoring";

const NOW = Date.parse("2026-10-14T17:00:00+05:30");
const art = (headline: string) => scoreArticle({ headline, summary: "", source: "World Oil", url: headline, publishedAt: new Date(NOW - 25 * 60_000).toISOString() }, NOW);

test("a strike on oil infrastructure is strongly bullish for crude", () => {
  const a = art("Aramco's Dhahran headquarters hit during Houthi missile attack on Saudi Arabia");
  expect(a.matchedRules).toContain("energyStrike");
  expect(a.impactScale).toBeGreaterThanOrEqual(4);
  expect(a.affectedMarket === "CRUDE" || a.affectedMarket === "BOTH").toBe(true);
  expect(art("Drone strike sets Ras Tanura oil terminal ablaze").impactScale).toBeGreaterThanOrEqual(4);
});

test("supply halts and escalation are bullish; de-escalation is strongly bearish", () => {
  expect(art("Libya declares force majeure at key export port").impactScale).toBeGreaterThanOrEqual(3);
  expect(art("Israel strikes Iran in retaliation for missile barrage").impactScale).toBeGreaterThanOrEqual(3);
  expect(art("Ceasefire agreed between Israel and Iran, talks progress").impactScale).toBeLessThanOrEqual(-3);
});

test("ordinary industry news stays neutral", () => {
  expect(art("Viking opens API-certified well completions facility in Saudi Arabia").impactScale).toBe(0);
  expect(Math.abs(art("TotalEnergies pledges further diesel price cuts in France amid oil crisis").impactScale)).toBeLessThanOrEqual(2);
});
