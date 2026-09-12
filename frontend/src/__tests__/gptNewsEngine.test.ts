import { test } from "node:test";
import assert from "node:assert/strict";
import {
  categoriesFor, horizonFor, verificationFor, strengthFor, priorityFor, confidenceBand,
  buildGptNewsItems, sortItems, breakingItems, applyFilters, countryRisks, chokepointReads,
  weatherRead, crudePanel, ngPanel, intelligenceFor, sessionInfo, openingBiasEstimate,
  eiaScheduleEvents, upcomingEvents, readPosition, evaluateAlerts, LOT_SIZE, EMPTY_FILTERS,
  DEFAULT_ALERT_RULES, type GptNewsItem,
} from "../utils/gptNewsEngine";
import type { NewsEvent, ScoredNewsArticle } from "../utils/newsScoring";

const NOW = Date.UTC(2026, 8, 11, 6, 0, 0); // Friday 11 Sep 2026, 11:30 IST
const minsAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

function event(over: Partial<NewsEvent> = {}): NewsEvent {
  return {
    id: over.id ?? `evt-${Math.random()}`,
    title: "Oil steady in quiet trade",
    articleCount: 1,
    sources: ["Reuters"],
    primarySource: "Reuters",
    primaryUrl: "https://example.com/a",
    affectedMarket: "CRUDE",
    impactScale: 0,
    relevancePct: 40,
    sourceQualityPct: 80,
    recencyPct: 100,
    confidencePct: 60,
    publishedAt: minsAgo(10),
    whyItMatters: "why",
    expectedEffect: "effect",
    matchedRules: [],
    ...over,
  };
}

function article(over: Partial<ScoredNewsArticle> = {}): ScoredNewsArticle {
  return {
    headline: "Oil steady in quiet trade",
    summary: "A summary.",
    source: "Reuters",
    publishedAt: minsAgo(10),
    url: "https://example.com/a",
    affectedMarket: "CRUDE",
    importance: 50,
    bullishScore: 0,
    bearishScore: 0,
    confidence: 60,
    expectedMove: "neutral",
    timeImpact: "1h",
    matchedRules: [],
    sourceTier: 2,
    relevancePct: 40,
    sourceQualityPct: 80,
    recencyPct: 100,
    marketImpactPct: 50,
    impactScale: 0,
    ...over,
  };
}

const build = (events: NewsEvent[], articles: ScoredNewsArticle[] = []) => buildGptNewsItems(events, articles, NOW);

// ---- Categories, horizon, verification ----

test("a story lands under every tab it genuinely belongs to", () => {
  const cats = categoriesFor("Houthi drone attack halts LNG tanker near Bab el-Mandeb", "BOTH");
  assert.ok(cats.includes("crude"));
  assert.ok(cats.includes("gas"));
  assert.ok(cats.includes("war"));
  assert.ok(cats.includes("lng"));
  assert.ok(!cats.includes("opec"));
});

test("the fastest-acting matched rule sets the horizon", () => {
  // sanctions is a 1-3 day story, a pipeline explosion moves the tape in minutes.
  assert.equal(horizonFor(["sanctions", "pipelineExplosion"]), "minutes");
  assert.equal(horizonFor(["sanctions"]), "1-3 days");
  assert.equal(horizonFor([]), "1-3 days");
});

test("one outlet is never enough to call a story confirmed unless it is the source itself", () => {
  assert.equal(verificationFor(1, 1), "confirmed", "EIA/OPEC publishing their own number is the source");
  assert.equal(verificationFor(2, 1), "developing", "a single wire is still developing");
  assert.equal(verificationFor(2, 2), "confirmed", "two independent wires corroborate");
  assert.equal(verificationFor(4, 3), "unconfirmed");
});

// ---- Strength: the spec's central anti-hype rule ----

test("VERY HIGH needs four signals to agree, not one loud keyword", () => {
  const strong = { absImpact: 5, sourceQualityPct: 100, sourceCount: 2, bestTier: 1, recencyPct: 90 };
  assert.equal(strengthFor(strong), "very_high");
  // Each single missing leg caps it at HIGH.
  assert.equal(strengthFor({ ...strong, sourceCount: 1, bestTier: 2 }), "high", "no corroboration");
  assert.equal(strengthFor({ ...strong, recencyPct: 20 }), "high", "stale");
  assert.equal(strengthFor({ ...strong, sourceQualityPct: 55 }), "high", "weak source");
});

