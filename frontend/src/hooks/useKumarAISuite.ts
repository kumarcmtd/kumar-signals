import { useMemo } from "react";
import { useCandles, useOptionsAnalytics } from "../api/hooks";
import { computeIndicatorSnapshot } from "../utils/indicators";
import { detectCandlePattern, analyzeStructure } from "../utils/priceAction";
import { analyzeTimeframe, type TimeframeAnalysis } from "../utils/timeframeEngine";

export type KumarAiTradableSymbol = "CRUDEOIL" | "NATURALGAS";

// This page's OWN timeframe set, deliberately separate from the shared
// 4-timeframe TIMEFRAMES constant every other AI page in this app uses.
// 5-minute and 10-minute were dropped from every OTHER engine app-wide for
// being too noisy/high-loss -- but Kumar AI is a distinct, independent
// feature the user explicitly asked to include them in, so it keeps its
// own list rather than touching the shared one.
export const KUMAR_AI_TIMEFRAMES: { tf: string; label: string }[] = [
  { tf: "5", label: "5 Minutes" },
  { tf: "10", label: "10 Minutes" },
  { tf: "15", label: "15 Minutes" },
  { tf: "30", label: "30 Minutes" },
  { tf: "60", label: "1 Hour" },
  { tf: "240", label: "4 Hours" },
];

export interface KumarAiTimeframeSnapshot {
  tf: string;
  label: string;
  analysis: TimeframeAnalysis;
  ema9: number | null;
  ema20: number | null;
  ema50: number | null;
  ema200: number | null;
  rsi14: number | null;
  macd: { line: number; signal: number; histogram: number } | null;
  vwap: number | null;
  atr14: number | null;
  adx14: number | null;
  bollinger: { upper: number; middle: number; lower: number } | null;
  superTrend: { value: number; direction: string } | null;
  volumeRatio: number | null;
  structureLabel: string | null;
  patternLabel: string | null;
  supportResistanceNote: string | null;
  breakout: boolean;
  breakoutDirection: "bullish" | "bearish" | "neutral";
  changeOfCharacter: boolean;
}

const EMPTY_SNAPSHOT_FIELDS = {
  ema9: null,
  ema20: null,
  ema50: null,
  ema200: null,
  rsi14: null,
  macd: null,
  vwap: null,
  atr14: null,
  adx14: null,
  bollinger: null,
  superTrend: null,
  volumeRatio: null,
  structureLabel: null,
  patternLabel: null,
  supportResistanceNote: null,
  breakout: false,
  breakoutDirection: "neutral",
  changeOfCharacter: false,
} as const;

// Fetches live candles for one symbol across all 6 Kumar AI timeframes and
// runs each one through the SAME verified analyzeTimeframe() engine every
// other AI page in this app already uses (real EMA/RSI/MACD/VWAP/ATR/ADX/
// Bollinger/SuperTrend/structure/pattern/volume scoring), plus exposes the
// raw indicator readouts this page displays directly. Nothing here is
// computed by a language model -- the Workers AI call (triggered separately,
// per signal, from the page) only ever explains numbers already produced
// here, never invents them.
export function useKumarAISuite(symbol: KumarAiTradableSymbol, journalWinRate: number | null) {
  const c5 = useCandles(symbol, "5");
  const c10 = useCandles(symbol, "10");
  const c15 = useCandles(symbol, "15");
  const c30 = useCandles(symbol, "30");
  const c60 = useCandles(symbol, "60");
  const c240 = useCandles(symbol, "240");
  const c1D = useCandles(symbol, "1D");
  const optionsQ = useOptionsAnalytics(symbol);
  const { data: options, error: optionsError } = optionsQ;

  const queries = [c5, c10, c15, c30, c60, c240];
  const loading = queries.some((q) => q.isLoading);
  const liveDataUnavailable = !!optionsError || !!options?.error;
  const isFetching = queries.some((q) => q.isFetching) || optionsQ.isFetching;
  const dataUpdatedAt = Math.max(...queries.map((q) => q.dataUpdatedAt), optionsQ.dataUpdatedAt);
  const refetchAll = () => Promise.all([...queries.map((q) => q.refetch()), c1D.refetch(), optionsQ.refetch()]);

  const snapshots = useMemo<KumarAiTimeframeSnapshot[]>(() => {
    return KUMAR_AI_TIMEFRAMES.map(({ tf, label }, i) => {
      const candles = queries[i].data?.candles ?? [];
      const analysis = analyzeTimeframe({
        tf,
        label,
        candles,
        dailyCandles: c1D.data?.candles,
        options: liveDataUnavailable ? undefined : options,
        journalWinRate,
      });

      if (candles.length < 30) {
        return { tf, label, analysis, ...EMPTY_SNAPSHOT_FIELDS };
      }

      const snap = computeIndicatorSnapshot(candles);
      const pattern = detectCandlePattern(candles);
      const structure = analyzeStructure(candles);
      const last = candles[candles.length - 1];
      const recentVolumes = candles.slice(-11, -1).map((c) => c.volume ?? 0);
      const avgVolume = recentVolumes.length ? recentVolumes.reduce((s, v) => s + v, 0) / recentVolumes.length : 0;
      const volumeRatio = avgVolume > 0 ? Number(((last.volume ?? 0) / avgVolume).toFixed(2)) : null;
      const supportResistanceNote = analysis.categories?.supportResistance.notes.join("; ") || null;

      return {
        tf,
        label,
        analysis,
        ema9: snap.ema9,
        ema20: snap.ema20,
        ema50: snap.ema50,
        ema200: snap.ema200,
        rsi14: snap.rsi14,
        macd: snap.macd,
        vwap: snap.vwap,
        atr14: snap.atr14,
        adx14: snap.adx14,
        bollinger: snap.bollinger,
        superTrend: snap.superTrend,
        volumeRatio,
        structureLabel: structure.label,
        patternLabel: pattern.pattern !== "none" ? pattern.pattern : null,
        supportResistanceNote,
        breakout: structure.bos,
        breakoutDirection: structure.bosDirection,
        changeOfCharacter: structure.choch,
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, c5.data, c10.data, c15.data, c30.data, c60.data, c240.data, c1D.data, options, liveDataUnavailable, journalWinRate]);

  return { snapshots, options, loading, liveDataUnavailable, errorMessage: options?.error, isFetching, dataUpdatedAt, refetchAll };
}
