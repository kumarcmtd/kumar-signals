import { useEffect, useMemo } from "react";
import { useCandles } from "../api/hooks";
import { useAppStore, type SuperTrendLogEntry } from "../store/appStore";
import type { Candle, InstrumentSymbol } from "../types";
import { computeSuperTrendPro, effectiveStopForSetup, HIGHER_TF, type SuperTrendProSnapshot } from "../utils/superTrendProEngine";

// Advances one open entry against the latest close, exactly the same
// trailing-stop philosophy used everywhere else in this app (advanceOpenEntry
// in hooks/useTradeLog.ts), generalized to 5 ATR-based targets and a raw
// price direction instead of a fixed CE/PE + strike.
function advanceEntry(entry: SuperTrendLogEntry, liveClose: number | null, now: number): SuperTrendLogEntry {
  if (entry.closed || liveClose === null) return entry;
  const sign = entry.direction === "bullish" ? 1 : -1;
  const aboveNow = entry.targets.map((t) => sign * liveClose >= sign * t) as [boolean, boolean, boolean, boolean, boolean];
  const targetsHit = entry.targetsHit.map((h, i) => h || aboveNow[i]) as [boolean, boolean, boolean, boolean, boolean];

  if (targetsHit[4]) {
    if (entry.status === "target5_hit") return entry;
    return { ...entry, targetsHit, status: "target5_hit", closed: true, closedAt: entry.closedAt ?? now };
  }

  const effStop = effectiveStopForSetup({ entry: entry.entry, targets: entry.targets, stopLoss: entry.stop }, targetsHit);
  if (sign * liveClose <= sign * effStop) {
    const anyHit = targetsHit.some(Boolean);
    return { ...entry, targetsHit, status: anyHit ? "stopped_trailing" : "sl_hit", closed: true, closedAt: now };
  }

  const changed = targetsHit.some((h, i) => h !== entry.targetsHit[i]);
  if (!changed) return entry;
  return { ...entry, targetsHit, status: "running" };
}

export function useSuperTrendPro(symbol: InstrumentSymbol, timeframe: string) {
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
      const advanced = advanceEntry(open, snapshot.lastPrice, now);
      if (advanced !== open) setSuperTrendLog(key, [...history.slice(0, -1), advanced]);
      return;
    }

    // Only the highest-conviction tier opens a tracked trade -- matches the
    // spec's own gate ("only produce Strong Buy/Strong Sell when lower and
    // higher timeframes agree"). Buy/Bullish/Sell/Weak Sell/Wait/Range/
    // Neutral are shown live on the dashboard but never logged as a trade,
    // same reasoning AI Elite already uses for its own strict-only log.
    if ((snapshot.marketStatus === "Strong Buy" || snapshot.marketStatus === "Strong Sell") && snapshot.tradeSetup) {
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
      };
      setSuperTrendLog(key, [...history, entry]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot, key, symbol, timeframe]);

  return {
    snapshot,
    candles,
    candlesLoading: isLoading,
    candlesError: error instanceof Error ? error.message : candlesErrorReason,
    log: superTrendLogs[key] ?? [],
  };
}
