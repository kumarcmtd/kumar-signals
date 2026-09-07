import { test } from "node:test";
import assert from "node:assert/strict";
import { ageMinutes, flashRecencyPct, heatFor, formatAge, directionOf, biasForScore, buildFlashItems, scoreFlash, analyzeFlash, FLASH_HALF_LIFE_MIN } from "../utils/aiFlashEngine";
import type { ScoredNewsArticle } from "../utils/newsScoring";

const NOW = Date.UTC(2026, 8, 7, 12, 0, 0);
const minsAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

function article(over: Partial<ScoredNewsArticle> = {}): ScoredNewsArticle {
  return {
    headline: "Headline", summary: "Summary", source: "Reuters", url: "https://example.com/a", publishedAt: minsAgo(5),
    affectedMarket: "CRUDE", importance: 80, bullishScore: 60, bearishScore: 0, confidence: 70,
    expectedMove: "bullish", timeImpact: "1h", matchedRules: ["war"], sourceTier: 2,
    relevancePct: 60, sourceQualityPct: 80, recencyPct: 100, marketImpactPct: 70, impactScale: 3,
    ...over,
  };
}

test("recency decays on a 90-minute half-life", () => {
  assert.equal(flashRecencyPct(0), 100);
  assert.equal(flashRecencyPct(FLASH_HALF_LIFE_MIN), 50);
  assert.equal(flashRecencyPct(2 * FLASH_HALF_LIFE_MIN), 25);
  // Past 48h a story contributes literally nothing to the score.
  assert.equal(flashRecencyPct(2881), 0);
});

test("a feed clock running ahead never reads as future-dated", () => {
  assert.equal(ageMinutes(new Date(NOW + 10 * 60_000).toISOString(), NOW), 0);
  assert.equal(ageMinutes("not-a-date", NOW), Number.POSITIVE_INFINITY);
});

test("heat bands and age labels", () => {
  assert.equal(heatFor(5), "flash");
  assert.equal(heatFor(40), "hot");
  assert.equal(heatFor(120), "recent");
  assert.equal(heatFor(600), "today");
  assert.equal(heatFor(5000), "stale");
  assert.equal(formatAge(0.2), "just now");
  assert.equal(formatAge(42), "42 min ago");
  assert.equal(formatAge(150), "2h 30m ago");
});

test("feed is ordered newest-first, not by importance", () => {
  // The old news page would rank the big old story first; AI Flash must not.
  const big = article({ headline: "Old but huge", importance: 100, publishedAt: minsAgo(300) });
  const small = article({ headline: "Fresh and small", importance: 40, publishedAt: minsAgo(3) });
  const items = buildFlashItems([big, small], "CRUDE", NOW);
  assert.equal(items[0].headline, "Fresh and small");
  assert.equal(items[0].heat, "flash");
});

test("BOTH-market articles count toward each symbol, others are filtered out", () => {
  const both = article({ affectedMarket: "BOTH", headline: "Dollar slumps" });
  const ngOnly = article({ affectedMarket: "NG", headline: "Cold snap" });
  assert.equal(buildFlashItems([both, ngOnly], "CRUDE", NOW).length, 1);
  assert.equal(buildFlashItems([both, ngOnly], "NG", NOW).length, 2);
});

test("fresh bullish wire news scores above 50 and flags direction", () => {
  const { pulse, items } = analyzeFlash(
    [
      article({ headline: "Tanker struck near Strait of Hormuz", url: "https://example.com/a" }),
      article({ headline: "Saudi Arabia deepens crude output cut", url: "https://example.com/b" }),
      article({ headline: "US crude inventories post surprise draw", url: "https://example.com/c" }),
    ],
    "CRUDE",
    NOW
  );
  assert.equal(items[0].direction, "bullish");
  assert.ok(pulse.score > 50, `expected bullish score, got ${pulse.score}`);
  assert.equal(pulse.bias === "bullish" || pulse.bias === "strong_bullish", true);
  assert.equal(pulse.freshCount, 3);
  assert.equal(pulse.quiet, false);
});

test("fresh bearish news scores below 50", () => {
  const bear = { bullishScore: 0, bearishScore: 70, matchedRules: ["opecIncrease"] };
  const { pulse } = analyzeFlash(
    [
      article({ ...bear, headline: "OPEC+ agrees to raise output next quarter", url: "https://example.com/a" }),
      article({ ...bear, headline: "Crude stockpiles climb to a nine-month high", url: "https://example.com/b" }),
      article({ ...bear, headline: "Ceasefire deal cools Middle East risk premium", url: "https://example.com/c" }),
    ],
    "CRUDE",
    NOW
  );
  assert.ok(pulse.score < 50, `expected bearish score, got ${pulse.score}`);
  assert.equal(pulse.bearishCount, 3);
});

