// How much has price ALREADY moved since a headline -- and is there room left?
//
// A big headline moves crude within seconds to minutes. Whether it is still
// worth trading depends on how much of that reaction has already happened.
// This measures the futures move from the last price before the headline to
// now (and the furthest it went), in units of a typical 1-hour range, and
// reads it as:
//   little reaction yet -> room may be left (if the story holds)
//   partly priced in    -> some room; wait for a pullback
//   big move done       -> most of a typical reaction is done; don't chase
//   spike faded         -> it ran, then gave most of it back
//   market ignoring it  -> price went the other way
// An estimate from the futures price, not the option premium, and not a
// forecast: a story can keep running, or reverse on the next headline.

import type { Candle } from "../types";
import { atr } from "./indicators";

export type RoomRead = "room_left" | "partly_priced" | "done" | "faded" | "ignored";

export interface NewsReaction {
  sinceAt: string; // the headline's time, IST HH:MM
  basePrice: number; // last price before the headline
  movePts: number; // now vs base, signed
  movePct: number;
  peakPts: number; // furthest in the news direction since the headline
  ranges: number; // move in the news direction, in typical 1-hour ranges
  read: RoomRead;
  text: string;
  gapFromClose: boolean; // the headline came while MCX was shut
}

const hhmm = (ms: number) => new Date(ms + 5.5 * 3600_000).toISOString().slice(11, 16);

/**
 * @param c5 5-minute futures candles (oldest first or any order)
 * @param publishedAt the headline's time
 * @param direction +1 bullish news, -1 bearish
 * @param livePrice the latest price (defaults to the last candle's close)
 */
export function newsReaction(c5: Candle[], publishedAt: string, direction: 1 | -1, livePrice?: number | null): NewsReaction | null {
  const t = Date.parse(publishedAt);
  if (!Number.isFinite(t) || c5.length < 20) return null;
  const sorted = [...c5].sort((a, b) => a.date.localeCompare(b.date));
  const beforeIdx = sorted.findLastIndex((c) => Date.parse(c.date) <= t);
  if (beforeIdx < 0) return null;
  const after = sorted.slice(beforeIdx + 1);
  const base = sorted[beforeIdx];
  // The candle the headline landed in: its open is the last price before it,
  // unless the headline came after that candle had closed (MCX shut).
  const landedInside = t < Date.parse(base.date) + 5 * 60_000;
  const basePrice = landedInside ? base.open : base.close;
  const window = landedInside ? [base, ...after] : after;
  if (window.length === 0) return null;

  const price = livePrice ?? sorted[sorted.length - 1].close;
  const a5 = atr(sorted.slice(0, beforeIdx + 1).slice(-60), 14) ?? atr(sorted, 14);
  if (!a5 || a5 <= 0) return null;
  const hourRange = a5 * Math.sqrt(12); // a typical 1-hour range from the 5-minute ATR

  const movePts = price - basePrice;
  const peakPts = direction > 0 ? Math.max(...window.map((c) => c.high)) - basePrice : basePrice - Math.min(...window.map((c) => c.low));
  const withNews = movePts * direction;
  const ranges = Math.round((withNews / hourRange) * 10) / 10;
  const peakRanges = peakPts / hourRange;

  let read: RoomRead;
  if (withNews < -0.3 * hourRange) read = "ignored";
  else if (peakRanges >= 1 && withNews < 0.5 * peakPts) read = "faded";
  else if (ranges >= 1.5) read = "done";
  else if (ranges >= 0.5) read = "partly_priced";
  else read = "room_left";

  const dirWord = direction > 0 ? "up" : "down";
  const texts: Record<RoomRead, string> = {
    room_left: `Little reaction yet — room may be left if the story holds. Enter only on steady 5-min candles ${dirWord}.`,
    partly_priced: "Partly priced in — some room may be left. Better on a pullback than chasing.",
    done: "Big move already happened — most of a typical reaction is done. Don't chase; premium is likely already high.",
    faded: "It spiked, then gave most of it back — the market sold the news. Don't trade the headline now.",
    ignored: `Price went the other way — the market is ignoring this story. Don't trade it ${dirWord}.`,
  };
  return {
    sinceAt: hhmm(t),
    basePrice: Math.round(basePrice * 100) / 100,
    movePts: Math.round(movePts * 100) / 100,
    movePct: Math.round((movePts / basePrice) * 10000) / 100,
    peakPts: Math.round(peakPts * 100) / 100,
    ranges,
    read,
    text: texts[read],
    gapFromClose: !landedInside,
  };
}
