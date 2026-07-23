// Ported from a user-supplied "Commodity Options Trading Playbook" document
// (a Python script, source credited as "Kimi AI"). The setup catalog below
// (entry/stop/target RULES, descriptions, avoid-when conditions) is generic
// technical-analysis reference material and is reproduced faithfully.
//
// v2.1 "Survival Edition" update: the source document was regenerated after
// live testing of v1 showed a 0% win rate, traced to stops that were far
// tighter than the setup's own natural volatility (ATR). This version adds,
// per setup: a minimum stop/target distance expressed as a multiple of
// ATR(14), and a mandatory list of confluence factors that must be present
// before a signal counts as tradeable at all -- both enforced below, not
// just displayed.
//
// IMPORTANT HONESTY NOTE: the trades/wins/win_rate/avg_win/avg_loss/
// profit_factor/expectancy figures attached to each setup are NOT derived
// from any real backtest against actual MCX Crude Oil/Natural Gas history --
// they are example figures embedded in the source document with no
// verification behind them. This app never presents invented data as if it
// were real, so every UI surface using these numbers must label them
// "reference / unverified" rather than "backtested". The calculator
// functions below (hit probability, potential left, position size) are pure
// deterministic math ported exactly from the source -- those are legitimate
// regardless of which numbers get fed into them.

export type Commodity = "NG" | "CL";
export type OptSide = "CE" | "PE" | "CE/PE";

export interface PlaybookSetup {
  setupName: string;
  direction: OptSide;
  trades: number;
  wins: number;
  avgWin: number;
  avgLoss: number;
  maxDd: number;
  winRate: number;
  rrRatio: number;
  profitFactor: number;
  expectancy: number;
  bestTimeframe: string;
  description: string;
  entryRules: string[];
  stopLossRules: string[];
  targetRules: string[];
  avoidWhen: string[];
  // v2.1 additions -- the actual enforced risk rules, not just reference text.
  minAtrSl: number;
  minAtrTarget: number;
  requiredConfluence: ConfluenceFactor[];
  newsRequired?: boolean;
}

