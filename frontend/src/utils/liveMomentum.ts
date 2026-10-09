// "Right now" -- what price has done since the last CLOSED 15-minute candle.
//
// AI Verify Pro decides only on finished candles so it does not flip on every
// tick, which means up to 15 minutes can pass between reads. A trend can fade
// inside that gap. This fills it without touching the decision: it compares
// the live price with the last closed candle (its close, high and low, scaled
// by ATR so Crude and Gas read alike) and looks at the 5-minute candles
// inside the candle that is still forming. The answer is about the current
// side -- is the call holding, weakening or reversing -- and is labelled as a
// live read that can change before the candle closes.

import type { Candle } from "../types";
import { atr } from "./indicators";
import { sessionBucketStart } from "./candleResample";
import type { DecisionResult } from "./buyDecisionEngine";

export type LiveAction = "HOLDING" | "BUILDING" | "NO_CHANGE" | "WEAKENING" | "REVERSING" | "STOP_BROKEN" | "BULLISH" | "BEARISH" | "FLAT";

export interface LiveRead {
  action: LiveAction;
  tone: "good" | "warn" | "bad" | "neutral" | "bull" | "bear";
  headline: string;
  detail: string;
  live: number;
  movePts: number; // live - last closed candle's close
  movePct: number;
  sinceAt: string; // HH:MM IST the last closed candle STARTED (as the verdict labels it)
  closesAt: string; // HH:MM IST when the forming candle closes
  fiveMin: ("up" | "down" | "flat")[]; // 5-minute candles inside the forming 15-minute one
  brokeHigh: boolean;
  brokeLow: boolean;
}

const BUCKET = 15 * 60_000;
const hhmm = (ms: number) => new Date(ms + 5.5 * 3600_000).toISOString().slice(11, 16);

export function liveMomentum(c15: Candle[], c5: Candle[], result: DecisionResult | null, now: number, marketOpen: boolean): LiveRead | null {
  if (!marketOpen || c15.length < 16) return null;
  const formingStart = sessionBucketStart(now, 15);
  const closed = c15.filter((c) => Date.parse(c.date) < formingStart);
  if (closed.length < 15) return null;
  const last = closed[closed.length - 1];
  const lastEnd = Date.parse(last.date) + BUCKET;
  // Only meaningful while the last closed candle is the one just before this one.
  if (formingStart - Date.parse(last.date) > 3 * BUCKET) return null;

  const inBucket = c5.filter((c) => Date.parse(c.date) >= lastEnd).sort((a, b) => a.date.localeCompare(b.date));
  const forming15 = c15.find((c) => Date.parse(c.date) >= formingStart);
  const live = inBucket.length ? inBucket[inBucket.length - 1].close : forming15 ? forming15.close : null;
  if (live === null) return null;

  const a = atr(closed, 14) ?? last.close * 0.002;
  const movePts = live - last.close;
  const s = movePts / a;
  const brokeHigh = live > last.high;
  const brokeLow = live < last.low;
  const fiveMin = inBucket.map((c) => (c.close > c.open + a * 0.03 ? "up" : c.close < c.open - a * 0.03 ? "down" : "flat")) as LiveRead["fiveMin"];
  const ups = fiveMin.filter((f) => f === "up").length;
  const downs = fiveMin.filter((f) => f === "down").length;
  // One number: distance from the last close in ATRs, nudged by a break of the
  // last candle's range and by the 5-minute candles' direction.
  const d = s + (brokeHigh ? 0.3 : 0) - (brokeLow ? 0.3 : 0) + 0.12 * Math.max(-3, Math.min(3, ups - downs));
  const dir: "up" | "down" | "flat" = d >= 0.25 ? "up" : d <= -0.25 ? "down" : "flat";

  const movePct = (movePts / last.close) * 100;
  const sign = movePts >= 0 ? "+" : "−";
  const where = brokeHigh ? "above the last candle's high" : brokeLow ? "below the last candle's low" : "inside the last candle's range";
  const detail = `${sign}₹${Math.abs(movePts).toFixed(2)} (${sign}${Math.abs(movePct).toFixed(2)}%) since the ${hhmm(lastEnd - BUCKET)} candle closed · ${where}`;
  const base = { live, movePts, movePct, sinceAt: hhmm(lastEnd - BUCKET), closesAt: hhmm(formingStart + BUCKET), fiveMin, brokeHigh, brokeLow, detail };

  const side = result?.side ?? null;
  const buying = result?.verdict === "BUY_CE" || result?.verdict === "BUY_PE";
  const forming = result?.verdict === "FORMING_CE" || result?.verdict === "FORMING_PE";

  // The plan's stop is a hard line: past it, the call is off.
  if (buying && result?.plan) {
    const p = result.plan;
    const past = p.side === "CE" ? live <= p.stop : live >= p.stop;
    if (past) return { ...base, action: "STOP_BROKEN", tone: "bad", headline: `STOP LEVEL BROKEN (₹${p.stop.toFixed(2)}) — exit / don't enter` };
  }

  if (!side || (!buying && !forming)) {
    if (dir === "up") return { ...base, action: "BULLISH", tone: "bull", headline: "Bullish since the last candle — not confirmed" };
    if (dir === "down") return { ...base, action: "BEARISH", tone: "bear", headline: "Bearish since the last candle — not confirmed" };
    return { ...base, action: "FLAT", tone: "neutral", headline: "Flat since the last candle" };
  }

  const withSide = side === "CE" ? dir === "up" : dir === "down";
  const against = side === "CE" ? dir === "down" : dir === "up";
  const brokeAgainst = side === "CE" ? brokeLow : brokeHigh;
  // A real reversal: through the last candle's range with some force, or a big move without it.
  const strongAgainst = side === "CE" ? d <= -0.7 : d >= 0.7;
  const forcefulBreak = brokeAgainst && (side === "CE" ? s <= -0.35 : s >= 0.35);
  const word = side === "CE" ? "bullish" : "bearish";

  if (against && (forcefulBreak || strongAgainst)) {
    return { ...base, action: "REVERSING", tone: "bad", headline: buying ? `REVERSING — avoid a new ${side}; protect a running ${side}` : `REVERSING — the ${side} setup is fading, don't buy` };
  }
  if (against) return { ...base, action: "WEAKENING", tone: "warn", headline: `WEAKENING — wait, don't chase the ${side}` };
  if (withSide) {
    return forming
      ? { ...base, action: "BUILDING", tone: "good", headline: `BUILDING — still ${word}, heading for confirmation at ${hhmm(formingStart + BUCKET)}` }
      : { ...base, action: "HOLDING", tone: "good", headline: `HOLDING — still ${word} right now` };
  }
  return { ...base, action: "NO_CHANGE", tone: "neutral", headline: `NO CHANGE — ${word} read holding, waiting for the ${hhmm(formingStart + BUCKET)} close` };
}