test("an unconfirmed report can never be a Level 5 market shock", () => {
  const base = { strength: "very_high" as const, ageMin: 5, direction: "bullish" as const };
  assert.equal(priorityFor({ ...base, verification: "confirmed" }), 5);
  assert.equal(priorityFor({ ...base, verification: "developing" }), 4);
  assert.equal(priorityFor({ ...base, verification: "unconfirmed" }), 3);
});

test("yesterday's news stops being urgent however big it was", () => {
  const base = { strength: "very_high" as const, verification: "confirmed" as const, direction: "bullish" as const };
  assert.equal(priorityFor({ ...base, ageMin: 30 }), 5);
  assert.equal(priorityFor({ ...base, ageMin: 300 }), 3);
  assert.equal(priorityFor({ ...base, ageMin: 1500 }), 2);
});

test("confidence bands read the way the labels claim", () => {
  assert.equal(confidenceBand(82), "high");
  assert.equal(confidenceBand(50), "medium");
  assert.equal(confidenceBand(20), "low");
});

// ---- Item building ----

test("an event becomes one item carrying every outlet that reported it", () => {
  const [item] = build([event({ sources: ["Reuters", "Bloomberg", "AP"], title: "Saudi pipeline attacked and shut", impactScale: 4, matchedRules: ["pipelineExplosion"] })]);
  assert.equal(item.sourceCount, 3);
  assert.deepEqual(item.sources, ["Reuters", "Bloomberg", "AP"]);
  assert.equal(item.direction, "bullish");
  assert.equal(item.horizon, "minutes");
});

test("the summary comes from the real article, never invented when absent", () => {
  const [withArticle] = build([event()], [article({ summary: "Real summary text." })]);
  assert.equal(withArticle.summary, "Real summary text.");
  const [without] = build([event({ primaryUrl: "https://example.com/missing", title: "Nothing matches this" })]);
  assert.equal(without.summary, "", "no article means an empty summary, not a generated one");
});

test("marks are awarded per commodity, and a BOTH story counts for each", () => {
  const [both] = build([event({ affectedMarket: "BOTH", impactScale: 3 })]);
  assert.equal(both.crudeMarks, 3);
  assert.equal(both.gasMarks, 3);
  const [crudeOnly] = build([event({ affectedMarket: "CRUDE", impactScale: 3 })]);
  assert.equal(crudeOnly.crudeMarks, 3);
  assert.equal(crudeOnly.gasMarks, 0);
});

test("the feed can be ranked by importance or by clock, and they differ", () => {
  const items = build([
    event({ id: "old-big", title: "OPEC cuts production sharply", publishedAt: minsAgo(90), impactScale: 4, sources: ["Reuters", "Bloomberg"], sourceQualityPct: 100, recencyPct: 80, matchedRules: ["opecCut"] }),
    event({ id: "new-small", title: "Minor refinery note", publishedAt: minsAgo(2), impactScale: 1, sourceQualityPct: 55 }),
  ]);
  assert.equal(sortItems(items, "importance")[0].id, "old-big");
  assert.equal(sortItems(items, "newest")[0].id, "new-small");
});

// ---- Breaking ----

test("breaking never promotes a rumour, however dramatic", () => {
  const rumour = event({ id: "rumour", title: "Reports of a strike on Hormuz shipping", impactScale: 5, sources: ["SomeBlog"], sourceQualityPct: 25, matchedRules: ["hormuz", "war"] });
  const solid = event({ id: "solid", title: "OPEC cuts production", impactScale: 4, sources: ["Reuters", "Bloomberg"], sourceQualityPct: 100, matchedRules: ["opecCut"] });
  const breaking = breakingItems(build([rumour, solid]));
  assert.deepEqual(breaking.map((b) => b.id), ["solid"]);
});

test("a big story from yesterday is not breaking today", () => {
  const stale = event({ title: "OPEC cuts production", impactScale: 4, publishedAt: minsAgo(600), sources: ["Reuters", "Bloomberg"], sourceQualityPct: 100, recencyPct: 20, matchedRules: ["opecCut"] });
  assert.equal(breakingItems(build([stale])).length, 0);
});

// ---- Filters and search ----

