// The six pieces of evidence the Buy Decision page weighs, each read from
// CLOSED candles only. Every read returns a vote from -1 (bearish) to +1
// (bullish) and plain-English notes saying why, so the page can show its work.
//
// Built on the app's existing, tested indicators (utils/indicators.ts); no new
// maths is invented here, only how the readings are combined.

import type { Candle } from "../types";
import { adx, atr, emaLast, macd, rsi, superTrend, vwap } from "./indicators";
import { detectCandlePatterns } from "./candlePatterns";
import { analyzeSmartMoneyConcepts } from "./smartMoneyConcepts";

export type Side = "bull" | "bear" | "neutral";

export interface Note {
  text: string;
  side: Side;
}

export interface PillarRead {
  vote: number; // -1 .. +1
  notes: Note[];
  insufficient?: boolean;
}

const clamp = (v: number, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, v));
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const sideOf = (v: number, dead = 0.15): Side => (v > dead ? "bull" : v < -dead ? "bear" : "neutral");
const fmt = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 2 });

// ---- Candles ------------------------------------------------------------------

/** Drops the bar that is still forming. While MCX is shut, every bar is final. */
export function closedOnly(candles: Candle[], tfMin: number, now: number, marketOpen: boolean): Candle[] {
  if (!marketOpen || !candles.length) return candles;
  const last = candles[candles.length - 1];
  return Date.parse(last.date) + tfMin * 60_000 <= now ? candles : candles.slice(0, -1);
}

/** Bars that had closed by `cutoff` (bars are stamped with their start time). */
export function closedBy(candles: Candle[], tfMin: number, cutoff: number): Candle[] {
  let end = candles.length;
  while (end > 0 && Date.parse(candles[end - 1].date) + tfMin * 60_000 > cutoff) end--;
  return end === candles.length ? candles : candles.slice(0, end);
}

// ---- 1 & 2. Trend on one timeframe ----------------------------------------------

export interface TrendRead extends PillarRead {
  direction: Side;
}

export function readTrend(candles: Candle[], tfLabel: string): TrendRead {
  // EMA50 plus a few bars. (The app keeps ~20 days: about 56 four-hour bars.)
  if (candles.length < 52) {
    return { vote: 0, direction: "neutral", insufficient: true, notes: [{ text: `${tfLabel}: not enough history yet`, side: "neutral" }] };
  }
  const closes = candles.map((c) => c.close);
  const price = closes[closes.length - 1];
  const e20 = emaLast(closes, 20)!;
  const e50 = emaLast(closes, 50)!;
  const e20Before = emaLast(closes.slice(0, -3), 20) ?? e20;
  const range = atr(candles) ?? Math.abs(price) * 0.003;
  const st = superTrend(candles);
  const slope = range > 0 ? (e20 - e20Before) / range : 0;

  const stack = e20 > e50 ? 1 : -1;
  const location = price > e50 ? 1 : -1;
  const stVote = st ? (st.direction === "bullish" ? 1 : -1) : 0;
  const slopeVote = slope > 0.1 ? 1 : slope < -0.1 ? -1 : 0;
  const vote = mean([stack, location, stVote, slopeVote]);
  const direction = sideOf(vote, 0.25);

  return {
    vote,
    direction,
    notes: [
      { text: `${tfLabel}: EMA20 ${stack > 0 ? "above" : "below"} EMA50`, side: stack > 0 ? "bull" : "bear" },
      { text: `${tfLabel}: price ${location > 0 ? "above" : "below"} EMA50 (₹${fmt(e50)})`, side: location > 0 ? "bull" : "bear" },
      { text: `${tfLabel}: SuperTrend ${stVote > 0 ? "up" : stVote < 0 ? "down" : "n/a"}`, side: sideOf(stVote) },
      { text: `${tfLabel}: EMA20 ${slopeVote > 0 ? "rising" : slopeVote < 0 ? "falling" : "flat"}`, side: sideOf(slopeVote) },
    ],
  };
}

/** 15-minute trend plus swing structure (higher highs/lows or lower). */
export function readSetupTrend(c15: Candle[]): TrendRead {
  const base = readTrend(c15, "15m");
  if (base.insufficient) return base;
  const smc = analyzeSmartMoneyConcepts(c15.slice(-120));
  const structure = smc.structureBias === "bullish" ? 1 : smc.structureBias === "bearish" ? -1 : 0;
  const vote = (base.vote * 4 + structure) / 5;
  return {
    vote,
    direction: sideOf(vote, 0.25),
    notes: [
      ...base.notes,
      {
        text: structure > 0 ? "15m: higher highs & higher lows" : structure < 0 ? "15m: lower highs & lower lows" : "15m: no clean swing structure",
        side: sideOf(structure),
      },
    ],
  };
}

