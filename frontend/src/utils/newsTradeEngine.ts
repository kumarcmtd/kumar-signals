import type { Candle, OptionsAnalytics } from "../types";
import { computeIndicatorSnapshot } from "./indicators";
import { analyzeSmartMoneyConcepts } from "./smartMoneyConcepts";
import { detectCandlePatterns } from "./candlePatterns";
import { classifyMarketRegime } from "./marketRegime";
import type { MarketDepthResult } from "./marketDepthAnalysis";
import type { ScoredNewsArticle, EiaScoreResult, ExpectedMove } from "./newsScoring";

// News Based Trade AI's final decision engine. Per the spec's own
// instruction ("Never generate signals from news alone"), News is
// deliberately just ONE of four weighted categories here -- Technical
// (reusing the same indicator/SMC/candle-pattern/regime engines built for
// AI Verify Pro) and Options/Liquidity (reusing OptionsAnalytics and the
// Market Depth engine) all vote independently. A symbol can have very
// bullish news and still net out neutral/bearish if the technicals disagree.

export type NewsTradeSymbol = "CRUDEOIL" | "NATURALGAS";

export interface CategoryReading {
  net: number; // -100 (max bearish) .. +100 (max bullish)
  available: boolean;
  reasons: string[];
}

export interface NewsTradeResult {
  symbol: NewsTradeSymbol;
  finalNet: number;
  expectedMove: ExpectedMove;
  weightsUsed: { news: number; technical: number; options: number; liquidity: number };
  news: CategoryReading & { articles: ScoredNewsArticle[] };
  technical: CategoryReading & { regimeLabel: string };
  options: CategoryReading & { pcr: number | null };
  liquidity: CategoryReading;
}

export interface NewsTradeInput {
  symbol: NewsTradeSymbol;
  candles: Candle[];
  options: OptionsAnalytics | null;
  depth: MarketDepthResult | null;
  articles: ScoredNewsArticle[];
  eia: EiaScoreResult | null;
  atmOiSamples: (number | null)[];
  underlyingPriceSamples: number[];
}

// News 30% / Technical 40% / Options 20% / Liquidity 10% -- auto-normalized
// across whichever categories actually have data (see evaluateNewsTrade),
// the same "don't let missing data silently drag toward neutral" pattern
// used throughout this app's other weighted engines.
const BASE_WEIGHTS = { news: 30, technical: 40, options: 20, liquidity: 10 };

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

function computeNewsReading(symbol: NewsTradeSymbol, articles: ScoredNewsArticle[], eia: EiaScoreResult | null): CategoryReading & { articles: ScoredNewsArticle[] } {
  const marketKey = symbol === "CRUDEOIL" ? "CRUDE" : "NG";
  const relevant = articles.filter((a) => a.affectedMarket === marketKey || a.affectedMarket === "BOTH");
  if (relevant.length === 0 && !eia) return { net: 0, available: false, reasons: ["No news available"], articles: [] };

  let weightedSum = 0;
  let totalWeight = 0;
  const reasons: string[] = [];

  for (const a of relevant.slice(0, 15)) {
    const contribution = (a.bullishScore - a.bearishScore) / 100;
    weightedSum += contribution * a.importance;
    totalWeight += a.importance;
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
  return { net, available: totalWeight > 0, reasons, articles: relevant.slice(0, 10) };
}

export function evaluateNewsTrade(input: NewsTradeInput): NewsTradeResult {
  const technical = computeTechnicalReading(input.candles);
  const options = computeOptionsReading(input.options, input.atmOiSamples, input.underlyingPriceSamples);
  const liquidity = computeLiquidityReading(input.depth);
  const news = computeNewsReading(input.symbol, input.articles, input.eia);

  const cats = [
    { key: "news" as const, reading: news, weight: BASE_WEIGHTS.news },
    { key: "technical" as const, reading: technical, weight: BASE_WEIGHTS.technical },
    { key: "options" as const, reading: options, weight: BASE_WEIGHTS.options },
    { key: "liquidity" as const, reading: liquidity, weight: BASE_WEIGHTS.liquidity },
  ];
  const availableCats = cats.filter((c) => c.reading.available);
  const totalAvailableWeight = availableCats.reduce((s, c) => s + c.weight, 0);

  const weightsUsed = { news: 0, technical: 0, options: 0, liquidity: 0 };
  let finalNet = 0;
  if (totalAvailableWeight > 0) {
    for (const c of availableCats) {
      const normalizedWeight = (c.weight / totalAvailableWeight) * 100;
      weightsUsed[c.key] = Math.round(normalizedWeight);
      finalNet += c.reading.net * (normalizedWeight / 100);
    }
  }
  finalNet = clamp(finalNet);

  return { symbol: input.symbol, finalNet, expectedMove: classifyExpectedMove(finalNet), weightsUsed, news, technical, options, liquidity };
}
