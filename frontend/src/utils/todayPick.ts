// Which timeframe's call to trust most RIGHT NOW, for one market.
// Evidence first: each timeframe's own closed-call record on this market
// (needs 8+ results, else treated as an unproven 35%), then whether the call
// agrees with the 1-hour / 4-hour read, then whether it matches the side the
// daily picture favours. A call against both higher timeframes is never
// picked when another is available.

import type { TradeLogEntry } from "./tradeLogCore";
import type { TfRecord } from "../hooks/useTodayFocus";

export interface TfCall {
  tf: string;
  short: string;
  entry: TradeLogEntry | null; // the running call, if any
  record: TfRecord;
  higherSides: ("CE" | "PE" | null)[]; // the 1h and 4h sides (excluding itself)
}

export interface Pick {
  tf: string;
  score: number;
  reasons: string[];
}

export const MIN_RECORD = 8;

export function pickBest(calls: TfCall[], favour: "CE" | "PE" | null): Pick | null {
  const scored = calls
    .filter((c) => c.entry && !c.entry.closed)
    .map((c) => {
      const side = c.entry!.optSide;
      const reasons: string[] = [];
      const proven = c.record.closed >= MIN_RECORD && c.record.winRate !== null;
      let score = proven ? c.record.winRate! : 35;
      reasons.push(proven ? `${c.short} has won ${c.record.winRate}% of ${c.record.wins + c.record.losses} calls here` : `${c.short} has too few results yet (${c.record.closed})`);
      const known = c.higherSides.filter((s) => s !== null);
      const agree = known.filter((s) => s === side).length;
      const against = known.length - agree;
      if (known.length && agree === known.length) {
        score += 12;
        reasons.push("agrees with the higher timeframes");
      } else if (against === known.length && known.length) {
        score -= 20;
        reasons.push("AGAINST the higher timeframes");
      }
      if (favour && side === favour) {
        score += 6;
        reasons.push("matches today's daily picture");
      } else if (favour && side !== favour) {
        score -= 6;
        reasons.push("against today's daily picture — quick trade only");
      }
      return { tf: c.tf, score, reasons, against: against === known.length && known.length > 0 };
    })
    .sort((a, b) => b.score - a.score);
  if (!scored.length) return null;
  const best = scored.find((s) => !s.against) ?? scored[0];
  return { tf: best.tf, score: Math.round(best.score), reasons: best.reasons };
}
