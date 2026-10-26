// Ai-Today: everything for ONE market -- 5m / 10m / 15m / 1h / 4h calls from
// the same confluence engine the Trade Report ranks (analyzeTimeframe), each
// priced as an option call (entry premium, stop, three targets) and logged
// with its result, plus the long-range picture from daily candles.

import { useMemo } from "react";
import { useCandles, useOptionsAnalytics } from "../api/hooks";
import { analyzeTimeframe, type TimeframeAnalysis } from "../utils/timeframeEngine";
import { useTradeLog } from "./useTradeLog";
import type { OptionsAnalytics } from "../types";

export type FocusSym = "CRUDEOIL" | "NATURALGAS";

export const TODAY_TFS: { tf: string; label: string; short: string }[] = [
  { tf: "5", label: "5 Minutes", short: "5m" },
  { tf: "10", label: "10 Minutes", short: "10m" },
  { tf: "15", label: "15 Minutes", short: "15m" },
  { tf: "60", label: "1 Hour", short: "1h" },
  { tf: "240", label: "4 Hours", short: "4h" },
];

export interface Projection {
  strike: number;
  optSide: "CE" | "PE";
  entry: number;
  targets: [number, number, number];
  stop: number;
}

/** The ATM option priced at the call's futures levels, by the leg's own delta (0.5 if missing). */
export function projectCall(a: TimeframeAnalysis, options: OptionsAnalytics | undefined): Projection | null {
  if (!options || options.error || !a.optSide || a.underlyingEntry === null || a.underlyingStop === null || !a.underlyingTargets) return null;
  const row = options.rows.find((r) => r.strike === options.atmStrike) ?? options.rows[Math.floor(options.rows.length / 2)];
  if (!row) return null;
  const leg = a.optSide === "CE" ? row.call : row.put;
  if (leg.ltp === null || leg.ltp <= 0) return null;
  const d = typeof leg.delta === "number" && Math.abs(leg.delta) >= 0.1 ? Math.abs(leg.delta) : 0.5;
  const at = (fut: number) => Number((leg.ltp! + d * Math.abs(fut - a.underlyingEntry!)).toFixed(2));
  const t = a.underlyingTargets;
  return {
    strike: row.strike,
    optSide: a.optSide,
    entry: leg.ltp,
    targets: [at(t[0]), at(t[1]), at(t[2])],
    stop: Number(Math.max(leg.ltp * 0.35, leg.ltp - d * Math.abs(a.underlyingEntry - a.underlyingStop)).toFixed(2)),
  };
}

export { tfRecord, type TfRecord } from "../utils/tfRecord";

export function useTodayFocus(sym: FocusSym) {
  const c5 = useCandles(sym, "5");
  const c10 = useCandles(sym, "10");
  const c15 = useCandles(sym, "15");
  const c60 = useCandles(sym, "60");
  const c240 = useCandles(sym, "240");
  const c1D = useCandles(sym, "1D");
  const optionsQ = useOptionsAnalytics(sym);
  const options = optionsQ.data && !optionsQ.data.error ? optionsQ.data : undefined;
  const qs = [c5, c10, c15, c60, c240];
  const daily = c1D.data && "candles" in c1D.data ? c1D.data.candles : [];

  const analyses = useMemo<TimeframeAnalysis[]>(
    () => TODAY_TFS.map(({ tf, label }, i) => analyzeTimeframe({ tf, label, candles: qs[i].data?.candles ?? [], dailyCandles: daily, options })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [c5.data, c10.data, c15.data, c60.data, c240.data, c1D.data, options],
  );
  const projections = useMemo(() => analyses.map((a) => projectCall(a, options)), [analyses, options]);
  const logs = useTradeLog(sym, analyses, projections, options, `TODAY-${sym}`);

  return {
    analyses,
    logs,
    options,
    daily,
    candles: { "5": c5.data?.candles ?? [], "10": c10.data?.candles ?? [], "15": c15.data?.candles ?? [], "60": c60.data?.candles ?? [], "240": c240.data?.candles ?? [] } as Record<string, import("../types").Candle[]>,
    loading: qs.some((q) => q.isLoading),
    refetch: () => Promise.all([...qs, c1D, optionsQ].map((q) => q.refetch())),
  };
}
