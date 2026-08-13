import type { OptionsAnalytics } from "../types";
import type { EliteCandidate } from "./eliteSignal";
import { projectGatePremium, type GateDirection, type GateQualified } from "./directionalGateEngine";
import type { TimedScanResult } from "./kimiScanner";
import { calculateHitProbability, type Commodity } from "./kimiPlaybook";
import type { TimeframeAnalysis } from "./timeframeEngine";

// "Best Call" compares the three independent, already-strict engines this
// app runs elsewhere -- AI Elite (STRONG-only + confluence), the CE/PE
// Directional Gate (multi-timeframe trend + ADX + volume), and the Kimi
// playbook scanner (named setup + confluence + hit-probability) -- and picks
// whichever single candidate currently has the HIGHEST estimated win
// probability, across all three, per instrument. Each engine only ever
// contributes a candidate when it has ALREADY cleared its own strict bar
// (Elite's findEliteSignal, Gate's "qualified" status, Kimi's tradeable
// flag), so there is nothing here to loosen further -- if none of the three
// currently qualifies for an instrument, there is no pick. Never falls back
// to "best of a weak field."
export type BestCallSource = "AI Elite" | "Directional Gate" | "Kimi Playbook" | "Pattern Signal";

export interface BestCallPick {
  source: BestCallSource;
  label: string;
  direction: "bullish" | "bearish";
  optSide: "CE" | "PE";
  confidence: number; // 0-100, each engine's own probability-style metric
  strike: number;
  entry: number;
  targets: [number, number, number];
  stop: number;
  rr: number | null;
  reasons: string[];
}

const DELTA = 0.5; // same ATM-option delta approximation used by every projection in this app

// Exported so other engines (e.g. patternSignalEngine's AI-Learn-informed
// candlestick detector) can project their own underlying entry/stop/targets
// into an option premium using this exact same convention, instead of each
// writing a slightly different copy.
export function projectFromUnderlying(
  optSide: "CE" | "PE",
  underlyingEntry: number,
  underlyingStop: number,
  underlyingTargets: [number, number, number],
  options: OptionsAnalytics | undefined
): { strike: number; entry: number; targets: [number, number, number]; stop: number; rr: number | null } | null {
  if (!options || options.error) return null;
  const row = options.rows.find((r) => r.strike === options.atmStrike) ?? options.rows[Math.floor(options.rows.length / 2)];
  if (!row) return null;
  const leg = optSide === "CE" ? row.call : row.put;
  if (leg.ltp === null || leg.ltp <= 0) return null;
  const favMove = Math.abs(underlyingTargets[0] - underlyingEntry);
  const riskMove = Math.abs(underlyingEntry - underlyingStop);
  const entry = leg.ltp;
  const targets: [number, number, number] = [
    Number((entry + DELTA * favMove).toFixed(2)),
    Number((entry + DELTA * Math.abs(underlyingTargets[1] - underlyingEntry)).toFixed(2)),
    Number((entry + DELTA * Math.abs(underlyingTargets[2] - underlyingEntry)).toFixed(2)),
  ];
  const stop = Number(Math.max(entry * 0.35, entry - DELTA * riskMove).toFixed(2));
  const rr = entry - stop !== 0 ? Number(((targets[0] - entry) / (entry - stop)).toFixed(2)) : null;
  return { strike: row.strike, entry, targets, stop, rr };
}

export function eliteToBestCallPick(elite: EliteCandidate): BestCallPick | null {
  const analysis: TimeframeAnalysis = elite.analysis;
  if (!analysis.optSide || analysis.underlyingEntry === null || analysis.underlyingStop === null || !analysis.underlyingTargets || analysis.hitProbability === null) {
    return null;
  }
  const proj = projectFromUnderlying(analysis.optSide, analysis.underlyingEntry, analysis.underlyingStop, analysis.underlyingTargets, elite.options);
  if (!proj) return null;
  return {
    source: "AI Elite",
    label: `${analysis.label} · confirmed by ${elite.confirmingTimeframes.join(", ") || "another timeframe"}`,
    direction: analysis.bias === "bearish" ? "bearish" : "bullish",
    optSide: analysis.optSide,
    confidence: analysis.hitProbability,
    strike: proj.strike,
    entry: proj.entry,
    targets: proj.targets,
    stop: proj.stop,
    rr: elite.rr,
    reasons: analysis.reasons,
  };
}

