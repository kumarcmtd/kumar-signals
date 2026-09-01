// On-demand "is this call still strong?" check.
//
// A call can stay open for days crawling toward its target or its stop. This
// answers, at any moment the trader asks, whether the LIVE market still backs
// the call's direction -- trend, momentum, MACD, RSI regime, volume, and where
// the premium now sits between stop and target -- or whether the potential has
// drained out even though the stop hasn't been hit yet. Pure and deterministic:
// it reads the same real candles the rest of the app uses, never a guess.

import type { Candle } from "../types";
import { emaLast, rsi, macd } from "./indicators";
import { checkVolumeSupport } from "./volumeSupport";

export type CallStrengthTier = "strong" | "holding" | "weakening" | "weak";

export interface CallStrengthReason {
  ok: boolean; // true = supports the call, false = works against it
  text: string;
}

export interface CallStrengthResult {
  score: number; // 0-100, how much live data still backs the call
  tier: CallStrengthTier;
  label: string;
  headline: string;
  reasons: CallStrengthReason[];
  daysOpen: number;
}

export interface CallStrengthContext {
  entry: number;
  stop: number;
  targets: number[];
  targetsHit: boolean[];
  current: number | null; // live option premium
  openedAt: number;
}

const TIER_LABEL: Record<CallStrengthTier, string> = {
  strong: "Still Strong",
  holding: "Holding — Watch It",
  weakening: "Weakening",
  weak: "Weak — Potential Fading",
};

const TIER_HEADLINE: Record<CallStrengthTier, string> = {
  strong: "The live market still backs this call — momentum and trend are with it, so the potential to reach target is intact.",
  holding: "Still on the right side, but the drive has cooled. Fine to hold, but keep a close eye — it isn't building the way a strong call does.",
  weakening: "Momentum is fading against this call. It hasn't hit the stop, but the odds of reaching target from here have dropped — tighten up or be ready to exit.",
  weak: "The live market has turned against this call. Very little potential left even though the stop isn't hit — consider getting out rather than waiting for the stop.",
};

function tierFromScore(score: number): CallStrengthTier {
  if (score >= 68) return "strong";
  if (score >= 50) return "holding";
  if (score >= 35) return "weakening";
  return "weak";
}

// direction: the option's directional bet -- "bullish" for a CE, "bearish"
// for a PE. Every factor is measured in the call's favour.
export function assessCallStrength(candles: Candle[], direction: "bullish" | "bearish", ctx: CallStrengthContext): CallStrengthResult | null {
  if (!candles || candles.length < 21) return null;
  const dir = direction === "bullish" ? 1 : -1;
  const closes = candles.map((c) => c.close);
  const reasons: CallStrengthReason[] = [];

  let points = 0;
  let available = 0;
  const add = (got: number, max: number) => {
    points += got;
    available += max;
  };

  // 1) Trend: fast EMA vs slow EMA, in the call's direction. (max 22)
  const ema9 = emaLast(closes, 9);
  const ema21 = emaLast(closes, 21);
  if (ema9 !== null && ema21 !== null && ema21 !== 0) {
    const sepPct = (dir * (ema9 - ema21)) / ema21; // >0 = aligned
    const got = Math.max(0, Math.min(22, 11 + sepPct * 2200));
    add(got, 22);
    reasons.push({ ok: got >= 11, text: got >= 11 ? "Short-term trend is still pushing your way." : "Short-term trend has rolled against you." });
  }

  // 2) Momentum: last close vs 5 bars ago, in direction. (max 20)
  if (closes.length >= 6) {
    const c0 = closes[closes.length - 1];
    const c5 = closes[closes.length - 6];
    const movePct = c5 !== 0 ? (dir * (c0 - c5)) / c5 : 0;
    const got = Math.max(0, Math.min(20, 10 + movePct * 2000));
    add(got, 20);
    reasons.push({ ok: got >= 10, text: got >= 10 ? "Price is still moving in your favour over the last few bars." : "Price has stalled or reversed over the last few bars." });
  }

  // 3) MACD histogram sign, in direction. (max 14)
  const m = macd(closes);
  if (m) {
    const aligned = dir * m.histogram > 0;
    add(aligned ? 14 : 3, 14);
    reasons.push({ ok: aligned, text: aligned ? "MACD momentum is on your side." : "MACD momentum has flipped against you." });
  }

  // 4) RSI regime: healthy zone in your direction, penalize exhaustion. (max 14)
  const r = rsi(closes, 14);
  if (r !== null) {
    let got: number;
    let note: string;
    if (dir > 0) {
      if (r >= 80) { got = 5; note = "RSI is overbought — the up-move may be running out of steam."; }
      else if (r >= 52) { got = 14; note = "RSI is firmly bullish."; }
      else if (r >= 45) { got = 8; note = "RSI is neutral — no strong push either way."; }
      else { got = 2; note = "RSI has turned bearish against your Call."; }
    } else {
      if (r <= 20) { got = 5; note = "RSI is oversold — the down-move may be running out of steam."; }
      else if (r <= 48) { got = 14; note = "RSI is firmly bearish."; }
      else if (r <= 55) { got = 8; note = "RSI is neutral — no strong push either way."; }
      else { got = 2; note = "RSI has turned bullish against your Put."; }
    }
    add(got, 14);
    reasons.push({ ok: got >= 10, text: note });
  }

  // 5) Volume support on the moves in your direction. (max 14)
  const vol = checkVolumeSupport(candles, direction);
  if (vol) {
    const got = vol.tier === "strong" ? 14 : vol.tier === "moderate" ? 8 : 2;
    add(got, 14);
    reasons.push({ ok: got >= 8, text: got >= 8 ? "Real volume is behind the move, not just drift." : "Volume behind the move is thin — little conviction." });
  }

  // 6) Where the premium now sits between stop and next target. (max 16)
  const nextIdx = ctx.targetsHit.findIndex((h) => !h);
  const nextTarget = ctx.targets[nextIdx === -1 ? ctx.targets.length - 1 : nextIdx];
  if (ctx.current !== null && nextTarget > ctx.stop) {
    const ratio = Math.max(0, Math.min(1, (ctx.current - ctx.stop) / (nextTarget - ctx.stop)));
    const got = Number((ratio * 16).toFixed(1));
    add(got, 16);
    reasons.push({
      ok: ratio >= 0.4,
      text:
        ratio >= 0.55
          ? "Premium is sitting closer to the next target than to your stop."
          : ratio >= 0.35
            ? "Premium is roughly midway between stop and target."
            : "Premium has drifted close to your stop — the buffer is thin.",
    });
  }

  if (available === 0) return null;
  const score = Math.round((points / available) * 100);
  const tier = tierFromScore(score);
  const daysOpen = (Date.now() - ctx.openedAt) / 86_400_000;

  // Time decay is a real cost the longer an option is held. Surface it as an
  // extra caution once a call has been open for a day or more.
  if (daysOpen >= 1) {
    const dLabel = daysOpen >= 2 ? `${Math.floor(daysOpen)} days` : "over a day";
    const stalled = ctx.current !== null && ctx.current <= ctx.entry;
    reasons.push({
      ok: false,
      text: stalled
        ? `Open ${dLabel} and still under your entry — time decay (theta) is working against you the longer this sits.`
        : `Open ${dLabel} — remember time decay (theta) quietly eats option premium the longer a call runs.`,
    });
  }

  return { score, tier, label: TIER_LABEL[tier], headline: TIER_HEADLINE[tier], reasons, daysOpen: Number(daysOpen.toFixed(1)) };
}
