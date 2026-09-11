import { useMemo } from "react";
import { useCandles } from "../api/hooks";
import { adx as adxOf, superTrend } from "../utils/indicators";
import { assessCallStrength } from "../utils/callStrength";
import { auditTradeLogCall, legGreeksFor, type CallAudit, type TradeLogCallLike } from "../utils/callAuditEngine";
import type { Candle, InstrumentSymbol, OptionsAnalytics } from "../types";
import type { TradeLogEntry } from "../utils/tradeLogCore";

/**
 * Audits one of the standard TradeLogEntry-shaped calls. One hook so Best
 * Call, AI-Shoot, Ai20-20, Level Cross and AI-Up all grade a call by exactly
 * the same rules -- a grade that meant different things on different pages
 * would be worse than no grade.
 *
 * The trend inputs are computed here from candles, independently of the call
 * being audited. Asking the engine that produced the call whether the call
 * agrees with it would always answer yes.
 */
export function useCallAudit({
  symbol,
  entry,
  candles,
  options,
  liveLtp,
  log,
}: {
  symbol: InstrumentSymbol;
  entry: TradeLogEntry | null | undefined;
  candles: Candle[];
  options: OptionsAnalytics | undefined;
  liveLtp: number | null;
  /** This page's own trade log, for the track-record check. */
  log?: TradeLogEntry[];
}): CallAudit | null {
  // Daily candles carry the higher-timeframe trend. Shared react-query key, so
  // on pages already loading them this costs nothing extra.
  const daily = useCandles(symbol, "1D");
  const dailyCandles = daily.data?.candles;

  return useMemo(() => {
    if (!entry) return null;

    const call: TradeLogCallLike = {
      strike: entry.strike,
      optSide: entry.optSide,
      entry: entry.entry,
      stop: entry.stop,
      targets: entry.targets,
      targetsHit: entry.targetsHit,
      openedAt: entry.openedAt,
    };

    const direction = entry.optSide === "CE" ? "bullish" : "bearish";
    const st = candles.length ? superTrend(candles) : null;
    const dailySt = dailyCandles?.length ? superTrend(dailyCandles) : null;
    const strength = candles.length
      ? assessCallStrength(candles, direction, {
          entry: entry.entry,
          stop: entry.stop,
          targets: entry.targets,
          targetsHit: entry.targetsHit,
          current: liveLtp,
          openedAt: entry.openedAt,
        })
      : null;

    const greeks = legGreeksFor(options, entry.strike, entry.optSide);
    // Only trades that actually resolved count toward the record; a call still
    // running says nothing yet about whether this page is working.
    const decided = (log ?? []).filter((e) => e.status === "target3_hit" || e.status === "stopped_after_t1" || e.status === "sl_hit");

    return auditTradeLogCall({
      call,
      trend: st?.direction ?? null,
      higherTfTrend: dailySt?.direction ?? null,
      adx: candles.length ? adxOf(candles) : null,
      strengthPct: strength?.score ?? null,
      options,
      delta: greeks.delta,
      thetaPerDay: greeks.thetaPerDay,
      trackRecord: decided.length
        ? { closed: decided.length, wins: decided.filter((e) => e.status === "target3_hit" || e.status === "stopped_after_t1").length }
        : null,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry, candles, dailyCandles, options, liveLtp, log]);
}
