import { useEffect, useRef } from "react";
import { createChart, ColorType, CandlestickSeries, type IChartApi, type ISeriesApi, type UTCTimestamp } from "lightweight-charts";
import { useAppStore } from "../store/appStore";
import { useCandles, useScan } from "../api/hooks";
import { TechnicalAnalysisPanel } from "../components/TechnicalAnalysisPanel";

const TIMEFRAMES: { value: "5" | "15" | "30" | "1D"; label: string }[] = [
  { value: "5", label: "5m" },
  { value: "15", label: "15m" },
  { value: "30", label: "30m" },
  { value: "1D", label: "1D" },
];

export function Charts() {
  const { selectedInstrument, setSelectedInstrument, selectedTimeframe, setSelectedTimeframe } = useAppStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);

  const { data: candleData, isLoading: candlesLoading, error: candlesError } = useCandles(selectedInstrument, selectedTimeframe);
  const { data: scan } = useScan(selectedInstrument, selectedTimeframe, true);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      layout: { background: { type: ColorType.Solid, color: "#ffffff" }, textColor: "#0f172a" },
      grid: { vertLines: { color: "#f1f5f9" }, horzLines: { color: "#f1f5f9" } },
      width: containerRef.current.clientWidth,
      height: 320,
      timeScale: { timeVisible: true },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#16a34a",
      downColor: "#dc2626",
      borderVisible: false,
      wickUpColor: "#16a34a",
      wickDownColor: "#dc2626",
    });
    chartRef.current = chart;
    seriesRef.current = series;

    const handleResize = () => chart.applyOptions({ width: containerRef.current?.clientWidth ?? 320 });
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!seriesRef.current || !candleData?.candles?.length) return;
    const bars = candleData.candles.map((c) => ({
      time: Math.floor(new Date(c.date).getTime() / 1000) as UTCTimestamp,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));
    seriesRef.current.setData(bars);
    chartRef.current?.timeScale().fitContent();
  }, [candleData]);

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {(["CRUDEOIL", "NATURALGAS"] as const).map((sym) => (
          <button
            key={sym}
            onClick={() => setSelectedInstrument(sym)}
            className={`flex-1 rounded-xl py-2 text-sm font-bold ${
              selectedInstrument === sym
                ? "bg-gradient-to-r from-orange-500 to-pink-600 text-white"
                : "bg-white text-[var(--color-muted)] card"
            }`}
          >
            {sym}
          </button>
        ))}
      </div>

      <div className="flex gap-2">
        {TIMEFRAMES.map((tf) => (
          <button
            key={tf.value}
            onClick={() => setSelectedTimeframe(tf.value)}
            className={`flex-1 rounded-lg py-1.5 text-xs font-bold border ${
              selectedTimeframe === tf.value
                ? "bg-[var(--color-primary)] text-white border-transparent"
                : "bg-white text-[var(--color-muted)] border-[var(--color-border)]"
            }`}
          >
            {tf.label}
          </button>
        ))}
      </div>

      <div className="card p-2 relative">
        <div ref={containerRef} />
        {candlesLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/70 text-xs text-[var(--color-muted)]">
            Loading candles…
          </div>
        )}
        {candlesError && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/90 text-xs text-[var(--color-sell)] px-4 text-center">
            {(candlesError as Error).message}
          </div>
        )}
      </div>

      {scan && !("error" in scan) && (
        <div className="card p-4 text-sm space-y-1">
          <p className="font-bold">{scan.pattern?.pattern}</p>
          <p className="text-[var(--color-muted)]">{scan.pattern?.note}</p>
        </div>
      )}

      {candleData?.candles && <TechnicalAnalysisPanel candles={candleData.candles} />}

      <p className="text-[11px] text-[var(--color-muted)] px-1">
        Drawing tools (trend lines, Fibonacci) are planned for a follow-up build — this view currently renders live
        candles and indicators only.
      </p>
    </div>
  );
}