export const NATURAL_GAS_SETUPS: PlaybookSetup[] = [
  {
    setupName: "Bullish Engulfing + EMA Bounce",
    direction: "CE",
    trades: 45,
    wins: 33,
    avgWin: 18.5,
    avgLoss: 8.2,
    maxDd: 12.3,
    winRate: 73.3,
    rrRatio: 2.26,
    profitFactor: 6.2,
    expectancy: 11.37,
    bestTimeframe: "30-min / 1-hour",
    description: "Bullish engulfing candle forms at 20/50 EMA support during uptrend. Volume spike confirms.",
    entryRules: ["Price above 200 EMA (uptrend)", "Pulls back to 20 or 50 EMA", "Bullish engulfing candle at EMA", "Volume > 1.5x average", "Entry = break of engulfing high"],
    stopLossRules: ["Below engulfing low OR 1.5x ATR, whichever is WIDER"],
    targetRules: ["1.5x to 2.0x RR or previous swing high"],
    avoidWhen: ["ATR < 2 points", "Against downtrend", "No volume confirmation"],
    minAtrSl: 1.5,
    minAtrTarget: 3.0,
    requiredConfluence: ["volume_spike_1_5x", "trend_aligned"],
  },
  {
    setupName: "Double Bottom + Volume Spike",
    direction: "CE",
    trades: 38,
    wins: 29,
    avgWin: 22.1,
    avgLoss: 9.5,
    maxDd: 15.1,
    winRate: 76.3,
    rrRatio: 2.33,
    profitFactor: 7.5,
    expectancy: 14.61,
    bestTimeframe: "1-hour / Daily",
    description: "Classic W-pattern at support. Second bottom holds with higher volume on bounce.",
    entryRules: ["Two distinct lows at similar price", "Second low has higher RSI", "Volume spike on bounce", "Break of neckline = entry"],
    stopLossRules: ["Below second bottom low"],
    targetRules: ["Pattern depth from neckline"],
    avoidWhen: ["Second bottom breaks first low by >1 ATR"],
    minAtrSl: 1.8,
    minAtrTarget: 3.5,
    requiredConfluence: ["volume_spike_1_5x", "divergence_rsi"],
  },
  {
    setupName: "EIA Storage Reversal (Post-Data)",
    direction: "CE/PE",
    trades: 52,
    wins: 36,
    avgWin: 28.4,
    avgLoss: 11.2,
    maxDd: 18.7,
    winRate: 69.2,
    rrRatio: 2.54,
    profitFactor: 5.71,
    expectancy: 16.2,
    bestTimeframe: "15-min / 30-min post-data",
    description: "Trade the reversal AFTER EIA weekly storage report. Wait for initial whipsaw to settle.",
    entryRules: ["EIA report released (Thu 10:30 AM EST)", "Wait MINIMUM 15 minutes", "Wait for candle CLOSE", "Engulfing at gap extreme", "Entry = break of confirmation candle"],
    stopLossRules: ["2x ATR from entry (news = wild swings)"],
    targetRules: ["1.5x to 2.5x RR or 50% gap fill"],
    avoidWhen: ["Enter before 15 min", "ATR > 3x normal", "No reversal candle"],
    minAtrSl: 2.0,
    minAtrTarget: 4.0,
    requiredConfluence: ["volume_spike_2x"],
    newsRequired: true,
  },
  {
    setupName: "Opening Range Breakout — CORRECTED",
    direction: "CE/PE",
    trades: 62,
    wins: 37,
    avgWin: 14.2,
    avgLoss: 7.8,
    maxDd: 9.4,
    winRate: 59.7,
    rrRatio: 1.82,
    profitFactor: 2.69,
    expectancy: 5.33,
    bestTimeframe: "30-min / 1-hour (NOT 15-min!)",
    description: "Trade the break of the first 60-minute range. v2.1 fix: 15-min was pure noise -- widened to 30-min/1-hour.",
    entryRules: ["Mark high/low of FIRST 60 MINUTES", "Range must be > 1.5x ATR(14)", "Break of range with volume", "Entry = break of range boundary"],
    stopLossRules: ["Other side of range OR 1.5x ATR, whichever is WIDER"],
    targetRules: ["2x range width"],
    avoidWhen: ["Range < 1.5x ATR", "Low volume break", "First 30 min only"],
    minAtrSl: 1.5,
    minAtrTarget: 2.5,
    requiredConfluence: ["volume_spike_1_5x", "trend_aligned"],
  },
  {
    setupName: "RSI Divergence at Support",
    direction: "CE",
    trades: 41,
    wins: 27,
    avgWin: 19.8,
    avgLoss: 10.1,
    maxDd: 13.6,
    winRate: 65.9,
    rrRatio: 1.96,
    profitFactor: 3.78,
    expectancy: 9.6,
    bestTimeframe: "30-min / 1-hour",
    description: "Price makes lower low but RSI makes higher low = bullish divergence. Signals weakening selling pressure.",
    entryRules: ["Price at key support", "RSI higher low, price lower low", "Bullish candle confirmation", "Entry = break of confirmation high"],
    stopLossRules: ["Below lower low + 0.5 ATR buffer"],
    targetRules: ["Previous resistance or 1.5x RR"],
    avoidWhen: ["Divergence on <30min", "No candle confirmation"],
    minAtrSl: 1.5,
    minAtrTarget: 3.0,
    requiredConfluence: ["divergence_rsi", "key_level_sr"],
  },
  {
    setupName: "Bearish Pin Bar at Resistance",
    direction: "PE",
    trades: 35,
    wins: 24,
    avgWin: 16.3,
    avgLoss: 8.9,
    maxDd: 11.2,
    winRate: 68.6,
    rrRatio: 1.83,
    profitFactor: 4.0,
    expectancy: 8.39,
    bestTimeframe: "30-min / 1-hour",
    description: "Shooting star / pin bar forms at resistance. Long upper wick shows rejection.",
    entryRules: ["Price at resistance", "Pin bar with wick >= 2x body", "Wick touches resistance then rejects", "Next candle closes below pin bar low", "Entry = break of pin bar low"],
    stopLossRules: ["Above pin bar high + 0.5 ATR"],
    targetRules: ["Next support or 1.5x RR"],
    avoidWhen: ["Pin bar mid-range", "Low volume", "Strong uptrend"],
    minAtrSl: 1.5,
    minAtrTarget: 2.5,
    requiredConfluence: ["key_level_sr"],
  },
  {
    setupName: "200 EMA Rejection",
    direction: "PE",
    trades: 48,
    wins: 31,
    avgWin: 15.7,
    avgLoss: 9.3,
    maxDd: 14.8,
    winRate: 64.6,
    rrRatio: 1.69,
    profitFactor: 3.08,
    expectancy: 6.85,
    bestTimeframe: "1-hour / 4-hour",
    description: "Counter-trend play. Price rallies to 200 EMA in downtrend and gets rejected.",
    entryRules: ["Price below 200 EMA (downtrend)", "Rally approaches 200 EMA", "Bearish reversal candle at 200 EMA", "Entry = break of reversal candle low"],
    stopLossRules: ["Above 200 EMA + 1 ATR buffer"],
    targetRules: ["Previous swing low or 1.5x RR"],
    avoidWhen: ["Price breaks above 200 EMA", "Strong volume on rally"],
    minAtrSl: 1.5,
    minAtrTarget: 2.5,
    requiredConfluence: ["trend_aligned", "volume_spike_1_5x"],
  },
  {
    setupName: "Flag Breakout (30-min)",
    direction: "CE/PE",
    trades: 55,
    wins: 37,
    avgWin: 12.8,
    avgLoss: 6.5,
    maxDd: 8.2,
    winRate: 67.3,
    rrRatio: 1.97,
    profitFactor: 4.05,
    expectancy: 6.49,
    bestTimeframe: "30-min / 1-hour",
    description: "After strong move, price consolidates in parallel channel (flag). Break = continuation. v2.1: moved off 15-min noise.",
    entryRules: ["Strong impulsive move (pole) > 2x ATR", "Consolidation in parallel channel", "Volume decreases during flag", "Break of flag boundary with volume spike"],
    stopLossRules: ["Other side of flag channel"],
    targetRules: ["Pole height projected from breakout"],
    avoidWhen: ["Flag > 15 candles", "Break without volume"],
    minAtrSl: 1.2,
    minAtrTarget: 2.5,
    requiredConfluence: ["volume_spike_1_5x"],
  },
];

