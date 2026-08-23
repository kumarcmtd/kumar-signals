import { useEffect, useMemo, useState } from "react";
import { useCandles, useOptionsAnalytics, useMarketStatus } from "../api/hooks";
import { analyzeTimeframe } from "../utils/timeframeEngine";
import { computePriceSpeed } from "../utils/priceSpeed";
import { sessionStateNow, evaluateSessionSetup } from "../utils/sessionStrategyEngine";
import { projectPremiumFromUnderlying } from "../utils/optionProjection";
import { useEliteTradeLog } from "./useTradeLog";
import type { Decision6 } from "../utils/timeframeEngine";

export type AiOwnSymbol = "CRUDEOIL" | "NATURALGAS";
const TRACKING_KEY: Record<AiOwnSymbol, string> = { CRUDEOIL: "AIOWN-CRUDEOIL", NATURALGAS: "AIOWN-NATURALGAS" };

// Ties the pure session-timing engine to live 15m candles + the option chain,
// and tracks whatever it fires under its own AIOWN-<symbol> line (so the
// server-side Cron advances/closes it exactly like every other engine's calls).
export function useAiOwn(symbol: AiOwnSymbol) {
  const c15 = useCandles(symbol, "15");
  const c1d = useCandles(symbol, "1D");
  const { data: options } = useOptionsAnalytics(symbol);
  const { data: market } = useMarketStatus();
  const liveOptions = options && !options.error ? options : undefined;

  // A light clock tick so the active-window / countdown updates on their own.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15000);
    return () => clearInterval(t);
  }, []);

  const candles = useMemo(() => c15.data?.candles ?? [], [c15.data]);

  const analysis = useMemo(
    () => analyzeTimeframe({ tf: "15", label: "15 Minutes", candles, dailyCandles: c1d.data?.candles, options: liveOptions }),
    [candles, c1d.data, liveOptions]
  );

  const atmDelta = liveOptions?.atmStrike != null ? liveOptions.rows.find((r) => r.strike === liveOptions.atmStrike)?.call.delta ?? null : null;
  const speed = useMemo(() => (candles.length ? computePriceSpeed(candles, atmDelta) : null), [candles, atmDelta]);

  const session = useMemo(() => sessionStateNow(now, market?.isOpen), [now, market?.isOpen]);
  const setup = useMemo(() => evaluateSessionSetup(session, analysis, speed), [session, analysis, speed]);

  const proj = useMemo(() => {
    if (!setup.optSide || analysis.underlyingEntry === null || analysis.underlyingStop === null || !analysis.underlyingTargets) return null;
    const p = projectPremiumFromUnderlying(setup.optSide, analysis.underlyingEntry, analysis.underlyingStop, analysis.underlyingTargets, liveOptions);
    return p ? { strike: p.strike, optSide: setup.optSide, entry: p.entry, targets: p.targets, stop: p.stop } : null;
  }, [setup, analysis, liveOptions]);

  const meta = useMemo(
    () => ({ label: `AI Own · ${session.active?.label ?? "Session"}`, reasons: setup.reasons, confirmingTimeframes: [] }),
    [session, setup]
  );

  const tradeLog = useEliteTradeLog(TRACKING_KEY[symbol], setup.decision as Decision6, setup.optSide, proj, liveOptions, meta);

  return {
    session,
    setup,
    analysis,
    speed,
    options: liveOptions,
    candles,
    tradeLog,
    trackingKey: TRACKING_KEY[symbol],
    liveDataUnavailable: !!options?.error,
  };
}
