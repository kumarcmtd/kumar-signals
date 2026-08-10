import type { Candle, MarketDepthSnapshot, OptionsAnalytics } from "../types";
import { adx, rsi } from "./indicators";
import { evaluateStrategyVerification, type CallDirection, type StrategyResult, type StrategyTier } from "./strategyVerification";
import type { MarketDepthResult } from "./marketDepthAnalysis";
import { classifyMarketRegime, applyRegimeWeight, type ConfidenceCategory, type RegimeResult } from "./marketRegime";
import { analyzeSmartMoneyConcepts } from "./smartMoneyConcepts";
import { detectCandlePatterns } from "./candlePatterns";
import { analyzeOrderFlow } from "./orderFlowAnalysis";
import { evaluateOptionsSentiment } from "./optionsSentiment";
import { evaluateEntryTiming, type EntryTimingVerdict } from "./entryTiming";

// AI Verify Pro is a FINAL APPROVAL gate on top of whatever Best Call
// already generated -- it never invents a signal of its own. It re-reads
// the exact same 13-check Strategy Verification result, adds Market
// Structure/Smart Money/Candle Pattern/Order Flow/Options Sentiment as more
// votes, buckets everything into 9 confidence categories, and applies a
// stricter set of hard-rejection rules than Strategy Verification does --
// by design, since this page's whole job is to say NO TRADE more readily,
// not less.

export type TradeGrade = "S+" | "S" | "A+" | "A" | "B" | "C" | "REJECT";
export type FinalAction = "STRONG BUY" | "BUY" | "WAIT" | "NO TRADE";
export type RiskLevel = "Very Low" | "Low" | "Medium" | "High" | "Extreme";
export type ReversalProbability = "Very Low" | "Low" | "Medium" | "High" | "Very High";

export interface ThinkingStep {
  step: number;
  title: string;
  text: string;
}

export interface RiskPlan {
  stopLoss: number;
  targets: [number, number, number, number];
  riskRewardRatio: number | null;
  riskRewardLabel: string;
}

export interface CategoryScore {
  category: ConfidenceCategory;
  label: string;
  scorePct: number;
}

export interface VerifyProResult {
  regime: RegimeResult;
  checks: StrategyResult[];
  categoryScores: CategoryScore[];
  weightedScorePct: number;
  tradeGrade: TradeGrade;
  finalAction: FinalAction;
  winningProbabilityPct: number;
  riskLevel: RiskLevel;
  reversalProbability: ReversalProbability;
  entryTiming: EntryTimingVerdict;
  risk: RiskPlan;
  hardRejectionReasons: string[];
  reasons: { positive: string[]; negative: string[] };
  thinkingSteps: ThinkingStep[];
  newsRiskNote: string;
}

export interface VerifyProInput {
  direction: CallDirection;
  candles: Candle[];
  liveUnderlyingPrice: number;
  entry: number;
  stop: number; // original stop, as opened
  effectiveStop: number; // current trailing stop
  targets: [number, number, number];
  targetsHit: [boolean, boolean, boolean];
  livePremium: number | null;
  premiumSamples: number[];
  oiSamples: (number | null)[];
  underlyingPriceSamples: number[];
  marketDepth: MarketDepthResult | null;
  rawDepth: MarketDepthSnapshot | null;
  previousRawDepth: MarketDepthSnapshot | null;
  options: OptionsAnalytics | null;
}

const TIER_SCORE: Record<StrategyTier, number> = { pass: 100, wait: 50, fail: 0 };

const CATEGORY_LABEL: Record<ConfidenceCategory, string> = {
  trend: "Trend",
  momentum: "Momentum",
  volume: "Volume",
  vwap: "VWAP",
  structure: "Structure",
  smartMoney: "Smart Money",
  risk: "Risk",
  optionsSentiment: "Options Sentiment",
  orderFlow: "Order Flow",
};

