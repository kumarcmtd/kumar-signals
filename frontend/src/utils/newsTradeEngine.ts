import type { Candle, OptionsAnalytics } from "../types";
import { computeIndicatorSnapshot } from "./indicators";
import { analyzeSmartMoneyConcepts } from "./smartMoneyConcepts";
import { detectCandlePatterns } from "./candlePatterns";
import { classifyMarketRegime } from "./marketRegime";
import type { MarketDepthResult } from "./marketDepthAnalysis";
import type { ScoredNewsArticle, EiaScoreResult, ExpectedMove, NewsEvent } from "./newsScoring";

// News Based Trade AI's final decision engine. Per the spec's own
// instruction ("Never generate signals from news alone"), News is
// deliberately just ONE of five weighted categories here -- Technical
// (reusing the same indicator/SMC/candle-pattern/regime engines built for
// AI Verify Pro), Price-Momentum (a distinct, faster short-horizon
// rate-of-change read), Options and Liquidity (reusing OptionsAnalytics and
// the Market Depth engine) all vote independently. A symbol can have very
// bullish news and still net out neutral/bearish -- or explicitly flag
// CONFLICT -- if the rest disagrees.

export type NewsTradeSymbol = "CRUDEOIL" | "NATURALGAS";

export interface CategoryReading {
  net: number; // -100 (max bearish) .. +100 (max bullish)
  available: boolean;
  reasons: string[];
}

export type TradeConfirmation = "STRONG_CONFIRM" | "CONFIRM" | "WAIT_CONFLICT" | "NEWS_SUPPORT_ONLY" | "NEUTRAL";

// Exact structured shape the spec asks the News engine to make available for
// the existing Best Call / Verify Pro system to consume -- this module only
// COMPUTES and exposes it; it deliberately does not reach into or modify
// those engines' own scoring (that integration is a separate, explicit
// follow-up, not smuggled into this page's own upgrade).
export interface NewsSignalBrief {
  instrument: NewsTradeSymbol;
  newsScore: number; // -100..100
  newsDirection: "bullish" | "bearish" | "neutral";
  newsConfidence: number; // 0-100
  topEvents: NewsEvent[];
  eventCount: number;
  highImpactEventCount: number;
  sourceQuality: number; // 0-100, best corroborated source-quality among top events
  timestamp: string;
  dataFreshness: "live" | "stale" | "unavailable";
  conflictDetected: boolean;
}

export interface NewsTradeResult {
  symbol: NewsTradeSymbol;
  finalNet: number;
  expectedMove: ExpectedMove;
  weightsUsed: { news: number; technical: number; momentum: number; options: number; liquidity: number };
  news: CategoryReading & { articles: ScoredNewsArticle[]; events: NewsEvent[] };
  technical: CategoryReading & { regimeLabel: string };
  momentum: CategoryReading;
  options: CategoryReading & { pcr: number | null };
  liquidity: CategoryReading;
  tradeConfirmation: TradeConfirmation;
  tradeConfirmationLabel: string;
  newsSignal: NewsSignalBrief;
}

export interface NewsTradeInput {
  symbol: NewsTradeSymbol;
  candles: Candle[];
  options: OptionsAnalytics | null;
  depth: MarketDepthResult | null;
  articles: ScoredNewsArticle[];
  events: NewsEvent[];
  newsAvailable: boolean;
  eia: EiaScoreResult | null;
  atmOiSamples: (number | null)[];
  underlyingPriceSamples: number[];
  fetchedAt: string | null;
}

// Technicals 35% / Options 20% / Price-Momentum 15% / News 20% /
// Liquidity 10% -- auto-normalized across whichever categories actually
// have data (see evaluateNewsTrade), the same "don't let missing data
// silently drag toward neutral" pattern used throughout this app's other
// weighted engines.
const BASE_WEIGHTS = { technical: 35, options: 20, momentum: 15, news: 20, liquidity: 10 };

