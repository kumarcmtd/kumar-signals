import type { Candle } from "../types";
import { adx, atr, centralPivotRange, emaLast, macd, pivotPoints, rsi, superTrend, vwap } from "./indicators";
import type { MarketDepthResult } from "./marketDepthAnalysis";

// A completely separate, read-only verification layer on top of whatever
// Best Call (or any other page) already generated -- this module never
// writes to any trade log, never calls an API of its own, and never
// touches BestCall.tsx. It only re-reads the exact same underlying candles
// and live option data every other page already fetches, and grades the
// trade against 12 independently-weighted institutional checks.

export type StrategyTier = "pass" | "wait" | "fail";
export type CallDirection = "bullish" | "bearish"; // bullish = CE/BUY, bearish = PE/SELL

export interface StrategyResult {
  key: string;
  name: string;
  tier: StrategyTier;
  reason: string;
  explain: string;
  weightPct: number;
}

export type OverallTier = "strong" | "good" | "wait" | "avoid";

export interface VerificationResult {
  strategies: StrategyResult[];
  weightedScorePct: number;
  scoreTier: OverallTier;
  finalTier: OverallTier;
  overrideReasons: string[];
}

export interface VerificationInput {
  direction: CallDirection;
  candles: Candle[]; // underlying, same timeframe Best Call itself uses (15m)
  liveUnderlyingPrice: number;
  entry: number; // option premium at entry
  effectiveStop: number; // current trailing stop, option premium terms
  livePremium: number | null;
  // Rolling in-browser samples collected on this page's own 5s refresh tick
  // -- oldest first. There is no historical premium/OI candle endpoint in
  // this app (only live snapshots), so trend-dependent checks build their
  // own short history the moment this page is open rather than inventing
  // data that doesn't exist.
  premiumSamples: number[];
  oiSamples: (number | null)[];
  // Market Depth & Smart Money is intentionally NOT one of the "major"
  // override-gating checks below -- per its own spec, it must only ever
  // nudge the existing weighted confidence, never independently force or
  // block a BUY on its own. null when depth data isn't available (no L2
  // entitlement, or not enough candles yet) -- shown as a neutral WAIT
  // rather than treated as a failure of the trade itself.
  marketDepth: MarketDepthResult | null;
}

const TIER_SCORE: Record<StrategyTier, number> = { pass: 100, wait: 50, fail: 0 };

function pct(value: number, ref: number): number {
  return ref === 0 ? 0 : ((value - ref) / ref) * 100;
}

function result(key: string, name: string, weightPct: number, tier: StrategyTier, reason: string, explain: string): StrategyResult {
  return { key, name, tier, reason, explain, weightPct };
}

// 1. Double SuperTrend -- fast (7,2) + slow (10,3, this library's own
// default) must BOTH agree with the call's own direction to pass.
function checkDoubleSuperTrend(candles: Candle[], direction: CallDirection): StrategyResult {
  const fast = superTrend(candles, 7, 2);
  const slow = superTrend(candles, 10, 3);
  if (!fast || !slow) {
    return result("supertrend", "Double SuperTrend", 15, "wait", "Not enough candles yet to compute both SuperTrends.", "Needs at least ~11 bars on this timeframe.");
  }
  const bothAgree = fast.direction === slow.direction;
  const agreesWithCall = fast.direction === direction && slow.direction === direction;
  const label = (d: string) => (d === "bullish" ? "BUY" : "SELL");
  if (bothAgree && agreesWithCall) {
    return result(
      "supertrend",
      "Double SuperTrend",
      15,
      "pass",
      `Both Fast and Slow SuperTrend read ${label(fast.direction)}, matching this call.`,
      `Fast SuperTrend (₹${fast.value.toFixed(2)}) and Slow SuperTrend (₹${slow.value.toFixed(2)}) both indicate ${label(fast.direction)}.`
    );
  }
  if (bothAgree && !agreesWithCall) {
    return result(
      "supertrend",
      "Double SuperTrend",
      15,
      "fail",
      `Both SuperTrends agree, but on ${label(fast.direction)} -- opposite to this call.`,
      `Fast and Slow SuperTrend both indicate ${label(fast.direction)}, which is against this call's direction.`
    );
  }
  return result(
    "supertrend",
    "Double SuperTrend",
    15,
    "wait",
    `Fast reads ${label(fast.direction)} while Slow reads ${label(slow.direction)} -- not aligned yet.`,
    `Fast SuperTrend (₹${fast.value.toFixed(2)}) is ${label(fast.direction)} but Slow SuperTrend (₹${slow.value.toFixed(2)}) is ${label(slow.direction)} -- wait for them to agree.`
  );
}