const CATEGORY_MAP: Record<string, ConfidenceCategory> = {
  supertrend: "trend",
  ema200: "trend",
  cpr: "trend",
  adx: "momentum",
  rsi: "momentum",
  macd: "momentum",
  premiumMomentum: "momentum",
  volume: "volume",
  vwap: "vwap",
  sr: "structure",
  marketStructure: "structure",
  candlePattern: "structure",
  marketDepth: "smartMoney",
  smartMoneyFlags: "smartMoney",
  atrStop: "risk",
  pcr: "optionsSentiment",
  oiBuildup: "optionsSentiment",
  maxPain: "optionsSentiment",
  oi: "optionsSentiment",
  orderFlow: "orderFlow",
};

function mk(key: string, name: string, weightPct: number, tier: StrategyTier, reason: string, explain: string): StrategyResult {
  return { key, name, tier, reason, explain, weightPct };
}

function buildMarketStructureCheck(direction: CallDirection, smc: ReturnType<typeof analyzeSmartMoneyConcepts>): StrategyResult {
  const aligned = direction === "bullish" ? smc.structureBias === "bullish" : smc.structureBias === "bearish";
  const opposed = direction === "bullish" ? smc.structureBias === "bearish" : smc.structureBias === "bullish";
  const zoneFavorable = direction === "bullish" ? smc.zone === "discount" : smc.zone === "premium";
  const zoneUnfavorable = direction === "bullish" ? smc.zone === "premium" : smc.zone === "discount";
  if (aligned && !zoneUnfavorable) {
    return mk("marketStructure", "Market Structure (SMC)", 10, "pass", `Structure reads ${smc.structureBias} (HH/HL${zoneFavorable ? `, price in the ${smc.zone} zone` : ""}) -- matching this call.`, `Swing structure is ${smc.structureBias}, price sits at ${smc.zonePct}% of its recent swing range (${smc.zone} zone).`);
  }
  if (opposed) {
    return mk("marketStructure", "Market Structure (SMC)", 10, "fail", `Structure reads ${smc.structureBias} -- against this call.`, `Swing structure (recent highs/lows) is ${smc.structureBias}, opposite this call's direction.`);
  }
  if (zoneUnfavorable) {
    return mk("marketStructure", "Market Structure (SMC)", 10, "wait", `Price is in the ${smc.zone} zone (${smc.zonePct}% of recent range) -- not the ideal spot to add this ${direction === "bullish" ? "BUY" : "SELL"}.`, `Buying in a premium zone or selling in a discount zone usually means chasing -- structure itself isn't opposed, but the entry location isn't ideal.`);
  }
  return mk("marketStructure", "Market Structure (SMC)", 10, "wait", "Structure is mixed -- no clear HH/HL or LH/LL sequence yet.", `Recent swing highs/lows don't show a clean directional sequence (${smc.zonePct}% of range).`);
}

function buildSmartMoneyFlagsCheck(direction: CallDirection, smc: ReturnType<typeof analyzeSmartMoneyConcepts>): StrategyResult {
  const bullishFlags = smc.flags.filter((f) => f.kind === "bullish").length;
  const bearishFlags = smc.flags.filter((f) => f.kind === "bearish").length;
  const netBullish = bullishFlags - bearishFlags;
  const summary = smc.flags.length ? smc.flags.map((f) => f.label).slice(0, 3).join(" · ") : "No notable SMC flags right now.";
  const aligned = direction === "bullish" ? netBullish > 0 : netBullish < 0;
  const opposed = direction === "bullish" ? netBullish < 0 : netBullish > 0;
  if (aligned) return mk("smartMoneyFlags", "Smart Money Flags", 10, "pass", `${bullishFlags} bullish vs ${bearishFlags} bearish SMC flags -- net favors this call.`, summary);
  if (opposed) return mk("smartMoneyFlags", "Smart Money Flags", 10, "fail", `${bearishFlags} bearish vs ${bullishFlags} bullish SMC flags -- net against this call.`, summary);
  return mk("smartMoneyFlags", "Smart Money Flags", 10, "wait", "SMC flags are balanced or absent -- no clear edge.", summary);
}

