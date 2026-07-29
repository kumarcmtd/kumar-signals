import { useMemo } from "react";
import { useCandles, useSignal } from "../api/hooks";
import { useTimeframeSuite, TIMEFRAMES } from "./useTimeframeSuite";
import { useDirectionalGateSuite } from "./useDirectionalGateSuite";
import { useEliteTradeLog } from "./useTradeLog";
import { findEliteSignal } from "../utils/eliteSignal";
import { scanAllSetups } from "../utils/kimiScanner";
import { eliteToBestCallPick, gateToBestCallPick, kimiToBestCallPick, pickBestCall, type BestCallPick } from "../utils/bestCallSelector";
import type { Decision6 } from "../utils/timeframeEngine";

export type TradableSymbol = "CRUDEOIL" | "NATURALGAS";
export const COMMODITY: Record<TradableSymbol, "NG" | "CL"> = { CRUDEOIL: "CL", NATURALGAS: "NG" };

// Runs all three independently-built engines this app already has (AI Elite,
// the CE/PE Directional Gate in both directions, and the Kimi playbook
// scanner across all 4 timeframes) for one instrument, and hands every
// candidate that already cleared ITS OWN engine's strict bar to
// pickBestCall(), which keeps only the single highest-confidence one. Also
// tracks that pick under its own "BEST-<symbol>" trade-log line (same
// mechanism AI Elite uses). Shared between the Best Call page (which
// displays it) and the app-wide alert engine (which watches for a new pick
// opening so it can notify even when the Best Call page isn't the one open)
// so both stay in sync off a single source of truth for what "best" means.
export function useBestCallForSymbol(symbol: TradableSymbol, journalWinRate: number | null) {
  const commodity = COMMODITY[symbol];
  const suite = useTimeframeSuite(symbol, journalWinRate);
  const gateBull = useDirectionalGateSuite(symbol, "bullish");
  const gateBear = useDirectionalGateSuite(symbol, "bearish");
  const c15 = useCandles(symbol, "15");
  const c30 = useCandles(symbol, "30");
  const c60 = useCandles(symbol, "60");
  const c240 = useCandles(symbol, "240");
  const { data: signal } = useSignal(symbol);

  const eliteEntries = useMemo(
    () => suite.analyses.map((a) => ({ symbol, analysis: a, options: suite.options })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [suite.analyses, suite.options]
  );
  const elite = useMemo(() => findEliteSignal(eliteEntries), [eliteEntries]);
  const elitePick = useMemo(() => (elite ? eliteToBestCallPick(elite) : null), [elite]);

  const gatePicks = useMemo(() => {
    const out: BestCallPick[] = [];
    for (const r of gateBull.results) {
      if (r.evaluation.status !== "qualified") continue;
      const p = gateToBestCallPick(r.evaluation, "bullish", r.label, gateBull.options);
      if (p) out.push(p);
    }
    for (const r of gateBear.results) {
      if (r.evaluation.status !== "qualified") continue;
      const p = gateToBestCallPick(r.evaluation, "bearish", r.label, gateBear.options);
      if (p) out.push(p);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gateBull.results, gateBull.options, gateBear.results, gateBear.options]);

  const kimiPicks = useMemo(() => {
    const timeframes = TIMEFRAMES.map(({ tf, label }) => {
      const q = tf === "15" ? c15 : tf === "30" ? c30 : tf === "60" ? c60 : c240;
      return { tf, label, candles: q.data?.candles ?? [] };
    });
    const results = scanAllSetups(commodity, timeframes);
    return results.map((r) => kimiToBestCallPick(r, commodity, suite.options)).filter((p): p is BestCallPick => p !== null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commodity, c15.data, c30.data, c60.data, c240.data, suite.options]);

  const allPicks = useMemo(() => [...(elitePick ? [elitePick] : []), ...gatePicks, ...kimiPicks], [elitePick, gatePicks, kimiPicks]);
  const best = useMemo(() => pickBestCall(allPicks), [allPicks]);

  const trackingKey = `BEST-${symbol}`;
  const decision: Decision6 | null = best ? (best.direction === "bullish" ? "STRONG BUY" : "STRONG SELL") : null;
  const proj = best ? { strike: best.strike, optSide: best.optSide, entry: best.entry, targets: best.targets, stop: best.stop } : null;
  const meta = best ? { label: best.source, reasons: best.reasons, confirmingTimeframes: [best.label] } : undefined;
  useEliteTradeLog(trackingKey, decision, best?.optSide ?? null, proj, suite.options, meta);

  return {
    best,
    trackingKey,
    options: suite.options,
    expiry: signal?.expiry,
    allCandidateCount: allPicks.length,
    // 15-minute candles for this symbol, already fetched above for the Kimi
    // scan -- exposed so the page can re-check the underlying's current
    // technical strength for an open trade without any extra API call.
    underlyingCandles: c15.data?.candles ?? [],
    underlyingCandlesLoading: c15.isLoading,
    // The worker returns {error} with a normal 200 status (not a thrown
    // fetch error) when candles genuinely aren't ready yet -- most commonly
    // "market may be closed"/"not enough bars yet" in the first ~20 minutes
    // after MCX opens, before today's 1-minute feed has enough bars to
    // resample. Surfacing the real reason lets a chart consumer explain
    // *why* there's nothing to show instead of looking broken.
    underlyingCandlesError: (c15.data as { error?: string } | undefined)?.error ?? null,
  };
}
