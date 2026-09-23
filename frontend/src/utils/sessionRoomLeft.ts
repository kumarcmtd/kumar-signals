// "How much more can it move today?"
//
// THE HONEST ANSWER, AND WHY IT IS NOT A TARGET.
//
// The question people want answered is "give me a price it will reach". That
// number cannot be produced from candles, and producing one anyway is exactly
// how a page starts costing money: a made-up target reads with the same
// confidence as a measured one, and the reader cannot tell them apart.
//
// What CAN be measured is how much ground this contract normally covers in a
// day, and how much of that it has already used. If Crude typically travels
// 1.8% between its high and low, and today has already covered 1.5%, then the
// day is nearly out of its usual range -- that is a fact about past sessions,
// and it is a genuinely useful thing to know before paying up for an option at
// 3 PM. It says nothing about DIRECTION, and this module never implies one.
//
// Two figures are reported side by side, deliberately:
//
//   * Typical FULL-DAY range, median over the sessions available. The median
//     rather than the mean, because one news day would drag an average up and
//     make every ordinary day look like it had room left.
//   * Median EXTENSION past the open for days that gapped the way today did,
//     which the overnight study alongside this already computes.
//
// They answer slightly different questions and they will sometimes disagree.
// Showing both, and saying so, is better than silently picking one.
//
// The stated limit, which is on the card too: a trending day goes straight
// through the typical range and a dead day never reaches it. This is the
// middle of a wide spread, not a boundary.

import type { Candle } from "../types";
import { istDateOf } from "./overnightFollowThrough";

export interface SessionRoom {
  /** Median high-to-low range of a completed session, as % of its open. */
  typicalRangePct: number | null;
  /** Sessions behind that median. */
  sessionsUsed: number;
  /** Today's high-to-low so far, as % of today's open. */
  usedPct: number | null;
  /** Share of a typical day's range already covered, 0-100+. */
  usedShare: number | null;
  /** Typical range minus what is used, floored at zero, in percent. */
  roomLeftPct: number | null;
  /** The same figure in rupees, which is what an option actually responds to. */
  roomLeftPoints: number | null;
  /** Today's range in rupees. */
  usedPoints: number | null;
  /** Too few completed sessions to state a typical range. */
  thin: boolean;
  /** Plain-language reading. */
  verdict: string;
}

/** Below this many completed sessions a median is not worth quoting. */
export const MIN_SESSIONS_FOR_RANGE = 8;

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Splits a multi-day candle series into sessions and measures today's room.
 *
 * `todayDate` is passed in rather than read from the clock so the result is
 * reproducible: the same candles always produce the same answer.
 */
export function readSessionRoom(candles: Candle[] | undefined | null, todayDate: string): SessionRoom {
  const empty: SessionRoom = {
    typicalRangePct: null,
    sessionsUsed: 0,
    usedPct: null,
    usedShare: null,
    roomLeftPct: null,
    roomLeftPoints: null,
    usedPoints: null,
    thin: true,
    verdict: "Not enough session history yet to say what a typical day covers.",
  };
  if (!candles || candles.length === 0) return empty;

  const byDate = new Map<string, Candle[]>();
  for (const c of candles) {
    const d = istDateOf(c.date);
    const list = byDate.get(d);
    if (list) list.push(c);
    else byDate.set(d, [c]);
  }

  const ranges: number[] = [];
  let today: Candle[] | null = null;
  for (const [date, bars] of byDate) {
    if (date === todayDate) {
      today = bars;
      continue;
    }
    // A holiday half-day or a partial download is not a full day's range and
    // would drag the median down for every day compared against it.
    if (bars.length < 6) continue;
    const open = bars[0].open;
    if (!(open > 0)) continue;
    const high = Math.max(...bars.map((b) => b.high));
    const low = Math.min(...bars.map((b) => b.low));
    ranges.push(((high - low) / open) * 100);
  }

  const typicalRaw = median(ranges);
  const typicalRangePct = typicalRaw === null ? null : Number(typicalRaw.toFixed(2));
  const thin = ranges.length < MIN_SESSIONS_FOR_RANGE;

  if (!today || today.length === 0 || typicalRangePct === null) {
    return {
      ...empty,
      typicalRangePct,
      sessionsUsed: ranges.length,
      thin,
      verdict:
        typicalRangePct === null
          ? "Not enough completed sessions yet to say what a typical day covers."
          : `A typical day covers about ${typicalRangePct}% high to low${thin ? `, but that is only ${ranges.length} sessions — treat it as a note, not a finding` : ""}. Today's session has not started.`,
    };
  }

  const open = today[0].open;
  const high = Math.max(...today.map((b) => b.high));
  const low = Math.min(...today.map((b) => b.low));
  const usedPoints = Number((high - low).toFixed(2));
  const usedPct = open > 0 ? Number((((high - low) / open) * 100).toFixed(2)) : null;
  const usedShare = usedPct === null || typicalRangePct <= 0 ? null : Math.round((usedPct / typicalRangePct) * 100);
  const roomLeftPct = usedPct === null ? null : Number(Math.max(0, typicalRangePct - usedPct).toFixed(2));
  const roomLeftPoints = roomLeftPct === null || !(open > 0) ? null : Number(((roomLeftPct / 100) * open).toFixed(2));

  let verdict: string;
  if (thin) {
    verdict = `Only ${ranges.length} completed sessions to compare against — far too few to call anything typical. Treat the figure as a note, not a finding.`;
  } else if (usedShare === null) {
    verdict = `A typical day covers about ${typicalRangePct}%, measured over ${ranges.length} sessions.`;
  } else if (usedShare >= 100) {
    verdict =
      `Today has already covered ${usedPct}%, which is more than the ${typicalRangePct}% a typical day covers. ` +
      `Days do run further than usual — but buying an option for a move that has already happened is where premium goes to die.`;
  } else if (usedShare >= 70) {
    verdict =
      `${usedShare}% of a typical day's range is already used. On an ordinary day roughly ${roomLeftPct}% is left, about ${roomLeftPoints} points — and that is the WHOLE remaining range, ` +
      `not a move in your favour.`;
  } else {
    verdict =
      `Only ${usedShare}% of a typical day's range is used so far, so an ordinary day would have roughly ${roomLeftPct}% left — about ${roomLeftPoints} points of movement, in either direction.`;
  }

  return { typicalRangePct, sessionsUsed: ranges.length, usedPct, usedShare, roomLeftPct, roomLeftPoints, usedPoints, thin, verdict };
}
