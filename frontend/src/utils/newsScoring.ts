// Deterministic, rule-based news scoring -- implements the SPECIAL NEWS
// LOGIC table literally (OPEC cut/increase, inventory draw/build, war/
// peace, pipeline/refinery, dollar strength, cold/warm winter, LNG exports,
// storage vs prior period) as keyword matching against headline+summary
// text, rather than an LLM classification call per article. This matches
// the rest of this app's own design philosophy (established across Best
// Call, AI Verify Pro, etc.): a deterministic engine decides the score,
// Workers AI is only ever used afterward to write a plain-English summary
// of what the engine already concluded -- never to invent the score itself,
// which would make the same headline score differently on every request.

export type AffectedMarket = "CRUDE" | "NG" | "BOTH";
export type ExpectedMove = "very_strong_bullish" | "bullish" | "neutral" | "bearish" | "very_strong_bearish";
export type TimeImpact = "15m" | "30m" | "1h" | "4h" | "1d" | "1w";

export interface RawNewsArticle {
  headline: string;
  summary: string;
  source: string;
  publishedAt: string;
  url: string;
}

// Four-tier source-quality ranking (spec: "Never allow a Tier 4 source
// alone to generate a strong trade bias"). Classified from the article's
// own source name/URL domain -- no external reputation service, so this is
// a curated allowlist, not a live authority score.
export type SourceTier = 1 | 2 | 3 | 4;

// Matched against both the article's URL domain (most reliable) AND its
// human-readable source name (RSS items often carry a friendly feed name
// like "EIA - Today in Energy" or "Reuters" with no domain in sight), so a
// feed item missing a link still classifies correctly.
const TIER1_MATCH = ["eia.gov", "opec.org", "federalreserve.gov", "stlouisfed.org", "energy.gov", "whitehouse.gov", "treasury.gov", "state.gov", "iea.org", "eia -", "eia.", " eia ", "opec"];
const TIER2_MATCH = ["reuters.com", "bloomberg.com", "cnbc.com", "ft.com", "wsj.com", "marketwatch.com", "spglobal.com", "platts.com", "ap.org", "apnews.com", "reuters", "bloomberg", "cnbc", "wall street journal", "associated press"];
const TIER3_MATCH = ["oilprice.com", "rigzone.com", "naturalgasintel.com", "investing.com", "moneycontrol.com", "livemint.com", "businessline.com", "energyintel.com", "hellenicshippingnews.com", "oilprice", "rigzone"];

export function classifySourceTier(source: string, url?: string): SourceTier {
  const hay = `${source} ${url ?? ""}`.toLowerCase();
  if (TIER1_MATCH.some((d) => hay.includes(d))) return 1;
  if (TIER2_MATCH.some((d) => hay.includes(d))) return 2;
  if (TIER3_MATCH.some((d) => hay.includes(d))) return 3;
  return 4;
}

const TIER_QUALITY_PCT: Record<SourceTier, number> = { 1: 100, 2: 80, 3: 55, 4: 25 };

// Recency decay bands (spec-exact): fresher news counts for more, structural
// events (handled by the caller keeping them "active" regardless of age)
// are the only exception to "older than 48h = effectively ignored".
export function recencyWeightPct(publishedAt: string, now: number = Date.now()): number {
  const ageMin = (now - new Date(publishedAt).getTime()) / 60_000;
  if (!Number.isFinite(ageMin) || ageMin < 0) return 100;
  if (ageMin <= 30) return 100;
  if (ageMin <= 120) return 85;
  if (ageMin <= 360) return 65;
  if (ageMin <= 720) return 45;
  if (ageMin <= 1440) return 25;
  if (ageMin <= 2880) return 10;
  return 0;
}

