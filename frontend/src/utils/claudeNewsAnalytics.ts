// Claude News -- the analytics layer over the scored news feed.
//
// The Worker already fetches ~35 RSS sources and runs every headline through
// newsScoring.ts (relevance, source tier, recency decay, rule matching, a
// -5..+5 impact scale). This module does the reading ON TOP of that, and it
// runs IN THE BROWSER: a Worker invocation gets 10ms of CPU on this plan and
// ranking/bucketing a few hundred articles is not worth spending it on. The
// page therefore adds zero Worker CPU and zero extra upstream calls.
//
// Three honesty rules are enforced here in code rather than left to the UI:
//
//  1. Nothing is invented. Every number traces to articles that actually
//     arrived, and an empty feed produces an explicitly empty read, never a
//     neutral-looking zero that could be mistaken for "no news is good news".
//  2. Old news cannot masquerade as fresh. Every weight is multiplied by the
//     scorer's own recency decay, so a 30-hour-old story contributes almost
//     nothing even if it was enormous when it broke.
//  3. A tilt built on two headlines is labelled as built on two headlines.
//     Sample size travels with the number it describes.

import { recencyWeightPct } from "./newsScoring";
import type { ScoredNewsArticle, SourceTier } from "./newsScoring";

export type NewsCommodity = "CRUDE" | "NG";
export type TiltDirection = "bullish" | "bearish" | "neutral";
export type TiltStrength = "strong" | "moderate" | "slight" | "flat" | "none";

export interface NewsTilt {
  commodity: NewsCommodity;
  direction: TiltDirection;
  strength: TiltStrength;
  /** -100..+100. Positive is bullish. Freshness- and source-weighted. */
  score: number;
  /** Articles that actually fed this number. */
  sampleSize: number;
  bullishCount: number;
  bearishCount: number;
  neutralCount: number;
  /** Plain-language headline for the meter. */
  label: string;
  /** The honest caveat that travels with the score. */
  note: string;
}

export interface ThemeBucket {
  key: string;
  label: string;
  count: number;
  /** Net impact of the stories in this theme, -100..+100. */
  net: number;
  topHeadline: string | null;
}

export interface SourceHealth {
  source: string;
  ok: boolean;
  count: number;
  error?: string;
}

export interface SourceHealthSummary {
  live: SourceHealth[];
  failing: SourceHealth[];
  /** Sources that answered fine but returned nothing -- usually a changed feed URL. */
  empty: SourceHealth[];
  liveCount: number;
  totalCount: number;
  articlesFromLive: number;
}

export interface FreshnessRead {
  newestAgeMinutes: number | null;
  withinLastHour: number;
  withinLastSixHours: number;
  older: number;
  /** True when the whole feed is old enough that the page should say so loudly. */
  stale: boolean;
  label: string;
}

/** Source tier -> how much its opinion counts. Mirrors newsScoring's own scale. */
const TIER_WEIGHT: Record<SourceTier, number> = { 1: 1, 2: 0.85, 3: 0.6, 4: 0.3 };

/** Below this many contributing articles, a tilt is explicitly under-powered. */
export const MIN_SAMPLE_FOR_CONFIDENT_TILT = 6;

export function ageMinutes(publishedAt: string, now: number): number | null {
  const t = new Date(publishedAt).getTime();
  if (!Number.isFinite(t)) return null;
  return (now - t) / 60_000;
}

export function relevantTo(article: ScoredNewsArticle, commodity: NewsCommodity): boolean {
  if (article.affectedMarket === "BOTH") return true;
  return commodity === "CRUDE" ? article.affectedMarket === "CRUDE" : article.affectedMarket === "NG";
}

/**
 * How much this article's opinion should count right now: its own relevance,
 * its publisher's tier, and how long ago it broke, multiplied together.
 * Returns 0..1.
 *
 * Recency is RECOMPUTED here against the browser's clock rather than reusing
 * the article's stored recencyPct. That field was calculated on the Worker
 * when the Cron built the payload, which can be up to 30 minutes before the
 * phone reads it -- reusing it would quietly present half-hour-old news as
 * being as fresh as it was at build time, which is the exact failure this
 * page was created to fix.
 */
export function articleWeight(article: ScoredNewsArticle, now: number = Date.now()): number {
  const tier = TIER_WEIGHT[article.sourceTier] ?? 0.3;
  const recency = recencyWeightPct(article.publishedAt, now) / 100;
  const relevance = article.relevancePct / 100;
  return tier * recency * relevance;
}

function strengthOf(score: number, sampleSize: number): TiltStrength {
  if (sampleSize === 0) return "none";
  const a = Math.abs(score);
  if (a < 8) return "flat";
  if (a < 25) return "slight";
  if (a < 50) return "moderate";
  return "strong";
}

