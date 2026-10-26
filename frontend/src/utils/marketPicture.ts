// "Today's picture" for one market, from daily candles: where price sits in
// its range, whether it is at a many-month low or high, the daily trend and
// RSI -- and what that means for which side to favour today.
//
// The idea the trader put plainly: NG at a 24-month low has reversal room;
// crude after a long run-up can fall. At an extreme, the late sellers (or
// buyers) are the ones who get caught, so the page leans to the reversal
// side and treats the trend side as quick trades only.

import type { Candle } from "../types";
import { emaLast, rsi } from "./indicators";

export interface MarketPicture {
  days: number;
  rangeLow: number;
  rangeHigh: number;
  positionPct: number; // 0 = at the range low, 100 = at the high
  lowestInMonths: number | null; // today's close is the lowest in this many months
  highestInMonths: number | null;
  change5dPct: number | null;
  dailyRsi: number | null;
  trend: "up" | "down" | "sideways";
  tone: "reversal_up_watch" | "reversal_down_watch" | "trend_up" | "trend_down" | "range";
  favour: "CE" | "PE" | null;
  headline: string;
  bullets: string[];
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** How many months back today's close is the lowest (or highest) close; null if not even the lowest of the last 20 days. */
function extremeMonths(closes: number[], low: boolean): number | null {
  const last = closes[closes.length - 1];
  let i = closes.length - 2;
  while (i >= 0 && (low ? closes[i] >= last : closes[i] <= last)) i--;
  const days = closes.length - 2 - i;
  if (days < 20) return null;
  return r1(days / 21);
}

/**
 * @param livePrice today's live futures price. Daily candles end at the last
 * finished day, so without it the picture (and the range pointer) froze at
 * yesterday's close -- even when today had already broken the range.
 */
export function marketPicture(raw: Candle[], livePrice?: number | null, now: number = Date.now()): MarketPicture | null {
  let c = [...raw].sort((a, b) => a.date.localeCompare(b.date));
  if (c.length < 40) return null;
  if (livePrice != null && Number.isFinite(livePrice) && livePrice > 0) {
    const istDay = (ms: number) => new Date(ms + 5.5 * 3600_000).toISOString().slice(0, 10);
    const last = c[c.length - 1];
    if (istDay(Date.parse(last.date)) === istDay(now)) {
      c = [...c.slice(0, -1), { ...last, close: livePrice, high: Math.max(last.high, livePrice), low: Math.min(last.low, livePrice) }];
    } else {
      c = [...c, { date: new Date(now).toISOString(), open: last.close, high: Math.max(last.close, livePrice), low: Math.min(last.close, livePrice), close: livePrice }];
    }
  }
  const closes = c.map((k) => k.close);
  const last = closes[closes.length - 1];
  const rangeLow = Math.min(...c.map((k) => k.low));
  const rangeHigh = Math.max(...c.map((k) => k.high));
  const positionPct = Math.round(((last - rangeLow) / Math.max(1e-9, rangeHigh - rangeLow)) * 100);
  const lowestInMonths = extremeMonths(closes, true);
  const highestInMonths = extremeMonths(closes, false);
  const change5dPct = closes.length > 5 ? r1(((last - closes[closes.length - 6]) / closes[closes.length - 6]) * 100) : null;
  const dailyRsi = rsi(closes);
  const e20 = emaLast(closes, 20);
  const e50 = emaLast(closes, 50);
  const trend: MarketPicture["trend"] = e20 !== null && e50 !== null ? (last > e20 && e20 > e50 ? "up" : last < e20 && e20 < e50 ? "down" : "sideways") : "sideways";
  const months = r1(c.length / 21);
  const bullets: string[] = [];
  let tone: MarketPicture["tone"];
  let favour: MarketPicture["favour"];
  let headline: string;

  const nearLow = positionPct <= 12 || (lowestInMonths ?? 0) >= 3;
  const nearHigh = positionPct >= 88 || (highestInMonths ?? 0) >= 3;
  if (nearLow) {
    tone = "reversal_up_watch";
    favour = "CE";
    headline = lowestInMonths ? `Lowest close in ${lowestInMonths} months — reversal watch` : `Bottom ${positionPct}% of its ${months}-month range — reversal watch`;
    bullets.push("At an extreme low, late sellers get trapped when it turns. Favour CE on a confirmed turn (a strong green candle off a buyer zone).");
    bullets.push("PE only as quick trades with tight stops — the big fall has mostly happened.");
  } else if (nearHigh) {
    tone = "reversal_down_watch";
    favour = "PE";
    headline = highestInMonths ? `Highest close in ${highestInMonths} months — pullback watch` : `Top ${100 - positionPct}% of its ${months}-month range — pullback watch`;
    bullets.push("After a long run-up, late buyers get trapped when it turns. Favour PE on a confirmed turn (a strong red candle off a seller zone).");
    bullets.push("CE only as quick trades with tight stops — most of the rise has happened.");
  } else if (trend === "up") {
    tone = "trend_up";
    favour = "CE";
    headline = "Daily uptrend — buy the dips";
    bullets.push("Price above a rising 20-day average. Favour CE on pullbacks to support; avoid chasing green spikes.");
  } else if (trend === "down") {
    tone = "trend_down";
    favour = "PE";
    headline = "Daily downtrend — sell the rallies";
    bullets.push("Price below a falling 20-day average. Favour PE on bounces into resistance; avoid chasing red spikes.");
  } else {
    tone = "range";
    favour = null;
    headline = "No clear daily trend — range day";
    bullets.push("Mid-range and no daily trend: take only the clearest short-timeframe calls, book quickly.");
  }
  if (dailyRsi !== null && dailyRsi <= 30) bullets.push(`Daily RSI ${dailyRsi.toFixed(0)} — oversold; sharp short-covering bounces are likely.`);
  if (dailyRsi !== null && dailyRsi >= 70) bullets.push(`Daily RSI ${dailyRsi.toFixed(0)} — overbought; sharp profit-taking drops are likely.`);
  if (change5dPct !== null) bullets.push(`Last 5 days: ${change5dPct > 0 ? "+" : ""}${change5dPct}%.`);
  return { days: c.length, rangeLow, rangeHigh, positionPct, lowestInMonths, highestInMonths, change5dPct, dailyRsi, trend, tone, favour, headline, bullets };
}
