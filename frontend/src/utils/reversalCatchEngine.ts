// AI-Up: the "catch the snap-back after a big move" engine.
//
// Crude (and NG) rarely fall in a straight line -- a sharp, climactic drop is
// very often followed by a partial recovery, and a sharp spike by a fade. This
// engine hunts exactly that: it waits for a REAL, significant move (measured in
// ATR, not eyeballed), then for the market to show it has exhausted and turned
// (oversold/overbought RSI that is now reversing, a genuine reversal candle,
// price reclaiming a short EMA, volume behind the turn) -- and only then fires
// a trade to ride the recovery, with targets set at real retracement levels of
// the move it is snapping back from. Works both ways: buy the bounce after a
// fall (CE), sell the fade after a rally (PE). Pure and deterministic.

import type { Candle } from "../types";
import { rsi, atr, emaLast } from "./indicators";
import { detectCandlePattern } from "./priceAction";

export type ReversalDirection = "bullish" | "bearish";

export interface ReversalReason {
  ok: boolean;
  text: string;
}

export interface ReversalSetup {
  direction: ReversalDirection; // bullish = catch the up-move after a fall
  optSide: "CE" | "PE";
  entry: number; // underlying entry (the reversal bar's close)
  stop: number; // just beyond the swing extreme
  targets: [number, number, number]; // retracement levels of the prior move
  confidence: number; // 0-100
  moveMagnitude: number; // size of the fall/rally in price points
  moveAtr: number; // that size in ATR units
  rsiExtreme: number; // how oversold/overbought it got at the turn
  swingExtreme: number; // the low we bounced off / high we faded from
  swingOrigin: number; // where the move began
  reasons: ReversalReason[];
}

export interface ReversalScan {
  setup: ReversalSetup | null;
  waitingReason: string;
}

const MIN_CANDLES = 40;
const WINDOW = 20; // how far back to hunt the swing that just happened
const RECENT_BARS = 5; // the extreme must be this recent (near the turn)
const FALL_ATR_MULT = 2.2; // a move must be at least this many ATRs to count
const RSI_OVERSOLD = 35;
const RSI_OVERBOUGHT = 65;
const MIN_CONFIRMS = 3;

const BULLISH_REVERSAL_BARS = new Set(["hammer", "bullish_engulfing", "bullish_pin_bar", "strong_bullish_candle", "outside_bar"]);
const BEARISH_REVERSAL_BARS = new Set(["shooting_star", "bearish_engulfing", "bearish_pin_bar", "strong_bearish_candle", "outside_bar"]);

function avgVolume(candles: Candle[], from: number, to: number): number {
  let sum = 0;
  let n = 0;
  for (let i = from; i < to; i++) {
    const v = candles[i].volume;
    if (typeof v === "number") {
      sum += v;
      n++;
    }
  }
  return n ? sum / n : 0;
}

function buildTargets(base: number, move: number, entry: number, atrV: number, dir: 1 | -1): [number, number, number] {
  // Retracement of the move it is snapping back from: 38.2% / 61.8% / 100%.
  // Each is floored to sit a real step beyond entry so a target can never be
  // "already reached" the moment the call opens.
  const raw = [0.382, 0.618, 1.0].map((f) => base + dir * f * move);
  const floors = [0.6, 1.2, 2.0].map((m) => entry + dir * m * atrV);
  const t = raw.map((r, i) => (dir === 1 ? Math.max(r, floors[i]) : Math.min(r, floors[i])));
  // enforce strictly ordered in the trade's favour
  for (let i = 1; i < 3; i++) {
    if (dir === 1 && t[i] <= t[i - 1]) t[i] = t[i - 1] + 0.5 * atrV;
    if (dir === -1 && t[i] >= t[i - 1]) t[i] = t[i - 1] - 0.5 * atrV;
  }
  return [Number(t[0].toFixed(2)), Number(t[1].toFixed(2)), Number(t[2].toFixed(2))];
}

