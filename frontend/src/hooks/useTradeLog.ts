import { useEffect } from "react";
import { useAppStore } from "../store/appStore";
import type { Decision6 } from "../utils/timeframeEngine";
import type { OptionsAnalytics } from "../types";
// The pure advance/close/merge logic and the entry shape now live in
// tradeLogCore (shared with the Cloudflare Worker's Cron). Re-exported from
// here so every existing `import { liveLtpFor, effectiveStopFor, ... } from
// "../hooks/useTradeLog"` keeps working unchanged.
import {
  MAX_HISTORY,
  type ProjLike,
  type TradeLogEntry,
  effectiveStopFor,
  liveLtpFor,
  openNewEntry,
  advanceOpenEntry,
  advanceTradeLog,
} from "../utils/tradeLogCore";

export { MAX_HISTORY, effectiveStopFor, liveLtpFor, openNewEntry, advanceOpenEntry, advanceTradeLog };
export type { ProjLike };

// The only fields useTradeLog actually reads off each timeframe's analysis.
// TimeframeAnalysis already has all of these, so every existing caller
// (which passes TimeframeAnalysis[]) is unaffected; this just lets a
// differently-shaped engine (e.g. the CE/PE directional gate, which isn't a
// Decision6 score at all) feed its own lightweight per-timeframe result in
// without needing to fabricate an entire TimeframeAnalysis object.
interface AnalysisLike {
  tf: string;
  decision: Decision6;
  insufficient?: string | null;
  optSide?: "CE" | "PE" | null;
}

// keyPrefix defaults to symbol (unchanged behavior for every existing
// caller). Pass a distinct prefix to track a separate page's own history
// under exclusive keys in the SAME shared tradeLogs dictionary without
// colliding with another page's entries for the same symbol+timeframe --
// e.g. Kumar AI uses "KUMARAI-<symbol>" so its background tracking never
// mixes with AI-Test V2/Pro's own logs.
export function useTradeLog(
  symbol: string,
  analyses: AnalysisLike[],
  projections: (ProjLike | null)[],
  options: OptionsAnalytics | undefined,
  keyPrefix: string = symbol
) {
  const tradeLogs = useAppStore((s) => s.tradeLogs);
  const setTradeLog = useAppStore((s) => s.setTradeLog);

  useEffect(() => {
    const now = Date.now();
    analyses.forEach((a, i) => {
      const key = `${keyPrefix}-${a.tf}`;
      const history = tradeLogs[key] ?? [];
      const last = history[history.length - 1];
      const open = last && !last.closed ? last : undefined;
      const liveLtpForOpen = open ? liveLtpFor(options, open.strike, open.optSide) : null;
      const proj = projections[i];
      const next = advanceTradeLog(history, { decision: a.decision, insufficient: a.insufficient, optSide: a.optSide, proj, liveLtpForOpen }, now);
      if (next !== history) setTradeLog(key, next);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyPrefix, analyses, projections, options]);

  return tradeLogs;
}

// Same tracking logic as useTradeLog, but for a single named line rather
// than one per timeframe -- used by AI Elite, which only ever tracks the
// one candidate that clears its stricter bar (or nothing at all). Stored
// under a distinct "ELITE-<symbol>" key in the SAME shared tradeLogs
// dictionary so it can't collide with any real "<symbol>-<tf>" key.
export function useEliteTradeLog(
  trackingKey: string | null,
  decision: Decision6 | null,
  optSide: "CE" | "PE" | null,
  proj: ProjLike | null,
  options: OptionsAnalytics | undefined,
  meta?: TradeLogEntry["meta"]
) {
  const tradeLogs = useAppStore((s) => s.tradeLogs);
  const setTradeLog = useAppStore((s) => s.setTradeLog);

  useEffect(() => {
    if (!trackingKey) return;
    const now = Date.now();
    const history = tradeLogs[trackingKey] ?? [];
    const last = history[history.length - 1];
    const open = last && !last.closed ? last : undefined;
    const liveLtpForOpen = open ? liveLtpFor(options, open.strike, open.optSide) : null;
    const next = advanceTradeLog(history, { decision: decision ?? "WAIT", insufficient: null, optSide, proj, liveLtpForOpen, meta }, now);
    if (next !== history) setTradeLog(trackingKey, next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackingKey, decision, optSide, proj, options, meta]);

  return trackingKey ? tradeLogs[trackingKey] ?? [] : [];
}