export const CRUDE_OIL_SETUPS: PlaybookSetup[] = [
  {
    setupName: "EIA Inventory Reversal",
    direction: "CE/PE",
    trades: 68,
    wins: 51,
    avgWin: 125.0,
    avgLoss: 52.0,
    maxDd: 89.0,
    winRate: 75.0,
    rrRatio: 2.4,
    profitFactor: 7.21,
    expectancy: 80.75,
    bestTimeframe: "30-min / 1-hour post-data",
    description: "THE highest probability setup. EIA Wed 10:30 AM EST. Trade the reversal after initial knee-jerk.",
    entryRules: ["EIA report released (Wed 10:30 AM EST)", "Wait MINIMUM 20 minutes", "Wait for 30-min candle to CLOSE", "Engulfing at gap extreme", "Entry = break of engulfing candle"],
    stopLossRules: ["2x ATR from entry"],
    targetRules: ["2.0x to 2.5x RR or 50% gap fill"],
    avoidWhen: ["Enter before 20 min", "No clear engulfing"],
    minAtrSl: 2.0,
    minAtrTarget: 4.0,
    requiredConfluence: ["volume_spike_2x"],
    newsRequired: true,
  },
  {
    setupName: "Trendline Break + Retest",
    direction: "CE/PE",
    trades: 55,
    wins: 38,
    avgWin: 98.0,
    avgLoss: 45.0,
    maxDd: 72.0,
    winRate: 69.1,
    rrRatio: 2.18,
    profitFactor: 4.87,
    expectancy: 53.81,
    bestTimeframe: "1-hour / 4-hour",
    description: "Draw trendline connecting 3+ swing points. Break + retest = highest probability entry.",
    entryRules: ["Valid trendline (3+ touches)", "Price breaks trendline with volume", "Wait for retest", "Entry = rejection at retest (pin bar/engulfing)"],
    stopLossRules: ["Other side of retest + 0.5 ATR"],
    targetRules: ["Previous swing high/low or 1.5x RR"],
    avoidWhen: ["Break without volume", "No retest (FOMO)"],
    minAtrSl: 1.5,
    minAtrTarget: 3.0,
    requiredConfluence: ["volume_spike_1_5x", "trend_aligned"],
  },
  {
    setupName: "VWAP Rejection (Intraday)",
    direction: "CE/PE",
    trades: 72,
    wins: 47,
    avgWin: 68.0,
    avgLoss: 38.0,
    maxDd: 56.0,
    winRate: 65.3,
    rrRatio: 1.79,
    profitFactor: 3.36,
    expectancy: 31.22,
    bestTimeframe: "15-min / 30-min",
    description: "Mean reversion to VWAP. Price extends >2.0% away, volume diverges, snaps back.",
    entryRules: ["Price > 2.0% away from VWAP", "Volume decreasing on extension", "RSI extreme (>70 short, <30 long)", "Reversal candle at extreme"],
    stopLossRules: ["VWAP + 0.5 ATR buffer"],
    targetRules: ["VWAP level or next S/R"],
    avoidWhen: ["Trend day > 4%", "News-driven move"],
    minAtrSl: 1.0,
    minAtrTarget: 2.0,
    requiredConfluence: ["volume_spike_1_5x"],
  },
  {
    setupName: "OPEC News Gap Fill",
    direction: "CE/PE",
    trades: 42,
    wins: 29,
    avgWin: 145.0,
    avgLoss: 62.0,
    maxDd: 95.0,
    winRate: 69.0,
    rrRatio: 2.34,
    profitFactor: 5.22,
    expectancy: 80.83,
    bestTimeframe: "30-min / 1-hour",
    description: "OPEC+ news creates gap. Most gaps fill within 48 hours. Trade the fill.",
    entryRules: ["OPEC+ announcement creates gap > 3%", "Wait 3-4 hours for settle", "Reversal at gap extreme"],
    stopLossRules: ["2x ATR from entry"],
    targetRules: ["50% gap fill or full fill"],
    avoidWhen: ["Gap > 10%", "No reversal candle"],
    minAtrSl: 2.0,
    minAtrTarget: 4.0,
    requiredConfluence: ["volume_spike_1_5x"],
    newsRequired: true,
  },
  {
    setupName: "Head & Shoulders Pattern",
    direction: "PE",
    trades: 38,
    wins: 24,
    avgWin: 112.0,
    avgLoss: 51.0,
    maxDd: 78.0,
    winRate: 63.2,
    rrRatio: 2.2,
    profitFactor: 3.76,
    expectancy: 52.02,
    bestTimeframe: "Daily / 4-hour",
    description: "Classic reversal pattern. Three peaks with middle highest. Break of neckline = sell.",
    entryRules: ["Left shoulder, head, right shoulder visible", "Volume highest on left shoulder", "Break of neckline with volume"],
    stopLossRules: ["Above right shoulder high + 0.5 ATR"],
    targetRules: ["Head-to-neckline distance projected down"],
    avoidWhen: ["Sloping neckline", "Right shoulder > head"],
    minAtrSl: 1.5,
    minAtrTarget: 3.0,
    requiredConfluence: ["volume_spike_1_5x", "key_level_sr"],
  },
  {
    setupName: "Hammer at 200 EMA Support",
    direction: "CE",
    trades: 45,
    wins: 31,
    avgWin: 88.0,
    avgLoss: 42.0,
    maxDd: 61.0,
    winRate: 68.9,
    rrRatio: 2.1,
    profitFactor: 4.64,
    expectancy: 47.57,
    bestTimeframe: "1-hour / Daily",
    description: "Hammer candle forms at 200 EMA in uptrend. Strong institutional buying zone.",
    entryRules: ["Price above 200 EMA", "Hammer candle at 200 EMA", "Volume > previous 3 candles avg"],
    stopLossRules: ["Below hammer low - 0.5 ATR"],
    targetRules: ["Previous swing high or 1.5x RR"],
    avoidWhen: ["Hammer body > 30% of range", "Breaks below 200 EMA"],
    minAtrSl: 1.5,
    minAtrTarget: 3.0,
    requiredConfluence: ["volume_spike_1_5x", "trend_aligned"],
  },
  {
    setupName: "Shooting Star at Supply Zone",
    direction: "PE",
    trades: 40,
    wins: 26,
    avgWin: 95.0,
    avgLoss: 48.0,
    maxDd: 67.0,
    winRate: 65.0,
    rrRatio: 1.98,
    profitFactor: 3.68,
    expectancy: 44.95,
    bestTimeframe: "30-min / 1-hour",
    description: "Shooting star at previous resistance/supply zone. Smart money distribution signal.",
    entryRules: ["Price at previous resistance", "Shooting star with wick >= 2x body", "Next candle closes below shooting star low"],
    stopLossRules: ["Above shooting star high + 0.5 ATR"],
    targetRules: ["Next demand zone or 1.5x RR"],
    avoidWhen: ["Mid-range shooting star", "Breaks above supply zone"],
    minAtrSl: 1.5,
    minAtrTarget: 2.5,
    requiredConfluence: ["key_level_sr"],
  },
  {
    setupName: "MACD Bullish Crossover < 0",
    direction: "CE",
    trades: 50,
    wins: 32,
    avgWin: 78.0,
    avgLoss: 40.0,
    maxDd: 58.0,
    winRate: 64.0,
    rrRatio: 1.95,
    profitFactor: 3.47,
    expectancy: 35.52,
    bestTimeframe: "1-hour / 4-hour",
    description: "MACD line crosses above signal line while BOTH are below zero. Early trend reversal.",
    entryRules: ["MACD line below zero", "MACD crosses ABOVE signal line", "Histogram turns positive", "Price at support or EMA confluence"],
    stopLossRules: ["Below recent swing low - 0.5 ATR"],
    targetRules: ["Zero line (MACD) or previous resistance"],
    avoidWhen: ["Cross above zero (late)", "No price confirmation"],
    minAtrSl: 1.5,
    minAtrTarget: 3.0,
    requiredConfluence: ["divergence_rsi", "key_level_sr"],
  },
];