test("filters narrow on time, asset, impact, source and free text together", () => {
  const items = build([
    event({ id: "a", title: "Hormuz tanker attacked", affectedMarket: "CRUDE", impactScale: 4, publishedAt: minsAgo(5), sources: ["Reuters", "Bloomberg"], sourceQualityPct: 100, matchedRules: ["hormuz"] }),
    event({ id: "b", title: "Gas storage builds", affectedMarket: "NG", impactScale: -2, publishedAt: minsAgo(200), sources: ["OilPrice"], sourceQualityPct: 55, matchedRules: ["storageBuild"] }),
  ]);
  assert.deepEqual(applyFilters(items, { ...EMPTY_FILTERS, time: "1h" }, NOW).map((i) => i.id), ["a"]);
  assert.deepEqual(applyFilters(items, { ...EMPTY_FILTERS, asset: "NG" }, NOW).map((i) => i.id), ["b"]);
  assert.deepEqual(applyFilters(items, { ...EMPTY_FILTERS, source: "reuters" }, NOW).map((i) => i.id), ["a"]);
  assert.deepEqual(applyFilters(items, { ...EMPTY_FILTERS, query: "storage" }, NOW).map((i) => i.id), ["b"]);
  assert.deepEqual(applyFilters(items, { ...EMPTY_FILTERS, impact: "high" }, NOW).map((i) => i.id), ["a"]);
});

// ---- Country / chokepoint monitors ----

test("a country with no coverage says so instead of reporting an all-clear", () => {
  const qatar = countryRisks(build([event({ title: "Oil steady" })])).find((c) => c.key === "qatar")!;
  assert.equal(qatar.risk, "low");
  assert.equal(qatar.mentions, 0);
  assert.match(qatar.note, /not an all-clear/);
});

test("a real geopolitical story lifts that country's risk and names the headline", () => {
  const items = build([event({ title: "Iran missile attack on tanker near Hormuz", impactScale: 5, sources: ["Reuters", "AP"], sourceQualityPct: 100, matchedRules: ["war", "hormuz"] })]);
  const iran = countryRisks(items).find((c) => c.key === "iran")!;
  assert.ok(iran.risk === "extreme" || iran.risk === "high", `expected elevated risk, got ${iran.risk}`);
  assert.equal(iran.latest?.headline, "Iran missile attack on tanker near Hormuz");
});

test("Hormuz reads NORMAL only as 'nothing reported', and escalates on a real headline", () => {
  const quiet = chokepointReads(build([event({ title: "Oil steady" })])).find((c) => c.key === "hormuz")!;
  assert.equal(quiet.status, "normal");
  assert.match(quiet.note, /not a live shipping-authority feed/);

  const hot = chokepointReads(build([event({ title: "Tanker attacked in the Strait of Hormuz", impactScale: 4, matchedRules: ["hormuz"] })])).find((c) => c.key === "hormuz")!;
  assert.equal(hot.status, "high_risk");

  const shut = chokepointReads(build([event({ title: "Iran closes the Strait of Hormuz to shipping", impactScale: 5, matchedRules: ["hormuz"] })])).find((c) => c.key === "hormuz")!;
  assert.equal(shut.status, "blocked");
});

test("Red Sea signal rows say 'nothing reported' rather than leaving a blank that reads like data", () => {
  const quiet = chokepointReads(build([])).find((c) => c.key === "redsea")!;
  assert.ok(quiet.signals.every((s) => s.detail === "Nothing reported in the feed."));
});

// ---- Weather ----

test("the weather read is honest that no weather API is connected", () => {
  const cold = weatherRead(build([event({ title: "Polar vortex to hit US Midwest, heating demand to surge", affectedMarket: "NG", impactScale: 3, matchedRules: ["coldWinter"] })]));
  assert.equal(cold.bias, "bullish");
  assert.ok(cold.regions.find((r) => r.name === "Midwest")?.mentioned);
  assert.match(cold.note, /No NOAA\/weather API is connected/);
});

test("mild-weather headlines read bearish for gas", () => {
  const mild = weatherRead(build([event({ title: "Milder weather trims US heating demand forecast", affectedMarket: "NG", impactScale: -2, matchedRules: ["warmWinter"] })]));
  assert.equal(mild.bias, "bearish");
});

// ---- Bias panels ----

test("with no news at all the panel says quiet rather than printing a confident neutral", () => {
  const panel = crudePanel([]);
  assert.equal(panel.quiet, true);
  assert.equal(panel.confidencePct, 0);
  assert.equal(panel.score, 50);
});

test("a single stale low-tier story cannot peg the gauge to an extreme", () => {
  const panel = crudePanel(build([event({ title: "Blog says oil will spike", impactScale: 5, sources: ["SomeBlog"], sourceQualityPct: 25, recencyPct: 10, publishedAt: minsAgo(600) })]));
  assert.ok(panel.score < 62, `expected a damped score, got ${panel.score}`);
  assert.ok(panel.confidencePct < 55, `expected low confidence, got ${panel.confidencePct}`);
});