// ---- 3. Momentum --------------------------------------------------------------

export function readMomentum(c15: Candle[]): PillarRead {
  const closes = c15.map((c) => c.close);
  const r = rsi(closes);
  const m = macd(closes);
  const mPrev = macd(closes.slice(0, -1));
  const a = adx(c15);
  if (r === null || m === null) return { vote: 0, insufficient: true, notes: [{ text: "Momentum: not enough history yet", side: "neutral" }] };

  let rsiVote = 0;
  let rsiText = `RSI ${r.toFixed(0)} — neutral`;
  if (r >= 72) { rsiVote = 0.3; rsiText = `RSI ${r.toFixed(0)} — strong but stretched`; }
  else if (r > 55) { rsiVote = 1; rsiText = `RSI ${r.toFixed(0)} — buyers in control`; }
  else if (r <= 28) { rsiVote = -0.3; rsiText = `RSI ${r.toFixed(0)} — weak but stretched`; }
  else if (r < 45) { rsiVote = -1; rsiText = `RSI ${r.toFixed(0)} — sellers in control`; }

  // MACD's own side of zero is the trend and counts most; the histogram
  // (line vs signal) flips every few bars even in a healthy trend, so it and
  // its slope only adjust the vote.
  const rising = mPrev ? m.histogram > mPrev.histogram : false;
  const macdVote = clamp((m.line > 0 ? 0.5 : -0.5) + (m.histogram > 0 ? 0.3 : -0.3) + (rising ? 0.2 : -0.2));
  const strength = a === null ? 0.7 : a >= 25 ? 1 : a >= 20 ? 0.85 : 0.6;
  const vote = clamp(mean([rsiVote, macdVote]) * strength);

  return {
    vote,
    notes: [
      { text: rsiText, side: sideOf(rsiVote) },
      { text: `MACD ${m.line > 0 ? "above" : "below"} zero, ${m.histogram > 0 ? "above" : "below"} signal, ${rising ? "gaining" : "fading"}`, side: sideOf(macdVote) },
      {
        text: a === null ? "ADX n/a" : a >= 25 ? `ADX ${a.toFixed(0)} — strong trend` : a >= 20 ? `ADX ${a.toFixed(0)} — trend forming` : `ADX ${a.toFixed(0)} — weak/choppy, momentum counts less`,
        side: "neutral",
      },
    ],
  };
}

// ---- 4. Candle formation (last three closed 15m candles) ------------------------

export function readFormation(c15: Candle[]): PillarRead {
  const last3 = c15.slice(-3);
  if (last3.length < 3) return { vote: 0, insufficient: true, notes: [{ text: "Candles: not enough yet", side: "neutral" }] };
  let body = 0;
  let span = 0;
  const locs: number[] = [];
  let green = 0;
  for (const c of last3) {
    const range = c.high - c.low;
    if (range <= 0) continue;
    body += c.close - c.open;
    span += range;
    locs.push(((c.close - c.low) / range) * 2 - 1);
    if (c.close > c.open) green++;
  }
  const bodyVote = span > 0 ? clamp((body / span) * 1.5) : 0;
  const locVote = mean(locs);
  const patterns = detectCandlePatterns(c15);
  const pBull = patterns.filter((p) => p.bias === "bullish");
  const pBear = patterns.filter((p) => p.bias === "bearish");
  const votes = [bodyVote, locVote];
  if (pBull.length !== pBear.length) votes.push(pBull.length > pBear.length ? 1 : -1);
  const vote = mean(votes);

  const notes: Note[] = [
    { text: `Last 3 candles: ${green} green, ${3 - green} red`, side: sideOf(bodyVote, 0.2) },
    { text: locVote > 0.3 ? "Closing near their highs" : locVote < -0.3 ? "Closing near their lows" : "Closing mid-range", side: sideOf(locVote, 0.3) },
  ];
  for (const p of [...pBull, ...pBear].slice(0, 2)) notes.push({ text: `Pattern: ${p.name}`, side: p.bias === "bullish" ? "bull" : "bear" });
  return { vote, notes };
}

// ---- 5. Room to the next level ------------------------------------------------

export interface RoomRead {
  bull: number; // -1 .. +1 : how much room a BUY CE has
  bear: number;
  resistance: number | null;
  support: number | null;
  atr: number;
  notes: Note[];
}

function swingLevels(candles: Candle[], strength = 2): { highs: number[]; lows: number[] } {
  const highs: number[] = [];
  const lows: number[] = [];
  for (let i = strength; i < candles.length - strength; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - strength; j <= i + strength; j++) {
      if (candles[j].high > candles[i].high) isHigh = false;
      if (candles[j].low < candles[i].low) isLow = false;
    }
    if (isHigh) highs.push(candles[i].high);
    if (isLow) lows.push(candles[i].low);
  }
  return { highs, lows };
}