// Relevance keyword lists, taken directly from the spec. Multi-word phrases
// are weighted higher than single generic words (e.g. "Strait of Hormuz"
// matters far more on its own than the word "demand" does).
const CRUDE_KEYWORDS: { term: RegExp; weight: number }[] = [
  { term: /crude oil/i, weight: 20 }, { term: /\bwti\b/i, weight: 20 }, { term: /\bbrent\b/i, weight: 20 },
  { term: /opec\+?/i, weight: 18 }, { term: /saudi arabia/i, weight: 14 }, { term: /\brussia\b/i, weight: 10 },
  { term: /\buae\b/i, weight: 8 }, { term: /\biraq\b/i, weight: 10 }, { term: /\bkuwait\b/i, weight: 8 }, { term: /\biran\b/i, weight: 12 },
  { term: /oil (production|output)/i, weight: 16 }, { term: /oil inventor(y|ies)/i, weight: 16 }, { term: /\brefiner(y|ies)\b/i, weight: 10 },
  { term: /\bspr\b|strategic petroleum reserve/i, weight: 14 }, { term: /\bsanctions?\b/i, weight: 10 }, { term: /\bshipping\b/i, weight: 6 },
  { term: /\btanker(s)?\b/i, weight: 8 }, { term: /strait of hormuz/i, weight: 20 }, { term: /middle east conflict/i, weight: 16 },
  { term: /supply disruption/i, weight: 14 }, { term: /\bdemand\b/i, weight: 5 }, { term: /china oil demand/i, weight: 14 },
  { term: /us oil demand/i, weight: 12 }, { term: /us (crude )?production/i, weight: 10 },
];
const NG_KEYWORDS: { term: RegExp; weight: number }[] = [
  { term: /natural gas/i, weight: 20 }, { term: /henry hub/i, weight: 20 }, { term: /\blng\b/i, weight: 16 }, { term: /lng exports?/i, weight: 18 },
  { term: /us natural gas/i, weight: 14 }, { term: /gas storage/i, weight: 18 }, { term: /eia storage/i, weight: 18 }, { term: /\bpipeline\b/i, weight: 10 },
  { term: /freeport lng/i, weight: 16 }, { term: /\bweather\b/i, weight: 8 }, { term: /heating demand|cooling demand/i, weight: 14 },
  { term: /europe gas/i, weight: 12 }, { term: /\bttf\b/i, weight: 14 }, { term: /power demand/i, weight: 8 }, { term: /\bproduction\b/i, weight: 5 },
  { term: /dry gas/i, weight: 10 }, { term: /working gas/i, weight: 10 },
];

export function classifyRelevance(text: string): { market: AffectedMarket; relevancePct: number; matched: string[] } {
  const crudeHits = CRUDE_KEYWORDS.filter((k) => k.term.test(text));
  const ngHits = NG_KEYWORDS.filter((k) => k.term.test(text));
  const crudeScore = crudeHits.reduce((s, k) => s + k.weight, 0);
  const ngScore = ngHits.reduce((s, k) => s + k.weight, 0);
  let market: AffectedMarket = "BOTH";
  if (crudeScore > 0 && ngScore === 0) market = "CRUDE";
  else if (ngScore > 0 && crudeScore === 0) market = "NG";
  else if (crudeScore > ngScore * 1.5) market = "CRUDE";
  else if (ngScore > crudeScore * 1.5) market = "NG";
  const relevancePct = Math.min(100, Math.max(crudeScore, ngScore, market === "BOTH" ? crudeScore + ngScore : 0));
  return { market, relevancePct, matched: [...crudeHits.map((k) => k.term.source), ...ngHits.map((k) => k.term.source)] };
}

export interface ScoredNewsArticle extends RawNewsArticle {
  affectedMarket: AffectedMarket;
  importance: number; // 0-100
  bullishScore: number; // 0-100
  bearishScore: number; // 0-100
  confidence: number; // 0-100
  expectedMove: ExpectedMove;
  timeImpact: TimeImpact;
  matchedRules: string[];
  // Added for the News Based Trade AI upgrade -- distinct 0-100 dimensions
  // plus a -5..+5 impact scale, kept alongside (not replacing) the original
  // importance/confidence fields other pages/components already read.
  sourceTier: SourceTier;
  relevancePct: number;
  sourceQualityPct: number;
  recencyPct: number;
  marketImpactPct: number;
  impactScale: number; // -5 (extremely bearish) .. +5 (extremely bullish)
}

interface Rule {
  key: string;
  patterns: RegExp[];
  market: AffectedMarket;
  bullish: number; // -100..100, positive = bullish, negative = bearish
  importance: number;
  timeImpact: TimeImpact;
  whyItMatters: string;
  expectedEffect: string;
}