// 2. 200 EMA Trend Filter -- binary trend alignment check.
function checkEma200(candles: Candle[], direction: CallDirection, price: number): StrategyResult {
  const closes = candles.map((c) => c.close);
  const ema200 = emaLast(closes, 200);
  if (ema200 === null) {
    return result("ema200", "200 EMA Trend Filter", 10, "wait", `Only ${candles.length} candles available -- needs 200 for this EMA.`, "Not enough history yet on this timeframe to compute a 200-period EMA.");
  }
  const diffPct = pct(price, ema200);
  const above = price > ema200;
  const aligned = direction === "bullish" ? above : !above;
  const flat = Math.abs(diffPct) < 0.05;
  if (flat) {
    return result("ema200", "200 EMA Trend Filter", 10, "wait", `Price is sitting almost exactly on EMA200 (₹${ema200.toFixed(2)}).`, `Price (₹${price.toFixed(2)}) is within 0.05% of EMA200 -- too close to call a trend yet.`);
  }
  if (aligned) {
    return result(
      "ema200",
      "200 EMA Trend Filter",
      10,
      "pass",
      `Price is ${above ? "above" : "below"} EMA200, matching this ${direction === "bullish" ? "BUY" : "SELL"} call.`,
      `Price is ${Math.abs(diffPct).toFixed(1)}% ${above ? "above" : "below"} EMA200 (₹${ema200.toFixed(2)}).`
    );
  }
  return result(
    "ema200",
    "200 EMA Trend Filter",
    10,
    "fail",
    `Price is ${above ? "above" : "below"} EMA200 -- the wrong side for this ${direction === "bullish" ? "BUY" : "SELL"} call.`,
    `Price is ${Math.abs(diffPct).toFixed(1)}% ${above ? "above" : "below"} EMA200 (₹${ema200.toFixed(2)}), against this call's direction.`
  );
}

// 3. VWAP Confirmation -- same binary alignment pattern as EMA200.
function checkVwap(candles: Candle[], direction: CallDirection, price: number): StrategyResult {
  const vw = vwap(candles);
  if (vw === null) {
    return result("vwap", "VWAP Confirmation", 10, "wait", "VWAP isn't available yet.", "No volume data yet to compute session VWAP.");
  }
  const above = price > vw;
  const aligned = direction === "bullish" ? above : !above;
  const flat = Math.abs(pct(price, vw)) < 0.05;
  if (flat) {
    return result("vwap", "VWAP Confirmation", 10, "wait", `Price is sitting almost exactly on VWAP (₹${vw.toFixed(2)}).`, `Price (₹${price.toFixed(2)}) is essentially at VWAP -- no clear side yet.`);
  }
  if (aligned) {
    return result("vwap", "VWAP Confirmation", 10, "pass", `Price is trading ${above ? "above" : "below"} VWAP, matching this call.`, `Price is trading ${above ? "above" : "below"} VWAP (₹${vw.toFixed(2)}).`);
  }
  return result("vwap", "VWAP Confirmation", 10, "fail", `Price is ${above ? "above" : "below"} VWAP -- the wrong side for this call.`, `Price is trading ${above ? "above" : "below"} VWAP (₹${vw.toFixed(2)}), against this call's direction.`);
}

// 4. ADX Strength -- a trend-strength gate, not directional on its own.
function checkAdx(candles: Candle[]): StrategyResult {
  const adxValue = adx(candles);
  if (adxValue === null) {
    return result("adx", "ADX Strength", 10, "wait", "Not enough candles yet to compute ADX.", "Needs roughly 28+ bars on this timeframe.");
  }
  if (adxValue > 25) return result("adx", "ADX Strength", 10, "pass", `ADX ${adxValue.toFixed(1)} -- a real, tradeable trend.`, `Current ADX ${adxValue.toFixed(1)} -- Strong Trend.`);
  if (adxValue >= 20) return result("adx", "ADX Strength", 10, "wait", `ADX ${adxValue.toFixed(1)} -- a trend is forming but isn't strong yet.`, `Current ADX ${adxValue.toFixed(1)} -- Developing Trend.`);
  return result("adx", "ADX Strength", 10, "fail", `ADX ${adxValue.toFixed(1)} -- too choppy/range-bound to trust either side.`, `Current ADX ${adxValue.toFixed(1)} -- Weak/No Trend.`);
}