function labelFor(direction: TiltDirection, strength: TiltStrength, commodity: NewsCommodity): string {
  const name = commodity === "CRUDE" ? "Crude Oil" : "Natural Gas";
  if (strength === "none") return `No usable ${name} news right now`;
  if (strength === "flat") return `${name} news is balanced`;
  const s = strength === "strong" ? "Strongly" : strength === "moderate" ? "Leaning" : "Slightly";
  return `${name} news is ${s.toLowerCase()} ${direction}`;
}

/**
 * The net news tilt for one commodity.
 *
 * This is a weighted average of impact, NOT a sum -- otherwise twenty tiny
 * blog restatements of the same story would outweigh one EIA release, and the
 * meter would measure how many outlets rewrote a headline rather than how much
 * the news actually matters.
 */
export function computeTilt(articles: ScoredNewsArticle[], commodity: NewsCommodity, now: number = Date.now()): NewsTilt {
  const relevant = articles.filter((a) => relevantTo(a, commodity));

  let weightedSum = 0;
  let weightTotal = 0;
  let bullishCount = 0;
  let bearishCount = 0;
  let neutralCount = 0;

  for (const a of relevant) {
    const w = articleWeight(a, now);
    if (w <= 0) continue;
    // impactScale is -5..+5; normalise to -100..+100 before weighting.
    weightedSum += (a.impactScale / 5) * 100 * w;
    weightTotal += w;
    if (a.impactScale > 0.5) bullishCount += 1;
    else if (a.impactScale < -0.5) bearishCount += 1;
    else neutralCount += 1;
  }

  const sampleSize = bullishCount + bearishCount + neutralCount;
  const score = weightTotal > 0 ? Math.round(weightedSum / weightTotal) : 0;
  const direction: TiltDirection = score > 5 ? "bullish" : score < -5 ? "bearish" : "neutral";
  const strength = strengthOf(score, sampleSize);

  let note: string;
  if (sampleSize === 0) {
    note = `No ${commodity === "CRUDE" ? "crude" : "natural gas"} stories arrived that the scorer could use. That is an absence of data, not a neutral market.`;
  } else if (sampleSize < MIN_SAMPLE_FOR_CONFIDENT_TILT) {
    note = `Built on only ${sampleSize} ${sampleSize === 1 ? "story" : "stories"}. Too thin to lean on — treat it as a hint, not a reading.`;
  } else {
    note = `Weighted across ${sampleSize} stories by how recent each one is and how reliable its source is. News tilt is context, never an entry signal.`;
  }

  return {
    commodity,
    direction,
    strength,
    score,
    sampleSize,
    bullishCount,
    bearishCount,
    neutralCount,
    label: labelFor(direction, strength, commodity),
    note,
  };
}

/**
 * The stories that actually deserve the trader's attention, in order.
 * Ranked by how much the market should care (impact magnitude), scaled by
 * source quality and freshness -- so a huge old story sinks below a moderate
 * one that broke ten minutes ago.
 */
export function rankMovers(articles: ScoredNewsArticle[], commodity: NewsCommodity | "ALL", limit = 12, now: number = Date.now()): ScoredNewsArticle[] {
  const pool = commodity === "ALL" ? articles : articles.filter((a) => relevantTo(a, commodity));
  return [...pool]
    .map((a) => ({ a, rank: Math.abs(a.impactScale) * articleWeight(a, now) * (a.importance / 100) }))
    .filter((x) => x.rank > 0)
    .sort((x, y) => y.rank - x.rank)
    .slice(0, limit)
    .map((x) => x.a);
}

/** Stories that landed in the last `minutes`, newest first. */
export function breakingSince(articles: ScoredNewsArticle[], minutes: number, now: number = Date.now()): ScoredNewsArticle[] {
  return articles
    .filter((a) => {
      const age = ageMinutes(a.publishedAt, now);
      return age !== null && age >= 0 && age <= minutes;
    })
    .sort((x, y) => new Date(y.publishedAt).getTime() - new Date(x.publishedAt).getTime());
}

const THEMES: { key: string; label: string; test: RegExp }[] = [
  { key: "geopolitics", label: "Geopolitics & conflict", test: /hormuz|red sea|houthi|war|conflict|attack|strike|missile|sanction|embargo|israel|iran|russia|ukraine|venezuela/i },
  { key: "supply", label: "Supply & production", test: /opec|production|output|supply|barrels per day|\bbpd\b|quota|rig count|drilling|shale/i },
  { key: "inventory", label: "Inventories & storage", test: /inventor|stockpile|storage|\bspr\b|strategic petroleum|build|draw|\beia\b|\bapi\b/i },
  { key: "demand", label: "Demand", test: /demand|consumption|refinery run|refining margin|economic growth|recession|gdp/i },
  { key: "weather", label: "Weather & seasonal", test: /weather|hurricane|storm|freeze|cold|heat|temperature|heating degree|cooling degree|winter|summer/i },
  { key: "lng", label: "LNG & pipelines", test: /\blng\b|freeport|pipeline|terminal|liquefaction|export facility|feedgas/i },
  { key: "macro", label: "Macro & dollar", test: /dollar|\bfed\b|federal reserve|interest rate|inflation|\bcpi\b|treasury yield|tariff/i },
];

