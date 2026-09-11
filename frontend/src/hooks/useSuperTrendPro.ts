import { useEffect, useMemo } from "react";
import { useCandles } from "../api/hooks";
import { useAppStore, type SuperTrendLogEntry } from "../store/appStore";
import type { Candle, InstrumentSymbol, OptionsAnalytics } from "../types";
import { computeSuperTrendPro, HIGHER_TF, advanceEntry, type SuperTrendProSnapshot } from "../utils/superTrendProEngine";
import { projectPremiumFromUnderlying } from "../utils/optionProjection";
import { liveLtpFor } from "../utils/tradeLogCore";

// Advances one open entry against the latest close, exactly the same
// trailing-stop philosophy used everywhere else in this app (advanceOpenEntry
// in hooks/useTradeLog.ts), generalized to 5 ATR-based targets and a raw
// price direction instead of a fixed CE/PE + strike.
export function useSuperTrendPro(symbol: InstrumentSymbol, timeframe: string, options?: OptionsAnalytics) {
  const { data: candleData, isLoading, error } = useCandles(symbol, timeframe);
  const higherTf = HIGHER_TF[timeframe] ?? timeframe;
  const { data: higherData } = useCandles(symbol, higherTf);

  const candles: Candle[] = candleData && "candles" in candleData ? candleData.candles : [];
  const higherCandles: Candle[] | null = higherData && "candles" in higherData ? higherData.candles : null;
  const candlesErrorReason = (candleData as { error?: string } | undefined)?.error ?? null;

  const snapshot: SuperTrendProSnapshot | null = useMemo(() => computeSuperTrendPro(candles, higherCandles), [candles, higherCandles]);

  const key = `${symbol}-${timeframe}`;
  const superTrendLogs = useAppStore((s) => s.superTrendLogs);
  const setSuperTrendLog = useAppStore((s) => s.setSuperTrendLog);

  useEffect(() => {
    if (!snapshot) return;
    const now = Date.now();
    const history = superTrendLogs[key] ?? [];
    const last = history[history.length - 1];
    const open = last && !last.closed ? last : undefined;

    if (open) {
      const optLtp = open.optStrike !== undefined && open.optSide ? liveLtpFor(options, open.optStrike, open.optSide) : null;
      const advanced = advanceEntry(open, snapshot.lastPrice, optLtp, now);
      if (advanced !== open) setSuperTrendLog(key, [...history.slice(0, -1), advanced]);
      return;
    }

    // Only the highest-conviction tier opens a tracked trade -- matches the
    // spec's own gate ("only produce Strong Buy/Strong Sell when lower and
    // higher timeframes agree"). Buy/Bullish/Sell/Weak Sell/Wait/Range/
    // Neutral are shown live on the dashboard but never logged as a trade,
    // same reasoning AI Elite already uses for its own strict-only log.
    if ((snapshot.marketStatus === "Strong Buy" || snapshot.marketStatus === "Strong Sell") && snapshot.tradeSetup) {
      // Pin the option leg at open: which strike, which side, and the premium
      // it was actually quoting right then. If the chain is unreachable these
      // stay undefined and the milestone card simply doesn't render.
      const optSide: "CE" | "PE" = snapshot.tradeSetup.direction === "bullish" ? "CE" : "PE";
      const optProj = projectPremiumFromUnderlying(
        optSide,
        snapshot.tradeSetup.entry,
        snapshot.tradeSetup.stopLoss,
        [snapshot.tradeSetup.targets[0], snapshot.tradeSetup.targets[1], snapshot.tradeSetup.targets[2]],
        options
      );

      const entry: SuperTrendLogEntry = {
        id: `${key}-${now}`,
        symbol,
        timeframe,
        direction: snapshot.tradeSetup.direction,
        entry: snapshot.tradeSetup.entry,
        stop: snapshot.tradeSetup.stopLoss,
        targets: snapshot.tradeSetup.targets,
        targetsHit: [false, false, false, false, false],
        confidence: snapshot.marketStatus === "Strong Buy" ? snapshot.confidence.buyPct : snapshot.confidence.sellPct,
        status: "running",
        closed: false,
        openedAt: now,
        closedAt: null,
        optStrike: optProj?.strike,
        optSide: optProj ? optSide : undefined,
        optEntry: optProj?.entry,
        optHighWaterMark: optProj?.entry,
      };
      setSuperTrendLog(key, [...history, entry]);
    }
    // options is a dependency so the option high-water mark keeps climbing as
    // the chain ticks, not only when a new candle arrives. Re-running with an
    // unchanged peak produces an identical entry and sets nothing, so this
    // settles rather than looping.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot, key, symbol, timeframe, options]);

  return {
    snapshot,
    candles,
    candlesLoading: isLoading,
    candlesError: error instanceof Error ? error.message : candlesErrorReason,
    log: superTrendLogs[key] ?? [],
  };
}