// 5. RSI Confirmation -- a directional "sweet spot" band, with overbought/
// oversold extremes flagged as caution rather than an outright fail.
function checkRsi(candles: Candle[], direction: CallDirection): StrategyResult {
  const closes = candles.map((c) => c.close);
  const rsiValue = rsi(closes);
  if (rsiValue === null) {
    return result("rsi", "RSI Confirmation", 5, "wait", "Not enough candles yet to compute RSI.", "Needs 15+ bars on this timeframe.");
  }
  const r = rsiValue;
  if (r > 75) return result("rsi", "RSI Confirmation", 5, "wait", `RSI ${r.toFixed(1)} -- overbought, this leg may be overextended.`, `RSI ${r.toFixed(1)} is above 75 -- overbought caution zone.`);
  if (r < 25) return result("rsi", "RSI Confirmation", 5, "wait", `RSI ${r.toFixed(1)} -- oversold, momentum may be exhausted.`, `RSI ${r.toFixed(1)} is below 25 -- oversold caution zone.`);
  if (direction === "bullish" && r >= 55 && r <= 70) return result("rsi", "RSI Confirmation", 5, "pass", `RSI ${r.toFixed(1)} sits in the healthy 55-70 BUY zone.`, `RSI ${r.toFixed(1)} is in the 55-70 band this BUY call wants.`);
  if (direction === "bearish" && r >= 30 && r <= 45) return result("rsi", "RSI Confirmation", 5, "pass", `RSI ${r.toFixed(1)} sits in the healthy 30-45 SELL zone.`, `RSI ${r.toFixed(1)} is in the 30-45 band this SELL call wants.`);
  return result("rsi", "RSI Confirmation", 5, "wait", `RSI ${r.toFixed(1)} is neutral -- not yet confirming this call's direction.`, `RSI ${r.toFixed(1)} is outside the ${direction === "bullish" ? "55-70 BUY" : "30-45 SELL"} confirmation band.`);
}

// 6. MACD -- histogram sign must match the call's direction.
function checkMacd(candles: Candle[], direction: CallDirection): StrategyResult {
  const closes = candles.map((c) => c.close);
  const m = macd(closes);
  if (!m) {
    return result("macd", "MACD", 10, "wait", "Not enough candles yet to compute MACD.", "Needs 35+ bars on this timeframe.");
  }
  const bullishHist = m.histogram > 0;
  const aligned = direction === "bullish" ? bullishHist : !bullishHist;
  if (aligned) {
    return result("macd", "MACD", 10, "pass", `MACD histogram is ${bullishHist ? "positive" : "negative"}, matching this call.`, `MACD histogram ${m.histogram.toFixed(3)} is ${bullishHist ? "positive (green)" : "negative (red)"}.`);
  }
  return result("macd", "MACD", 10, "fail", `MACD histogram is ${bullishHist ? "positive" : "negative"} -- against this call's direction.`, `MACD histogram ${m.histogram.toFixed(3)} is ${bullishHist ? "positive (green)" : "negative (red)"}, opposite this call.`);
}

// 7. Volume Confirmation -- latest bar vs its own 20-bar average.
function checkVolume(candles: Candle[]): StrategyResult {
  if (candles.length < 21) {
    return result("volume", "Volume Confirmation", 10, "wait", "Not enough candles yet for a 20-bar volume average.", "Needs 21+ bars on this timeframe.");
  }
  const recent = candles.slice(-21, -1);
  const avg = recent.reduce((s, c) => s + (c.volume ?? 0), 0) / recent.length;
  const latest = candles[candles.length - 1].volume ?? 0;
  if (avg === 0) return result("volume", "Volume Confirmation", 10, "wait", "No volume data available on this feed.", "Volume figures aren't populated for this instrument/timeframe.");
  const ratio = latest / avg;
  if (ratio > 1.1) return result("volume", "Volume Confirmation", 10, "pass", `Current volume is ${ratio.toFixed(2)}x the 20-bar average.`, `Current volume (${Math.round(latest)}) vs 20-candle average (${Math.round(avg)}) -- above average.`);
  if (ratio >= 0.9) return result("volume", "Volume Confirmation", 10, "wait", `Current volume is roughly in line with average (${ratio.toFixed(2)}x).`, `Current volume (${Math.round(latest)}) is about equal to the 20-candle average (${Math.round(avg)}).`);
  return result("volume", "Volume Confirmation", 10, "fail", `Current volume is only ${ratio.toFixed(2)}x the average -- thin participation.`, `Current volume (${Math.round(latest)}) is below the 20-candle average (${Math.round(avg)}).`);
}