function buildCandlePatternCheck(direction: CallDirection, candles: Candle[]): StrategyResult {
  const patterns = detectCandlePatterns(candles);
  if (!patterns.length) return mk("candlePattern", "Candle Pattern", 5, "wait", "No notable candlestick pattern on the last bar.", "No recognizable reversal/continuation pattern formed on the most recent candles.");
  const bullish = patterns.filter((p) => p.bias === "bullish").length;
  const bearish = patterns.filter((p) => p.bias === "bearish").length;
  const names = patterns.map((p) => p.name).join(", ");
  const aligned = direction === "bullish" ? bullish > bearish : bearish > bullish;
  const opposed = direction === "bullish" ? bearish > bullish : bullish > bearish;
  if (aligned) return mk("candlePattern", "Candle Pattern", 5, "pass", `${names} -- matches this call's direction.`, `Detected: ${names}.`);
  if (opposed) return mk("candlePattern", "Candle Pattern", 5, "fail", `${names} -- against this call's direction.`, `Detected: ${names}.`);
  return mk("candlePattern", "Candle Pattern", 5, "wait", `${names} -- mixed/neutral signal.`, `Detected: ${names}.`);
}

function buildOrderFlowCheck(direction: CallDirection, flow: ReturnType<typeof analyzeOrderFlow>): StrategyResult {
  if (!flow) return mk("orderFlow", "Order Flow", 10, "wait", "Order flow isn't available right now.", "Needs Level 2 depth data to approximate order flow.");
  const aligned = direction === "bullish" ? flow.deltaBias === "bullish" : flow.deltaBias === "bearish";
  const opposed = direction === "bullish" ? flow.deltaBias === "bearish" : flow.deltaBias === "bullish";
  const exhaustionAgainst = flow.exhaustion && !aligned;
  if (exhaustionAgainst) return mk("orderFlow", "Order Flow", 10, "fail", `${flow.deltaLabel}, and this leg shows signs of exhaustion.`, flow.reason);
  if (aligned) return mk("orderFlow", "Order Flow", 10, "pass", `${flow.deltaLabel} -- matches this call.`, flow.reason);
  if (opposed) return mk("orderFlow", "Order Flow", 10, "fail", `${flow.deltaLabel} -- against this call.`, flow.reason);
  return mk("orderFlow", "Order Flow", 10, "wait", `${flow.deltaLabel} -- no clear edge yet.`, flow.reason);
}

function computeRiskPlan(entry: number, stop: number, targets: [number, number, number]): RiskPlan {
  // Targets 1-3 are the REAL levels this call already opened with -- Verify
  // Pro doesn't invent its own. Target 4 is the only genuinely new number
  // here: a same-length continuation of the 2->3 leg, clearly derived, not
  // fabricated from nothing.
  const leg = targets[2] - targets[1];
  const target4 = Number((targets[2] + leg * 1.3).toFixed(2));
  const risk = Math.abs(entry - stop);
  const reward = Math.abs(targets[1] - entry); // RR judged against Target 2, the spec's "ideal" reference point
  const rr = risk > 0 ? Number((reward / risk).toFixed(2)) : null;
  const rrLabel = rr !== null ? `1 : ${rr.toFixed(1)}` : "n/a";
  return { stopLoss: stop, targets: [targets[0], targets[1], targets[2], target4], riskRewardRatio: rr, riskRewardLabel: rrLabel };
}

function gradeFor(scorePct: number, failCount: number, majorAllPass: boolean): TradeGrade {
  if (scorePct >= 90 && failCount === 0 && majorAllPass) return "S+";
  if (scorePct >= 85 && failCount <= 1 && majorAllPass) return "S";
  if (scorePct >= 75 && failCount <= 2) return "A+";
  if (scorePct >= 65 && failCount <= 2) return "A";
  if (scorePct >= 55) return "B";
  if (scorePct >= 45) return "C";
  return "REJECT";
}

const GRADE_ACTION: Record<TradeGrade, FinalAction> = {
  "S+": "STRONG BUY",
  S: "STRONG BUY",
  "A+": "BUY",
  A: "BUY",
  B: "WAIT",
  C: "WAIT",
  REJECT: "NO TRADE",
};