const TIME_ORDER: Record<TimeImpact, number> = { "15m": 0, "30m": 1, "1h": 2, "4h": 3, "1d": 4, "1w": 5 };

const RULES: Rule[] = [
  // Deliberately requires "production"/"output" near the cut/increase verb
  // (either word order) rather than matching "cut"/"increase" alone right
  // after "OPEC" -- otherwise "OPEC cuts demand forecast" (a very different,
  // NOT bullish story) would false-positive as a production cut.
  {
    key: "opecCut",
    patterns: [/opec\+?.{0,20}(production|output).{0,15}\bcuts?\b/i, /opec\+?.{0,20}\bcuts?\b.{0,15}(production|output)/i, /opec\+?.{0,20}reduc.{0,15}(production|output)/i],
    market: "CRUDE", bullish: 70, importance: 85, timeImpact: "4h",
    whyItMatters: "OPEC+ cutting production tightens global crude supply.",
    expectedEffect: "Typically pushes crude prices higher, more so if the cut is deeper or more sudden than the market expected.",
  },
  {
    key: "opecIncrease",
    patterns: [/opec\+?.{0,20}(production|output).{0,15}increas/i, /opec\+?.{0,20}increas.{0,15}(production|output)/i, /opec\+?.{0,20}(rais|boost|hik).{0,15}output/i],
    market: "CRUDE", bullish: -60, importance: 80, timeImpact: "4h",
    whyItMatters: "OPEC+ raising output adds supply to the market.",
    expectedEffect: "Typically pressures crude prices lower, milder if the increase is small/expected, sharper if it is a surprise or unwinding cuts faster than planned.",
  },
  { key: "inventoryDraw", patterns: [/inventor(y|ies).{0,25}draw/i, /crude stock.{0,20}(fall|drop|declin)/i], market: "CRUDE", bullish: 55, importance: 75, timeImpact: "1h",
    whyItMatters: "US crude inventories falling signals demand outpacing supply that week.", expectedEffect: "Generally bullish for WTI/Brent, more so on a larger-than-usual draw." },
  { key: "inventoryBuild", patterns: [/inventor(y|ies).{0,25}build/i, /crude stock.{0,20}(ris|increas|climb)/i], market: "CRUDE", bullish: -55, importance: 75, timeImpact: "1h",
    whyItMatters: "US crude inventories rising signals supply outpacing demand that week.", expectedEffect: "Generally bearish for WTI/Brent, more so on a larger-than-usual build." },
  { key: "war", patterns: [/\bwar\b/i, /\battack(s|ed)?\b.{0,25}(oil|energy|refiner|tanker|pipeline)/i, /military conflict/i], market: "CRUDE", bullish: 60, importance: 80, timeImpact: "30m",
    whyItMatters: "Armed conflict near energy infrastructure raises supply-disruption risk.", expectedEffect: "Bullish for crude on fear of lost supply -- strength depends on how close the conflict is to producing/shipping regions." },
  { key: "peace", patterns: [/peace (deal|agreement|talks)/i, /ceasefire/i, /truce/i], market: "CRUDE", bullish: -50, importance: 70, timeImpact: "1h",
    whyItMatters: "A ceasefire/peace deal removes part of the geopolitical risk premium priced into crude.", expectedEffect: "Bearish for crude as the fear premium unwinds." },
  { key: "pipelineExplosion", patterns: [/pipeline.{0,20}(explosion|blast|fire|attack|sabotage)/i], market: "BOTH", bullish: 65, importance: 85, timeImpact: "15m",
    whyItMatters: "A damaged pipeline removes takeaway/supply capacity immediately.", expectedEffect: "Bullish for the affected commodity while the pipeline is down -- direction depends on whether it restricts supply into or out of the region." },
  { key: "refineryShutdown", patterns: [/refiner(y|ies).{0,20}(shutdown|shut down|outage|fire|halt)/i], market: "CRUDE", bullish: -35, importance: 60, timeImpact: "4h",
    whyItMatters: "A refinery outage cuts demand for crude feedstock even though it can be bullish for refined products.", expectedEffect: "Mildly bearish for crude, bullish for gasoline/diesel cracks." },
  { key: "dollarStrong", patterns: [/dollar.{0,20}(strength|strong|rally|surg)/i, /\bdxy\b.{0,20}(ris|climb|jump)/i], market: "BOTH", bullish: -30, importance: 50, timeImpact: "1d",
    whyItMatters: "Crude and gas are dollar-denominated -- a stronger dollar makes them costlier for foreign buyers.", expectedEffect: "Mildly bearish for both commodities." },
  { key: "dollarWeak", patterns: [/dollar.{0,20}(weak|fall|declin|slump)/i, /\bdxy\b.{0,20}(fall|drop|declin)/i], market: "BOTH", bullish: 30, importance: 50, timeImpact: "1d",
    whyItMatters: "A weaker dollar makes dollar-priced commodities cheaper for foreign buyers.", expectedEffect: "Mildly bullish for both commodities." },
  { key: "coldWinter", patterns: [/cold (snap|weather|blast)/i, /polar vortex/i, /arctic (blast|cold)/i], market: "NG", bullish: 55, importance: 70, timeImpact: "1d",
    whyItMatters: "Cold weather drives heating demand for natural gas.", expectedEffect: "Bullish for Henry Hub / NG, stronger the more widespread/prolonged the cold." },
  { key: "warmWinter", patterns: [/warm(er)? (winter|weather)/i, /mild winter/i], market: "NG", bullish: -50, importance: 65, timeImpact: "1d",
    whyItMatters: "A mild winter reduces heating demand for natural gas.", expectedEffect: "Bearish for Henry Hub / NG." },
  { key: "lngExportIncrease", patterns: [/lng export.{0,20}(ris|increas|record|surg)/i, /freeport lng.{0,20}(restart|resum|ramp)/i], market: "NG", bullish: 45, importance: 65, timeImpact: "1d",
    whyItMatters: "Higher LNG exports pull more gas out of the domestic market.", expectedEffect: "Bullish for US NG (more demand on the same supply)." },
  { key: "pipelineOutageNg", patterns: [/(gas )?pipeline.{0,20}(shutdown|shut down|outage)/i], market: "NG", bullish: 40, importance: 60, timeImpact: "4h",
    whyItMatters: "A gas pipeline outage constrains delivery.", expectedEffect: "Direction depends on whether the pipeline restricts supply into or demand out of the affected hub -- treated here as a mild supply-side constraint." },
  { key: "storageBuild", patterns: [/(gas |ng )?storage.{0,25}(build|injection)/i, /storage.{0,20}(above|higher than).{0,20}expect/i], market: "NG", bullish: -45, importance: 65, timeImpact: "1h",
    whyItMatters: "Gas storage building faster than seasonal norms signals oversupply.", expectedEffect: "Bearish for NG, more so if the build beat expectations." },
  { key: "storageDraw", patterns: [/(gas |ng )?storage.{0,25}(draw|withdrawal)/i, /storage.{0,20}(below|lower than).{0,20}expect/i], market: "NG", bullish: 45, importance: 65, timeImpact: "1h",
    whyItMatters: "Gas storage draining faster than seasonal norms signals tight supply.", expectedEffect: "Bullish for NG, more so if the draw beat expectations." },
  { key: "hormuz", patterns: [/strait of hormuz/i, /\bhormuz\b/i], market: "CRUDE", bullish: 55, importance: 75, timeImpact: "30m",
    whyItMatters: "~20% of global oil trade transits the Strait of Hormuz -- any threat there is a major supply-risk headline.", expectedEffect: "Bullish for crude, sharply so if shipping is actually disrupted rather than just threatened." },
  { key: "redSea", patterns: [/red sea/i, /houthi/i], market: "CRUDE", bullish: 45, importance: 65, timeImpact: "1h",
    whyItMatters: "Red Sea shipping disruption lengthens tanker routes and raises freight/insurance costs.", expectedEffect: "Bullish for crude on elevated shipping risk." },
  { key: "hurricane", patterns: [/hurricane/i, /tropical storm/i], market: "BOTH", bullish: 40, importance: 60, timeImpact: "1d",
    whyItMatters: "Gulf of Mexico storms threaten offshore production and Gulf Coast refining/LNG capacity.", expectedEffect: "Bullish while the storm threatens Gulf output/refining, path-dependent." },
  { key: "sanctions", patterns: [/sanction/i], market: "CRUDE", bullish: 40, importance: 60, timeImpact: "4h",
    whyItMatters: "Sanctions on a producer nation restrict how much of its crude reaches the global market.", expectedEffect: "Bullish for crude, larger the more oil-export-heavy the sanctioned country is." },
  { key: "fedRateHike", patterns: [/fed.{0,15}(rate hike|raises? rate|hikes? rate)/i, /fomc.{0,15}hike/i], market: "BOTH", bullish: -25, importance: 55, timeImpact: "1d",
    whyItMatters: "Higher rates strengthen the dollar and can cool growth/energy demand expectations.", expectedEffect: "Mildly bearish for both commodities." },
  { key: "fedRateCut", patterns: [/fed.{0,15}(rate cut|cuts? rate|lowers? rate)/i, /fomc.{0,15}cut/i], market: "BOTH", bullish: 25, importance: 55, timeImpact: "1d",
    whyItMatters: "Lower rates weaken the dollar and support growth/energy demand expectations.", expectedEffect: "Mildly bullish for both commodities." },
];