// 8. CPR Analysis -- price vs the Central Pivot Range band.
function checkCpr(candles: Candle[], direction: CallDirection, price: number): StrategyResult {
  if (candles.length < 2) {
    return result("cpr", "CPR Analysis", 10, "wait", "Not enough candles yet to compute CPR.", "Needs at least 2 bars.");
  }
  const cpr = centralPivotRange(candles[candles.length - 2]);
  const width = cpr.tc - cpr.bc;
  const narrow = width > 0 && Math.abs(price - cpr.pivot) < width * 1.5;
  if (price > cpr.tc && !narrow) {
    return direction === "bullish"
      ? result("cpr", "CPR Analysis", 10, "pass", `Price is above CPR (₹${cpr.tc.toFixed(2)}) -- bullish structure.`, `Price (₹${price.toFixed(2)}) is above the CPR top (₹${cpr.tc.toFixed(2)}) -- Bullish.`)
      : result("cpr", "CPR Analysis", 10, "fail", `Price is above CPR -- bullish structure, against this SELL call.`, `Price (₹${price.toFixed(2)}) is above the CPR top (₹${cpr.tc.toFixed(2)}) -- Bullish, opposite this call.`);
  }
  if (price < cpr.bc && !narrow) {
    return direction === "bearish"
      ? result("cpr", "CPR Analysis", 10, "pass", `Price is below CPR (₹${cpr.bc.toFixed(2)}) -- bearish structure.`, `Price (₹${price.toFixed(2)}) is below the CPR bottom (₹${cpr.bc.toFixed(2)}) -- Bearish.`)
      : result("cpr", "CPR Analysis", 10, "fail", `Price is below CPR -- bearish structure, against this BUY call.`, `Price (₹${price.toFixed(2)}) is below the CPR bottom (₹${cpr.bc.toFixed(2)}) -- Bearish, opposite this call.`);
  }
  return result("cpr", "CPR Analysis", 10, "wait", `Price is inside a narrow CPR (₹${cpr.bc.toFixed(2)}-₹${cpr.tc.toFixed(2)}) -- no clear structure yet.`, `Price (₹${price.toFixed(2)}) is inside the CPR band -- a narrow/undecided zone.`);
}

