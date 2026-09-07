// AI Flash -- the "what just happened, right now" read on Crude and NG.
//
// This deliberately does NOT reuse News Based Trade AI's ordering. That page
// ranks by importance, which is correct for "what matters today" but is the
// exact reason a fresh, price-moving headline gets buried under a bigger but
// older story -- by the time you scroll to it the move is gone. AI Flash
// inverts that priority: recency dominates the weighting, and the feed is
// ordered newest-first, so the top of the page is always the newest thing
// the market has just been handed.
//
// Same house rule as every other engine here: fully deterministic and
// rule-based off the already-scored article (newsScoring.ts decides bullish
// vs bearish), so the same headline always produces the same number. Nothing
// is invented -- if no news arrived, the score says so rather than guessing.

import type { ScoredNewsArticle } from "./newsScoring";

export type FlashMarket = "CRUDE" | "NG";
export type FlashBias = "strong_bullish" | "bullish" | "neutral" | "bearish" | "strong_bearish";
export type FlashDirection = "bullish" | "bearish" | "neutral";
// How "live" an item is. Drives the badge colour and the FLASH pill -- the
// whole point of the page is that these are visually impossible to miss.
export type FlashHeat = "flash" | "hot" | "recent" | "today" | "stale";

export const FLASH_HALF_LIFE_MIN = 90;

export function ageMinutes(publishedAt: string, now: number = Date.now()): number {
  const t = new Date(publishedAt).getTime();
  if (!Number.isFinite(t)) return Number.POSITIVE_INFINITY;
  // A feed clock running slightly ahead of ours must not read as "in the
  // future" and outrank genuinely fresh items -- clamp to 0.
  return Math.max(0, (now - t) / 60_000);
}

// Exponential decay with a 90-minute half-life, rather than News AI's
// coarse step bands. Fresh news is worth roughly double a 90-minute-old
// story and ~16x a 6-hour-old one, which is the behaviour this page exists
// to provide. Anything past 48h contributes nothing at all.
export function flashRecencyPct(ageMin: number): number {
  if (!Number.isFinite(ageMin)) return 0;
  if (ageMin > 2880) return 0;
  return Math.max(1, Math.round(100 * Math.pow(0.5, ageMin / FLASH_HALF_LIFE_MIN)));
}

export function heatFor(ageMin: number): FlashHeat {
  if (!Number.isFinite(ageMin)) return "stale";
  if (ageMin <= 15) return "flash";
  if (ageMin <= 45) return "hot";
  if (ageMin <= 180) return "recent";
  if (ageMin <= 720) return "today";
  return "stale";
}

export function formatAge(ageMin: number): string {
  if (!Number.isFinite(ageMin)) return "unknown";
  const m = Math.floor(ageMin);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export interface FlashItem {
  id: string;
  headline: string;
  summary: string;
  source: string;
  url: string;
  publishedAt: string;
  ageMin: number;
  ageLabel: string;
  heat: FlashHeat;
  direction: FlashDirection;
  /** 0-100, how hard this one item pushes its direction. */
  strength: number;
  /** -100..100 signed, bullish positive. */
  net: number;
  /** How much this item counts toward the headline score (0-1). */
  weight: number;
  sourceTier: number;
  recencyPct: number;
  matchedRules: string[];
}

export function directionOf(net: number): FlashDirection {
  if (net >= 12) return "bullish";
  if (net <= -12) return "bearish";
  return "neutral";
}

// Relevance below ~60 is treated as partial credit rather than a hard cut --
// a genuinely on-topic story that only trips one keyword should still count,
// just less than one that trips five.
function relevanceFactor(relevancePct: number): number {
  return 0.35 + 0.65 * Math.min(1, Math.max(0, relevancePct) / 60);
}

// The Worker de-dupes on exact URL, which cannot catch the same wire story
// syndicated under different URLs across a dozen feeds -- and on a
// newest-first feed those land as a wall of near-identical rows. Collapsing
// on a normalized headline fingerprint keeps the freshest, best-sourced copy.
// It also matters for the score: ten copies of one story would otherwise
// contribute ten times the evidence mass of a story that happened once.
const HEADLINE_STOPWORDS = new Set(["a", "an", "the", "of", "in", "on", "to", "for", "and", "or", "is", "are", "as", "at", "by", "from", "with", "says", "said", "after", "amid", "update", "new"]);

export function headlineFingerprint(headline: string): string {
  return headline
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !HEADLINE_STOPWORDS.has(w))
    .sort()
    .slice(0, 8)
    .join(" ");
}

function dedupeByHeadline(items: FlashItem[]): FlashItem[] {
  const best = new Map<string, FlashItem>();
  for (const item of items) {
    const key = headlineFingerprint(item.headline);
    if (!key) {
      best.set(item.id, item);
      continue;
    }
    const existing = best.get(key);
    // Items arrive already sorted newest-first, so the first copy seen is the
    // freshest; only replace it if a later copy has a genuinely better source.
    if (!existing || item.sourceTier < existing.sourceTier) best.set(key, item);
  }
  return Array.from(best.values()).sort((a, b) => a.ageMin - b.ageMin || a.sourceTier - b.sourceTier);
}

