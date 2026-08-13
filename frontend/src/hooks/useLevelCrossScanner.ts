import { useMemo } from "react";
import { usePortfolio } from "../api/hooks";
import { computePortfolioSummary } from "../utils/portfolioStats";
import { useHitScoreSuite } from "./useHitScoreSuite";
import { useEliteTradeLog } from "./useTradeLog";
import { evaluateLevelCross, type LevelCrossSignal } from "../utils/levelCrossEngine";
import { projectFromUnderlying } from "../utils/bestCallSelector";
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

  const crudeLog = useEliteTradeLog(
    best.CRUDEOIL ? `LEVELCROSS-CRUDEOIL-${best.CRUDEOIL.tf}` : null,
    best.CRUDEOIL?.decision ?? null,
    best.CRUDEOIL?.optSide ?? null,
    projections.CRUDEOIL,
    crudeOil.options
  );
  const ngLog = useEliteTradeLog(
    best.NATURALGAS ? `LEVELCROSS-NATURALGAS-${best.NATURALGAS.tf}` : null,
    best.NATURALGAS?.decision ?? null,
    best.NATURALGAS?.optSide ?? null,
    projections.NATURALGAS,
    naturalGas.options
  );

  const anyLiveDataUnavailable = crudeOil.liveDataUnavailable || naturalGas.liveDataUnavailable;

  return {
    best,
    misses,
    projections,
    chartCandles,
    tradeLogs: { CRUDEOIL: crudeLog, NATURALGAS: ngLog },
    options: { CRUDEOIL: crudeOil.options, NATURALGAS: naturalGas.options },
    anyLiveDataUnavailable,
  };
}
