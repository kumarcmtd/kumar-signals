import { useEffect, useRef } from "react";
import {
  createChart,
  createSeriesMarkers,
  ColorType,
  CandlestickSeries,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
  type IPriceLine,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type Time,
} from "lightweight-charts";
import type { Candle } from "../types";

interface PriceLineSpec {
  price: number;
  color: string;
  title: string;
}

export interface ChartMarkerSpec {
  timeMs: number;
  color: string;
  shape: "circle" | "square" | "arrowUp" | "arrowDown";
  text: string;
  position?: "aboveBar" | "belowBar" | "inBar";
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
  markers,
  height = 260,
  theme = "dark",
}: {
  candles: Candle[];
  priceLines: PriceLineSpec[];
  ema20?: number[];
  markers?: ChartMarkerSpec[];
  height?: number;
  theme?: "dark" | "light";
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const emaSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const linesRef = useRef<IPriceLine[]>([]);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const isLight = theme === "light";
    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: isLight ? "#ffffff" : "#12131C" },
        textColor: isLight ? "#64748b" : "#9AA4B2",
      },
      grid: {
        vertLines: { color: isLight ? "#f1f5f9" : "rgba(255,255,255,.04)" },
        horzLines: { color: isLight ? "#f1f5f9" : "rgba(255,255,255,.04)" },
      },
      width: containerRef.current.clientWidth,
      height,
      timeScale: { timeVisible: true, borderColor: isLight ? "#e2e8f0" : "rgba(255,255,255,.08)" },
      rightPriceScale: { borderColor: isLight ? "#e2e8f0" : "rgba(255,255,255,.08)" },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: isLight ? "#16a34a" : "#00E676",
      downColor: isLight ? "#dc2626" : "#FF4D4F",
      borderVisible: false,
      wickUpColor: isLight ? "#16a34a" : "#00E676",
      wickDownColor: isLight ? "#dc2626" : "#FF4D4F",
    });
    const emaSeries = chart.addSeries(LineSeries, { color: "#7C4DFF", lineWidth: 1 });
    chartRef.current = chart;
    seriesRef.current = series;
    emaSeriesRef.current = emaSeries;
    markersRef.current = createSeriesMarkers(series, []);

    const handleResize = () => chart.applyOptions({ width: containerRef.current?.clientWidth ?? 320 });
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      emaSeriesRef.current = null;
      markersRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [height, theme]);

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

  // Snapped to the candle AT OR BEFORE each marker's real timestamp -- a
  // marker time that falls between two bars (which it always will, since a
  // call rarely opens exactly on a candle boundary) would otherwise render
  // nothing, so this finds the bar the call was actually inside when it fired.
  useEffect(() => {
    if (!markersRef.current || !candles.length) return;
    if (!markers || !markers.length) {
      markersRef.current.setMarkers([]);
      return;
    }
    const barTimes = candles.map((c) => Math.floor(new Date(c.date).getTime() / 1000));
    const out: SeriesMarker<Time>[] = [];
    for (const m of markers) {
      const targetSec = Math.floor(m.timeMs / 1000);
      let snapped = barTimes[0];
      for (const t of barTimes) {
        if (t > targetSec) break;
        snapped = t;
      }
      out.push({ time: snapped as UTCTimestamp, position: m.position ?? "aboveBar", color: m.color, shape: m.shape, text: m.text });
    }
    out.sort((a, b) => (a.time as number) - (b.time as number));
    markersRef.current.setMarkers(out);
  }, [markers, candles]);

  return <div ref={containerRef} className="w-full rounded-xl overflow-hidden" />;
}