export function buildFlashItems(articles: ScoredNewsArticle[], market: FlashMarket, now: number = Date.now()): FlashItem[] {
  const mapped = articles
    .filter((a) => a.affectedMarket === market || a.affectedMarket === "BOTH")
    .map((a) => {
      const ageMin = ageMinutes(a.publishedAt, now);
      const recencyPct = flashRecencyPct(ageMin);
      const net = Math.max(-100, Math.min(100, a.bullishScore - a.bearishScore));
      const weight = (recencyPct / 100) * (a.sourceQualityPct / 100) * relevanceFactor(a.relevancePct) * (a.importance / 100);
      return {
        id: a.url || `${a.source}-${a.publishedAt}-${a.headline.slice(0, 32)}`,
        headline: a.headline,
        summary: a.summary,
        source: a.source,
        url: a.url,
        publishedAt: a.publishedAt,
        ageMin,
        ageLabel: formatAge(ageMin),
        heat: heatFor(ageMin),
        direction: directionOf(net),
        strength: Math.min(100, Math.abs(net)),
        net,
        weight,
        sourceTier: a.sourceTier,
        recencyPct,
        matchedRules: a.matchedRules,
      };
    })
    // Newest first -- the entire premise of the page. Ties broken by the
    // better source so a wire beats a blog on the same minute.
    .sort((a, b) => a.ageMin - b.ageMin || a.sourceTier - b.sourceTier);
  return dedupeByHeadline(mapped);
}

export interface FlashPulse {
  market: FlashMarket;
  /** 0-100. 50 = neutral, above = bullish pressure, below = bearish. */
  score: number;
  bias: FlashBias;
  biasLabel: string;
  /** 0-100 -- how much evidence stands behind the score. */
  confidence: number;
  /** Items published in the last 30 minutes. */
  freshCount: number;
  totalCount: number;
  bullishCount: number;
  bearishCount: number;
  /** The single highest-weighted item, i.e. what is actually driving the score. */
  topDriver: FlashItem | null;
  /** True when nothing recent enough exists to say anything at all. */
  quiet: boolean;
}

const BIAS_LABEL: Record<FlashBias, string> = {
  strong_bullish: "Strong Bullish",
  bullish: "Bullish",
  neutral: "Neutral / Mixed",
  bearish: "Bearish",
  strong_bearish: "Strong Bearish",
};

export function biasForScore(score: number): FlashBias {
  if (score >= 70) return "strong_bullish";
  if (score >= 58) return "bullish";
  if (score <= 30) return "strong_bearish";
  if (score <= 42) return "bearish";
  return "neutral";
}

// Evidence mass at which the score is allowed to use its full 0-100 range.
// Below it the score is pulled toward 50, so "one stale blog post" can never
// print an extreme reading -- it prints "Neutral, low confidence", which is
// the honest answer.
const FULL_CONVICTION_MASS = 3;

export function scoreFlash(items: FlashItem[], market: FlashMarket): FlashPulse {
  const scoring = items.filter((i) => i.weight > 0);
  const mass = scoring.reduce((s, i) => s + i.weight, 0);
  const freshCount = items.filter((i) => i.ageMin <= 30).length;
  const bullishCount = items.filter((i) => i.direction === "bullish").length;
  const bearishCount = items.filter((i) => i.direction === "bearish").length;
  const topDriver = scoring.reduce<FlashItem | null>((best, i) => (best === null || Math.abs(i.net) * i.weight > Math.abs(best.net) * best.weight ? i : best), null);

  if (mass <= 0) {
    return {
      market, score: 50, bias: "neutral", biasLabel: BIAS_LABEL.neutral, confidence: 0,
      freshCount, totalCount: items.length, bullishCount, bearishCount, topDriver: null, quiet: true,
    };
  }

  // netAvg is a weighted AVERAGE, so a single article's own direction is its
  // full net no matter how weak that article is. Conviction therefore has to
  // scale the deflection all the way down to zero -- damping to a floor
  // instead would mean any one item, however stale and low-tier, still pegged
  // the gauge near an extreme.
  const netAvg = scoring.reduce((s, i) => s + i.weight * i.net, 0) / mass;
  const conviction = Math.min(1, mass / FULL_CONVICTION_MASS);
  const score = Math.max(0, Math.min(100, Math.round(50 + (netAvg / 100) * 50 * conviction)));

  const bestQuality = Math.max(...scoring.map((i) => (i.sourceTier === 1 ? 100 : i.sourceTier === 2 ? 80 : i.sourceTier === 3 ? 55 : 25)));
  const confidence = Math.max(0, Math.min(95, Math.round(conviction * 50 + (bestQuality / 100) * 30 + (Math.min(scoring.length, 8) / 8) * 20)));
  const bias = biasForScore(score);

  return {
    market, score, bias, biasLabel: BIAS_LABEL[bias], confidence,
    freshCount, totalCount: items.length, bullishCount, bearishCount, topDriver,
    // "Quiet" means nothing has landed recently enough to act on, even if
    // stale articles exist -- said plainly instead of dressing up old news.
    quiet: freshCount === 0 && mass < 0.35,
  };
}

export function analyzeFlash(articles: ScoredNewsArticle[], market: FlashMarket, now: number = Date.now()): { items: FlashItem[]; pulse: FlashPulse } {
  const items = buildFlashItems(articles, market, now);
  return { items, pulse: scoreFlash(items, market) };
}
