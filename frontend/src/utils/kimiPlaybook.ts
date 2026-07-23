// Ported from a user-supplied "Commodity Options Trading Playbook" document
// (a Python script, source credited as "Kimi AI"). The setup catalog below
// (entry/stop/target RULES, descriptions, avoid-when conditions) is generic
// technical-analysis reference material and is reproduced faithfully.
//
// IMPORTANT HONESTY NOTE: the trades/wins/win_rate/avg_win/avg_loss/
// profit_factor/expectancy figures attached to each setup are NOT derived
// from any real backtest against actual MCX Crude Oil/Natural Gas history --
// they are example figures embedded in the source document with no
// verification behind them. This app never presents invented data as if it
// were real, so every UI surface using these numbers must label them
// "reference / unverified" rather than "backtested". The two calculator
// functions below (hit probability, potential left) are pure deterministic
// math ported exactly from the source -- those are legitimate regardless of
// which numbers get fed into them.

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
    entryRules: [
      "Price in uptrend (above 200 EMA)",
      "Pulls back to 20 or 50 EMA",
      "Bullish engulfing candle forms at EMA",
      "Volume on green candle > 1.5x average",
      "Entry = break of engulfing candle high",
    ],
    stopLossRules: ["Below engulfing candle low - 0.5 buffer"],
    targetRules: ["1.5x to 2.0x RR", "Previous swing high"],
    avoidWhen: ["Against major downtrend", "Low volume", "Mid-range consolidation"],
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
    entryRules: [
      "Two distinct lows at similar price",
      "Second low has higher RSI (bullish divergence)",
      "Volume spike on bounce from second bottom",
      "Break of neckline = entry",
      "Measured target = depth of pattern",
    ],
    stopLossRules: ["Below second bottom low"],
    targetRules: ["Pattern depth from neckline", "1.5x RR minimum"],
    avoidWhen: ["Second bottom breaks first low", "Declining volume on bounce"],
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
    bestTimeframe: "5-min / 15-min post-data",
    description: "Trade the reversal AFTER EIA weekly storage report. Wait for initial whipsaw to settle.",
    entryRules: [
      "EIA report released (Thu 10:30 AM EST)",
      "Wait for FIRST 5-min candle to CLOSE",
      "Look for engulfing or pin bar at gap extreme",
      "Entry = break of confirmation candle",
      "Direction = opposite of gap if reversal candle forms",
    ],
    stopLossRules: ["Above/below confirmation candle + 2-3 pts buffer"],
    targetRules: ["1.5x to 2.5x RR", "Fill 50% of gap"],
    avoidWhen: ["Entering in first 2 minutes", "ATR > 2x normal", "No clear reversal candle"],
  },
  {
    setupName: "Opening Range Breakout",
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
    bestTimeframe: "5-min / 15-min (first hour)",
    description: "Trade the break of first 30-60 min range. High probability when aligned with overnight trend.",
    entryRules: [
      "Mark high and low of first 30-60 minutes",
      "Wait for break of range with volume",
      "Entry = break of range boundary",
      "SL = other side of range",
      "Best when gap up/down aligns with break direction",
    ],
    stopLossRules: ["Opposite side of opening range"],
    targetRules: ["1.5x opening range width", "Previous day high/low"],
    avoidWhen: ["Range < 1.5x ATR", "Low volume break", "Against overnight trend"],
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
    entryRules: [
      "Price at key support level",
      "RSI(14) shows higher low while price shows lower low",
      "Bullish candle confirmation (hammer, engulfing)",
      "Entry = break of confirmation candle high",
      "Volume increases on bounce",
    ],
    stopLossRules: ["Below the lower low"],
    targetRules: ["Previous resistance", "1.5x to 2.0x RR"],
    avoidWhen: ["Divergence on very low timeframe (<15min)", "No candle confirmation"],
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
    entryRules: [
      "Price at resistance (pivot, EMA, trendline)",
      "Pin bar with wick >= 2x body",
      "Wick touches/breaks resistance then rejects",
      "Next candle closes below pin bar low",
      "Entry = break of pin bar low",
    ],
    stopLossRules: ["Above pin bar high"],
    targetRules: ["Next support level", "1.5x RR"],
    avoidWhen: ["Pin bar in middle of range", "Low volume", "Strong uptrend"],
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
    entryRules: [
      "Price below 200 EMA (downtrend)",
      "Rally approaches 200 EMA",
      "Bearish reversal candle at 200 EMA",
      "Entry = break of reversal candle low",
      "Volume dries up on rally (weak buying)",
    ],
    stopLossRules: ["Above 200 EMA + buffer"],
    targetRules: ["Previous swing low", "1.5x RR"],
    avoidWhen: ["Price breaks above 200 EMA", "Strong volume on rally"],
  },
  {
    setupName: "Flag Breakout (15-min)",
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
    bestTimeframe: "15-min / 30-min",
    description: "After strong move, price consolidates in parallel channel (flag). Break = continuation.",
    entryRules: [
      "Strong impulsive move (pole)",
      "Consolidation in descending/ascending channel",
      "Volume decreases during flag",
      "Break of flag boundary with volume spike",
      "Entry = break of flag line",
    ],
    stopLossRules: ["Other side of flag channel"],
    targetRules: ["Pole height projected from breakout", "1.5x RR"],
    avoidWhen: ["Flag too long (>10 candles)", "Break without volume"],
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
    bestTimeframe: "15-min / 30-min post-data",
    description: "THE highest probability setup. EIA Wed 10:30 AM EST. Trade the reversal after initial knee-jerk.",
    entryRules: [
      "EIA report released (Wed 10:30 AM EST)",
      "Wait for 15-min candle to close",
      "Look for engulfing at gap extreme",
      "Entry = break of engulfing candle",
      "Build = bearish (PE), Draw = bullish (CE)",
    ],
    stopLossRules: ["Above/below engulfing candle + 3-5 pts"],
    targetRules: ["2.0x to 2.5x RR", "50% gap fill"],
    avoidWhen: ["Entering before 10:35 AM", "No clear engulfing", "API already hinted same direction"],
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
    entryRules: [
      "Draw valid trendline (3+ touches)",
      "Price breaks trendline with volume",
      "Wait for retest of broken trendline",
      "Entry = rejection at retest (pin bar/engulfing)",
      "Direction = direction of break",
    ],
    stopLossRules: ["Other side of retest zone"],
    targetRules: ["Previous swing high/low", "1.5x to 2.0x RR"],
    avoidWhen: ["Break without volume", "No retest (FOMO entry)", "Against major trend"],
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
    bestTimeframe: "5-min / 15-min",
    description: "Mean reversion to VWAP. Price extends >1.5% away, volume diverges, snaps back.",
    entryRules: [
      "Price > 1.5% away from VWAP",
      "Volume decreasing on extension",
      "RSI extreme (>65 for short, <35 for long)",
      "Reversal candle at extreme",
      "Entry = break of reversal candle",
    ],
    stopLossRules: ["VWAP + 0.3% buffer"],
    targetRules: ["VWAP level", "Next S/R"],
    avoidWhen: ["Strong trend day (trend > 3%)", "No volume divergence", "News-driven move"],
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
    bestTimeframe: "15-min / 30-min",
    description: "OPEC+ news creates gap. 70% of gaps fill within 48 hours. Trade the fill.",
    entryRules: [
      "OPEC+ announcement creates gap",
      "Wait 2-4 hours for initial move to settle",
      "Look for reversal at gap extreme",
      "Entry = break of reversal candle",
      "Direction = toward gap fill",
    ],
    stopLossRules: ["Above/below gap extreme + buffer"],
    targetRules: ["50% gap fill", "Full gap fill", "1.5x RR"],
    avoidWhen: ["Historic production cut/increase", "Gap > 8%", "No reversal candle"],
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
    entryRules: [
      "Left shoulder, head, right shoulder visible",
      "Neckline connects two troughs",
      "Volume highest on left shoulder, lowest on right",
      "Entry = break of neckline with volume",
      "Can enter on right shoulder rejection",
    ],
    stopLossRules: ["Above right shoulder high"],
    targetRules: ["Head to neckline distance projected down", "1.5x RR"],
    avoidWhen: ["Sloping neckline", "Right shoulder higher than head", "No volume on break"],
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
    entryRules: [
      "Price above 200 EMA (uptrend)",
      "Pulls back to test 200 EMA",
      "Hammer candle at 200 EMA (long lower wick)",
      "Volume on hammer > previous 3 candles avg",
      "Entry = break of hammer high",
    ],
    stopLossRules: ["Below hammer low"],
    targetRules: ["Previous swing high", "1.5x to 2.0x RR"],
    avoidWhen: ["Hammer body > 30% of range", "No volume confirmation", "Breaks below 200 EMA"],
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
    entryRules: [
      "Price at previous resistance / supply zone",
      "Shooting star with long upper wick (>=2x body)",
      "Wick touches supply zone then rejects",
      "Next candle closes below shooting star low",
      "Entry = break of shooting star low",
    ],
    stopLossRules: ["Above shooting star high"],
    targetRules: ["Next demand zone", "1.5x RR"],
    avoidWhen: ["Shooting star in middle of range", "Breaks above supply zone"],
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
    entryRules: [
      "MACD line below zero",
      "Signal line below zero",
      "MACD crosses ABOVE signal line",
      "Histogram turns positive",
      "Price at support or EMA confluence",
      "Entry = break of confirmation candle high",
    ],
    stopLossRules: ["Below recent swing low"],
    targetRules: ["Zero line (MACD)", "Previous resistance", "1.5x RR"],
    avoidWhen: ["Cross above zero (late)", "No price confirmation", "Bearish divergence on RSI"],
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
  adjustments: { factor: string; value: number }[];
  totalAdjustment: number;
  finalProbability: number;
  rrRatio: number;
  edgeScore: number;
  recommendation: Recommendation;
  expectancy: number;
  avgWin: number;
  avgLoss: number;
}