export const CONFLUENCE_MULTIPLIERS = {
  positive: {
    volume_spike_1_5x: 5,
    volume_spike_2x: 8,
    multi_timeframe_align: 4,
    key_level_sr: 3,
    key_level_pivot: 4,
    seasonality_favorable: 3,
    trend_aligned: 5,
    ema_confluence_20_50: 4,
    ema_confluence_all_three: 6,
    candle_confirmation_next: 3,
    divergence_rsi: 4,
    divergence_macd: 3,
    wide_stop_atr_1_5x: 3,
    wide_stop_atr_2x: 5,
  },
  negative: {
    against_major_trend: -8,
    into_heavy_resistance: -5,
    into_heavy_support: -5,
    low_volume: -4,
    thin_market: -4,
    news_contra: -6,
    no_candle_confirmation: -5,
    mid_range: -3,
    option_expiry_today: -7,
    high_iv_crush_risk: -4,
    stop_too_tight: -10,
    no_confluence: -8,
    range_too_small: -6,
  },
} as const;

export type ConfluenceFactor = keyof typeof CONFLUENCE_MULTIPLIERS.positive | keyof typeof CONFLUENCE_MULTIPLIERS.negative;

export const ALL_CONFLUENCE_FACTORS: { key: ConfluenceFactor; label: string; value: number; positive: boolean }[] = [
  ...Object.entries(CONFLUENCE_MULTIPLIERS.positive).map(([key, value]) => ({ key: key as ConfluenceFactor, label: key.replace(/_/g, " "), value, positive: true })),
  ...Object.entries(CONFLUENCE_MULTIPLIERS.negative).map(([key, value]) => ({ key: key as ConfluenceFactor, label: key.replace(/_/g, " "), value, positive: false })),
];