function baseScore(article: RawNewsArticle, now: number): Omit<ScoredNewsArticle, keyof RawNewsArticle> {
  const text = `${article.headline} ${article.summary}`;
  const matched = RULES.filter((rule) => rule.patterns.some((p) => p.test(text)));
  const relevance = classifyRelevance(text);
  const sourceTier = classifySourceTier(article.source, article.url);
  const sourceQualityPct = TIER_QUALITY_PCT[sourceTier];
  const recencyPct = recencyWeightPct(article.publishedAt, now);

  let importance: number;
  let netBullish: number;
  let timeImpact: TimeImpact;
  let affectedMarket: AffectedMarket;
  let matchedRules: string[];

  if (matched.length === 0) {
    importance = Math.round(20 + relevance.relevancePct * 0.3);
    netBullish = 0;
    timeImpact = "1d";
    affectedMarket = relevance.market;
    matchedRules = [];
  } else {
    // Net direction weighted by each matched rule's own importance -- a minor
    // rule shouldn't cancel out a major one 1-for-1.
    const totalWeight = matched.reduce((s, r) => s + r.importance, 0);
    netBullish = matched.reduce((s, r) => s + r.bullish * r.importance, 0) / totalWeight;
    importance = Math.min(100, Math.max(...matched.map((r) => r.importance)) + (matched.length - 1) * 5);
    timeImpact = matched.reduce((fastest, r) => (TIME_ORDER[r.timeImpact] < TIME_ORDER[fastest] ? r.timeImpact : fastest), matched[0].timeImpact);
    const markets = new Set(matched.map((r) => r.market));
    affectedMarket = markets.size > 1 || markets.has("BOTH") ? "BOTH" : matched[0].market;
    matchedRules = matched.map((r) => r.key);
  }

  // Never let a single Tier-4 (unverified blog/social) source alone drive a
  // strong bias -- damp magnitude and confidence when there's no corroboration.
  const tier4Damp = sourceTier === 4 ? 0.5 : 1;
  const bullishScore = Math.round(Math.max(0, netBullish) * tier4Damp);
  const bearishScore = Math.round(Math.max(0, -netBullish) * tier4Damp);
  const baseConfidence = matched.length === 0 ? 15 : Math.min(95, 40 + matched.length * 15);
  const confidence = Math.round(baseConfidence * (sourceTier === 4 ? 0.6 : 1) * (recencyPct / 100 + 0.3));

  const marketImpactPct = Math.round(Math.min(100, 0.5 * importance + 0.3 * relevance.relevancePct + 0.2 * sourceQualityPct) * tier4Damp);
  const impactScale = Math.max(-5, Math.min(5, Math.round(((netBullish * tier4Damp) / 100) * 5)));

  return {
    affectedMarket, importance, bullishScore, bearishScore, confidence, expectedMove: classifyExpectedMove(netBullish * tier4Damp),
    timeImpact, matchedRules, sourceTier, relevancePct: relevance.relevancePct, sourceQualityPct, recencyPct, marketImpactPct, impactScale,
  };
}

