import type { InstrumentSymbol, OptionsAnalytics, Candle } from "../types";
import { computeIndicatorSnapshot } from "./indicators";

// Ai20-20's whole reason to exist: Best Call and AI Verify Pro are both
// deliberately strict and go idle the moment a call closes or moves past its
// own targets. The FIRST version of this engine reused the app's own
// 15m/30m/1H/4H TimeframeAnalysis buckets to qualify -- but that meant a
// candidate was only ever as fresh as its slowest confirming timeframe, and
// a card labelled "4 Hours" reads as "this will take 4 hours," the opposite
// of what a quick-win page should promise. This version drops candle-bucket
// analysis entirely: it reads fine-grained (5-minute) price action AND the
// option premium's own live tick-to-tick movement (sampled independently of
// any candle close, on a fast poll cadence -- see useImmediateSuite), so a
// call can qualify the moment real momentum shows up, not on some fixed
// timeframe's next close.
//
// The target itself is unchanged: a flat PROFIT_PER_LOT (see below), not a
// flat point count. A flat point count breaks the moment you compare two
// symbols with very different lot sizes -- Crude Oil's lot size (100) means
// a 20-point premium move is exactly Rs2000/lot, but Natural Gas's lot size
// (1250) means that SAME 20 points would be Rs25,000/lot, an unrealistic ask
// given NG premiums typically sit around Rs9-18 to begin with. Anchoring on
// profit-per-lot and deriving each symbol's own point target from its own
// lot size keeps "one lot, one clean win" consistent across both markets.

export type ImmediateDirection = "bullish" | "bearish" | "neutral";

export interface ImmediateCategory {
  score: number; // 0-100
  notes: string[];
}

export interface ImmediateAnalysis {
  bias: ImmediateDirection;
  optSide: "CE" | "PE" | null;
  insufficient: string | null;
  vetoes: string[];
  categories: {
    trend: ImmediateCategory;
    momentum: ImmediateCategory;
    priceAction: ImmediateCategory;
    premiumMomentum: ImmediateCategory;
  } | null;
}

const MIN_BARS = 30;
const clamp100 = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

// Reads whatever fine-grained candles it's given (useImmediateSuite feeds it
// 5-minute bars) and scores four fast-reacting categories -- deliberately no
// ADX-style "is this trend mature yet" gate, since maturity is the opposite
// of immediate. premiumMomentumPct is the option's OWN live price's percent
// change over the last ~40-60 seconds (see useImmediateSuite), sampled
// independent of any candle -- real money moving right now, the single most
// direct "immediate" signal available.
export function analyzeImmediate(candles: Candle[], ceMomentumPct: number | null, peMomentumPct: number | null): ImmediateAnalysis {
  if (candles.length < MIN_BARS) {
    return { bias: "neutral", optSide: null, insufficient: "Not enough recent price data yet", vetoes: [], categories: null };
  }
  const snap = computeIndicatorSnapshot(candles);
  const recent = candles.slice(-5);
  const netMove = recent[recent.length - 1].close - recent[0].open;
  const avgRange = recent.reduce((s, c) => s + (c.high - c.low), 0) / recent.length;

  let trendScore = 50;
  const trendNotes: string[] = [];
  if (snap.ema9 !== null && snap.ema20 !== null) {
    if (snap.ema9 > snap.ema20) {
      trendScore += 20;
      trendNotes.push("Fast EMA9 above EMA20");
    } else if (snap.ema9 < snap.ema20) {
      trendScore -= 20;
      trendNotes.push("Fast EMA9 below EMA20");
    }
  }
  if (snap.trendDirection === "bullish") {
    trendScore += 15;
    trendNotes.push("SuperTrend reads bullish");
  } else if (snap.trendDirection === "bearish") {
    trendScore -= 15;
    trendNotes.push("SuperTrend reads bearish");
  }

  let momentumScore = 50;
  const momentumNotes: string[] = [];
  if (snap.rsi14 !== null) {
    momentumScore += (snap.rsi14 - 50) * 0.8;
    momentumNotes.push(`RSI ${snap.rsi14.toFixed(0)}`);
  }
  if (snap.macd) {
    momentumScore += snap.macd.histogram > 0 ? 15 : snap.macd.histogram < 0 ? -15 : 0;
    momentumNotes.push(snap.macd.histogram > 0 ? "MACD histogram positive" : snap.macd.histogram < 0 ? "MACD histogram negative" : "MACD flat");
  }

  let priceActionScore = 50;
  const priceActionNotes: string[] = [];
  if (avgRange > 0) {
    const thrust = Math.max(-1, Math.min(1, netMove / (avgRange * recent.length)));
    priceActionScore += thrust * 40;
    priceActionNotes.push(thrust > 0.15 ? "Last few bars pushing up" : thrust < -0.15 ? "Last few bars pushing down" : "Last few bars flat");
  }

  const underlyingScore = (clamp100(trendScore) + clamp100(momentumScore) + clamp100(priceActionScore)) / 3;
  const tentativeBias: ImmediateDirection = underlyingScore >= 58 ? "bullish" : underlyingScore <= 42 ? "bearish" : "neutral";
  if (tentativeBias === "neutral") {
    return {
      bias: "neutral",
      optSide: null,
      insufficient: null,
      vetoes: [],
      categories: {
        trend: { score: clamp100(trendScore), notes: trendNotes },
        momentum: { score: clamp100(momentumScore), notes: momentumNotes },
        priceAction: { score: clamp100(priceActionScore), notes: priceActionNotes },
        premiumMomentum: { score: 50, notes: ["No clean underlying read yet"] },
      },
    };
  }

  const optSide: "CE" | "PE" = tentativeBias === "bullish" ? "CE" : "PE";
  const ownPremiumMomentumPct = optSide === "CE" ? ceMomentumPct : peMomentumPct;
  let premiumScore = 50;
  const premiumNotes: string[] = [];
  if (ownPremiumMomentumPct !== null) {
    premiumScore += Math.max(-40, Math.min(40, ownPremiumMomentumPct * 4));
    premiumNotes.push(ownPremiumMomentumPct > 1 ? "Live premium already rising" : ownPremiumMomentumPct < -1 ? "Live premium already falling" : "Live premium flat so far");
  } else {
    premiumNotes.push("Not enough live premium samples yet -- still building the window");
  }

  const vetoes: string[] = [];
  if (ownPremiumMomentumPct !== null && ownPremiumMomentumPct < -1) {
    vetoes.push(`Live ${optSide} premium is actually falling right now despite the underlying's ${tentativeBias} read`);
  }

  return {
    bias: tentativeBias,
    optSide,
    insufficient: null,
    vetoes,
    categories: {
      trend: { score: clamp100(trendScore), notes: trendNotes },
      momentum: { score: clamp100(momentumScore), notes: momentumNotes },
      priceAction: { score: clamp100(priceActionScore), notes: priceActionNotes },
      premiumMomentum: { score: clamp100(premiumScore), notes: premiumNotes },
    },
  };
}

