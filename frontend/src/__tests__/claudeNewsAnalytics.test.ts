import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeTilt, rankMovers, breakingSince, bucketThemes, summariseSourceHealth, readFreshness,
  relativeAge, articleWeight, relevantTo,
} from "../utils/claudeNewsAnalytics";
import { scoreArticle } from "../utils/newsScoring";
import type { ScoredNewsArticle, RawNewsArticle } from "../utils/newsScoring";

const NOW = Date.UTC(2026, 8, 19, 6, 0, 0);

function raw(headline: string, opts: Partial<RawNewsArticle> = {}): RawNewsArticle {
  return {
    headline,
    summary: opts.summary ?? "",
    source: opts.source ?? "Reuters",
    publishedAt: opts.publishedAt ?? new Date(NOW - 10 * 60_000).toISOString(),
    url: opts.url ?? `https://www.reuters.com/${encodeURIComponent(headline.slice(0, 20))}`,
  };
}

function scored(headline: string, opts: Partial<RawNewsArticle> = {}): ScoredNewsArticle {
  return scoreArticle(raw(headline, opts), NOW);
}

// A hand-built article, for testing the maths directly without depending on
// which scoring rules happen to fire on a given sentence.
function synthetic(over: Partial<ScoredNewsArticle>): ScoredNewsArticle {
  const base = scored("Oil market update");
  return { ...base, ...over };
}

const MINUTES_AGO = (m: number) => new Date(NOW - m * 60_000).toISOString();

test("articleWeight falls with age, source tier and irrelevance", () => {
  const fresh = synthetic({ sourceTier: 1, publishedAt: MINUTES_AGO(5), relevancePct: 100 });
  const old = synthetic({ sourceTier: 1, publishedAt: MINUTES_AGO(2000), relevancePct: 100 });
  const lowTier = synthetic({ sourceTier: 4, publishedAt: MINUTES_AGO(5), relevancePct: 100 });
  const offTopic = synthetic({ sourceTier: 1, publishedAt: MINUTES_AGO(5), relevancePct: 10 });

  assert.equal(articleWeight(fresh, NOW), 1);
  assert.ok(articleWeight(old, NOW) < articleWeight(fresh, NOW));
  assert.ok(articleWeight(lowTier, NOW) < articleWeight(fresh, NOW));
  assert.ok(articleWeight(offTopic, NOW) < articleWeight(fresh, NOW));
});

test("articleWeight ignores a stale cached recencyPct and uses the real age", () => {
  // The Worker built this payload claiming the story was brand new, but it is
  // in fact two days old. The browser's own clock must win.
  const lying = synthetic({ sourceTier: 1, relevancePct: 100, recencyPct: 100, publishedAt: MINUTES_AGO(4000) });
  assert.equal(articleWeight(lying, NOW), 0);
});

test("relevantTo treats BOTH as relevant to either commodity", () => {
  assert.equal(relevantTo(synthetic({ affectedMarket: "BOTH" }), "CRUDE"), true);
  assert.equal(relevantTo(synthetic({ affectedMarket: "BOTH" }), "NG"), true);
  assert.equal(relevantTo(synthetic({ affectedMarket: "CRUDE" }), "NG"), false);
  assert.equal(relevantTo(synthetic({ affectedMarket: "NG" }), "CRUDE"), false);
});

test("an empty feed reports no usable news, not a neutral market", () => {
  const t = computeTilt([], "CRUDE", NOW);
  assert.equal(t.sampleSize, 0);
  assert.equal(t.strength, "none");
  assert.equal(t.score, 0);
  assert.match(t.note, /absence of data, not a neutral market/i);
});

test("bullish articles produce a positive tilt and bearish a negative one", () => {
  const bulls = [
    synthetic({ affectedMarket: "CRUDE", impactScale: 4, sourceTier: 1, publishedAt: MINUTES_AGO(5), relevancePct: 100 }),
    synthetic({ affectedMarket: "CRUDE", impactScale: 3, sourceTier: 2, publishedAt: MINUTES_AGO(5), relevancePct: 100 }),
  ];
  const bears = bulls.map((a) => ({ ...a, impactScale: -a.impactScale }));

  assert.ok(computeTilt(bulls, "CRUDE", NOW).score > 0);
  assert.equal(computeTilt(bulls, "CRUDE", NOW).direction, "bullish");
  assert.ok(computeTilt(bears, "CRUDE", NOW).score < 0);
  assert.equal(computeTilt(bears, "CRUDE", NOW).direction, "bearish");
});

test("a thin sample is labelled thin rather than presented as a reading", () => {
  const t = computeTilt([synthetic({ affectedMarket: "CRUDE", impactScale: 5, relevancePct: 100, publishedAt: MINUTES_AGO(5) })], "CRUDE", NOW);
  assert.equal(t.sampleSize, 1);
  assert.match(t.note, /too thin to lean on/i);
});

// The reason the tilt is an average and not a sum.
test("many small low-tier restatements cannot outvote one major story", () => {
  const oneBigOfficial = synthetic({ affectedMarket: "CRUDE", impactScale: -5, sourceTier: 1, publishedAt: MINUTES_AGO(5), relevancePct: 100 });
  const manySmallBlogs = Array.from({ length: 12 }, () =>
    synthetic({ affectedMarket: "CRUDE", impactScale: 1, sourceTier: 4, publishedAt: MINUTES_AGO(300), relevancePct: 40 })
  );
  const tilt = computeTilt([oneBigOfficial, ...manySmallBlogs], "CRUDE", NOW);
  assert.equal(tilt.direction, "bearish", "the single authoritative bearish story should still dominate");
});

