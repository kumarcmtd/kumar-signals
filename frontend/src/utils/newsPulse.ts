// The news side of a call, in one line: which way the latest headlines lean
// for this market, how strongly, how many are high-impact and fresh, and the
// top story. Uses the same recency- and source-weighted reading the News page
// uses (computeNewsReading), so the card and the News page always agree.
//
// In war-time crude, price moves on headlines (risk premium) more than on
// indicators -- so a call whose side the news is clearly against is not a
// call to take, however good the chart looks.

import type { EiaScoreResult, ScoredNewsArticle } from "./newsScoring";
import { computeNewsReading } from "./newsTradeEngine";

export interface NewsPulse {
  net: number; // -100..+100, + = bullish for this market
  direction: "bullish" | "bearish" | "neutral";
  highImpactFresh: number; // |impact| >= 3 within the last 2 hours
  top: { headline: string; source: string; ageMin: number; impactScale: number } | null;
  feedAgeMin: number | null; // how old the news build is
  available: boolean;
}

/** News at or beyond this, against a call's side, blocks a MATCHED alert. */
export const NEWS_AGAINST_BLOCK = 35;

export function newsPulseFor(symbol: "CRUDEOIL" | "NATURALGAS", articles: ScoredNewsArticle[], eia: EiaScoreResult | null, builtAt: string | null, now: number): NewsPulse {
  const reading = computeNewsReading(symbol, articles, eia);
  const marketKey = symbol === "CRUDEOIL" ? "CRUDE" : "NG";
  const relevant = articles.filter((a) => a.affectedMarket === marketKey || a.affectedMarket === "BOTH");
  const fresh = relevant.filter((a) => now - Date.parse(a.publishedAt) < 2 * 3600_000);
  const strongest = [...fresh].sort((a, b) => Math.abs(b.impactScale) - Math.abs(a.impactScale))[0] ?? relevant[0];
  const net = Math.round(reading.net);
  return {
    net,
    direction: net > 10 ? "bullish" : net < -10 ? "bearish" : "neutral",
    highImpactFresh: fresh.filter((a) => Math.abs(a.impactScale) >= 3).length,
    top: strongest
      ? { headline: strongest.headline, source: strongest.source, ageMin: Math.max(0, Math.round((now - Date.parse(strongest.publishedAt)) / 60_000)), impactScale: strongest.impactScale }
      : null,
    feedAgeMin: builtAt ? Math.max(0, Math.round((now - Date.parse(builtAt)) / 60_000)) : null,
    available: reading.available,
  };
}

/** How the news sits against a CE or PE call. */
export function newsVsSide(news: NewsPulse | null, side: "CE" | "PE"): "with" | "against" | "strongly_against" | "neutral" {
  if (!news || !news.available) return "neutral";
  const forSide = side === "CE" ? news.net : -news.net;
  if (forSide <= -NEWS_AGAINST_BLOCK) return "strongly_against";
  if (forSide < -10) return "against";
  if (forSide > 10) return "with";
  return "neutral";
}
