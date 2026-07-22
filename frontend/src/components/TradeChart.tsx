import { useEffect, useRef } from "react";
import { createChart, ColorType, CandlestickSeries, LineSeries, type IChartApi, type ISeriesApi, type UTCTimestamp, type IPriceLine } from "lightweight-charts";
import type { Candle } from "../types";

interface PriceLineSpec {
  price: number;
  color: string;
  title: string;
}

// A self-drawn candlestick chart (lightweight-charts, already a project
// dependency) rather than the embedded TradingView widget -- the free
// TradingView widget is a locked iframe with no API to draw our own
// entry/stop/target lines on it. This gives full control to actually plot
// those levels, which the TradingView embed alongside it cannot do.
export function TradeChart({
  candles,
  priceLines,
  ema20,
  height = 260,
}: {
  candles: Candle[];
  priceLines: PriceLineSpec[];
  ema20?: number[];
  height?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const emaSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const linesRef = useRef<IPriceLine[]>([]);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      layout: { background: { type: ColorType.Solid, color: "#12131C" }, textColor: "#9AA4B2" },
      grid: { vertLines: { color: "rgba(255,255,255,.04)" }, horzLines: { color: "rgba(255,255,255,.04)" } },
      width: containerRef.current.clientWidth,
      height,
      timeScale: { timeVisible: true, borderColor: "rgba(255,255,255,.08)" },
      rightPriceScale: { borderColor: "rgba(255,255,255,.08)" },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#00E676",
      downColor: "#FF4D4F",
      borderVisible: false,
      wickUpColor: "#00E676",
      wickDownColor: "#FF4D4F",
    });
    const emaSeries = chart.addSeries(LineSeries, { color: "#7C4DFF", lineWidth: 1 });
    chartRef.current = chart;
    seriesRef.current = series;
    emaSeriesRef.current = emaSeries;

    const handleResize = () => chart.applyOptions({ width: containerRef.current?.clientWidth ?? 320 });
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      emaSeriesRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [height]);

  useEffect(() => {
    if (!seriesRef.current || !candles.length) return;
    const bars = candles.map((c) => ({
      time: Math.floor(new Date(c.date).getTime() / 1000) as UTCTimestamp,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));
    seriesRef.current.setData(bars);

    if (emaSeriesRef.current && ema20 && ema20.length === candles.length) {
      emaSeriesRef.current.setData(
        candles.map((c, i) => ({ time: Math.floor(new Date(c.date).getTime() / 1000) as UTCTimestamp, value: ema20[i] }))
      );
    }
    chartRef.current?.timeScale().fitContent();
  }, [candles, ema20]);

  useEffect(() => {
    if (!seriesRef.current) return;
    for (const line of linesRef.current) seriesRef.current.removePriceLine(line);
    linesRef.current = priceLines.map((p) =>
      seriesRef.current!.createPriceLine({ price: p.price, color: p.color, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: p.title })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [priceLines]);

  return <div ref={containerRef} className="w-full rounded-xl overflow-hidden" />;
}