test("no news at all returns an honest neutral 50 with zero confidence", () => {
  const pulse = scoreFlash([], "NG");
  assert.equal(pulse.score, 50);
  assert.equal(pulse.confidence, 0);
  assert.equal(pulse.quiet, true);
  assert.equal(pulse.topDriver, null);
});

test("a single stale low-tier post cannot print an extreme score", () => {
  const weak = article({ sourceTier: 4, sourceQualityPct: 25, relevancePct: 10, importance: 30, bullishScore: 100, bearishScore: 0, publishedAt: minsAgo(600) });
  const { pulse } = analyzeFlash([weak], "CRUDE", NOW);
  assert.ok(pulse.score < 70, `low-quality stale news must stay non-extreme, got ${pulse.score}`);
  assert.ok(pulse.confidence < 50, `confidence should stay low, got ${pulse.confidence}`);
});

test("the same story fresh outweighs the same story hours old", () => {
  const fresh = analyzeFlash([article({ publishedAt: minsAgo(2) })], "CRUDE", NOW).pulse.score;
  const old = analyzeFlash([article({ publishedAt: minsAgo(360) })], "CRUDE", NOW).pulse.score;
  assert.ok(fresh > old, `fresh ${fresh} should outrank old ${old}`);
});

test("topDriver is the highest weighted mover, not merely the newest", () => {
  const tiny = article({ headline: "Tiny newest", publishedAt: minsAgo(1), importance: 20, bullishScore: 15, bearishScore: 0, relevancePct: 10 });
  const mover = article({ headline: "Real mover", publishedAt: minsAgo(20), importance: 95, bullishScore: 80, bearishScore: 0, sourceTier: 1, sourceQualityPct: 100, relevancePct: 90 });
  const { items, pulse } = analyzeFlash([tiny, mover], "CRUDE", NOW);
  assert.equal(items[0].headline, "Tiny newest"); // feed order stays newest-first
  assert.equal(pulse.topDriver?.headline, "Real mover"); // but the driver is the mover
});

test("the same wire story syndicated across feeds collapses to one row", () => {
  const wire = "OPEC+ agrees to cut production by 1 million barrels per day";
  const copies = [
    article({ headline: wire, source: "OilPrice.com", sourceTier: 3, url: "https://oilprice.com/1", publishedAt: minsAgo(8) }),
    article({ headline: wire, source: "Reuters", sourceTier: 2, url: "https://reuters.com/1", publishedAt: minsAgo(9) }),
    article({ headline: `${wire} - update`, source: "CNBC", sourceTier: 2, url: "https://cnbc.com/1", publishedAt: minsAgo(10) }),
  ];
  const items = buildFlashItems(copies, "CRUDE", NOW);
  assert.equal(items.length, 1, "three copies of one story must read as one");
  // Of the copies, the better-sourced one wins the row.
  assert.equal(items[0].sourceTier, 2);
});

test("deduping stops one story from inflating the score ten times over", () => {
  const wire = "Massive explosion halts major crude pipeline indefinitely";
  const copies = Array.from({ length: 10 }, (_, i) => article({ headline: wire, url: `https://example.com/copy-${i}`, publishedAt: minsAgo(5) }));
  const oneCopy = analyzeFlash([copies[0]], "CRUDE", NOW).pulse.score;
  const tenCopies = analyzeFlash(copies, "CRUDE", NOW).pulse.score;
  assert.equal(tenCopies, oneCopy, "syndication must not multiply evidence mass");
});

test("genuinely different stories are not collapsed together", () => {
  const a = article({ headline: "Cold blast sweeps US Midwest lifting heating demand", url: "https://x/1", affectedMarket: "NG" });
  const b = article({ headline: "Freeport LNG restarts second liquefaction train", url: "https://x/2", affectedMarket: "NG" });
  assert.equal(buildFlashItems([a, b], "NG", NOW).length, 2);
});

test("bias thresholds map scores to labels", () => {
  assert.equal(biasForScore(85), "strong_bullish");
  assert.equal(biasForScore(60), "bullish");
  assert.equal(biasForScore(50), "neutral");
  assert.equal(biasForScore(35), "bearish");
  assert.equal(biasForScore(10), "strong_bearish");
  assert.equal(directionOf(0), "neutral");
  assert.equal(directionOf(-40), "bearish");
});
