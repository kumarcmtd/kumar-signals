import type { OptionsAnalytics } from "../types";
import type { CallDirection, StrategyResult, StrategyTier } from "./strategyVerification";

// Reads the SAME OptionsAnalytics object every other page already fetches
// (PCR, bias, Max Pain are computed server-side, not new data) plus a short
// in-browser rolling sample of the traded option's own OI and the
// underlying's price (built the same way Strategy Verification's own OI/
// Premium Momentum checks are) to produce 3 checks: PCR sentiment, OI
// buildup type for this specific contract, and Max Pain pin-risk.

const MIN_SAMPLES = 3;

function mk(key: string, name: string, weightPct: number, tier: StrategyTier, reason: string, explain: string): StrategyResult {
  return { key, name, tier, reason, explain, weightPct };
}

function checkPcr(options: OptionsAnalytics, direction: CallDirection): StrategyResult {
  const pcr = options.pcr;
  if (pcr === null) {
    return mk("pcr", "PCR Sentiment", 5, "wait", "PCR isn't available right now.", "Put-Call Ratio couldn't be computed from the current option chain snapshot.");
  }
  // Indian-market convention: PCR > 1 (more puts written than calls) reads
  // as bullish support building, PCR < 1 reads as resistance/bearish.
  const bullishPcr = pcr > 1.3;
  const bearishPcr = pcr < 0.7;
  const aligned = direction === "bullish" ? bullishPcr : bearishPcr;
  const opposed = direction === "bullish" ? bearishPcr : bullishPcr;
  if (aligned) return mk("pcr", "PCR Sentiment", 5, "pass", `PCR ${pcr.toFixed(2)} favors this ${direction === "bullish" ? "BUY" : "SELL"} call.`, `Put-Call Ratio ${pcr.toFixed(2)} is ${bullishPcr ? "above 1.3 (bullish put-writing support)" : "below 0.7 (bearish call-writing pressure)"}.`);
  if (opposed) return mk("pcr", "PCR Sentiment", 5, "fail", `PCR ${pcr.toFixed(2)} is against this call's direction.`, `Put-Call Ratio ${pcr.toFixed(2)} favors the opposite side.`);
  return mk("pcr", "PCR Sentiment", 5, "wait", `PCR ${pcr.toFixed(2)} is neutral -- no strong sentiment either way.`, `Put-Call Ratio ${pcr.toFixed(2)} sits in the 0.7-1.3 neutral band.`);
}

function checkOiBuildup(direction: CallDirection, oiSamples: (number | null)[], priceSamples: number[]): StrategyResult {
  const validOi = oiSamples.filter((v): v is number => v !== null);
  if (validOi.length < MIN_SAMPLES || priceSamples.length < MIN_SAMPLES) {
    return mk("oiBuildup", "OI Build-up", 5, "wait", "Gathering OI + price samples -- keep this page open a little longer.", "Needs a few more 5-second polls to read a buildup pattern.");
  }
  const oiChange = validOi[validOi.length - 1] - validOi[0];
  const priceChange = priceSamples[priceSamples.length - 1] - priceSamples[0];
  let buildup: string;
  let bullish: boolean | null;
  if (oiChange > 0 && priceChange > 0) { buildup = "Long Build-up"; bullish = true; }
  else if (oiChange > 0 && priceChange < 0) { buildup = "Short Build-up"; bullish = false; }
  else if (oiChange < 0 && priceChange > 0) { buildup = "Short Covering"; bullish = true; }
  else if (oiChange < 0 && priceChange < 0) { buildup = "Long Unwinding"; bullish = false; }
  else { buildup = "Flat"; bullish = null; }

  if (bullish === null) return mk("oiBuildup", "OI Build-up", 5, "wait", "OI and price are both flat -- no clear buildup pattern yet.", "Neither OI nor the underlying has moved enough since this page opened to classify a buildup type.");
  const aligned = direction === "bullish" ? bullish : !bullish;
  if (aligned) return mk("oiBuildup", "OI Build-up", 5, "pass", `${buildup} detected -- matches this call's direction.`, `Open Interest ${oiChange > 0 ? "rising" : "falling"} while the underlying ${priceChange > 0 ? "rises" : "falls"} reads as ${buildup}.`);
  return mk("oiBuildup", "OI Build-up", 5, "fail", `${buildup} detected -- against this call's direction.`, `Open Interest ${oiChange > 0 ? "rising" : "falling"} while the underlying ${priceChange > 0 ? "rises" : "falls"} reads as ${buildup}, opposite this call.`);
}

function checkMaxPain(options: OptionsAnalytics, liveUnderlyingPrice: number): StrategyResult {
  if (options.maxPain === null) {
    return mk("maxPain", "Max Pain Distance", 5, "wait", "Max Pain isn't available right now.", "Couldn't compute a Max Pain strike from the current option chain snapshot.");
  }
  const distPct = Math.abs(((liveUnderlyingPrice - options.maxPain) / options.maxPain) * 100);
  if (distPct < 1) {
    return mk("maxPain", "Max Pain Distance", 5, "wait", `Price is sitting right on Max Pain (₹${options.maxPain.toFixed(2)}) -- elevated pin risk near expiry.`, `Only ${distPct.toFixed(2)}% away from the Max Pain strike -- price often gets pulled toward this level as expiry nears.`);
  }
  return mk("maxPain", "Max Pain Distance", 5, "pass", `Price is ${distPct.toFixed(1)}% clear of Max Pain (₹${options.maxPain.toFixed(2)}) -- low pin risk.`, `${distPct.toFixed(1)}% away from the Max Pain strike -- comfortably clear of expiry pin risk.`);
}

export function evaluateOptionsSentiment(
  options: OptionsAnalytics | null,
  direction: CallDirection,
  liveUnderlyingPrice: number | null,
  oiSamples: (number | null)[],
  underlyingPriceSamples: number[]
): StrategyResult[] {
  if (!options || options.error) return [];
  const out = [checkPcr(options, direction), checkOiBuildup(direction, oiSamples, underlyingPriceSamples)];
  if (liveUnderlyingPrice !== null) out.push(checkMaxPain(options, liveUnderlyingPrice));
  return out;
}
