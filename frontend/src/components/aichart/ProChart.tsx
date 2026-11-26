// The Ai-Chart canvas: candles + volume you can pinch, zoom and scroll, with
// the support / rejection levels as coloured lines, buyer / seller zones as
// boxes, pivots, the trend channel, and every page's call as a star. Times on
// the axis are IST.

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { createChart, CandlestickSeries, ColorType, HistogramSeries, LineSeries, LineStyle, type IChartApi, type IPriceLine, type ISeriesApi, type UTCTimestamp } from "lightweight-charts";
import type { Candle } from "../../types";
import type { SrLevel } from "../../utils/srLevels";
import type { KeyLevels } from "../../utils/checklist";
import type { Channel } from "../../utils/chartMarks";
import { StarsPrimitive, ZonesPrimitive, type StarMark, type ZoneBox } from "./primitives";
import { chartTime, LEVEL_STYLE } from "./chartStyle";

export interface ProChartProps {
  candles: Candle[];
  /** Changes when the market or timeframe changes: the view refits then, not on every refresh. */
  viewKey: string;
  levels: SrLevel[];
  pivots: KeyLevels | null;
  zones: ZoneBox[];
  channel: Channel | null;
  stars: StarMark[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  decimals: number;
}

export interface ProChartHandle {
  focus: (time: UTCTimestamp) => void;
}

export const ProChart = forwardRef<ProChartHandle, ProChartProps>(function ProChart(p, ref) {
  const box = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const chanRef = useRef<ISeriesApi<"Line">[]>([]);
  const linesRef = useRef<IPriceLine[]>([]);
  const zonesRef = useRef<ZonesPrimitive | null>(null);
  const starsRef = useRef<StarsPrimitive | null>(null);
  const fitted = useRef<string>("");
  const onSelect = useRef(p.onSelect);
  onSelect.current = p.onSelect;

  useEffect(() => {
    if (!box.current) return;
    const chart = createChart(box.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "#FFFFFF" }, textColor: "#475569", fontSize: 11 },
      grid: { vertLines: { color: "#F1F5F9" }, horzLines: { color: "#F1F5F9" } },
      timeScale: { timeVisible: true, secondsVisible: false, borderColor: "#E2E8F0", rightOffset: 6 },
      rightPriceScale: { borderColor: "#E2E8F0", scaleMargins: { top: 0.06, bottom: 0.17 } },
      crosshair: { mode: 0 },
    });
    const candles = chart.addSeries(CandlestickSeries, { upColor: "#16A34A", downColor: "#DC2626", borderVisible: false, wickUpColor: "#16A34A", wickDownColor: "#DC2626", priceLineColor: "#0F172A", priceLineStyle: LineStyle.Dotted });
    const vol = chart.addSeries(HistogramSeries, { priceScaleId: "vol", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.86, bottom: 0 } });
    chanRef.current = (["#F43F5E", "#334155", "#10B981"] as const).map((color, k) => chart.addSeries(LineSeries, { color, lineWidth: 1, lineStyle: k === 1 ? LineStyle.Dashed : LineStyle.Solid, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false }));
    const zones = new ZonesPrimitive();
    const stars = new StarsPrimitive();
    candles.attachPrimitive(zones);
    candles.attachPrimitive(stars);
    chart.subscribeClick((param) => {
      if (!param.point) return;
      onSelect.current(starsRef.current?.nearest(param.point.x, param.point.y, 22) ?? null);
    });
    chartRef.current = chart;
    candleRef.current = candles;
    volRef.current = vol;
    zonesRef.current = zones;
    starsRef.current = stars;
    return () => {
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      volRef.current = null;
      zonesRef.current = null;
      starsRef.current = null;
    };
  }, []);

  // Candles, volume and the channel.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !candleRef.current || !volRef.current || !p.candles.length) return;
    candleRef.current.setData(p.candles.map((c) => ({ time: chartTime(Date.parse(c.date)), open: c.open, high: c.high, low: c.low, close: c.close })));
    volRef.current.setData(p.candles.map((c) => ({ time: chartTime(Date.parse(c.date)), value: c.volume ?? 0, color: c.close >= c.open ? "rgba(22,163,74,.35)" : "rgba(220,38,38,.35)" })));
    candleRef.current.applyOptions({ priceFormat: { type: "price", precision: p.decimals, minMove: p.decimals ? 0.01 : 1 } });
    const ch = p.channel;
    const n = p.candles.length;
    const span = Math.min(n, 96);
    chanRef.current.forEach((s, k) => {
      if (!ch) return s.setData([]);
      const key = (["up", "mid", "dn"] as const)[k];
      const t0 = chartTime(Date.parse(p.candles[n - span].date));
      const t1 = chartTime(Date.parse(p.candles[n - 1].date));
      s.setData([
        { time: t0, value: ch.at(0)[key] },
        { time: t1, value: ch.at(span - 1)[key] },
      ]);
    });
    if (fitted.current !== p.viewKey) {
      fitted.current = p.viewKey;
      chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - 110), to: n + 4 });
    }
  }, [p.candles, p.channel, p.viewKey, p.decimals]);

  // Levels and pivots as price lines.
  useEffect(() => {
    const s = candleRef.current;
    if (!s) return;
    for (const l of linesRef.current) s.removePriceLine(l);
    const out: IPriceLine[] = [];
    for (const l of p.levels) {
      const st = LEVEL_STYLE[`${l.kind}-${l.tier}`];
      out.push(s.createPriceLine({ price: l.price, color: st.color, lineWidth: st.width, lineStyle: LineStyle.Solid, axisLabelVisible: true, title: `${st.title}×${l.holds}` }));
    }
    const pv = p.pivots;
    if (pv) {
      const thin = (price: number, color: string, title: string, style: LineStyle) => out.push(s.createPriceLine({ price, color, lineWidth: 1, lineStyle: style, axisLabelVisible: true, title }));
      thin(pv.pivot, "#94A3B8", "P", LineStyle.Dashed);
      thin(pv.r1, "#FB7185", "R1", LineStyle.Dashed);
      thin(pv.s1, "#34D399", "S1", LineStyle.Dashed);
      thin(pv.pdh, "#64748B", "PDH", LineStyle.Dotted);
      thin(pv.pdl, "#64748B", "PDL", LineStyle.Dotted);
    }
    linesRef.current = out;
  }, [p.levels, p.pivots]);

  useEffect(() => zonesRef.current?.set(p.zones), [p.zones]);
  useEffect(() => {
    const st = starsRef.current;
    if (!st) return;
    st.selected = p.selected;
    st.set(p.stars);
  }, [p.stars, p.selected]);

  useImperativeHandle(ref, () => ({
    focus: (time) => {
      const ts = chartRef.current?.timeScale();
      if (!ts) return;
      const idx = p.candles.findIndex((c) => chartTime(Date.parse(c.date)) >= time);
      if (idx >= 0) ts.setVisibleLogicalRange({ from: Math.max(0, idx - 50), to: idx + 50 });
    },
  }));

  return <div ref={box} className="w-full h-full" />;
});
