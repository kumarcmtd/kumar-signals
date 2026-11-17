// AI-Test V2 shared helpers: names, the option-premium projection that opens
// a call, the copy-tip text, call status labels and the decision colours.
// Pure (no JSX) so the page and its cards share one definition.

import type { TradeLogEntry, TradeLogStatus } from "../../store/appStore";
import { formatTipCard } from "../../utils/tipFormat";
import type { Decision6, TimeframeAnalysis } from "../../utils/timeframeEngine";
import type { OptionsAnalytics } from "../../types";

export type TradableSymbol = "CRUDEOIL" | "NATURALGAS";
export const SYMBOLS: TradableSymbol[] = ["CRUDEOIL", "NATURALGAS"];
export const DISPLAY_NAME: Record<TradableSymbol, string> = { CRUDEOIL: "Crude Oil", NATURALGAS: "Natural Gas" };
export const SHORT_NAME: Record<TradableSymbol, string> = { CRUDEOIL: "Crude", NATURALGAS: "NG" };
export const LOT_SIZE: Record<TradableSymbol, number> = { CRUDEOIL: 100, NATURALGAS: 1250 };
export const TF_SHORT: Record<string, string> = { "15": "15m", "30": "30m", "60": "1h", "240": "4h" };

/** This page's own trade lines: "<SYMBOL>-<minutes>" (every other page uses a prefix). */
export const isOwnKey = (k: string) => /^(CRUDEOIL|NATURALGAS)-\d+$/.test(k);
export const ownLogs = (logs: Record<string, TradeLogEntry[]>) => Object.fromEntries(Object.entries(logs).filter(([k]) => isOwnKey(k)));

/** Text colour of each decision tier on a light card (bullish greens ... bearish roses). */
export const DECISION_HEX: Record<Decision6, string> = {
  "STRONG BUY": "#059669",
  BUY: "#16A34A",
  "WATCH BUY": "#65A30D",
  WAIT: "#D97706",
  SELL: "#E11D48",
  "STRONG SELL": "#BE123C",
};
/** Vivid fill of each tier (signal map cells, detail header). */
export const DECISION_GRAD: Record<Decision6, string> = {
  "STRONG BUY": "linear-gradient(145deg,#059669,#34D399)",
  BUY: "linear-gradient(145deg,#16A34A,#4ADE80)",
  "WATCH BUY": "linear-gradient(145deg,#65A30D,#A3E635)",
  WAIT: "linear-gradient(145deg,#F59E0B,#FBBF24)",
  SELL: "linear-gradient(145deg,#E11D48,#FB7185)",
  "STRONG SELL": "linear-gradient(145deg,#BE123C,#F43F5E)",
};
export const NO_DATA_GRAD = "linear-gradient(145deg,#CBD5E1,#E2E8F0)";
/** Only a few points off WAIT: real but weak signals, flagged wherever they show. */
export const MARGINAL = new Set<Decision6>(["WATCH BUY", "SELL"]);

export const STATUS_LABEL: Record<TradeLogStatus, string> = {
  running: "Running",
  sl_hit: "SL Hit",
  stopped_breakeven: "Closed at Breakeven (T1)",
  stopped_after_t1: "Closed after T1 (T2 hit)",
  target3_hit: "Target 3 Hit",
  closed_manual: "Closed Manually",
  closed_eod: "Closed at Day End",
};
export const STATUS_HEX: Record<TradeLogStatus, string> = {
  running: "#334155",
  sl_hit: "#E11D48",
  stopped_breakeven: "#65A30D",
  stopped_after_t1: "#059669",
  target3_hit: "#059669",
  closed_manual: "#64748B",
  closed_eod: "#64748B",
};

export interface PremiumProjection {
  strike: number;
  optSide: "CE" | "PE";
  entry: number;
  targets: [number, number, number];
  stop: number;
  rr: number | null;
}

// Converts a timeframe's underlying entry/target/stop (futures points) into
// option-premium terms with the app's delta ~0.5 ATM projection, on the one
// live premium every timeframe shares. Only ever used to OPEN a trade line --
// once a line exists, its own frozen numbers are what is shown and tracked.
export function projectPremium(analysis: TimeframeAnalysis, options: OptionsAnalytics | undefined): PremiumProjection | null {
  if (!options || options.error || !analysis.optSide || analysis.underlyingEntry === null || analysis.underlyingStop === null || !analysis.underlyingTargets) return null;
  const row = options.rows.find((r) => r.strike === options.atmStrike) ?? options.rows[Math.floor(options.rows.length / 2)];
  if (!row) return null;
  const leg = analysis.optSide === "CE" ? row.call : row.put;
  if (leg.ltp === null || leg.ltp <= 0) return null;
  const DELTA = 0.5;
  const riskMove = Math.abs(analysis.underlyingEntry - analysis.underlyingStop);
  const entry = leg.ltp;
  const t = analysis.underlyingTargets.map((x) => Number((entry + DELTA * Math.abs(x - analysis.underlyingEntry!)).toFixed(2))) as [number, number, number];
  const stop = Number(Math.max(entry * 0.35, entry - DELTA * riskMove).toFixed(2));
  const rr = entry - stop !== 0 ? Number(((t[0] - entry) / (entry - stop)).toFixed(2)) : null;
  return { strike: row.strike, optSide: analysis.optSide, entry, targets: t, stop, rr };
}

const expiryLabel = (expiry: string | undefined) => {
  if (!expiry) return "—";
  try {
    return new Date(expiry).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
  } catch {
    return expiry;
  }
};

/** The app's standard tip card for a running call, on the clipboard. */
export function copyTip(sym: TradableSymbol, e: TradeLogEntry, expiry: string | undefined): void {
  const tip = formatTipCard({
    symbolLabel: DISPLAY_NAME[sym].toUpperCase(),
    strike: e.strike,
    optSide: e.optSide,
    expiryLabel: expiryLabel(expiry),
    buyZoneLow: e.entry,
    buyZoneHigh: Number((e.entry * 1.02).toFixed(2)),
    targets: e.targets,
    stopLoss: e.stop,
  });
  void navigator.clipboard?.writeText(tip);
}

export const fmtWhen = (ms: number) => new Date(ms).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });
export const rupees = (n: number) => `${n >= 0 ? "+" : "−"}₹${Math.abs(Math.round(n)).toLocaleString("en-IN")}`;