function clamp(n: number, lo = -100, hi = 100): number {
  return Math.max(lo, Math.min(hi, n));
}

function classifyExpectedMove(net: number): ExpectedMove {
  if (net >= 50) return "very_strong_bullish";
  if (net >= 15) return "bullish";
  if (net <= -50) return "very_strong_bearish";
  if (net <= -15) return "bearish";
  return "neutral";
}

function computeTechnicalReading(candles: Candle[]): CategoryReading & { regimeLabel: string } {
  if (candles.length < 30) return { net: 0, available: false, reasons: ["Not enough candles yet"], regimeLabel: "Gathering Data" };

  const snap = computeIndicatorSnapshot(candles);
  const price = candles[candles.length - 1].close;
  const reasons: string[] = [];
  let weightedSum = 0;
  let totalWeight = 0;
  const vote = (contribution: number, weight: number, reason: string) => {
    weightedSum += clamp(contribution, -1, 1) * weight;
    totalWeight += weight;
    reasons.push(reason);
  };

  if (snap.superTrend) vote(snap.superTrend.direction === "bullish" ? 1 : -1, 25, `SuperTrend ${snap.superTrend.direction === "bullish" ? "Bullish" : "Bearish"}`);
  if (snap.ema200 !== null) {
    const above = price > snap.ema200;
    vote(above ? 1 : -1, 20, `Price ${above ? "above" : "below"} EMA200`);
  }
  if (snap.vwap !== null) {
    const above = price > snap.vwap;
    vote(above ? 1 : -1, 15, `Price ${above ? "above" : "below"} VWAP`);
  }
  if (snap.macd) {
    const bullish = snap.macd.histogram > 0;
    vote(bullish ? 1 : -1, 15, `MACD ${bullish ? "Positive" : "Negative"}`);
  }
  if (snap.momentumScore !== null) {
    vote(snap.momentumScore / 100, 25, `Momentum ${snap.momentumScore > 10 ? "Bullish" : snap.momentumScore < -10 ? "Bearish" : "Neutral"}`);
  }

  const smc = analyzeSmartMoneyConcepts(candles);
  if (smc.structureBias !== "neutral") {
    vote(smc.structureBias === "bullish" ? 1 : -1, 15, `Market Structure ${smc.structureBias === "bullish" ? "Bullish" : "Bearish"}`);
  }

  const patterns = detectCandlePatterns(candles);
  const patternNet = patterns.reduce((s, p) => s + (p.bias === "bullish" ? 1 : p.bias === "bearish" ? -1 : 0), 0);
  if (patternNet !== 0) vote(patternNet, 10, `Candle Pattern ${patternNet > 0 ? "Bullish" : "Bearish"}`);

  const regime = classifyMarketRegime(candles);
  let net = totalWeight > 0 ? clamp((weightedSum / totalWeight) * 100) : 0;
  if (regime.regime === "false_breakout" || regime.regime === "liquidity_trap") {
    net *= 0.5;
    reasons.push(`Caution: ${regime.label} -- confidence reduced`);
  }

  return { net, available: totalWeight > 0, reasons, regimeLabel: regime.label };
}