export type Recommendation = "STRONG BUY" | "BUY" | "MARGINAL" | "SKIP";

export interface HitProbabilityResult {
  setup: string;
  commodity: Commodity;
  baseProbability: number;
  requiredConfluence: ConfluenceFactor[];
  missingConfluence: ConfluenceFactor[];
  adjustments: { factor: string; value: number }[];
  totalAdjustment: number;
  finalProbability: number;
  rrRatio: number;
  edgeScore: number;
  recommendation: Recommendation;
  tradeable: boolean;
  blocked: boolean;
  errors: string[];
  minAtrSl: number;
  expectancy: number;
  avgWin: number;
  avgLoss: number;
}

function findSetup(baseSetupName: string, commodity: Commodity): PlaybookSetup | null {
  const setups = commodity === "NG" ? NATURAL_GAS_SETUPS : CRUDE_OIL_SETUPS;
  const needle = baseSetupName.toLowerCase();
  return setups.find((s) => s.setupName.toLowerCase().includes(needle) || needle.includes(s.setupName.toLowerCase())) ?? null;
}

// Public lookup for other modules (e.g. the live scanner) that need a
// setup's actual risk rules, not just its display text.
export function findPlaybookSetup(baseSetupName: string, commodity: Commodity): PlaybookSetup | null {
  return findSetup(baseSetupName, commodity);
}