export function scoreArticle(article: RawNewsArticle, now: number = Date.now()): ScoredNewsArticle {
  return { ...article, ...baseScore(article, now) };
}

function classifyExpectedMove(net: number): ExpectedMove {
  if (net >= 50) return "very_strong_bullish";
  if (net >= 15) return "bullish";
  if (net <= -50) return "very_strong_bearish";
  if (net <= -15) return "bearish";
  return "neutral";
}

export function scoreArticles(articles: RawNewsArticle[], now: number = Date.now()): ScoredNewsArticle[] {
  return articles.map((a) => scoreArticle(a, now)).sort((a, b) => b.importance - a.importance);
}

// ---- Event clustering / deduplication ----
// Ten articles about the same wire story must read as ONE event, not ten --
// otherwise repeated syndication of a single headline would artificially
// inflate the news score. Grouped by token-overlap (Jaccard similarity) of
// normalized headlines, a simple and fully-inspectable technique (no ML
// model, no external service) that's adequate at the article volumes this
// page ever sees (tens, not thousands, per poll).
export interface NewsEvent {
  id: string;
  title: string;
  articleCount: number;
  sources: string[];
  primarySource: string;
  primaryUrl: string;
  affectedMarket: AffectedMarket;
  impactScale: number;
  relevancePct: number;
  sourceQualityPct: number;
  recencyPct: number;
  confidencePct: number;
  publishedAt: string;
  whyItMatters: string;
  expectedEffect: string;
  matchedRules: string[];
}