// A deliberately faster, narrower read than the Technical category above --
// pure short-horizon rate-of-change plus whether volume is confirming it,
// rather than a confluence of lagging indicators. This is what lets the
// engine distinguish "technically still bullish on EMA200/VWAP but has
// actually stalled the last few candles" from genuine ongoing momentum.
function computeMomentumReading(candles: Candle[]): CategoryReading {
  if (candles.length < 16) return { net: 0, available: false, reasons: ["Not enough candles yet"] };
  const closes = candles.map((c) => c.close);
  const last = closes[closes.length - 1];
  const roc5 = ((last - closes[closes.length - 6]) / closes[closes.length - 6]) * 100;
  const roc15 = ((last - closes[closes.length - 16]) / closes[closes.length - 16]) * 100;

  const reasons: string[] = [];
  let weightedSum = 0;
  let totalWeight = 0;
  const vote = (contribution: number, weight: number, reason: string) => {
    weightedSum += clamp(contribution, -1, 1) * weight;
    totalWeight += weight;
    reasons.push(reason);
  };

  vote(clamp(roc5 * 8, -1, 1), 55, `${roc5 >= 0 ? "+" : ""}${roc5.toFixed(2)}% over the last 5 candles`);
  vote(clamp(roc15 * 4, -1, 1), 30, `${roc15 >= 0 ? "+" : ""}${roc15.toFixed(2)}% over the last 15 candles`);

  const recentVol = candles.slice(-5).reduce((s, c) => s + (c.volume ?? 0), 0) / 5;
  const priorVol = candles.slice(-20, -5).reduce((s, c) => s + (c.volume ?? 0), 0) / 15;
  if (priorVol > 0) {
    const volSurge = recentVol / priorVol;
    if (volSurge >= 1.2) {
      const sameDirection = Math.sign(roc5) || 1;
      vote(sameDirection, 15, `Volume running ${volSurge.toFixed(1)}x recent average -- confirms the move`);
    }
  }

  const net = totalWeight > 0 ? clamp((weightedSum / totalWeight) * 100) : 0;
  return { net, available: totalWeight > 0, reasons };
}

function computeOptionsReading(options: OptionsAnalytics | null, atmOiSamples: (number | null)[], priceSamples: number[]): CategoryReading & { pcr: number | null } {
  if (!options || options.error) return { net: 0, available: false, reasons: ["Options data unavailable"], pcr: null };
  const reasons: string[] = [];
  let weightedSum = 0;
  let totalWeight = 0;
  const vote = (contribution: number, weight: number, reason: string) => {
    weightedSum += clamp(contribution, -1, 1) * weight;
    totalWeight += weight;
    reasons.push(reason);
  };

  if (options.pcr !== null) {
    const lean = options.pcr > 1.3 ? 1 : options.pcr < 0.7 ? -1 : clamp((options.pcr - 1) * 2, -1, 1);
    vote(lean, 55, `PCR ${options.pcr.toFixed(2)} -- ${options.pcr > 1.1 ? "Bullish lean" : options.pcr < 0.9 ? "Bearish lean" : "Neutral"}`);
  }

  const validOi = atmOiSamples.filter((v): v is number => v !== null);
  if (validOi.length >= 3 && priceSamples.length >= 3) {
    const oiChange = validOi[validOi.length - 1] - validOi[0];
    const priceChange = priceSamples[priceSamples.length - 1] - priceSamples[0];
    if (oiChange !== 0 && priceChange !== 0) {
      const bullish = (oiChange > 0 && priceChange > 0) || (oiChange < 0 && priceChange > 0);
      vote(bullish ? 1 : -1, 35, `ATM OI/Price co-movement ${bullish ? "Bullish" : "Bearish"}`);
    }
  }

  if (options.maxPain !== null && options.spot > 0 && Math.abs(((options.spot - options.maxPain) / options.maxPain) * 100) < 1) {
    reasons.push("Price sitting near Max Pain -- elevated pin risk");
  }

  const net = totalWeight > 0 ? clamp((weightedSum / totalWeight) * 100) : 0;
  return { net, available: totalWeight > 0, reasons, pcr: options.pcr };
}

function computeLiquidityReading(depth: MarketDepthResult | null): CategoryReading {
  if (!depth) return { net: 0, available: false, reasons: ["Order book depth unavailable"] };
  const net = clamp(depth.imbalance * 100);
  return { net, available: true, reasons: [`Order book imbalance ${depth.imbalance >= 0 ? "+" : ""}${depth.imbalance} (${depth.tier})`, `Liquidity score ${depth.liquidityScore}/10`] };
}