function detectOneSide(candles: Candle[], dir: ReversalDirection, atrV: number): ReversalSetup | null {
  const n = candles.length;
  const closes = candles.map((c) => c.close);
  const start = n - WINDOW;
  const last = candles[n - 1];

  // The freshly-made extreme in the recent window: the lowest low (for a
  // bullish bounce) or the highest high (for a bearish fade).
  let extIdx = start;
  for (let i = start; i < n; i++) {
    if (dir === "bullish" ? candles[i].low < candles[extIdx].low : candles[i].high > candles[extIdx].high) extIdx = i;
  }
  // Must be recent -- we want to enter near the turn, not mid-recovery.
  if (extIdx < n - RECENT_BARS) return null;
  // ...but not the very last bar: we need a reversal bar to have formed AFTER it.
  if (extIdx >= n - 1) return null;

  const swingExtreme = dir === "bullish" ? candles[extIdx].low : candles[extIdx].high;
  // Where the move began: the opposite extreme BEFORE it, within the window.
  let origin = swingExtreme;
  for (let i = start; i <= extIdx; i++) {
    if (dir === "bullish" ? candles[i].high > origin : candles[i].low < origin) origin = dir === "bullish" ? candles[i].high : candles[i].low;
  }
  const move = Math.abs(origin - swingExtreme);
  const moveAtr = atrV > 0 ? move / atrV : 0;
  if (moveAtr < FALL_ATR_MULT) return null; // not a big enough move to snap back from

  // --- confirmations ---
  const rsiNow = rsi(closes) ?? 50;
  const rsiAtExtreme = rsi(closes.slice(0, extIdx + 1)) ?? 50;
  const ema9 = emaLast(closes, 9);
  const pattern = detectCandlePattern(candles).pattern;
  const revBarVol = last.volume ?? 0;
  const avgVol = avgVolume(candles, start, n - 1);

  const reasons: ReversalReason[] = [];
  let confirms = 0;

  const wasExtreme = dir === "bullish" ? rsiAtExtreme <= RSI_OVERSOLD : rsiAtExtreme >= RSI_OVERBOUGHT;
  if (wasExtreme) confirms++;
  reasons.push({ ok: wasExtreme, text: dir === "bullish" ? `RSI hit ${rsiAtExtreme.toFixed(0)} at the low — a real oversold flush, the kind that snaps back.` : `RSI hit ${rsiAtExtreme.toFixed(0)} at the high — a real overbought push, the kind that fades.` });

  const turning = dir === "bullish" ? rsiNow > rsiAtExtreme + 2 : rsiNow < rsiAtExtreme - 2;
  if (turning) confirms++;
  reasons.push({ ok: turning, text: turning ? "Momentum (RSI) has turned back the other way — the move is reversing, not still going." : "Momentum hasn't turned yet." });

  const revBar = dir === "bullish" ? BULLISH_REVERSAL_BARS.has(pattern) : BEARISH_REVERSAL_BARS.has(pattern);
  if (revBar) confirms++;
  reasons.push({ ok: revBar, text: revBar ? `A ${pattern.replace(/_/g, " ")} reversal candle just printed at the turn.` : "No clean reversal candle yet." });

  const reclaim = ema9 !== null && (dir === "bullish" ? last.close > ema9 : last.close < ema9);
  if (reclaim) confirms++;
  reasons.push({ ok: reclaim, text: reclaim ? "Price has reclaimed its short-term average — buyers/sellers back in control." : "Price hasn't reclaimed its short-term average yet." });

  const volOk = avgVol > 0 && revBarVol >= avgVol;
  if (volOk) confirms++;
  reasons.push({ ok: volOk, text: volOk ? "Real volume behind the turn, not a quiet drift." : "Volume on the turn is light." });

  if (confirms < MIN_CONFIRMS) return null;

  const entry = Number(last.close.toFixed(2));
  const dirSign: 1 | -1 = dir === "bullish" ? 1 : -1;
  const stop = Number((dir === "bullish" ? swingExtreme - 0.3 * atrV : swingExtreme + 0.3 * atrV).toFixed(2));
  const targets = buildTargets(swingExtreme, move, entry, atrV, dirSign);

  // confidence: a floor for a qualifying setup, plus rewards for a bigger
  // move, extra confirmations, and how stretched the RSI got.
  const magBonus = Math.min(18, (moveAtr - FALL_ATR_MULT) * 7);
  const confirmBonus = (confirms - MIN_CONFIRMS) * 6;
  const rsiDepth = dir === "bullish" ? Math.max(0, RSI_OVERSOLD - rsiAtExtreme) : Math.max(0, rsiAtExtreme - RSI_OVERBOUGHT);
  const rsiBonus = Math.min(10, rsiDepth * 0.8);
  const confidence = Math.round(Math.max(55, Math.min(92, 55 + magBonus + confirmBonus + rsiBonus)));

  return {
    direction: dir,
    optSide: dir === "bullish" ? "CE" : "PE",
    entry,
    stop,
    targets,
    confidence,
    moveMagnitude: Number(move.toFixed(2)),
    moveAtr: Number(moveAtr.toFixed(2)),
    rsiExtreme: Number(rsiAtExtreme.toFixed(0)),
    swingExtreme: Number(swingExtreme.toFixed(2)),
    swingOrigin: Number(origin.toFixed(2)),
    reasons,
  };
}

export function detectReversal(candles: Candle[]): ReversalScan {
  if (!candles || candles.length < MIN_CANDLES) {
    return { setup: null, waitingReason: "Warming up — need more candles before it can measure a real move." };
  }
  const atrV = atr(candles, 14);
  if (!atrV || atrV <= 0) return { setup: null, waitingReason: "Volatility read not ready yet." };

  const bull = detectOneSide(candles, "bullish", atrV);
  const bear = detectOneSide(candles, "bearish", atrV);

  let setup: ReversalSetup | null = null;
  if (bull && bear) setup = bull.confidence >= bear.confidence ? bull : bear;
  else setup = bull ?? bear;

  if (!setup) {
    return { setup: null, waitingReason: "No fresh, exhausted move to catch right now — waiting for a sharp fall or spike that shows it's reversing." };
  }
  return { setup, waitingReason: "" };
}