// 9. Support/Resistance -- entry shouldn't be sitting right on top of the
// level working against it. Proximity ALONE can't tell a live breakout
// (price closing progressively through the level, exactly what a real move
// looks like in its first few candles) apart from genuine indecision or an
// outright rejection -- and a plain "too close = wait" check used to flag
// "wait" for both, which meant it kept holding a call back through the
// entire real move instead of confirming it the moment price actually broke
// through. Reading the last few CLOSES (not just the current live tick)
// resolves that ambiguity: closes already clear of the level in the call's
// favor is a confirmed break (pass); closes turning back across the level
// after testing it is a real rejection (fail, new for this check); only a
// level still being tested with no resolution either way stays "wait".
function checkSupportResistance(candles: Candle[], direction: CallDirection, price: number): StrategyResult {
  if (candles.length < 3) {
    return result("sr", "Support/Resistance", 10, "wait", "Not enough candles yet to compute pivot levels.", "Needs at least 3 bars.");
  }
  const piv = pivotPoints(candles[candles.length - 2]);
  const level = direction === "bullish" ? piv.r1 : piv.s1;
  const levelName = direction === "bullish" ? "Resistance (R1)" : "Support (S1)";
  const distPct = Math.abs(pct(price, level));

  const recentCloses = candles.slice(-3).map((c) => c.close);
  const clearedLevel = direction === "bullish" ? recentCloses.every((c) => c > level) : recentCloses.every((c) => c < level);
  const rejectedLevel = direction === "bullish" ? recentCloses[recentCloses.length - 1] < level && recentCloses[0] >= level : recentCloses[recentCloses.length - 1] > level && recentCloses[0] <= level;

  if (clearedLevel) {
    return result(
      "sr",
      "Support/Resistance",
      10,
      "pass",
      `Price has closed through ${levelName} (₹${level.toFixed(2)}) on the last few candles -- a confirmed break, not just a touch.`,
      `The last ${recentCloses.length} closes are all on the favorable side of ${levelName} (₹${level.toFixed(2)}).`
    );
  }
  if (rejectedLevel) {
    return result(
      "sr",
      "Support/Resistance",
      10,
      "fail",
      `Price tested ${levelName} (₹${level.toFixed(2)}) and got turned back -- a real rejection.`,
      `Price closed back across ${levelName} (₹${level.toFixed(2)}) after approaching it, against this call's direction.`
    );
  }
  if (distPct < 0.3) {
    return result(
      "sr",
      "Support/Resistance",
      10,
      "wait",
      `Price is testing ${levelName} (₹${level.toFixed(2)}) right now -- no confirmed break or rejection yet.`,
      `Price (₹${price.toFixed(2)}) is within 0.3% of ${levelName} (₹${level.toFixed(2)}), still being decided.`
    );
  }
  return result("sr", "Support/Resistance", 10, "pass", `Price is clear of ${levelName} (₹${level.toFixed(2)}) by ${distPct.toFixed(1)}%.`, `Price (₹${price.toFixed(2)}) is a clear ${distPct.toFixed(1)}% away from ${levelName} (₹${level.toFixed(2)}).`);
}

// 10. ATR Stop Validation -- is the option's own stop distance sized
// sensibly, or tight enough to be noise-vulnerable? Deliberately does NOT
// divide the option premium's own % distance by the underlying's ATR % --
// those are two different scales (option premium moves far more, in %
// terms, than the underlying itself, due to leverage/gamma), so a raw
// ratio between them is meaningless. The underlying's ATR is still used as
// a data-availability gate (and shown for context), while the actual
// tight/perfect/wide judgment is made on the premium's own stop distance.
function checkAtrStop(candles: Candle[], entry: number, effectiveStop: number): StrategyResult {
  const atrValue = atr(candles);
  if (atrValue === null) {
    return result("atrStop", "ATR Stop Validation", 5, "wait", "Not enough candles yet to compute ATR.", "Needs 15+ bars on this timeframe.");
  }
  const lastClose = candles[candles.length - 1].close;
  const underlyingAtrPct = lastClose > 0 ? (atrValue / lastClose) * 100 : 0;
  const stopDistancePct = Math.abs(pct(entry, effectiveStop));
  if (stopDistancePct < 15) {
    return result(
      "atrStop",
      "ATR Stop Validation",
      5,
      "fail",
      `Stop is only ${stopDistancePct.toFixed(1)}% from entry -- too tight, likely to get noise-stopped.`,
      `Too Tight: this stop sits close enough to entry that normal premium noise (underlying ATR ${underlyingAtrPct.toFixed(2)}% of price) could trigger it early.`
    );
  }
  if (stopDistancePct <= 40) {
    return result(
      "atrStop",
      "ATR Stop Validation",
      5,
      "pass",
      `Stop is ${stopDistancePct.toFixed(1)}% from entry -- sensibly sized.`,
      `Perfect: this stop gives the trade room to breathe (underlying ATR is ${underlyingAtrPct.toFixed(2)}% of price) without being excessive.`
    );
  }
  return result(
    "atrStop",
    "ATR Stop Validation",
    5,
    "wait",
    `Stop is ${stopDistancePct.toFixed(1)}% from entry -- wider than typical.`,
    `This stop is looser than usual (underlying ATR is ${underlyingAtrPct.toFixed(2)}% of price) -- more capital at risk per trade than necessary.`
  );
}

const MIN_SAMPLES_FOR_TREND = 3;