/** Which subjects the current news flow is actually about, and which way each leans. */
export function bucketThemes(articles: ScoredNewsArticle[], commodity: NewsCommodity | "ALL", now: number = Date.now()): ThemeBucket[] {
  const pool = commodity === "ALL" ? articles : articles.filter((a) => relevantTo(a, commodity));
  const out: ThemeBucket[] = [];

  for (const theme of THEMES) {
    const matched = pool.filter((a) => theme.test.test(`${a.headline} ${a.summary}`));
    if (matched.length === 0) continue;

    let weightedSum = 0;
    let weightTotal = 0;
    for (const a of matched) {
      const w = articleWeight(a, now);
      if (w <= 0) continue;
      weightedSum += (a.impactScale / 5) * 100 * w;
      weightTotal += w;
    }
    const top = [...matched].sort((x, y) => Math.abs(y.impactScale) * articleWeight(y, now) - Math.abs(x.impactScale) * articleWeight(x, now))[0];

    out.push({
      key: theme.key,
      label: theme.label,
      count: matched.length,
      net: weightTotal > 0 ? Math.round(weightedSum / weightTotal) : 0,
      topHeadline: top?.headline ?? null,
    });
  }

  return out.sort((a, b) => b.count - a.count);
}

/**
 * Which feeds are actually delivering.
 *
 * This is a first-class feature, not a debug panel. When the news page looks
 * empty the only useful question is "which sources answered and which did
 * not", and a source that returns HTTP 200 with zero items (a moved feed URL)
 * fails differently from one that returns 403 (bot-blocked) -- so the two are
 * separated rather than both being called "down".
 */
export function summariseSourceHealth(sourceStatus: SourceHealth[]): SourceHealthSummary {
  const live = sourceStatus.filter((s) => s.ok && s.count > 0);
  const empty = sourceStatus.filter((s) => s.ok && s.count === 0);
  const failing = sourceStatus.filter((s) => !s.ok);
  return {
    live: [...live].sort((a, b) => b.count - a.count),
    failing: [...failing].sort((a, b) => a.source.localeCompare(b.source)),
    empty: [...empty].sort((a, b) => a.source.localeCompare(b.source)),
    liveCount: live.length,
    totalCount: sourceStatus.length,
    articlesFromLive: live.reduce((s, x) => s + x.count, 0),
  };
}

/** How fresh the feed as a whole is -- the thing that was actually broken. */
export function readFreshness(articles: ScoredNewsArticle[], now: number = Date.now()): FreshnessRead {
  if (articles.length === 0) {
    return { newestAgeMinutes: null, withinLastHour: 0, withinLastSixHours: 0, older: 0, stale: true, label: "No stories at all" };
  }

  let newest = Infinity;
  let withinLastHour = 0;
  let withinLastSixHours = 0;
  let older = 0;

  for (const a of articles) {
    const age = ageMinutes(a.publishedAt, now);
    if (age === null || age < 0) continue;
    if (age < newest) newest = age;
    if (age <= 60) withinLastHour += 1;
    else if (age <= 360) withinLastSixHours += 1;
    else older += 1;
  }

  const newestAgeMinutes = Number.isFinite(newest) ? Math.round(newest) : null;
  // Six hours with nothing new, during a market that trades 9am-11:30pm, means
  // the feed is not keeping up -- say so rather than showing old news as news.
  const stale = newestAgeMinutes === null || newestAgeMinutes > 360;

  let label: string;
  if (newestAgeMinutes === null) label = "No usable timestamps";
  else if (newestAgeMinutes <= 15) label = "Live — newest story minutes old";
  else if (newestAgeMinutes <= 60) label = `Fresh — newest story ${newestAgeMinutes} min old`;
  else if (newestAgeMinutes <= 360) label = `Newest story ${Math.round(newestAgeMinutes / 60)}h old`;
  else label = `Stale — nothing newer than ${Math.round(newestAgeMinutes / 60)}h`;

  return { newestAgeMinutes, withinLastHour, withinLastSixHours, older, stale, label };
}

/** "12 min ago" / "3h ago" / "2d ago". Never a fabricated timestamp. */
export function relativeAge(publishedAt: string, now: number = Date.now()): string {
  const age = ageMinutes(publishedAt, now);
  if (age === null) return "unknown time";
  if (age < 0) return "just now";
  if (age < 1) return "just now";
  if (age < 60) return `${Math.round(age)} min ago`;
  if (age < 1440) return `${Math.round(age / 60)}h ago`;
  return `${Math.round(age / 1440)}d ago`;
}