test("corroborated fresh bullish supply news moves the crude panel bullish and names its drivers", () => {
  const items = build([
    event({ id: "1", title: "OPEC+ cuts production by 2 million bpd", impactScale: 4, sources: ["Reuters", "Bloomberg"], sourceQualityPct: 100, matchedRules: ["opecCut"] }),
    event({ id: "2", title: "Saudi pipeline attacked and shut", impactScale: 4, sources: ["Reuters", "AP"], sourceQualityPct: 100, matchedRules: ["pipelineExplosion", "war"] }),
  ]);
  const panel = crudePanel(items);
  assert.equal(panel.bias, "bullish");
  assert.ok(panel.drivers.length >= 2);
  assert.ok(panel.counterRisks.length > 0, "a bullish read must name what would flip it");
  assert.ok(panel.counterRisks.some((r) => /ceasefire|de-escalation|walking back/i.test(r)));
});

test("the EIA's own reported number appears as its own component, marked as official", () => {
  const panel = crudePanel(build([event()]), "bullish");
  const eia = panel.components.find((c) => c.label === "EIA inventories");
  assert.ok(eia, "the EIA component should be present when EIA data exists");
  assert.equal(eia!.reading, "bullish");
  assert.match(eia!.detail, /official figure, not a headline/);
});

test("the gas panel keeps storage, weather, LNG and production as separate readings", () => {
  const items = build([event({ title: "Freeport LNG restarts, exports ramp", affectedMarket: "NG", impactScale: 3, sources: ["Reuters", "Bloomberg"], sourceQualityPct: 100, matchedRules: ["lngExportIncrease"] })]);
  const panel = ngPanel(items, weatherRead(items), "bearish");
  assert.deepEqual(panel.components.map((c) => c.label), ["Storage", "Weather", "LNG", "Production", "News momentum"]);
  assert.equal(panel.components[0].reading, "bearish", "storage should follow the official EIA read");
  assert.equal(panel.components[2].reading, "bullish", "an LNG restart is bullish gas");
});

// ---- Intelligence summary ----

test("the intelligence summary separates fact from interpretation and never claims certainty", () => {
  const items = build([event({ title: "OPEC+ cuts production", impactScale: 4, sources: ["Reuters", "Bloomberg"], sourceQualityPct: 100, matchedRules: ["opecCut"] })]);
  const block = intelligenceFor(crudePanel(items));
  assert.match(block.headline, /^CRUDE BIAS:/);
  assert.ok(block.facts[0].includes("OPEC+ cuts production"));
  assert.ok(block.counterRisks.length > 0);
  assert.match(block.conclusion, /not a forecast and not a guaranteed direction/);
});

test("a quiet tape produces a summary that admits it has nothing, not a neutral verdict", () => {
  const block = intelligenceFor(crudePanel([]));
  assert.match(block.facts[0], /No directional headlines/);
  assert.match(block.conclusion, /No tradeable news bias/);
});

// ---- Sessions and opening bias ----

test("the next MCX session skips the weekend", () => {
  // Saturday 12 Sep 2026, 10:00 IST.
  const sat = sessionInfo(Date.UTC(2026, 8, 12, 4, 30));
  assert.equal(sat.isOpen, false);
  assert.equal(sat.isWeekend, true);
  assert.match(sat.nextSessionLabel, /Monday/);

  // Friday 11 Sep 2026, 11:30 IST -- inside the session.
  assert.equal(sessionInfo(NOW).isOpen, true);
});

test("a weekday before the open points at today, not tomorrow", () => {
  // Friday 11 Sep 2026, 07:00 IST.
  const early = sessionInfo(Date.UTC(2026, 8, 11, 1, 30));
  assert.equal(early.isOpen, false);
  assert.match(early.nextSessionLabel, /Today/);
  assert.equal(early.minutesToOpen, 120);
});

test("opening bias refuses to guess when there is no overseas quote", () => {
  const est = openingBiasEstimate([{ name: "WTI", tracksMCX: "CRUDEOIL", changePercent: null }], "CRUDEOIL");
  assert.equal(est.available, false);
  assert.match(est.detail, /no opening bias can be estimated/);
});

