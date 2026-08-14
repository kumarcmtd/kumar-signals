import { useEffect, useMemo } from "react";
import { usePortfolio } from "../api/hooks";
import { computePortfolioSummary } from "../utils/portfolioStats";
import { useHitScoreSuite } from "./useHitScoreSuite";
import { useEliteTradeLog } from "./useTradeLog";
import { evaluateLevelCross, type LevelCrossSignal } from "../utils/levelCrossEngine";
import { projectFromUnderlying } from "../utils/bestCallSelector";
import { useAppStore } from "../store/appStore";
import type { Candle } from "../types";

interface LevelCrossProjection {
  strike: number;
  optSide: "CE" | "PE";
  entry: number;
  targets: [number, number, number];
  stop: number;
}

type TradableSymbol = "CRUDEOIL" | "NATURALGAS";
const SYMBOLS: TradableSymbol[] = ["CRUDEOIL", "NATURALGAS"];
const STABLE_KEY: Record<TradableSymbol, string> = { CRUDEOIL: "LEVELCROSS-CRUDEOIL", NATURALGAS: "LEVELCROSS-NATURALGAS" };

// No fixed timeframe, by design (the same reasoning as AI-Shoot/Best Call):
// a well-tested level breaking on the 15-minute chart is just as valid a
// signal as one breaking on the 4-hour chart, so every timeframe is scanned
// and only the single highest-confidence qualifying break per symbol is
// surfaced -- never "best of a weak field" when nothing actually qualifies.
function pickBest(signals: LevelCrossSignal[]): LevelCrossSignal | null {
  const qualifying = signals.filter((s) => s.decision !== "WAIT" && s.confidence !== null);
  if (!qualifying.length) return null;
  return qualifying.reduce((best, s) => (s.confidence! > best.confidence! ? s : best));
}

// Signals that came close (a level genuinely broke, but volume/quality/
// confidence didn't clear the bar) -- informational only, same "near miss"
// concept AI-Shoot already uses so the page doesn't look dead on quiet days.
function nearMisses(signals: LevelCrossSignal[]): LevelCrossSignal[] {
  return signals.filter((s) => s.decision === "WAIT" && s.level !== null);
}

export function useLevelCrossScanner() {
  const { data: trades } = usePortfolio();
  const journalSummary = useMemo(() => computePortfolioSummary(trades ?? []), [trades]);

  // One-time cleanup for a real bug fixed earlier: this page used to key
  // each symbol's trade log by whichever timeframe currently had the best
  // signal (e.g. "LEVELCROSS-NATURALGAS-15"), so a still-open trade got
  // silently orphaned -- never advanced against live price again -- the
  // moment a different timeframe took the lead. Those legacy keys are now
  // stuck showing "Running" forever with no way to actually resolve them
  // (there's no live price feed still watching them). Force-closing them
  // once, honestly labeled "closed_manual" (never fabricating a market
  // exit price), clears the phantom entries out of Call History instead of
  // either hiding real historical data or leaving it permanently wrong.
  const tradeLogsRaw = useAppStore((s) => s.tradeLogs);
  const forceCloseTradeLog = useAppStore((s) => s.forceCloseTradeLog);
  useEffect(() => {
    for (const [key, history] of Object.entries(tradeLogsRaw)) {
      if (!key.startsWith("LEVELCROSS-")) continue;
      if (key === STABLE_KEY.CRUDEOIL || key === STABLE_KEY.NATURALGAS) continue;
      const last = history[history.length - 1];
      if (last && !last.closed) forceCloseTradeLog(key);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tradeLogsRaw]);

  const crudeOil = useHitScoreSuite("CRUDEOIL", journalSummary.winRate);
  const naturalGas = useHitScoreSuite("NATURALGAS", journalSummary.winRate);
  const suites: Record<TradableSymbol, ReturnType<typeof useHitScoreSuite>> = { CRUDEOIL: crudeOil, NATURALGAS: naturalGas };

  const signalsBySymbol = useMemo(() => {
    const out: Record<string, LevelCrossSignal[]> = {};
    for (const symbol of SYMBOLS) {
      out[symbol] = suites[symbol].entries.map((e) => evaluateLevelCross(e.candles, e.tf, e.label));
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crudeOil.entries, naturalGas.entries]);

  const best: Record<string, LevelCrossSignal | null> = {};
  const misses: Record<string, LevelCrossSignal[]> = {};
  // The exact same candle series each signal was computed from -- so any
  // price line drawn on the chart (the level, the target) lines up with the
  // bars actually shown, rather than a mismatched fixed timeframe. Falls
  // back to the 15-minute series when nothing qualifies yet, so the chart
  // still has something real to show for a near-miss.
  const chartCandles: Record<string, Candle[]> = {};
  for (const symbol of SYMBOLS) {
    best[symbol] = pickBest(signalsBySymbol[symbol]);
    misses[symbol] = nearMisses(signalsBySymbol[symbol]);
    const chartTf = best[symbol]?.tf ?? misses[symbol][0]?.tf ?? suites[symbol].entries[0]?.tf;
    chartCandles[symbol] = suites[symbol].entries.find((e) => e.tf === chartTf)?.candles ?? suites[symbol].entries[0]?.candles ?? [];
  }

  const projections: Record<string, LevelCrossProjection | null> = {};
  for (const symbol of SYMBOLS) {
    const sig = best[symbol];
    if (sig && sig.optSide && sig.underlyingEntry !== null && sig.underlyingStop !== null && sig.underlyingTargets) {
      const proj = projectFromUnderlying(sig.optSide, sig.underlyingEntry, sig.underlyingStop, sig.underlyingTargets, suites[symbol].options);
      projections[symbol] = proj ? { strike: proj.strike, optSide: sig.optSide, entry: proj.entry, targets: proj.targets, stop: proj.stop } : null;
    } else {
      projections[symbol] = null;
    }
  }

  // Stable per-symbol key, NOT suffixed by timeframe -- the same pattern
  // Best Call already uses for its own three source engines. Which
  // timeframe currently has the highest-confidence break can change poll
  // to poll (a 15m break today, a 4H break tomorrow); a key that varied
  // with it would silently orphan a still-open trade the moment a
  // different timeframe took the lead, freezing its live tracking forever
  // instead of continuing to advance it. advanceTradeLog already only ever
  // opens a fresh entry when nothing is currently open, so a stable key
  // can't accidentally double-open either.
  const meta = (sig: LevelCrossSignal | null) =>
    sig?.level
      ? { label: `Level Cross (${sig.label})`, reasons: sig.reasons, confirmingTimeframes: [] as string[] }
      : undefined;
  const crudeLog = useEliteTradeLog(STABLE_KEY.CRUDEOIL, best.CRUDEOIL?.decision ?? null, best.CRUDEOIL?.optSide ?? null, projections.CRUDEOIL, crudeOil.options, meta(best.CRUDEOIL));
  const ngLog = useEliteTradeLog(STABLE_KEY.NATURALGAS, best.NATURALGAS?.decision ?? null, best.NATURALGAS?.optSide ?? null, projections.NATURALGAS, naturalGas.options, meta(best.NATURALGAS));

  const anyLiveDataUnavailable = crudeOil.liveDataUnavailable || naturalGas.liveDataUnavailable;

  return {
    best,
    misses,
    projections,
    chartCandles,
    tradeLogs: { CRUDEOIL: crudeLog, NATURALGAS: ngLog },
    trackingKey: STABLE_KEY,
    forceCloseTradeLog,
    options: { CRUDEOIL: crudeOil.options, NATURALGAS: naturalGas.options },
    anyLiveDataUnavailable,
  };
}