export interface AiTwentyCandidate {
  symbol: string;
  analysis: ImmediateAnalysis;
  reason: string;
}

// Deliberately loose, same as before: at most one minor caution (a premium
// that hasn't caught up to the underlying's read yet) is allowed through.
export function scanForAiTwenty(entries: { symbol: string; analysis: ImmediateAnalysis }[]): AiTwentyCandidate[] {
  const out: AiTwentyCandidate[] = [];
  for (const e of entries) {
    const a = e.analysis;
    if (a.bias === "neutral" || !a.categories || a.insufficient) continue;
    if (a.vetoes.length > 1) continue;
    out.push({
      symbol: e.symbol,
      analysis: a,
      reason: a.vetoes.length === 1 ? `Fast directional read, with one caution: ${a.vetoes[0]}` : "Fast directional read across trend/momentum/price action, confirmed by the live premium itself",
    });
  }
  return out;
}

export interface AiTwentyPremium {
  strike: number;
  optSide: "CE" | "PE";
  entry: number;
  targets: [number, number, number];
  stop: number;
  rr: number | null;
  profitPerLot: number;
}

// Rs2000/lot at Target 1 is the actual bar -- "20 points" is just what that
// works out to for Crude Oil specifically (lot size 100). Same ratios as
// before (T2 = 1.6x T1, T3 = 2.25x T1, stop = 0.6x T1) so Crude Oil's own
// numbers stay familiar; only Natural Gas's point target shrinks to
// something its own premiums can realistically reach.
const PROFIT_PER_LOT = 2000;
const T2_RATIO = 1.6;
const T3_RATIO = 2.25;
const STOP_RATIO = 0.6;
export const LOT_SIZE: Record<InstrumentSymbol, number> = { CRUDEOIL: 100, NATURALGAS: 1250, GOLD: 100, SILVER: 30 };
// Just enough to keep the stop-distance math numerically sane for a
// near-zero premium -- the entry*0.5 floor below does the real guarding.
const MIN_ENTRY_PREMIUM = 1;

export function projectPremium20(analysis: ImmediateAnalysis, options: OptionsAnalytics | undefined): AiTwentyPremium | null {
  if (!options || options.error || !analysis.optSide) return null;
  const row = options.rows.find((r) => r.strike === options.atmStrike) ?? options.rows[Math.floor(options.rows.length / 2)];
  if (!row) return null;
  const leg = analysis.optSide === "CE" ? row.call : row.put;
  if (leg.ltp === null || leg.ltp < MIN_ENTRY_PREMIUM) return null;

  const lotSize = LOT_SIZE[options.symbol];
  const t1Points = PROFIT_PER_LOT / lotSize;

  const entry = leg.ltp;
  const targets: [number, number, number] = [
    Number((entry + t1Points).toFixed(2)),
    Number((entry + t1Points * T2_RATIO).toFixed(2)),
    Number((entry + t1Points * T3_RATIO).toFixed(2)),
  ];
  const stop = Number(Math.max(entry * 0.5, entry - t1Points * STOP_RATIO).toFixed(2));
  const rr = entry - stop !== 0 ? Number(((targets[0] - entry) / (entry - stop)).toFixed(2)) : null;
  return { strike: row.strike, optSide: analysis.optSide, entry, targets, stop, rr, profitPerLot: Number(((targets[0] - entry) * lotSize).toFixed(2)) };
}
