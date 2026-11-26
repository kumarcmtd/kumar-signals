// Drawings lightweight-charts has no built-in shape for: buyer / seller zone
// boxes, and a star for every page's call with the page's letter inside it.
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
  /** The page's code drawn inside the star ("B", "20", "L"). */
  code: string;
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

/** Five-point star path around (cx, cy); a fuller star than usual so a letter fits inside. */
function star(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.beginPath();
  for (let k = 0; k < 10; k++) {
    const rad = k % 2 === 0 ? r : r * 0.52;
    const a = -Math.PI / 2 + (k * Math.PI) / 5;
    const x = cx + rad * Math.cos(a);
    const y = cy + rad * Math.sin(a);
    if (k === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/** Star size: radius on screen, normal and tapped. */
export const STAR_R = 11;
const STAR_R_SELECTED = 13;

/**
 * How far to move each star so none sits on another (two pages calling on the
 * same candle, or close by): a CE star steps up, a PE star down, one star
 * height at a time, until it is clear. Returns the y shift for each point.
 */
export function spreadStars(points: { x: number; y: number; side: "CE" | "PE"; r: number }[]): number[] {
  const placed: { x: number; y: number; r: number }[] = [];
  return points.map((p) => {
    const step = (p.side === "CE" ? -1 : 1) * (2 * STAR_R + 1);
    let k = 0;
    while (k < 4 && placed.some((o) => Math.hypot(o.x - p.x, o.y - (p.y + k * step)) < o.r + p.r - 3)) k++;
    placed.push({ x: p.x, y: p.y + k * step, r: p.r });
    return k === 0 ? 0 : k * step;
  });
}

interface Placed {
  m: StarMark;
  /** Where the star is drawn, and the candle / price it was called at. */
  x: number;
  y: number;
  priceY: number;
  r: number;
}

export class StarsPrimitive extends Base<StarMark> {
  selected: string | null = null;

  constructor() {
    super("top");
  }

  private layout(): Placed[] {
    const chart = this.chart;
    const series = this.series;
    if (!chart || !series) return [];
    const pts = this.items.flatMap((m) => {
      const x = chart.timeScale().timeToCoordinate(m.time);
      const y = series.priceToCoordinate(m.price);
      return x === null || y === null ? [] : [{ m, x, y, side: m.side, r: this.selected === m.id ? STAR_R_SELECTED : STAR_R }];
    });
    const dy = spreadStars(pts);
    return pts.map((p, i) => ({ m: p.m, x: p.x, y: p.y + dy[i], priceY: p.y, r: p.r }));
  }

  /** The star nearest a tap at (x, y) within `within` px, as drawn (after stacking), or null. */
  nearest(x: number, y: number, within: number): string | null {
    let best: { id: string; d: number } | null = null;
    for (const p of this.layout()) {
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < within && (!best || d < best.d)) best = { id: p.m.id, d };
    }
    return best?.id ?? null;
  }

  protected draw(target: Target) {
    const placed = this.layout();
    if (!placed.length) return;
    target.useMediaCoordinateSpace(({ context: ctx }) => {
      ctx.save();
      const colOf = (m: StarMark) => (m.side === "CE" ? "#16A34A" : "#DC2626");
      // In layers -- stems, then rings, then the stars with their letters -- so
      // one call's stem or see-through ring never covers another call's letter.
      for (const { m, x, y, priceY, r } of placed) {
        // A star moved off a crowded spot keeps a thin stem to the price it was called at.
        if (y === priceY) continue;
        ctx.beginPath();
        ctx.moveTo(x, priceY);
        ctx.lineTo(x, y + (y < priceY ? r : -r));
        ctx.lineWidth = 1;
        ctx.strokeStyle = colOf(m);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x, priceY, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = colOf(m);
        ctx.fill();
      }
      for (const { m, x, y, r } of placed) {
        if (this.selected !== m.id && !m.live) continue;
        ctx.beginPath();
        ctx.arc(x, y, r + 4, 0, Math.PI * 2);
        ctx.fillStyle = m.side === "CE" ? "rgba(22,163,74,.2)" : "rgba(220,38,38,.2)";
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = colOf(m);
        ctx.stroke();
      }
      for (const { m, x, y, r } of placed) {
        const col = colOf(m);
        star(ctx, x, y, r);
        ctx.fillStyle = m.practice ? "#FFFFFF" : col;
        ctx.fill();
        ctx.lineWidth = m.practice ? 2 : 1.5;
        ctx.strokeStyle = m.practice ? col : "#FFFFFF";
        ctx.stroke();
        // The page's code inside the star: B, 20, L, T ...
        ctx.font = `900 ${m.code.length > 1 ? 8 : 10}px system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        // A thin halo in the star's own colour keeps "20" / "V2" sharp where it runs into the points.
        ctx.lineJoin = "round";
        ctx.lineWidth = 2;
        ctx.strokeStyle = m.practice ? "#FFFFFF" : col;
        ctx.strokeText(m.code, x, y + 1);
        ctx.fillStyle = m.practice ? col : "#FFFFFF";
        ctx.fillText(m.code, x, y + 1);
      }
      ctx.restore();
    });
  }
}