test("opening bias averages the benchmarks and calls itself an estimate", () => {
  const est = openingBiasEstimate(
    [
      { name: "WTI Crude Oil (NYMEX)", tracksMCX: "CRUDEOIL", changePercent: 1.5 },
      { name: "Brent Crude Oil (ICE)", tracksMCX: "CRUDEOIL", changePercent: 1.1 },
      { name: "Henry Hub", tracksMCX: "NATURALGAS", changePercent: -3 },
    ],
    "CRUDEOIL"
  );
  assert.equal(est.bias, "bullish");
  assert.equal(est.drivers.length, 2, "the gas benchmark must not leak into the crude estimate");
  assert.match(est.detail, /not a predicted opening price/);
});

// ---- Calendar ----

test("the EIA weekly releases land on their standing days and are always in the future", () => {
  const [crude, storage] = eiaScheduleEvents(NOW);
  assert.equal(new Date(crude.whenIso).getUTCDay(), 3, "crude inventories publish on Wednesday");
  assert.equal(new Date(storage.whenIso).getUTCDay(), 4, "gas storage publishes on Thursday");
  assert.ok(new Date(crude.whenIso).getTime() > NOW);
  assert.ok(new Date(storage.whenIso).getTime() > NOW);
});

test("calendar rows from FRED are merged in date order and past ones dropped", () => {
  const events = upcomingEvents(
    [
      { name: "CPI (Inflation)", date: "2026-09-15", affects: "BOTH", impact: "HIGH" },
      { name: "Ancient release", date: "2020-01-01", affects: "BOTH", impact: "LOW" },
    ],
    NOW
  );
  assert.ok(!events.some((e) => e.name === "Ancient release"));
  const dates = events.map((e) => e.whenIso);
  assert.deepEqual(dates, [...dates].sort());
});

// ---- Positions ----

test("position P&L is rupees across all lots, not premium points", () => {
  // Crude lot 100: entry 387.90, now 400.00, 1 lot = (400-387.9)*100 = 1210.
  const read = readPosition(
    { id: "p", symbol: "CRUDEOIL", strike: 9450, optSide: "CE", expiry: "2026-09-17", lots: 1, avgPremium: 387.9, levels: [] },
    9500,
    400,
    null,
    NOW
  );
  assert.equal(read.lotSize, LOT_SIZE.CRUDEOIL);
  assert.equal(read.pnlRs, 1210);
  assert.equal(read.breakeven, 9450 + 387.9);
  assert.equal(read.intrinsic, 50);
  assert.equal(read.timeValue, 350);
  assert.equal(read.distanceToStrike, 50);
});

test("a gas position uses the 1250 lot and the two lots it actually holds", () => {
  const read = readPosition(
    { id: "g", symbol: "NATURALGAS", strike: 270, optSide: "CE", expiry: "2026-09-23", lots: 2, avgPremium: 10.25, levels: [] },
    268,
    12.25,
    null,
    NOW
  );
  // (12.25 - 10.25) * 1250 * 2 lots = 5000.
  assert.equal(read.pnlRs, 5000);
  assert.equal(read.intrinsic, 0, "a CE below its strike has no intrinsic value");
  assert.equal(read.timeValue, 12.25);
});

test("no live premium means no P&L rather than a P&L of zero", () => {
  const read = readPosition(
    { id: "p", symbol: "CRUDEOIL", strike: 9450, optSide: "CE", expiry: "2026-09-17", lots: 1, avgPremium: 387.9, levels: [] },
    9500,
    null,
    null,
    NOW
  );
  assert.equal(read.pnlRs, null);
  assert.equal(read.timeValue, null);
});

test("a PE is measured the other way round", () => {
  const read = readPosition(
    { id: "p", symbol: "CRUDEOIL", strike: 9450, optSide: "PE", expiry: "2026-09-17", lots: 1, avgPremium: 100, levels: [] },
    9400,
    130,
    null,
    NOW
  );
  assert.equal(read.breakeven, 9350);
  assert.equal(read.intrinsic, 50);
  assert.equal(read.pnlRs, 3000);
});

test("expiry pressure is flagged only when it is actually close", () => {
  const near = readPosition({ id: "p", symbol: "CRUDEOIL", strike: 9450, optSide: "CE", expiry: "2026-09-13", lots: 1, avgPremium: 300, levels: [] }, null, null, null, NOW);
  assert.equal(near.expiryWarning, true);
  const far = readPosition({ id: "p", symbol: "CRUDEOIL", strike: 9450, optSide: "CE", expiry: "2026-10-20", lots: 1, avgPremium: 300, levels: [] }, null, null, null, NOW);
  assert.equal(far.expiryWarning, false);
});