function riskLevelFor(regime: RegimeResult, failCount: number, rr: number | null, marketDepth: MarketDepthResult | null): RiskLevel {
  let score = 15;
  if (regime.regime === "high_volatility") score += 30;
  else if (regime.regime === "liquidity_trap") score += 35;
  else if (regime.regime === "low_volatility") score -= 10;
  score += failCount * 10;
  if (rr !== null && rr < 1.5) score += 20;
  if (marketDepth && marketDepth.liquidityScore < 4) score += 15;
  if (score < 20) return "Very Low";
  if (score < 40) return "Low";
  if (score < 60) return "Medium";
  if (score < 80) return "High";
  return "Extreme";
}

export function evaluateVerifyPro(input: VerifyProInput): VerifyProResult {
  const {
    direction,
    candles,
    liveUnderlyingPrice,
    entry,
    stop,
    effectiveStop,
    targets,
    targetsHit,
    livePremium,
    premiumSamples,
    oiSamples,
    underlyingPriceSamples,
    marketDepth,
    rawDepth,
    previousRawDepth,
    options,
  } = input;

  const base = evaluateStrategyVerification({ direction, candles, liveUnderlyingPrice, entry, effectiveStop, livePremium, premiumSamples, oiSamples, marketDepth });
  const regime = classifyMarketRegime(candles);
  const smc = analyzeSmartMoneyConcepts(candles);
  const flow = analyzeOrderFlow(rawDepth, previousRawDepth, candles);
  const optionChecks = evaluateOptionsSentiment(options, direction, liveUnderlyingPrice, oiSamples, underlyingPriceSamples);

  const checks: StrategyResult[] = [
    ...base.strategies,
    buildMarketStructureCheck(direction, smc),
    buildSmartMoneyFlagsCheck(direction, smc),
    buildCandlePatternCheck(direction, candles),
    buildOrderFlowCheck(direction, flow),
    ...optionChecks,
  ];

  // Regime-adjusted weighted score -- same auto-normalizing formula as
  // Strategy Verification, just with each check's weight nudged by how much
  // its category matters in the CURRENT market condition.
  let weightedSum = 0;
  let totalWeight = 0;
  const categoryTotals = new Map<ConfidenceCategory, { sum: number; weight: number }>();
  for (const c of checks) {
    const category = CATEGORY_MAP[c.key] ?? "structure";
    const adjustedWeight = applyRegimeWeight(c.weightPct, category, regime);
    weightedSum += TIER_SCORE[c.tier] * adjustedWeight;
    totalWeight += adjustedWeight;
    const bucket = categoryTotals.get(category) ?? { sum: 0, weight: 0 };
    bucket.sum += TIER_SCORE[c.tier] * c.weightPct;
    bucket.weight += c.weightPct;
    categoryTotals.set(category, bucket);
  }
  const rawScorePct = totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 0;

  const categoryScores: CategoryScore[] = (Object.keys(CATEGORY_LABEL) as ConfidenceCategory[]).map((category) => {
    const bucket = categoryTotals.get(category);
    return { category, label: CATEGORY_LABEL[category], scorePct: bucket && bucket.weight > 0 ? Math.round(bucket.sum / bucket.weight) : 50 };
  });

  const failCount = checks.filter((c) => c.tier === "fail").length;
  const majorKeys = ["supertrend", "ema200", "vwap", "adx"];
  const majorAllPass = checks.filter((c) => majorKeys.includes(c.key)).every((c) => c.tier === "pass");

  const risk = computeRiskPlan(entry, stop, targets);
  const adxValue = adx(candles);
  const rsiValue = rsi(candles.map((c) => c.close));

  // ---- Caution flags -- each one DOCKS points off the score instead of
  // unilaterally overriding the verdict to REJECT on its own. The old
  // design let any ONE of these force NO TRADE regardless of how strong
  // every other check read -- which meant a single noisy, single-instant
  // condition (a fast SuperTrend flip on one pullback candle, a 200-EMA
  // still lagging a fresh breakout, one thin-volume bar inside an
  // otherwise strong rally) could reject a call that was demonstrably
  // working (already past Target 1, live premium climbing). A real trade
  // getting rejected outright by one blip, while everything else about it
  // was fine, is exactly the "missed the opportunity" complaint this
  // engine exists to avoid. Now the verdict comes from the SAME weighted
  // score the grade and win probability are both built from, so multiple
  // real cautions stacking up together can still (correctly) sink a weak
  // setup to REJECT -- but one isolated flag on an otherwise strong
  // picture only nudges the grade down a notch, not straight to zero.
  const cautionFlags: { reason: string; penalty: number }[] = [];
  const supertrendCheck = checks.find((c) => c.key === "supertrend");
  const ema200Check = checks.find((c) => c.key === "ema200");
  const srCheck = checks.find((c) => c.key === "sr");
  const volumeCheck = checks.find((c) => c.key === "volume");

  if (supertrendCheck?.tier === "fail") cautionFlags.push({ reason: "SuperTrend is against this call.", penalty: 15 });
  if (ema200Check?.tier === "fail") cautionFlags.push({ reason: "Higher-timeframe (EMA200) trend is against this call.", penalty: 12 });
  if (adxValue !== null && adxValue < 20) cautionFlags.push({ reason: `ADX ${adxValue.toFixed(1)} is below 20 -- trend isn't fully confirmed yet.`, penalty: 10 });
  if (risk.riskRewardRatio !== null && risk.riskRewardRatio < 1.5) cautionFlags.push({ reason: `Risk:Reward is only 1:${risk.riskRewardRatio.toFixed(1)} -- below the 1:1.5 target.`, penalty: 12 });
  if (srCheck?.tier === "wait") cautionFlags.push({ reason: "Price is still testing a major support/resistance level.", penalty: 6 });
  if (marketDepth && marketDepth.liquidityScore < 3) cautionFlags.push({ reason: "Order book liquidity is thin.", penalty: 15 });
  if (volumeCheck?.tier === "fail") cautionFlags.push({ reason: "Volume is thin on the latest bar -- weak participation right now.", penalty: 8 });
  if (marketDepth && marketDepth.spreadPct !== null && marketDepth.spreadPct > 0.15) cautionFlags.push({ reason: `Spread (${marketDepth.spreadPct.toFixed(2)}%) is wide.`, penalty: 10 });
  if (regime.regime === "false_breakout") cautionFlags.push({ reason: "Market just printed a false breakout.", penalty: 15 });
  if (direction === "bullish" && smc.flags.some((f) => f.key === "sweepHigh")) cautionFlags.push({ reason: "A liquidity sweep against this call was just detected.", penalty: 10 });
  if (direction === "bearish" && smc.flags.some((f) => f.key === "sweepLow")) cautionFlags.push({ reason: "A liquidity sweep against this call was just detected.", penalty: 10 });
  if (regime.regime === "sideways" && (adxValue === null || adxValue < 18)) cautionFlags.push({ reason: "Sideways market with weak momentum.", penalty: 12 });
  if (direction === "bullish" && smc.flags.some((f) => f.key === "instSell")) cautionFlags.push({ reason: "Institutional selling detected against this BUY call.", penalty: 10 });
  if (direction === "bearish" && smc.flags.some((f) => f.key === "instBuy")) cautionFlags.push({ reason: "Institutional buying detected against this SELL call.", penalty: 10 });

  const totalPenalty = cautionFlags.reduce((s, f) => s + f.penalty, 0);
  const weightedScorePct = Math.max(0, Math.min(100, rawScorePct - totalPenalty));
  const hardRejectionReasons = cautionFlags.map((f) => f.reason);

  const tradeGrade = gradeFor(weightedScorePct, failCount, majorAllPass);
  const finalAction = GRADE_ACTION[tradeGrade];

  // Winning Probability is a heuristic estimate derived from the SAME
  // final (post-caution) confidence score, NOT a calibrated machine-
  // learning output -- this app has no trained model. It intentionally
  // sits a little below raw confidence, the way an experienced desk
  // trader discounts a clean setup for the market's inherent uncertainty.
  // Deriving both numbers from one consistent score (plain proportional,
  // no separate floor/offset) means confidence and win probability can no
  // longer contradict each other the way a 78% score next to a 23% win
  // probability used to -- and a genuinely weak, low-scoring setup now
  // reads as a genuinely low win probability instead of being propped up
  // by a flat +20 floor.
  const winningProbabilityPct = Math.max(5, Math.min(97, Math.round(weightedScorePct * 0.9)));

  const riskLevel = riskLevelFor(regime, failCount, risk.riskRewardRatio, marketDepth);

  let reversalScore = 0;
  if (smc.chochDetected) reversalScore += 30;
  if (smc.liquiditySweepDetected) reversalScore += 25;
  if (regime.regime === "reversal") reversalScore += 30;
  if (rsiValue !== null && (rsiValue > 75 || rsiValue < 25)) reversalScore += 25;
  const reversalProbability: ReversalProbability = reversalScore < 20 ? "Very Low" : reversalScore < 40 ? "Low" : reversalScore < 60 ? "Medium" : reversalScore < 80 ? "High" : "Very High";

  const legFloor = targetsHit[1] ? targets[1] : targetsHit[0] ? targets[0] : entry;
  const nextTarget = targetsHit[1] ? targets[2] : targetsHit[0] ? targets[1] : targets[0];
  const entryTiming = livePremium !== null ? evaluateEntryTiming(legFloor, nextTarget, effectiveStop, livePremium) : { tier: "underwater" as const, label: "No Live Price", note: "Live premium isn't available right now." };

  const reasons = {
    positive: checks.filter((c) => c.tier === "pass").map((c) => `${c.name} passed`),
    negative: [...checks.filter((c) => c.tier === "fail").map((c) => `${c.name} against this call`), ...hardRejectionReasons],
  };

  const trendCat = categoryScores.find((c) => c.category === "trend")!;
  const momentumCat = categoryScores.find((c) => c.category === "momentum")!;
  const structureCat = categoryScores.find((c) => c.category === "structure")!;
  const smartMoneyCat = categoryScores.find((c) => c.category === "smartMoney")!;
  const riskCat = categoryScores.find((c) => c.category === "risk")!;

  const thinkingSteps: ThinkingStep[] = [
    { step: 1, title: "Trend Analysis", text: `Market regime: ${regime.label}. Trend category score ${trendCat.scorePct}%.` },
    { step: 2, title: "Momentum Analysis", text: `ADX ${adxValue?.toFixed(1) ?? "n/a"}, RSI ${rsiValue?.toFixed(1) ?? "n/a"}. Momentum category score ${momentumCat.scorePct}%.` },
    { step: 3, title: "Market Structure Analysis", text: `SMC structure is ${smc.structureBias}, price in the ${smc.zone} zone. Structure category score ${structureCat.scorePct}%.` },
    { step: 4, title: "Smart Money Analysis", text: flow ? `${flow.deltaLabel}. Smart Money category score ${smartMoneyCat.scorePct}%.` : `Smart Money category score ${smartMoneyCat.scorePct}%.` },
    { step: 5, title: "Risk Analysis", text: `Risk:Reward ${risk.riskRewardLabel}, Risk Level ${riskLevel}. Risk category score ${riskCat.scorePct}%.` },
    { step: 6, title: "Probability Calculation", text: `Weighted confidence ${weightedScorePct}%, estimated win probability ${winningProbabilityPct}%.` },
    { step: 7, title: "Final Decision", text: `${tradeGrade} grade -> ${finalAction}${cautionFlags.length ? ` (${totalPenalty} pts docked for ${cautionFlags.length} caution flag${cautionFlags.length > 1 ? "s" : ""})` : ""}.` },
  ];

  return {
    regime,
    checks,
    categoryScores,
    weightedScorePct,
    tradeGrade,
    finalAction,
    winningProbabilityPct,
    riskLevel,
    reversalProbability,
    entryTiming,
    risk,
    hardRejectionReasons,
    reasons,
    thinkingSteps,
    newsRiskNote: "News Risk isn't checked -- this app has no live news feed integrated, so this factor is intentionally left out rather than faked.",
  };
}
