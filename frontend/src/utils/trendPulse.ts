// Trend Pulse -- is the move STEADY, or are the small candles flipping?
//
// The 15-minute decision can say BUY while the 5-minute candles underneath
// go up-down-up-down. Entering then is how a call gets stopped out the moment
// after entry. This reads the last six CLOSED 5-minute candles (30 minutes):
//   STEADY UP / DOWN  most candles one way, higher highs (lower lows), price
//                     on one side of its 9-EMA -- a clean, continuing move.
//   BUILDING          leaning one way but not clean yet.
//   CHOPPY            candles flip, price keeps crossing its 9-EMA -- doubt.
//   FLAT              little movement.
// Separately, STRETCHED flags price already far from its 5-minute 20-EMA:
// the move may be real but most of it has happened, and the usual next step
// is a pullback -- which is exactly when late entries get stopped.
// All of it is arithmetic on finished candles plus the live price.

import type { Candle } from "../types";
import { atr, emaLast } from "./indicators";
import { sessionBucketStart } from "./candleResample";

export type PulseState = "STEADY_UP" | "STEADY_DOWN" | "BUILDING_UP" | "BUILDING_DOWN" | "CHOPPY" | "FLAT";

export interface TrendPulse {
  state: PulseState;
  title: string;
  detail: string;
  bars: ("up" | "down" | "flat")[]; // the last six closed 5-minute candles, oldest first
  stretched: { side: "up" | "down"; atrs: number; pullbackTo: number } | null;
}

const WINDOW = 6;

function emaSeries(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const out: number[] = [];
  values.forEach((v, i) => out.push(i === 0 ? v : v * k + out[i - 1] * (1 - k)));
  return out;
}

export function trendPulse(c5: Candle[], now: number, livePrice?: number | null): TrendPulse | null {
  const formingStart = sessionBucketStart(now, 5);
  const closed = [...c5].filter((c) => Date.parse(c.date) < formingStart).sort((a, b) => a.date.localeCompare(b.date));
  if (closed.length < 30) return null;
  const a = atr(closed, 14);
  if (!a || a <= 0) return null;

  const win = closed.slice(-WINDOW);
  const bars = win.map((c) => (c.close > c.open + a * 0.05 ? "up" : c.close < c.open - a * 0.05 ? "down" : "flat")) as TrendPulse["bars"];
  const ups = bars.filter((b) => b === "up").length;
  const downs = bars.filter((b) => b === "down").length;

  let hhhl = 0;
  let lhll = 0;
  for (let i = 1; i < win.length; i++) {
    if (win[i].high > win[i - 1].high && win[i].low > win[i - 1].low) hhhl++;
    if (win[i].high < win[i - 1].high && win[i].low < win[i - 1].low) lhll++;
  }

  const closes = closed.map((c) => c.close);
  const e9 = emaSeries(closes, 9).slice(-WINDOW);
  let crosses = 0;
  for (let i = 1; i < WINDOW; i++) if (Math.sign(win[i].close - e9[i]) !== Math.sign(win[i - 1].close - e9[i - 1])) crosses++;
  const above = win[WINDOW - 1].close > e9[WINDOW - 1];

  const net = (win[WINDOW - 1].close - closed[closed.length - 1 - WINDOW].close) / a; // in ATRs over 30 minutes

  let state: PulseState;
  if (net >= 1 && ups >= 4 && hhhl >= 3 && crosses <= 1 && above) state = "STEADY_UP";
  else if (net <= -1 && downs >= 4 && lhll >= 3 && crosses <= 1 && !above) state = "STEADY_DOWN";
  else if (crosses >= 2 || (ups >= 2 && downs >= 2 && Math.abs(net) < 1)) state = "CHOPPY";
  else if (net >= 0.5 && ups > downs) state = "BUILDING_UP";
  else if (net <= -0.5 && downs > ups) state = "BUILDING_DOWN";
  else state = "FLAT";

  const price = livePrice ?? closes[closes.length - 1];
  const e20 = emaLast(closes, 20);
  let stretched: TrendPulse["stretched"] = null;
  if (e20 !== null) {
    const dist = (price - e20) / a;
    if (Math.abs(dist) >= 2.2) stretched = { side: dist > 0 ? "up" : "down", atrs: Math.round(Math.abs(dist) * 10) / 10, pullbackTo: Math.round(e20 * 100) / 100 };
  }

  const n = (k: number, w: string) => `${k} of the last ${WINDOW} five-minute candles ${w}`;
  const copy: Record<PulseState, { title: string; detail: string }> = {
    STEADY_UP: { title: "STEADY UP", detail: `${n(ups, "closed up")}, higher highs and lows, price holding above its 9-EMA.` },
    STEADY_DOWN: { title: "STEADY DOWN", detail: `${n(downs, "closed down")}, lower highs and lows, price holding below its 9-EMA.` },
    BUILDING_UP: { title: "BUILDING UP", detail: "Leaning up over the last 30 minutes, but not a clean run yet." },
    BUILDING_DOWN: { title: "BUILDING DOWN", detail: "Leaning down over the last 30 minutes, but not a clean run yet." },
    CHOPPY: { title: "CHOPPY — DOUBT", detail: `Small candles flipping up and down (${ups} up, ${downs} down, ${crosses} crosses of the 9-EMA). Wait for a steady run.` },
    FLAT: { title: "FLAT", detail: "Little movement over the last 30 minutes." },
  };
  return { state, ...copy[state], bars, stretched };
}