function findSetup(baseSetupName: string, commodity: Commodity): PlaybookSetup | null {
  const setups = commodity === "NG" ? NATURAL_GAS_SETUPS : CRUDE_OIL_SETUPS;
  const needle = baseSetupName.toLowerCase();
  return setups.find((s) => s.setupName.toLowerCase().includes(needle)) ?? null;
}

// Faithful port of the source document's calculate_hit_probability(): base
// probability comes from the setup's (unverified) reference win rate, then
// each selected confluence factor adds/subtracts a fixed point value, capped
// to a 30-95% band, and combined with the setup's RR ratio into an edge
// score that maps to a recommendation.
export function calculateHitProbability(baseSetupName: string, commodity: Commodity, confluenceFactors: ConfluenceFactor[]): HitProbabilityResult | { error: string } {
  const setup = findSetup(baseSetupName, commodity);
  if (!setup) return { error: `Setup '${baseSetupName}' not found` };

  const baseProb = setup.winRate;
  const adjustments: { factor: string; value: number }[] = [];
  let totalAdjustment = 0;
  for (const factor of confluenceFactors) {
    const value = (CONFLUENCE_MULTIPLIERS.positive as Record<string, number>)[factor] ?? (CONFLUENCE_MULTIPLIERS.negative as Record<string, number>)[factor];
    adjustments.push({ factor, value: value ?? 0 });
    totalAdjustment += value ?? 0;
  }

  const finalProb = Math.max(30, Math.min(95, baseProb + totalAdjustment));
  const rr = setup.rrRatio;
  const edgeScore = (finalProb / 100) * rr;

  let recommendation: Recommendation;
  if (edgeScore >= 1.4) recommendation = "STRONG BUY";
  else if (edgeScore >= 1.0) recommendation = "BUY";
  else if (edgeScore >= 0.8) recommendation = "MARGINAL";
  else recommendation = "SKIP";

  return {
    setup: setup.setupName,
    commodity,
    baseProbability: baseProb,
    adjustments,
    totalAdjustment,
    finalProbability: Number(finalProb.toFixed(1)),
    rrRatio: rr,
    edgeScore: Number(edgeScore.toFixed(2)),
    recommendation,
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