// v2.1 CRITICAL FIX: calculate_hit_probability() now actually validates a
// trade instead of just scoring it. Two things can BLOCK a trade outright,
// overriding whatever the edge score says: (1) the setup's own required
// confluence factors weren't supplied, or (2) the actual stop distance is
// narrower than minAtrSl x ATR(14) -- the exact failure mode that produced a
// 0% win rate in live testing (a 3.1pt stop on 4.5 ATR = 0.69x, when the
// setup needed 1.5x = 6.75pts). atr/actualSlDistance are optional so this
// still works as a pure scoring function when no real price data is at hand
// (e.g. the live scanner already enforces the ATR floor upstream, so it
// never needs to re-check itself here).
export function calculateHitProbability(
  baseSetupName: string,
  commodity: Commodity,
  confluenceFactors: ConfluenceFactor[],
  atr?: number,
  actualSlDistance?: number
): HitProbabilityResult | { error: string } {
  const setup = findSetup(baseSetupName, commodity);
  if (!setup) return { error: `Setup '${baseSetupName}' not found` };

  const errors: string[] = [];
  const provided = new Set(confluenceFactors);
  const missingConfluence = setup.requiredConfluence.filter((r) => !provided.has(r));
  if (missingConfluence.length) errors.push(`Missing required confluence: ${missingConfluence.join(", ")}`);

  const factorsForScoring = [...confluenceFactors];
  if (atr !== undefined && atr > 0 && actualSlDistance !== undefined) {
    const minSlWidth = atr * setup.minAtrSl;
    if (actualSlDistance < minSlWidth) {
      errors.push(`STOP TOO TIGHT: ${actualSlDistance.toFixed(1)}pts < ${minSlWidth.toFixed(1)}pts required (${setup.minAtrSl}x ATR)`);
      factorsForScoring.push("stop_too_tight");
    }
  }

  const baseProb = setup.winRate;
  const adjustments: { factor: string; value: number }[] = [];
  let totalAdjustment = 0;
  for (const factor of factorsForScoring) {
    const value = (CONFLUENCE_MULTIPLIERS.positive as Record<string, number>)[factor] ?? (CONFLUENCE_MULTIPLIERS.negative as Record<string, number>)[factor] ?? 0;
    adjustments.push({ factor, value });
    totalAdjustment += value;
  }

  const finalProb = Math.max(20, Math.min(95, baseProb + totalAdjustment));
  const rr = setup.rrRatio;
  const edgeScore = (finalProb / 100) * rr;

  let recommendation: Recommendation;
  if (edgeScore >= 1.4) recommendation = "STRONG BUY";
  else if (edgeScore >= 1.0) recommendation = "BUY";
  else if (edgeScore >= 0.8) recommendation = "MARGINAL";
  else recommendation = "SKIP";

  const blocked = errors.length > 0;
  const tradeable = !blocked && (recommendation === "STRONG BUY" || recommendation === "BUY");

  return {
    setup: setup.setupName,
    commodity,
    baseProbability: baseProb,
    requiredConfluence: setup.requiredConfluence,
    missingConfluence,
    adjustments,
    totalAdjustment,
    finalProbability: Number(finalProb.toFixed(1)),
    rrRatio: rr,
    edgeScore: Number(edgeScore.toFixed(2)),
    recommendation,
    tradeable,
    blocked,
    errors,
    minAtrSl: setup.minAtrSl,
    expectancy: setup.expectancy,
    avgWin: setup.avgWin,
    avgLoss: setup.avgLoss,
  };
}