function computeNewsReading(symbol: NewsTradeSymbol, articles: ScoredNewsArticle[], eia: EiaScoreResult | null): CategoryReading & { articles: ScoredNewsArticle[]; events: NewsEvent[] } {
  const marketKey = symbol === "CRUDEOIL" ? "CRUDE" : "NG";
  const relevant = articles.filter((a) => a.affectedMarket === marketKey || a.affectedMarket === "BOTH");
  if (relevant.length === 0 && !eia) return { net: 0, available: false, reasons: ["No news available"], articles: [], events: [] };

  let weightedSum = 0;
  let totalWeight = 0;
  const reasons: string[] = [];

  for (const a of relevant.slice(0, 15)) {
    // Recency-decayed and source-quality-weighted, not just importance --
    // a fresh Tier-1 headline should count for far more than a stale,
    // uncorroborated one even if both matched the same keyword rule.
    const weight = a.importance * (a.recencyPct / 100) * (a.sourceQualityPct / 100);
    const contribution = (a.bullishScore - a.bearishScore) / 100;
    weightedSum += contribution * weight;
    totalWeight += weight;
  }
  if (eia) {
    const contribution = (eia.bullishScore - eia.bearishScore) / 100;
    // Real government data gets a bit more say than a single headline.
    weightedSum += contribution * eia.importance * 1.5;
    totalWeight += eia.importance * 1.5;
    reasons.push(eia.label);
  }
  reasons.push(...relevant.slice(0, 3).map((a) => a.headline));

  const net = totalWeight > 0 ? clamp((weightedSum / totalWeight) * 100) : 0;
  return { net, available: totalWeight > 0, reasons, articles: relevant.slice(0, 10), events: [] };
}

function buildNewsSignal(symbol: NewsTradeSymbol, news: CategoryReading, events: NewsEvent[], newsAvailable: boolean, fetchedAt: string | null, conflictDetected: boolean): NewsSignalBrief {
  const marketKey = symbol === "CRUDEOIL" ? "CRUDE" : "NG";
  const relevantEvents = events.filter((e) => e.affectedMarket === marketKey || e.affectedMarket === "BOTH");
  const topEvents = [...relevantEvents].sort((a, b) => Math.abs(b.impactScale) - Math.abs(a.impactScale)).slice(0, 5);
  const highImpactEventCount = relevantEvents.filter((e) => Math.abs(e.impactScale) >= 3).length;
  const sourceQuality = topEvents.length ? Math.max(...topEvents.map((e) => e.sourceQualityPct)) : 0;
  const ageMs = fetchedAt ? Date.now() - new Date(fetchedAt).getTime() : Infinity;
  const dataFreshness: NewsSignalBrief["dataFreshness"] = !newsAvailable ? "unavailable" : ageMs < 5 * 60 * 1000 ? "live" : "stale";

  return {
    instrument: symbol,
    newsScore: Math.round(news.net),
    newsDirection: news.net > 10 ? "bullish" : news.net < -10 ? "bearish" : "neutral",
    newsConfidence: news.available ? Math.min(95, Math.round(Math.abs(news.net) + sourceQuality * 0.3)) : 0,
    topEvents,
    eventCount: relevantEvents.length,
    highImpactEventCount,
    sourceQuality: Math.round(sourceQuality),
    timestamp: fetchedAt ?? new Date().toISOString(),
    dataFreshness,
    conflictDetected,
  };
}