// 11. Open Interest Confirmation -- built from this page's own rolling
// samples of the SPECIFIC option's live OI (there's no historical OI-candle
// endpoint for a single strike), same 5s cadence as everything else here.
function checkOpenInterest(premiumSamples: number[], oiSamples: (number | null)[]): StrategyResult {
  const validOi = oiSamples.filter((v): v is number => v !== null);
  if (validOi.length < MIN_SAMPLES_FOR_TREND || premiumSamples.length < MIN_SAMPLES_FOR_TREND) {
    return result("oi", "Open Interest Confirmation", 5, "wait", "Gathering live OI samples -- keep this page open a little longer.", "OI trend needs a few more 5-second polls before it can read a direction.");
  }
  const oiChange = validOi[validOi.length - 1] - validOi[0];
  const premChange = premiumSamples[premiumSamples.length - 1] - premiumSamples[0];
  if (oiChange > 0 && premChange >= 0) return result("oi", "Open Interest Confirmation", 5, "pass", "OI is building up alongside price -- fresh positioning behind this move.", "Open Interest is rising together with premium -- a real (not short-covering) move.");
  if (oiChange < 0) return result("oi", "Open Interest Confirmation", 5, "wait", "OI is unwinding -- this move may be short-covering rather than fresh conviction.", "Open Interest is falling -- positions are being closed, not added.");
  return result("oi", "Open Interest Confirmation", 5, "fail", "OI and premium are moving in conflicting directions.", "Open Interest is moving opposite to what this move needs to be trustworthy.");
}

// 12. Premium Momentum -- from this page's own rolling premium samples.
// Being LONG premium (true for both a bought CE and a bought PE) always
// wants the premium itself making higher highs/higher lows, regardless of
// which side the underlying call is on.
function checkPremiumMomentum(premiumSamples: number[]): StrategyResult {
  if (premiumSamples.length < MIN_SAMPLES_FOR_TREND) {
    return result("premiumMomentum", "Premium Momentum", 5, "wait", "Gathering live premium samples -- keep this page open a little longer.", "Premium trend needs a few more 5-second polls before it can read a pattern.");
  }
  const first = premiumSamples[0];
  const last = premiumSamples[premiumSamples.length - 1];
  const min = Math.min(...premiumSamples);
  const max = Math.max(...premiumSamples);
  const range = max - min;
  if (range === 0) return result("premiumMomentum", "Premium Momentum", 5, "wait", "Premium has been flat since this page opened.", "Premium Sideways -- no higher-high/higher-low pattern yet.");
  const netMovePct = ((last - first) / first) * 100;
  if (netMovePct > 0.5) return result("premiumMomentum", "Premium Momentum", 5, "pass", `Premium is up ${netMovePct.toFixed(1)}% since this page opened -- higher highs, higher lows.`, "Premium Higher High, Higher Low -- trending in this position's favor.");
  if (netMovePct < -0.5) return result("premiumMomentum", "Premium Momentum", 5, "fail", `Premium is down ${Math.abs(netMovePct).toFixed(1)}% since this page opened -- lower lows.`, "Premium Lower Low -- trending against this position.");
  return result("premiumMomentum", "Premium Momentum", 5, "wait", "Premium is moving sideways since this page opened.", "Premium Sideways -- no clear higher-high/higher-low pattern yet.");
}

// 13. Market Depth & Smart Money -- purely a confidence nudge, deliberately
// excluded from the "major" override-gating list below so it can never
// singlehandedly force a STRONG BUY or an AVOID the way SuperTrend/EMA/
// VWAP/ADX can.
function checkMarketDepth(direction: CallDirection, depth: MarketDepthResult | null): StrategyResult {
  if (!depth) {
    return result("marketDepth", "Market Depth & Smart Money", 10, "wait", "Order book depth isn't available right now.", "Either this account doesn't have Level 2 depth entitlement for MCX, or there isn't enough data yet.");
  }
  const aligned = direction === "bullish" ? depth.tier === "bullish" : depth.tier === "bearish";
  const opposed = direction === "bullish" ? depth.tier === "bearish" : depth.tier === "bullish";
  const cautionFlags = depth.smartMoney.filter((f) => f.kind === "caution").map((f) => f.label);
  if (aligned) {
    return result(
      "marketDepth",
      "Market Depth & Smart Money",
      10,
      "pass",
      `Order book is ${depth.tier} (${depth.reason}), matching this call.`,
      `Buy ${depth.buyPct}% / Sell ${depth.sellPct}%, imbalance ${depth.imbalance >= 0 ? "+" : ""}${depth.imbalance}. ${cautionFlags.length ? cautionFlags.join("; ") : "No unusual walls detected."}`
    );
  }
  if (opposed) {
    return result(
      "marketDepth",
      "Market Depth & Smart Money",
      10,
      "fail",
      `Order book is ${depth.tier} (${depth.reason}) -- against this call.`,
      `Buy ${depth.buyPct}% / Sell ${depth.sellPct}%, imbalance ${depth.imbalance >= 0 ? "+" : ""}${depth.imbalance}. ${cautionFlags.length ? cautionFlags.join("; ") : ""}`
    );
  }
  return result(
    "marketDepth",
    "Market Depth & Smart Money",
    10,
    "wait",
    `Order book is neutral (${depth.reason}) -- no clear edge either way.`,
    `Buy ${depth.buyPct}% / Sell ${depth.sellPct}%, imbalance ${depth.imbalance >= 0 ? "+" : ""}${depth.imbalance}.`
  );
}