// ---- Alerts ----

test("a price alert fires on the cross, not on every poll while the level is behind", () => {
  const rules = DEFAULT_ALERT_RULES.filter((r) => r.id === "crude-9500");
  const enabled = new Set(["crude-9500"]);
  const crossed = evaluateAlerts(rules, enabled, { prices: { CRUDEOIL: 9505 }, changePcts: {}, items: [], previousPrices: { CRUDEOIL: 9490 } });
  assert.equal(crossed.length, 1);
  const stillAbove = evaluateAlerts(rules, enabled, { prices: { CRUDEOIL: 9520 }, changePcts: {}, items: [], previousPrices: { CRUDEOIL: 9505 } });
  assert.equal(stillAbove.length, 0, "already through the level is not a new cross");
});

test("a price alert with no previous observation stays silent instead of firing on load", () => {
  const fired = evaluateAlerts(DEFAULT_ALERT_RULES.filter((r) => r.id === "crude-9500"), new Set(["crude-9500"]), {
    prices: { CRUDEOIL: 9600 }, changePcts: {}, items: [], previousPrices: {},
  });
  assert.equal(fired.length, 0);
});

test("a percent alert escalates to critical at the bigger threshold", () => {
  const fired = evaluateAlerts(DEFAULT_ALERT_RULES.filter((r) => r.symbol === "WTI"), new Set(["wti-1", "wti-2"]), {
    prices: {}, changePcts: { WTI: -2.4 }, items: [], previousPrices: {},
  });
  assert.equal(fired.length, 2);
  assert.ok(fired.every((f) => f.severity === "critical"));
});

test("a news alert only fires on a genuinely important, fresh story", () => {
  const big: GptNewsItem[] = build([event({ title: "Iran seizes tanker near Hormuz", impactScale: 5, sources: ["Reuters", "AP"], sourceQualityPct: 100, matchedRules: ["war", "hormuz"] })]);
  const small: GptNewsItem[] = build([event({ title: "Iran holds routine oil talks", impactScale: 0, sourceQualityPct: 55 })]);
  const rules = DEFAULT_ALERT_RULES.filter((r) => r.id === "news-iran");
  assert.equal(evaluateAlerts(rules, new Set(["news-iran"]), { prices: {}, changePcts: {}, items: big, previousPrices: {} }).length, 1);
  assert.equal(evaluateAlerts(rules, new Set(["news-iran"]), { prices: {}, changePcts: {}, items: small, previousPrices: {} }).length, 0);
});

test("a percent alert keeps one identity while it stays breached, so it cannot spam", () => {
  const rules = DEFAULT_ALERT_RULES.filter((r) => r.id === "wti-2");
  const enabled = new Set(["wti-2"]);
  const first = evaluateAlerts(rules, enabled, { prices: {}, changePcts: { WTI: -2.1 }, items: [], previousPrices: {} })[0];
  const later = evaluateAlerts(rules, enabled, { prices: {}, changePcts: { WTI: -2.6 }, items: [], previousPrices: {} })[0];
  assert.equal(first.dedupeKey, later.dedupeKey, "the same breach must not re-notify as the number ticks");
  const other = evaluateAlerts(rules, enabled, { prices: {}, changePcts: { WTI: 2.4 }, items: [], previousPrices: {} })[0];
  assert.notEqual(first.dedupeKey, other.dedupeKey, "a breach the other way is a separate event");
});

test("crossing a price level in both directions is two separate alerts", () => {
  const rules = DEFAULT_ALERT_RULES.filter((r) => r.id === "crude-9500");
  const enabled = new Set(["crude-9500"]);
  const up = evaluateAlerts(rules, enabled, { prices: { CRUDEOIL: 9510 }, changePcts: {}, items: [], previousPrices: { CRUDEOIL: 9490 } })[0];
  const down = evaluateAlerts(rules, enabled, { prices: { CRUDEOIL: 9480 }, changePcts: {}, items: [], previousPrices: { CRUDEOIL: 9510 } })[0];
  assert.notEqual(up.dedupeKey, down.dedupeKey);
});

test("a disabled rule never fires", () => {
  const fired = evaluateAlerts(DEFAULT_ALERT_RULES, new Set<string>(), { prices: { CRUDEOIL: 9600 }, changePcts: { WTI: 9 }, items: [], previousPrices: { CRUDEOIL: 9000 } });
  assert.equal(fired.length, 0);
});