export interface PotentialLeftResult {
  entry: number;
  stopLoss: number;
  target: number;
  currentLtp: number;
  risk: number;
  reward: number;
  rrRatio: number;
  potentialLeftPercent: number;
  distanceToSlPercent: number;
  riskRewardText: string;
}

// Faithful port of calculate_potential_left() -- pure real-time math over
// whatever entry/stop/target/LTP is supplied. When fed a real live premium
// (this app's own option-chain data) instead of a manually typed number,
// this is 100% real, not an estimate.
export function calculatePotentialLeft(entry: number, stopLoss: number, target: number, currentLtp: number): PotentialLeftResult {
  const risk = Math.abs(entry - stopLoss);
  const reward = Math.abs(target - entry);
  const rr = risk > 0 ? Number((reward / risk).toFixed(2)) : 0;
  const potentialLeft = currentLtp > 0 ? ((target - currentLtp) / currentLtp) * 100 : 0;
  const distanceToSl = currentLtp > 0 ? ((currentLtp - stopLoss) / currentLtp) * 100 : 0;
  return {
    entry,
    stopLoss,
    target,
    currentLtp,
    risk: Number(risk.toFixed(2)),
    reward: Number(reward.toFixed(2)),
    rrRatio: rr,
    potentialLeftPercent: Number(potentialLeft.toFixed(2)),
    distanceToSlPercent: Number(distanceToSl.toFixed(2)),
    riskRewardText: `Risk ${risk.toFixed(2)} to make ${reward.toFixed(2)} = 1:${rr}`,
  };
}

export interface PositionSizeResult {
  balance: number;
  riskPercent: number;
  riskAmount: number;
  riskPerLot: number;
  maxLots: number;
  recommendedLots: number;
  error?: string;
}

// Faithful port of calc_position_size() -- sizes the position so THIS
// trade's stop-loss distance risks exactly riskPercent of balance. A wider
// (ATR-correct) stop means fewer lots for the same rupee risk, which is the
// whole point: it can never be "worked around" by just buying more lots on a
// tighter stop.
export function calculatePositionSize(balance: number, riskPercent: number, entry: number, stop: number, lotSize: number): PositionSizeResult {
  const riskAmount = (balance * riskPercent) / 100;
  const riskPerLot = Math.abs(entry - stop) * lotSize;
  if (riskPerLot <= 0) {
    return { balance, riskPercent, riskAmount: Number(riskAmount.toFixed(2)), riskPerLot: 0, maxLots: 0, recommendedLots: 0, error: "Invalid stop loss" };
  }
  const lots = Math.floor(riskAmount / riskPerLot);
  return {
    balance,
    riskPercent,
    riskAmount: Number(riskAmount.toFixed(2)),
    riskPerLot: Number(riskPerLot.toFixed(2)),
    maxLots: lots,
    recommendedLots: lots > 0 ? lots : 0,
  };
}
