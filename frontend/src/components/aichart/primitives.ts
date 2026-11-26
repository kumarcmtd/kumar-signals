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
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      const shown = this.items.flatMap((m) => {
        const p = this.where(m);
        const sel = this.selected === m.id;
        return p ? [{ m, p, sel, r: sel ? 10 : 7.5, ring: sel ? 15 : m.live ? 12 : 8 }] : [];
      });
      for (const { m, p, sel, r } of shown) {
        const col = m.side === "CE" ? "#16A34A" : "#DC2626";
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
      }
      // Then the page's name in a pill beside each star -- clear of the other
      // stars and of the names already placed (live calls often sit close
      // together), and clear of the level names along the right edge.
      ctx.font = "800 10px system-ui, sans-serif";
      const stars: Box[] = shown.map(({ p, ring }) => ({ x: p.x - ring, y: p.y - ring, w: 2 * ring, h: 2 * ring }));
      const pills: Box[] = [];
      shown.forEach(({ m, p, r, ring }) => {
        const text = `${m.practice ? "(P) " : ""}${m.tag}`;
        // Its own star (and any other call on the very same spot) is not in the way.
        const others = stars.filter((_, j) => Math.abs(shown[j].p.x - p.x) > 2 || Math.abs(shown[j].p.y - p.y) > 2);
        const box = placePill(p, r, ctx.measureText(text).width + 8, m.side, mediaSize, [...others, ...pills]);
        pills.push(box);
        const col = m.side === "CE" ? "#16A34A" : "#DC2626";
        // A name that had to move away from its star gets a thin line back to it.
        const nx = Math.min(Math.max(p.x, box.x), box.x + box.w);
        const ny = Math.min(Math.max(p.y, box.y), box.y + box.h);
        const d = Math.hypot(nx - p.x, ny - p.y);
        if (d > ring + 4) {
          ctx.beginPath();
          ctx.moveTo(p.x + ((nx - p.x) * ring) / d, p.y + ((ny - p.y) * ring) / d);
          ctx.lineTo(nx, ny);
          ctx.lineWidth = 1;
          ctx.strokeStyle = col;
          ctx.stroke();
        }
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.roundRect(box.x, box.y, box.w, box.h, 4);
        ctx.fill();
        ctx.fillStyle = "#FFFFFF";
        ctx.fillText(text, box.x + 4, box.y + 10.5);
      });
    });
  }
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Room the level names ("S×15", "PDH") take at the pane's right edge. */
const NAMES_EDGE = 50;
const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Where a star's name pill goes: right of the star, else left; when both are
 * taken, one row further away (up for a CE call, down for a PE), then one row
 * the other way, and so on, until it hits nothing; failing that, the first
 * spot on screen.
 */
export function placePill(p: { x: number; y: number }, r: number, w: number, side: "CE" | "PE", size: { width: number; height: number }, avoid: Box[]): Box {
  const y0 = side === "CE" ? p.y - 20 : p.y - 8;
  const step = side === "CE" ? -15 : 15;
  const tries: Box[] = [];
  for (const k of [0, 1, -1, 2, -2, 3, -3, 4, 5]) for (const x of [p.x + r + 3, p.x - r - 3 - w]) tries.push({ x, y: y0 + k * step, w, h: 14 });
  const onScreen = (b: Box) => b.x >= 0 && b.x + b.w <= size.width - NAMES_EDGE && b.y >= 0 && b.y + b.h <= size.height;
  return tries.find((b) => onScreen(b) && !avoid.some((a) => overlaps(a, b))) ?? tries.find(onScreen) ?? tries[0];
}