export function gateToBestCallPick(
  evaluation: GateQualified,
  direction: GateDirection,
  tfLabel: string,
  options: OptionsAnalytics | undefined
): BestCallPick | null {
  const optSide: "CE" | "PE" = direction === "bullish" ? "CE" : "PE";
  const proj = projectGatePremium(evaluation, optSide, options);
  if (!proj || proj.rr === null) return null;
  return {
    source: "Directional Gate",
    label: `${tfLabel} · multi-timeframe trend + ADX + volume gate`,
    direction,
    optSide,
    confidence: evaluation.confidence,
    strike: proj.strike,
    entry: proj.entry,
    targets: proj.targets,
    stop: proj.stop,
    rr: proj.rr,
    reasons: evaluation.reasons,
  };
}

// Kimi's scanner only ever returns ONE target per setup (its playbook rule
// is a single RR multiple, e.g. "1.5x to 2.0x RR"). To show the same 3-tier
// scaling target ladder as the other two engines, T2/T3 are extrapolated
// from that single target using the exact same 1.5x/2.5x/3.5x ratio the
// Elite and Directional Gate engines already use for their own target
// ladders elsewhere in this app -- reusing an existing convention, not
// inventing a new one.
function deriveThreeTargets(entry: number, singleTarget: number): [number, number, number] {
  const move = singleTarget - entry;
  return [Number((entry + move).toFixed(2)), Number((entry + move * (2.5 / 1.5)).toFixed(2)), Number((entry + move * (3.5 / 1.5)).toFixed(2))];
}

export function kimiToBestCallPick(result: TimedScanResult, commodity: Commodity, options: OptionsAnalytics | undefined): BestCallPick | null {
  const prob = calculateHitProbability(result.setupName, commodity, result.detectedConfluence);
  if ("error" in prob || prob.blocked || !prob.tradeable) return null;
  const optSide: "CE" | "PE" = result.direction === "bullish" ? "CE" : "PE";
  const underlyingTargets = deriveThreeTargets(result.entry, result.target);
  const proj = projectFromUnderlying(optSide, result.entry, result.stop, underlyingTargets, options);
  if (!proj) return null;
  // Graduated docking for a trigger candle that doesn't actually confirm
  // follow-through (weak close, extended RSI, volume against the move --
  // see entryQuality.ts) -- never re-blocks a setup that already cleared
  // calculateHitProbability's own bar, just makes it less likely to win the
  // cross-engine confidence comparison in pickBestCall.
  const confidence = Math.max(20, Math.round(prob.finalProbability - result.qualityPenalty));
  return {
    source: "Kimi Playbook",
    label: `${result.setupName} (${result.tfLabel})`,
    direction: result.direction === "bearish" ? "bearish" : "bullish",
    optSide,
    confidence,
    strike: proj.strike,
    entry: proj.entry,
    targets: proj.targets,
    stop: proj.stop,
    rr: proj.rr,
    reasons: result.notes,
  };
}

// Highest confidence wins across all candidates supplied, regardless of
// which of the three engines produced it. Returns null when the list is
// empty -- callers pass in only candidates that already cleared their own
// engine's strict bar, so an empty list here means genuinely nothing
// qualifies right now, not a weak fallback waiting to be picked anyway.
export function pickBestCall(candidates: BestCallPick[]): BestCallPick | null {
  if (!candidates.length) return null;
  return candidates.reduce((best, c) => (c.confidence > best.confidence ? c : best));
}