export function evaluateStrategyVerification(input: VerificationInput): VerificationResult {
  const { direction, candles, liveUnderlyingPrice, entry, effectiveStop, livePremium, premiumSamples, oiSamples, marketDepth } = input;

  const strategies: StrategyResult[] = [
    checkDoubleSuperTrend(candles, direction),
    checkEma200(candles, direction, liveUnderlyingPrice),
    checkVwap(candles, direction, liveUnderlyingPrice),
    checkAdx(candles),
    checkRsi(candles, direction),
    checkMacd(candles, direction),
    checkVolume(candles),
    checkCpr(candles, direction, liveUnderlyingPrice),
    checkSupportResistance(candles, direction, liveUnderlyingPrice),
    checkAtrStop(candles, entry, effectiveStop),
    checkOpenInterest(premiumSamples, oiSamples),
    checkPremiumMomentum(premiumSamples),
    checkMarketDepth(direction, marketDepth),
  ];

  const totalWeight = strategies.reduce((s, r) => s + r.weightPct, 0);
  const weightedSum = strategies.reduce((s, r) => s + TIER_SCORE[r.tier] * r.weightPct, 0);
  const weightedScorePct = totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 0;

  let scoreTier: OverallTier;
  if (weightedScorePct > 85) scoreTier = "strong";
  else if (weightedScorePct >= 70) scoreTier = "good";
  else if (weightedScorePct >= 60) scoreTier = "wait";
  else scoreTier = "avoid";

  // ---- Override rules (never upgrade, only ever hold back or reject) ----
  const overrideReasons: string[] = [];
  let finalTier = scoreTier;

  const downgrade = (tier: OverallTier, reason: string) => {
    const rank: Record<OverallTier, number> = { strong: 3, good: 2, wait: 1, avoid: 0 };
    if (rank[tier] < rank[finalTier]) finalTier = tier;
    overrideReasons.push(reason);
  };

  const failCount = strategies.filter((s) => s.tier === "fail").length;
  if (failCount > 2 && finalTier !== "avoid") {
    downgrade("wait", `${failCount} strategies failed -- more than the 2 allowed for a BUY recommendation.`);
  }

  const majorKeys = ["supertrend", "ema200", "vwap", "adx"];
  const majorAllPass = strategies.filter((s) => majorKeys.includes(s.key)).every((s) => s.tier === "pass");
  if (finalTier === "strong" && !majorAllPass) {
    downgrade("good", "STRONG requires SuperTrend, EMA200, VWAP, and ADX to all PASS.");
  }

  const adxValue = adx(candles);
  if (adxValue !== null && adxValue < 20) {
    downgrade("wait", `ADX ${adxValue.toFixed(1)} is below 20 -- maximum recommendation is WAIT.`);
  }

  const srResult = strategies.find((s) => s.key === "sr");
  if (srResult?.tier === "wait") {
    downgrade("wait", "Price is touching the level working against this call.");
  }

  if (livePremium !== null && livePremium < entry) {
    downgrade("wait", `Premium (₹${livePremium.toFixed(2)}) is below entry (₹${entry.toFixed(2)}).`);
  }

  if (livePremium !== null && livePremium <= effectiveStop) {
    finalTier = "avoid";
    overrideReasons.push(`Premium (₹${livePremium.toFixed(2)}) has broken the stop (₹${effectiveStop.toFixed(2)}).`);
  }

  return { strategies, weightedScorePct, scoreTier, finalTier, overrideReasons };
}
