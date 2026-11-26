// Drawings lightweight-charts has no built-in shape for: buyer / seller zone
// boxes, and a star for every page's call with the page's name beside it.
// Both are series primitives -- they ask the chart where a time and a price
// sit on screen, so they move with zoom and scroll.

import type { IChartApi, IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesApi, ISeriesPrimitive, SeriesAttachedParameter, Time, UTCTimestamp } from "lightweight-charts";

type Target = Parameters<IPrimitivePaneRenderer["draw"]>[0];

export interface ZoneBox {
  /** Chart time where the box starts (null = from the left edge). */
  from: UTCTimestamp | null;
  low: number;
  high: number;
  fill: string;
  stroke: string;
  label: string;
}

export interface StarMark {
  id: string;
  time: UTCTimestamp;
  price: number;
  side: "CE" | "PE";
  tag: string;
  practice: boolean;
  /** Still running: drawn with a ring. */
  live?: boolean;
}

abstract class Base<T> implements ISeriesPrimitive<Time> {
  protected chart: IChartApi | null = null;
  protected series: ISeriesApi<"Candlestick"> | null = null;
  private request: (() => void) | null = null;
  protected items: T[] = [];
  private views: IPrimitivePaneView[];

  constructor(z: "bottom" | "top") {
    const renderer: IPrimitivePaneRenderer = { draw: (t) => this.draw(t) };
    this.views = [{ zOrder: () => z, renderer: () => renderer }];
  }

  attached(p: SeriesAttachedParameter<Time>) {
    this.chart = p.chart as IChartApi;
    this.series = p.series as ISeriesApi<"Candlestick">;
    this.request = p.requestUpdate;
  }

  detached() {
    this.chart = null;
    this.series = null;
    this.request = null;
  }

  paneViews() {
    return this.views;
  }

  set(items: T[]) {
    this.items = items;
    this.request?.();
  }

  protected abstract draw(target: Target): void;
}

export class ZonesPrimitive extends Base<ZoneBox> {
  constructor() {
    super("bottom");
  }

  protected draw(target: Target) {
    const chart = this.chart;
    const series = this.series;
    if (!chart || !series || !this.items.length) return;
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      for (const z of this.items) {
        const yTop = series.priceToCoordinate(z.high);
        const yBot = series.priceToCoordinate(z.low);
        if (yTop === null || yBot === null) continue;
        const x0 = z.from === null ? 0 : (chart.timeScale().timeToCoordinate(z.from) ?? 0);
        const top = Math.min(yTop, yBot);
        const h = Math.max(2, Math.abs(yBot - yTop));
        ctx.fillStyle = z.fill;
        ctx.fillRect(x0, top, mediaSize.width - x0, h);
        ctx.strokeStyle = z.stroke;
        ctx.lineWidth = 1;
        ctx.strokeRect(x0 + 0.5, top + 0.5, mediaSize.width - x0 - 1, h - 1);
        // Label on a white pill so a level line through the zone cannot strike it out.
        ctx.font = "800 10px system-ui, sans-serif";
        const w = ctx.measureText(z.label).width + 8;
        ctx.fillStyle = "rgba(255,255,255,.88)";
        ctx.fillRect(x0 + 2, top + 2, w, 13);
        ctx.fillStyle = z.stroke;
        ctx.fillText(z.label, x0 + 6, top + 12);
      }
    });
  }
}

/** Five-point star path around (cx, cy). */
function star(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.beginPath();
  for (let k = 0; k < 10; k++) {
    const rad = k % 2 === 0 ? r : r * 0.45;
    const a = -Math.PI / 2 + (k * Math.PI) / 5;
    const x = cx + rad * Math.cos(a);
    const y = cy + rad * Math.sin(a);
    if (k === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

export class StarsPrimitive extends Base<StarMark> {
  selected: string | null = null;

  constructor() {
    super("top");
  }

  all(): readonly StarMark[] {
    return this.items;
  }

  /** Screen position of a mark (for taps), or null when it is off screen. */
  where(m: StarMark): { x: number; y: number } | null {
    if (!this.chart || !this.series) return null;
    const x = this.chart.timeScale().timeToCoordinate(m.time);
    const y = this.series.priceToCoordinate(m.price);
    return x === null || y === null ? null : { x, y };
  }

  protected draw(target: Target) {
    if (!this.items.length) return;
    const stack = new Map<string, number>();
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      for (const m of this.items) {
        const p = this.where(m);
        if (!p) continue;
        const col = m.side === "CE" ? "#16A34A" : "#DC2626";
        const sel = this.selected === m.id;
        const r = sel ? 10 : 7.5;
        if (sel || m.live) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, sel ? 15 : 12, 0, Math.PI * 2);
          ctx.fillStyle = m.side === "CE" ? "rgba(22,163,74,.2)" : "rgba(220,38,38,.2)";
          ctx.fill();
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = col;
          ctx.stroke();
        }
        star(ctx, p.x, p.y, r);
        ctx.fillStyle = m.practice ? "#FFFFFF" : col;
        ctx.fill();
        ctx.lineWidth = m.practice ? 2 : 1.5;
        ctx.strokeStyle = m.practice ? col : "#FFFFFF";
        ctx.stroke();
        // The page's name in a pill; several calls on one candle stack upwards.
        const k = `${m.time}:${m.side}`;
        const n = stack.get(k) ?? 0;
        stack.set(k, n + 1);
        const text = `${m.practice ? "(P) " : ""}${m.tag}`;
        ctx.font = "800 10px system-ui, sans-serif";
        const w = ctx.measureText(text).width + 8;
        const right = p.x + w + 12 < mediaSize.width;
        const lx = right ? p.x + r + 3 : p.x - r - 3 - w;
        const ly = p.y - 7 - (m.side === "CE" ? 1 : -1) * n * 14 - (m.side === "CE" ? 6 : -6);
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.roundRect(lx, ly - 7, w, 14, 4);
        ctx.fill();
        ctx.fillStyle = "#FFFFFF";
        ctx.fillText(text, lx + 4, ly + 3.5);
      }
    });
  }
}