test("stale news barely moves the tilt", () => {
  const freshBear = computeTilt(
    [synthetic({ affectedMarket: "NG", impactScale: -4, sourceTier: 1, publishedAt: MINUTES_AGO(5), relevancePct: 100 })],
    "NG",
    NOW
  );
  const staleBear = computeTilt(
    [synthetic({ affectedMarket: "NG", impactScale: -4, sourceTier: 1, publishedAt: MINUTES_AGO(1400), relevancePct: 100 })],
    "NG",
    NOW
  );
  // Same direction, but the stale one is built on a far smaller weight, which
  // is what the sample note and the meter position both reflect.
  assert.equal(freshBear.direction, "bearish");
  assert.ok(Math.abs(staleBear.score) <= Math.abs(freshBear.score));
});

test("crude news does not leak into the natural gas tilt", () => {
  const crudeOnly = [synthetic({ affectedMarket: "CRUDE", impactScale: 5, relevancePct: 100, publishedAt: MINUTES_AGO(5) })];
  assert.equal(computeTilt(crudeOnly, "NG", NOW).sampleSize, 0);
});

test("rankMovers puts a fresh moderate story above a stale huge one", () => {
  const staleHuge = synthetic({ headline: "STALE HUGE", impactScale: 5, sourceTier: 1, publishedAt: MINUTES_AGO(1400), relevancePct: 100, importance: 90 });
  const freshMid = synthetic({ headline: "FRESH MID", impactScale: 3, sourceTier: 1, publishedAt: MINUTES_AGO(5), relevancePct: 100, importance: 70 });
  const ranked = rankMovers([staleHuge, freshMid], "ALL", 5, NOW);
  assert.equal(ranked[0].headline, "FRESH MID");
});

test("rankMovers drops zero-impact noise entirely", () => {
  const noise = synthetic({ headline: "NOISE", impactScale: 0 });
  assert.equal(rankMovers([noise], "ALL", 5, NOW).length, 0);
});

test("breakingSince returns only recent items, newest first", () => {
  const a = scored("OPEC cuts production sharply", { publishedAt: new Date(NOW - 5 * 60_000).toISOString() });
  const b = scored("Natural gas storage build reported", { publishedAt: new Date(NOW - 40 * 60_000).toISOString() });
  const c = scored("Old crude story", { publishedAt: new Date(NOW - 300 * 60_000).toISOString() });

  const out = breakingSince([b, c, a], 60, NOW);
  assert.equal(out.length, 2);
  assert.equal(out[0].headline, a.headline, "newest should be first");
});

test("bucketThemes finds the subject and ignores subjects with no stories", () => {
  const themes = bucketThemes(
    [
      scored("Strait of Hormuz tanker attack disrupts oil shipping"),
      scored("EIA reports a large crude inventory build"),
    ],
    "ALL",
    NOW
  );
  const keys = themes.map((t) => t.key);
  assert.ok(keys.includes("geopolitics"));
  assert.ok(keys.includes("inventory"));
  assert.ok(!keys.includes("weather"), "no weather story was supplied, so no weather bucket");
  assert.ok(themes.every((t) => t.count > 0));
});

test("source health separates blocked feeds from moved ones", () => {
  const h = summariseSourceHealth([
    { source: "Yahoo Finance - WTI Crude", ok: true, count: 20 },
    { source: "OilPrice.com", ok: false, count: 0, error: "HTTP 403 Forbidden" },
    { source: "World Oil", ok: true, count: 0 },
  ]);
  assert.equal(h.liveCount, 1);
  assert.equal(h.totalCount, 3);
  assert.equal(h.articlesFromLive, 20);
  assert.equal(h.failing[0].source, "OilPrice.com");
  assert.equal(h.empty[0].source, "World Oil", "HTTP 200 with zero items is a moved feed, not a blocked one");
});

test("readFreshness calls an old feed stale", () => {
  const old = [scored("Old story", { publishedAt: new Date(NOW - 20 * 60 * 60_000).toISOString() })];
  const f = readFreshness(old, NOW);
  assert.equal(f.stale, true);
  assert.match(f.label, /stale/i);
});

test("readFreshness calls a minutes-old feed live", () => {
  const fresh = [scored("Breaking oil story", { publishedAt: new Date(NOW - 4 * 60_000).toISOString() })];
  const f = readFreshness(fresh, NOW);
  assert.equal(f.stale, false);
  assert.equal(f.withinLastHour, 1);
  assert.match(f.label, /live/i);
});

test("an empty feed is stale, never quietly fresh", () => {
  const f = readFreshness([], NOW);
  assert.equal(f.stale, true);
  assert.equal(f.newestAgeMinutes, null);
});

test("relativeAge never invents a timestamp", () => {
  assert.equal(relativeAge("not-a-date", NOW), "unknown time");
  assert.equal(relativeAge(new Date(NOW - 30 * 60_000).toISOString(), NOW), "30 min ago");
  assert.equal(relativeAge(new Date(NOW - 3 * 60 * 60_000).toISOString(), NOW), "3h ago");
  assert.equal(relativeAge(new Date(NOW - 2 * 24 * 60 * 60_000).toISOString(), NOW), "2d ago");
});