const STOPWORDS = new Set([
  "a","an","the","of","in","on","to","for","and","or","is","are","was","were","with","as","at","by","from","this","that","its","it",
  "will","after","over","up","down","says","said","amid","than","into","out","new","report","reports","update","news",
]);

function normalizeTokens(headline: string): Set<string> {
  return new Set(
    headline
      .toLowerCase()
      .replace(/[^a-z0-9%$ ]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w))
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const w of a) if (b.has(w)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

const RULE_MAP: Record<string, Rule> = Object.fromEntries(RULES.map((r) => [r.key, r]));

export function clusterEvents(articles: ScoredNewsArticle[]): NewsEvent[] {
  const withTokens = articles.map((a) => ({ article: a, tokens: normalizeTokens(a.headline) }));
  const used = new Set<number>();
  const clusters: (typeof withTokens)[] = [];

  for (let i = 0; i < withTokens.length; i++) {
    if (used.has(i)) continue;
    const cluster = [withTokens[i]];
    used.add(i);
    for (let j = i + 1; j < withTokens.length; j++) {
      if (used.has(j)) continue;
      if (jaccard(withTokens[i].tokens, withTokens[j].tokens) >= 0.45) {
        cluster.push(withTokens[j]);
        used.add(j);
      }
    }
    clusters.push(cluster);
  }

  return clusters
    .map((cluster, idx) => {
      const articlesInCluster = cluster.map((c) => c.article);
      // Prefer the best-tier, most recent article as the "primary" one for
      // title/url/why-it-matters text.
      const primary = [...articlesInCluster].sort((a, b) => a.sourceTier - b.sourceTier || +new Date(b.publishedAt) - +new Date(a.publishedAt))[0];
      const sources = Array.from(new Set(articlesInCluster.map((a) => a.source)));
      const bestTier = Math.min(...articlesInCluster.map((a) => a.sourceTier)) as SourceTier;
      const isTier4Only = bestTier === 4 && sources.length === 1;
      const relevancePct = Math.max(...articlesInCluster.map((a) => a.relevancePct));
      const sourceQualityPct = TIER_QUALITY_PCT[bestTier];
      const recencyPct = Math.max(...articlesInCluster.map((a) => a.recencyPct));
      const markets = new Set(articlesInCluster.map((a) => a.affectedMarket));
      const affectedMarket: AffectedMarket = markets.size > 1 || markets.has("BOTH") ? "BOTH" : (primary.affectedMarket as AffectedMarket);
      const avgImpact = articlesInCluster.reduce((s, a) => s + a.impactScale, 0) / articlesInCluster.length;
      const impactScale = Math.max(-5, Math.min(5, Math.round(isTier4Only ? avgImpact * 0.5 : avgImpact)));
      // Corroboration across multiple independent sources raises confidence;
      // a single Tier-4-only source is capped low regardless of rule match.
      const corroborationBonus = Math.min(30, (sources.length - 1) * 12);
      const confidencePct = Math.min(95, isTier4Only ? Math.min(35, Math.max(...articlesInCluster.map((a) => a.confidence))) : Math.max(...articlesInCluster.map((a) => a.confidence)) + corroborationBonus);
      const matchedRules = Array.from(new Set(articlesInCluster.flatMap((a) => a.matchedRules)));
      const ruleText = matchedRules.map((k) => RULE_MAP[k]).find((r) => r);
      const earliest = articlesInCluster.reduce((min, a) => (+new Date(a.publishedAt) < +new Date(min.publishedAt) ? a : min), articlesInCluster[0]);

      return {
        id: `evt-${idx}-${primary.url || primary.headline.slice(0, 24)}`,
        title: primary.headline,
        articleCount: articlesInCluster.length,
        sources,
        primarySource: primary.source,
        primaryUrl: primary.url,
        affectedMarket,
        impactScale,
        relevancePct,
        sourceQualityPct,
        recencyPct,
        confidencePct: Math.round(confidencePct),
        publishedAt: earliest.publishedAt,
        whyItMatters: ruleText?.whyItMatters ?? (relevancePct >= 40 ? "Directly references key crude/natural-gas market drivers." : "Tangential energy-market relevance."),
        expectedEffect: ruleText?.expectedEffect ?? "No strong rule-based signal matched -- treat as informational, not a trade trigger on its own.",
        matchedRules,
      };
    })
    .sort((a, b) => b.impactScale ** 2 * b.sourceQualityPct - a.impactScale ** 2 * a.sourceQualityPct || +new Date(b.publishedAt) - +new Date(a.publishedAt));
}

// ---- EIA numeric data (real government figures, not headline text) ----
// A separate, more reliable read than trying to keyword-match a build/draw
// out of a headline: uses the actual reported change value from the EIA API.
// Magnitude scaling below is a heuristic (this app has no historical
// distribution of weekly inventory changes to calibrate a precise "how big
// is big" threshold against), documented as such rather than presented as a
// calibrated statistic. This compares the latest release to the PRIOR
// release (real, reported data), not to an analyst consensus forecast --
// EIA/FRED's free public APIs don't expose consensus-forecast numbers, and
// inventing one would violate the "never fabricate forecast numbers" rule.
export interface EiaScoreResult {
  market: "CRUDE" | "NG";
  label: string;
  direction: "draw" | "build";
  changeValue: number;
  latestValue: number;
  priorValue: number;
  bullishScore: number;
  bearishScore: number;
  importance: number;
}

export function scoreEiaChange(series: "crude_inventory" | "ng_storage", latestValue: number, priorValue: number): EiaScoreResult {
  const market = series === "crude_inventory" ? "CRUDE" : "NG";
  const changeValue = latestValue - priorValue;
  const draw = changeValue < 0;
  // Rough scaling: crude inventory moves are typically measured in
  // thousands of barrels (a multi-million-barrel weekly swing is a big
  // week), NG storage in Bcf (a ~20+ Bcf weekly swing is a big week).
  const typicalBigMove = series === "crude_inventory" ? 5_000_000 : 40;
  const magnitude = Math.min(60, (Math.abs(changeValue) / typicalBigMove) * 60);
  return {
    market,
    label: `${series === "crude_inventory" ? "Crude Inventory" : "NG Storage"} ${draw ? "Draw" : "Build"} of ${Math.abs(changeValue).toLocaleString()} vs prior week`,
    direction: draw ? "draw" : "build",
    changeValue,
    latestValue,
    priorValue,
    bullishScore: draw ? Math.round(35 + magnitude) : 0,
    bearishScore: draw ? 0 : Math.round(35 + magnitude),
    importance: Math.round(55 + magnitude * 0.4),
  };
}