function roomVote(roomAtr: number, extension: number): number {
  let v = roomAtr >= 2 ? 1 : roomAtr >= 1.2 ? 0.4 : roomAtr >= 0.6 ? -0.3 : -0.8;
  if (extension > 2.5) v = Math.min(v, -0.5); // already stretched far from EMA20
  return v;
}

export function readRoom(c15: Candle[]): RoomRead {
  const price = c15[c15.length - 1]?.close ?? 0;
  const range = atr(c15) ?? Math.abs(price) * 0.003;
  const e20 = emaLast(c15.map((c) => c.close), 20) ?? price;
  const window = c15.slice(-80);
  const { highs, lows } = swingLevels(window);

  // Previous session's high and low are levels every desk watches.
  const lastDate = c15[c15.length - 1]?.date.slice(0, 10);
  const prevDay = c15.filter((c) => c.date.slice(0, 10) < (lastDate ?? ""));
  const prevDate = prevDay[prevDay.length - 1]?.date.slice(0, 10);
  const prevBars = prevDay.filter((c) => c.date.slice(0, 10) === prevDate);
  if (prevBars.length) {
    highs.push(Math.max(...prevBars.map((c) => c.high)));
    lows.push(Math.min(...prevBars.map((c) => c.low)));
  }

  const gap = range * 0.05;
  const above = highs.filter((h) => h > price + gap);
  const below = lows.filter((l) => l < price - gap);
  const resistance = above.length ? Math.min(...above) : null;
  const support = below.length ? Math.max(...below) : null;
  const upRoom = resistance !== null && range > 0 ? (resistance - price) / range : 3;
  const downRoom = support !== null && range > 0 ? (price - support) / range : 3;
  const extUp = range > 0 ? (price - e20) / range : 0;

  const bull = roomVote(upRoom, extUp);
  const bear = roomVote(downRoom, -extUp);
  const notes: Note[] = [
    {
      text: resistance !== null ? `Resistance ₹${fmt(resistance)} — ${upRoom.toFixed(1)}× ATR above` : "No swing resistance nearby above",
      side: bull > 0 ? "bull" : "bear",
    },
    {
      text: support !== null ? `Support ₹${fmt(support)} — ${downRoom.toFixed(1)}× ATR below` : "No swing support nearby below",
      side: bear > 0 ? "bear" : "bull",
    },
  ];
  if (Math.abs(extUp) > 2.5) notes.push({ text: `Price is ${Math.abs(extUp).toFixed(1)}× ATR ${extUp > 0 ? "above" : "below"} EMA20 — stretched, chasing risk`, side: "neutral" });
  return { bull, bear, resistance, support, atr: range, notes };
}

// ---- 6. Participation (VWAP + volume) -----------------------------------------

export function readParticipation(c15: Candle[]): PillarRead {
  const last = c15[c15.length - 1];
  if (!last) return { vote: 0, insufficient: true, notes: [] };
  const day = last.date.slice(0, 10);
  const today = c15.filter((c) => c.date.slice(0, 10) === day);
  const v = vwap(today);
  const range = atr(c15) ?? last.close * 0.003;
  const votes: number[] = [];
  const notes: Note[] = [];

  if (v !== null) {
    const d = (last.close - v) / (range || 1);
    const vv = d > 0.1 ? 1 : d < -0.1 ? -1 : 0;
    votes.push(vv);
    notes.push({ text: `Price ${vv > 0 ? "above" : vv < 0 ? "below" : "at"} VWAP (₹${fmt(v)})`, side: sideOf(vv) });
  }

  const vols = c15.map((c) => c.volume ?? 0);
  const prior = vols.slice(-23, -3);
  const avg = mean(prior);
  if (avg > 0) {
    let push = 0;
    let heavy = 0;
    for (const c of c15.slice(-3)) {
      if ((c.volume ?? 0) > avg * 1.2) {
        heavy++;
        push += Math.sign(c.close - c.open);
      }
    }
    const volVote = clamp(push / 2);
    votes.push(volVote);
    notes.push({
      text: heavy === 0 ? "Volume normal — no strong push either way" : `${heavy} of last 3 candles on high volume, ${push > 0 ? "mostly buying" : push < 0 ? "mostly selling" : "mixed"}`,
      side: sideOf(volVote),
    });
  } else {
    notes.push({ text: "Volume data not available", side: "neutral" });
  }
  return { vote: mean(votes), notes };
}