export function evaluateNewsTrade(input: NewsTradeInput): NewsTradeResult {
  const technical = computeTechnicalReading(input.candles);
  const momentum = computeMomentumReading(input.candles);
  const options = computeOptionsReading(input.options, input.atmOiSamples, input.underlyingPriceSamples);
  const liquidity = computeLiquidityReading(input.depth);
  const news = computeNewsReading(input.symbol, input.articles, input.eia);
  const newsWithEvents = { ...news, events: input.events };

  const cats = [
    { key: "news" as const, reading: news, weight: BASE_WEIGHTS.news },
    { key: "technical" as const, reading: technical, weight: BASE_WEIGHTS.technical },
    { key: "momentum" as const, reading: momentum, weight: BASE_WEIGHTS.momentum },
    { key: "options" as const, reading: options, weight: BASE_WEIGHTS.options },
    { key: "liquidity" as const, reading: liquidity, weight: BASE_WEIGHTS.liquidity },
  ];
  const availableCats = cats.filter((c) => c.reading.available);
  const totalAvailableWeight = availableCats.reduce((s, c) => s + c.weight, 0);

  const weightsUsed = { news: 0, technical: 0, momentum: 0, options: 0, liquidity: 0 };
  let finalNet = 0;
  if (totalAvailableWeight > 0) {
    for (const c of availableCats) {
      const normalizedWeight = (c.weight / totalAvailableWeight) * 100;
      weightsUsed[c.key] = Math.round(normalizedWeight);
      finalNet += c.reading.net * (normalizedWeight / 100);
    }
  }
  finalNet = clamp(finalNet);

  // "Do not force a trade": News should strengthen an existing technical/
  // options setup, never manufacture one on its own -- and when News
  // disagrees with the rest, that must show as an explicit CONFLICT rather
  // than being averaged away into a falsely-confident number.
  const nonNewsCats = [technical, momentum, options].filter((c) => c.available);
  const nonNewsNet = nonNewsCats.length ? nonNewsCats.reduce((s, c) => s + c.net, 0) / nonNewsCats.length : 0;
  const newsStrong = news.available && Math.abs(news.net) >= 15;
  const nonNewsStrong = nonNewsCats.length > 0 && Math.abs(nonNewsNet) >= 15;
  const disagreeing = newsStrong && nonNewsStrong && Math.sign(news.net) !== Math.sign(nonNewsNet);

  let tradeConfirmation: TradeConfirmation;
  let tradeConfirmationLabel: string;
  if (disagreeing) {
    tradeConfirmation = "WAIT_CONFLICT";
    tradeConfirmationLabel = `CONFLICT -- News is ${news.net > 0 ? "bullish" : "bearish"} but technicals/options structure disagree. WAIT for alignment, don't trade the news alone.`;
  } else if (newsStrong && !nonNewsStrong) {
    tradeConfirmation = "NEWS_SUPPORT_ONLY";
    tradeConfirmationLabel = "NEWS SUPPORT ONLY -- WAIT FOR TECHNICAL CONFIRMATION before acting.";
  } else if (newsStrong && nonNewsStrong && Math.sign(news.net) === Math.sign(nonNewsNet) && Math.abs(finalNet) >= 40) {
    tradeConfirmation = "STRONG_CONFIRM";
    tradeConfirmationLabel = `STRONG ${finalNet > 0 ? "BUY" : "SELL"} CONFIRMATION -- News, technicals, and options are all aligned.`;
  } else if (nonNewsStrong && Math.abs(finalNet) >= 20) {
    tradeConfirmation = "CONFIRM";
    tradeConfirmationLabel = `${finalNet > 0 ? "Bullish" : "Bearish"} setup confirmed by technicals/options${news.available ? (Math.sign(news.net) === Math.sign(nonNewsNet) || news.net === 0 ? ", news not conflicting" : "") : ""}.`;
  } else {
    tradeConfirmation = "NEUTRAL";
    tradeConfirmationLabel = "No clear edge yet -- signals are mixed or too weak to act on.";
  }

  const newsSignal = buildNewsSignal(input.symbol, news, input.events, input.newsAvailable, input.fetchedAt, disagreeing);

  return {
    symbol: input.symbol,
    finalNet,
    expectedMove: classifyExpectedMove(finalNet),
    weightsUsed,
    news: newsWithEvents,
    technical,
    momentum,
    options,
    liquidity,
    tradeConfirmation,
    tradeConfirmationLabel,
    newsSignal,
  };
}
