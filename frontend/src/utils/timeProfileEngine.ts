// Price-Alerts -- which times of day actually move, measured from real candles.
//
// This page exists because a trader was told a list of specific claims about
// MCX intraday timings ("by 12:00 it falls back", "9-10 PM is the big move").
// Those claims might be right. The job of this engine is NOT to repeat them --
// it is to MEASURE them against the contract's own 30-minute history and report
// what the data says, including when the data says nothing at all.
//
// Three rules run through everything below, because they are what separates a
// real time-of-day study from the way people usually fool themselves:
//
//  1. SAMPLE SIZE IS PART OF EVERY ANSWER. MCX futures roll monthly, so one
//     contract carries at most a few dozen sessions. Twenty sessions cannot
//     establish "this always happens at 12 o'clock", and every figure here is
//     published alongside the number of sessions behind it.
//
//  2. A COIN FLIP IS REPORTED AS A COIN FLIP. An up-rate of 60% over 25
//     sessions is what a fair coin does all the time. Direction is only called
//     when it clears a significance bar (see directionVerdict), and is
//     otherwise labelled "no reliable bias" rather than dressed up as an edge.
//
//  3. TESTING 29 SLOTS MEANS ~1 LOOKS SIGNIFICANT BY LUCK. That is the
//     multiple-comparisons trap, and it is the single most common way a
//     backtest produces a "pattern" that does not exist. The bar for calling a
//     slot reliable is deliberately set higher than the textbook 2-sigma, and
//     the page says this out loud.
//
// Nothing here is fetched, nothing is random, and nothing is invented: given
// the same candles it always produces the same numbers.

import type { Candle } from "../types";

/** MCX energy session in IST minutes-from-midnight: 9:00 AM to 11:30 PM. */
export const SESSION_START_MIN = 9 * 60;
export const SESSION_END_MIN = 23 * 60 + 30;
export const SLOT_MINUTES = 30;

/** Below this many sessions a slot gets no verdict at all. */
export const MIN_SESSIONS_FOR_VERDICT = 10;
/** Below this, a verdict is shown but flagged as thin. */
export const MIN_SESSIONS_FOR_CONFIDENCE = 20;

/**
 * Significance bar for calling a directional bias real.
 *
 * The textbook bar is 2.0 sigma (~5% false-positive rate). With 29 slots
 * tested at once, a 5% rate means roughly 1.5 slots look "significant" purely
 * by chance every single time this page loads. 2.8 sigma puts the
 * expected number of lucky slots under 0.2, which is the honest bar for a
 * screen that scans every half hour of the day at once.
 */
export const STRONG_Z = 2.8;
export const LEANING_Z = 2.0;

export type Bias = "up" | "down" | "coin_flip";
export type Confidence = "reliable" | "leaning" | "coin_flip" | "insufficient";

/** IST minutes-from-midnight, read straight off Upstox's own +05:30 stamp.
 *  Parsing to a Date and calling getHours() would shift every bar by 5.5
 *  hours on a UTC worker and put the whole evening in the wrong slot. */
export function istMinutesOfStamp(date: string): number | null {
  const m = /T(\d{2}):(\d{2})/.exec(date);
  if (!m) return null;
  const mins = Number(m[1]) * 60 + Number(m[2]);
  return Number.isFinite(mins) ? mins : null;
}

export function slotStartOf(minutes: number): number {
  return Math.floor(minutes / SLOT_MINUTES) * SLOT_MINUTES;
}

export function slotLabel(startMin: number): string {
  const fmt = (m: number) => {
    const h24 = Math.floor(m / 60) % 24;
    const mm = m % 60;
    const ampm = h24 < 12 ? "AM" : "PM";
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    return `${h12}:${String(mm).padStart(2, "0")} ${ampm}`;
  };
  return `${fmt(startMin)} – ${fmt(startMin + SLOT_MINUTES)}`;
}

/** "21:00" -- the stable key for a slot. */
export function slotKey(startMin: number): string {
  return `${String(Math.floor(startMin / 60)).padStart(2, "0")}:${String(startMin % 60).padStart(2, "0")}`;
}

export function allSlotStarts(): number[] {
  const out: number[] = [];
  for (let m = SESSION_START_MIN; m < SESSION_END_MIN; m += SLOT_MINUTES) out.push(m);
  return out;
}

/** One half-hour of one trading day. */
export interface SlotSession {
  date: string;
  startMin: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * Folds 30-minute candles into per-day, per-slot rows. Candles outside the
 * MCX session, and any with a non-positive open, are dropped rather than
 * contributing a divide-by-zero percentage.
 */
export function buildSlotSessions(candles: Candle[]): SlotSession[] {
  const byKey = new Map<string, SlotSession>();
  for (const c of candles) {
    const mins = istMinutesOfStamp(c.date);
    if (mins === null || mins < SESSION_START_MIN || mins >= SESSION_END_MIN) continue;
    if (!(c.open > 0)) continue;
    const startMin = slotStartOf(mins);
    const date = c.date.slice(0, 10);
    const key = `${date}|${startMin}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { date, startMin, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume ?? 0 });
    } else {
      // Two candles inside one slot (a 15m feed, say) merge into one bar.
      existing.high = Math.max(existing.high, c.high);
      existing.low = Math.min(existing.low, c.low);
      existing.close = c.close;
      existing.volume += c.volume ?? 0;
    }
  }
  return Array.from(byKey.values()).sort((a, b) => a.date.localeCompare(b.date) || a.startMin - b.startMin);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * How far from a coin flip an up/down split is, in standard deviations.
 * Positive means more up-closes than down.
 */
export function directionZ(upDays: number, total: number): number {
  if (total <= 0) return 0;
  const p = upDays / total;
  return (p - 0.5) / Math.sqrt(0.25 / total);
}

export function directionVerdict(upDays: number, total: number): { bias: Bias; confidence: Confidence; z: number } {
  const z = directionZ(upDays, total);
  if (total < MIN_SESSIONS_FOR_VERDICT) return { bias: "coin_flip", confidence: "insufficient", z: r3(z) };
  const abs = Math.abs(z);
  if (abs >= STRONG_Z) return { bias: z > 0 ? "up" : "down", confidence: "reliable", z: r3(z) };
  if (abs >= LEANING_Z) return { bias: z > 0 ? "up" : "down", confidence: "leaning", z: r3(z) };
  return { bias: "coin_flip", confidence: "coin_flip", z: r3(z) };
}

export interface SlotStat {
  key: string;
  startMin: number;
  label: string;
  sessions: number;
  /** Mean (high-low)/open as a percent -- how much the price TRAVELS. */
  avgRangePct: number;
  medianRangePct: number;
  /** Mean signed (close-open)/open -- the directional drift. */
  avgMovePct: number;
  /**
   * How far the price typically REACHES each way inside the half hour,
   * measured from that half hour's opening price. These two answer "price up
   * by how much, down by how much" far better than a single range number: a
   * 0.8% range could be 0.8% up and nothing down, or 0.4% each way, and an
   * option buyer needs to know which.
   */
  avgUpReachPct: number;
  avgDownReachPct: number;
  /** On the days it finished green, how much it gained; and on red days, how much it lost. */
  avgGainPct: number;
  avgLossPct: number;
  upDays: number;
  downDays: number;
  upRatePct: number;
  bias: Bias;
  confidence: Confidence;
  z: number;
  avgVolume: number;
  /** 1 = the biggest-moving slot of the day. */
  rangeRank: number;
  /** This slot's range divided by the median slot's range. 2.0 = twice as active. */
  movementIndex: number;
}

/**
 * What the HALF HOUR BEFORE says about this one.
 *
 * A trader looking at a big move always wants to know what the candle before
 * it looked like. This splits every session in two -- the days the previous
 * half hour finished green, and the days it finished red -- and reports what
 * this slot then did in each case.
 *
 * Conditioning like this roughly halves the sample, which is exactly why
 * "after a green candle it always does X" survives in trading talk unchecked.
 * Both halves carry their own session count and their own significance check.
 */
export interface ConditionalOutcome {
  sessions: number;
  upRatePct: number;
  avgMovePct: number;
  bias: Bias;
  confidence: Confidence;
}

export interface PrevCandleLink {
  key: string;
  startMin: number;
  prevKey: string;
  afterGreen: ConditionalOutcome;
  afterRed: ConditionalOutcome;
  /** continues = green begets green; reverses = green begets red; none = the previous candle tells you nothing. */
  verdict: "continues" | "reverses" | "none" | "insufficient";
  /** Plain-language answer, with the real numbers in it. */
  summary: string;
}

export interface TimeProfile {
  slots: SlotStat[];
  prevLinks: PrevCandleLink[];
  sessionsAnalyzed: number;
  firstDate: string | null;
  lastDate: string | null;
  /** The median slot range across the day -- the yardstick movementIndex uses. */
  typicalRangePct: number;
}

/** How far apart two up-rates must be before the previous candle is said to matter. */
export const PREV_LINK_GAP_PCT = 15;

function outcomeOf(moves: number[]): ConditionalOutcome {
  const up = moves.filter((m) => m > 0).length;
  const down = moves.filter((m) => m < 0).length;
  const decided = up + down;
  const { bias, confidence } = directionVerdict(up, decided);
  return {
    sessions: moves.length,
    upRatePct: decided ? Math.round((up / decided) * 100) : 0,
    avgMovePct: moves.length ? r3(moves.reduce((a, b) => a + b, 0) / moves.length) : 0,
    bias,
    confidence,
  };
}

export function buildPrevCandleLinks(slotSessions: SlotSession[]): PrevCandleLink[] {
  const byDate = groupByDate(slotSessions);
  const greenMoves = new Map<number, number[]>();
  const redMoves = new Map<number, number[]>();

  for (const [, daySlots] of byDate) {
    const byStart = new Map(daySlots.map((s) => [s.startMin, s]));
    for (const s of daySlots) {
      const prev = byStart.get(s.startMin - SLOT_MINUTES);
      if (!prev || !(s.open > 0)) continue;
      // A perfectly flat previous candle belongs to neither group.
      if (prev.close === prev.open) continue;
      const move = ((s.close - s.open) / s.open) * 100;
      const target = prev.close > prev.open ? greenMoves : redMoves;
      const list = target.get(s.startMin);
      if (list) list.push(move);
      else target.set(s.startMin, [move]);
    }
  }

  return allSlotStarts()
    .filter((startMin) => startMin > SESSION_START_MIN)
    .map((startMin) => {
      const afterGreen = outcomeOf(greenMoves.get(startMin) ?? []);
      const afterRed = outcomeOf(redMoves.get(startMin) ?? []);
      const prevKey = slotKey(startMin - SLOT_MINUTES);
      const base = { key: slotKey(startMin), startMin, prevKey, afterGreen, afterRed };

      if (afterGreen.sessions < MIN_SESSIONS_FOR_VERDICT || afterRed.sessions < MIN_SESSIONS_FOR_VERDICT) {
        return {
          ...base,
          verdict: "insufficient" as const,
          summary: `Not enough days to compare (${afterGreen.sessions} after a green ${prevKey}, ${afterRed.sessions} after a red one).`,
        };
      }

      const gap = afterGreen.upRatePct - afterRed.upRatePct;
      const meaningful = afterGreen.confidence === "reliable" || afterRed.confidence === "reliable" || Math.abs(gap) >= PREV_LINK_GAP_PCT * 1.5;

      if (gap >= PREV_LINK_GAP_PCT && meaningful) {
        return {
          ...base,
          verdict: "continues" as const,
          summary: `The move tends to carry on. After a green ${prevKey} this half hour went up ${afterGreen.upRatePct}% of ${afterGreen.sessions} days; after a red one, only ${afterRed.upRatePct}% of ${afterRed.sessions} days.`,
        };
      }
      if (gap <= -PREV_LINK_GAP_PCT && meaningful) {
        return {
          ...base,
          verdict: "reverses" as const,
          summary: `The move tends to flip. After a green ${prevKey} this half hour went up only ${afterGreen.upRatePct}% of ${afterGreen.sessions} days; after a red one it went up ${afterRed.upRatePct}% of ${afterRed.sessions} days.`,
        };
      }
      return {
        ...base,
        verdict: "none" as const,
        summary: `The candle before makes no real difference — ${afterGreen.upRatePct}% up after a green ${prevKey} against ${afterRed.upRatePct}% after a red one. Close enough to be chance.`,
      };
    });
}

export function buildTimeProfile(slotSessions: SlotSession[]): TimeProfile {
  const bySlot = new Map<number, SlotSession[]>();
  for (const s of slotSessions) {
    const list = bySlot.get(s.startMin);
    if (list) list.push(s);
    else bySlot.set(s.startMin, [s]);
  }

  const dates = Array.from(new Set(slotSessions.map((s) => s.date))).sort();
  const raw = allSlotStarts().map((startMin) => {
    const rows = bySlot.get(startMin) ?? [];
    const ranges = rows.map((r) => ((r.high - r.low) / r.open) * 100);
    const moves = rows.map((r) => ((r.close - r.open) / r.open) * 100);
    const upReach = rows.map((r) => (Math.max(0, r.high - r.open) / r.open) * 100);
    const downReach = rows.map((r) => (Math.max(0, r.open - r.low) / r.open) * 100);
    const gains = moves.filter((m) => m > 0);
    const losses = moves.filter((m) => m < 0).map((m) => -m);
    const upDays = gains.length;
    const downDays = losses.length;
    const decided = upDays + downDays;
    const { bias, confidence, z } = directionVerdict(upDays, decided);
    const mean = (list: number[]) => (list.length ? r3(list.reduce((a, b) => a + b, 0) / list.length) : 0);
    return {
      key: slotKey(startMin),
      startMin,
      label: slotLabel(startMin),
      sessions: rows.length,
      avgRangePct: rows.length ? r3(ranges.reduce((a, b) => a + b, 0) / ranges.length) : 0,
      medianRangePct: r3(median(ranges)),
      avgMovePct: mean(moves),
      avgUpReachPct: mean(upReach),
      avgDownReachPct: mean(downReach),
      avgGainPct: mean(gains),
      avgLossPct: mean(losses),
      upDays,
      downDays,
      upRatePct: decided ? Math.round((upDays / decided) * 100) : 0,
      bias,
      confidence,
      z,
      avgVolume: rows.length ? Math.round(rows.reduce((a, b) => a + b.volume, 0) / rows.length) : 0,
      rangeRank: 0,
      movementIndex: 0,
    };
  });

  // The yardstick deliberately ignores empty slots, so a contract that never
  // traded after 10 PM does not drag the "typical" range down to near zero and
  // make every other slot look explosive by comparison.
  const active = raw.filter((s) => s.sessions >= MIN_SESSIONS_FOR_VERDICT && s.avgRangePct > 0);
  const typicalRangePct = r3(median(active.map((s) => s.avgRangePct)));

  const ranked = [...raw].filter((s) => s.sessions > 0).sort((a, b) => b.avgRangePct - a.avgRangePct);
  const rankByKey = new Map(ranked.map((s, i) => [s.key, i + 1]));

  const slots = raw.map((s) => ({
    ...s,
    rangeRank: rankByKey.get(s.key) ?? 0,
    movementIndex: typicalRangePct > 0 && s.sessions > 0 ? r3(s.avgRangePct / typicalRangePct) : 0,
  }));

  return {
    slots,
    prevLinks: buildPrevCandleLinks(slotSessions),
    sessionsAnalyzed: dates.length,
    firstDate: dates[0] ?? null,
    lastDate: dates[dates.length - 1] ?? null,
    typicalRangePct,
  };
}

// ---- Plain language ----
// The trader reading this page is not a statistician and should not have to be.
// "Coin flip", "leaning", "2.8 sigma" are the engine's words; these are the
// words the screen uses. Kept here, beside the maths they describe, so the
// wording can never drift away from what was actually computed.

/** What the direction reading means, in words anyone can act on. */
export function plainDirection(bias: Bias, confidence: Confidence): string {
  if (confidence === "insufficient") return "Not enough days yet to say";
  if (confidence === "coin_flip") return "Up or down — 50/50, no way to tell";
  if (confidence === "reliable") return bias === "up" ? "Usually goes UP" : "Usually goes DOWN";
  return bias === "up" ? "Goes up more often — but not always" : "Goes down more often — but not always";
}

/** A one-line answer to "how busy is this half hour". */
export function plainBusyness(movementIndex: number): string {
  if (movementIndex >= 1.7) return "Very busy";
  if (movementIndex >= 1.25) return "Busy";
  if (movementIndex >= 0.85) return "Normal";
  if (movementIndex > 0) return "Quiet";
  return "No data";
}

/** How much of the day's movement happens here, as a plain multiple. */
export function plainMultiple(movementIndex: number): string {
  if (movementIndex <= 0) return "—";
  if (movementIndex >= 1.05) return `${movementIndex.toFixed(1)}× the normal half hour`;
  if (movementIndex <= 0.95) return `${(1 / movementIndex).toFixed(1)}× quieter than normal`;
  return "About the same as any other half hour";
}

/** The busiest slots that actually have enough history to be worth naming. */
export function bestWindows(profile: TimeProfile, limit = 5): SlotStat[] {
  return profile.slots
    .filter((s) => s.sessions >= MIN_SESSIONS_FOR_VERDICT)
    .sort((a, b) => b.avgRangePct - a.avgRangePct)
    .slice(0, limit);
}

/** The quietest slots -- where an option buyer pays time decay for nothing. */
export function quietWindows(profile: TimeProfile, limit = 3): SlotStat[] {
  return profile.slots
    .filter((s) => s.sessions >= MIN_SESSIONS_FOR_VERDICT && s.avgRangePct > 0)
    .sort((a, b) => a.avgRangePct - b.avgRangePct)
    .slice(0, limit);
}

// ---- Live "where are we now" ----

export function istMinutesNow(now: number = Date.now()): number {
  const ist = new Date(now + 5.5 * 60 * 60 * 1000);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes();
}

export interface LiveWindow {
  inSession: boolean;
  current: SlotStat | null;
  next: SlotStat | null;
  minutesIntoSlot: number;
  minutesToNext: number;
  /** The next slot from here on that is a genuine mover, if any. */
  nextBigMover: SlotStat | null;
  minutesToBigMover: number | null;
}

export function liveWindow(profile: TimeProfile, now: number = Date.now()): LiveWindow {
  const mins = istMinutesNow(now);
  const inSession = mins >= SESSION_START_MIN && mins < SESSION_END_MIN;
  const byStart = new Map(profile.slots.map((s) => [s.startMin, s]));
  const currentStart = slotStartOf(mins);
  const current = inSession ? byStart.get(currentStart) ?? null : null;
  const nextStart = currentStart + SLOT_MINUTES;
  const next = inSession && nextStart < SESSION_END_MIN ? byStart.get(nextStart) ?? null : null;

  const upcoming = profile.slots
    .filter((s) => s.startMin > mins && s.sessions >= MIN_SESSIONS_FOR_VERDICT && s.movementIndex >= 1.25)
    .sort((a, b) => a.startMin - b.startMin);
  const nextBigMover = upcoming[0] ?? null;

  return {
    inSession,
    current,
    next,
    minutesIntoSlot: inSession ? mins - currentStart : 0,
    minutesToNext: inSession ? nextStart - mins : 0,
    nextBigMover,
    minutesToBigMover: nextBigMover ? nextBigMover.startMin - mins : null,
  };
}

// ---- Testing the specific claims ----
// Each claim is stated as the trader heard it, then answered with a number
// computed from this contract's own sessions. A claim that cannot be tested
// on the available history returns "insufficient" rather than a guess.

export type ClaimVerdict = "supported" | "mixed" | "not_supported" | "insufficient";

export interface ClaimResult {
  id: string;
  /** What was claimed, in the trader's own framing. */
  claim: string;
  /** Exactly what was measured, so the number can be argued with. */
  measured: string;
  /** The answer in plain language, with the real figures in it. */
  finding: string;
  verdict: ClaimVerdict;
  sessions: number;
  /** The honest caveat for this specific test. */
  caveat?: string;
}

const pctText = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(3)}%`;

function slotRows(sessions: SlotSession[], startMin: number): SlotSession[] {
  return sessions.filter((s) => s.startMin === startMin);
}

/** Signed move across a span of slots on one day, as a percent of the span's open. */
function spanMove(daySlots: SlotSession[], fromMin: number, toMin: number): number | null {
  const within = daySlots.filter((s) => s.startMin >= fromMin && s.startMin < toMin).sort((a, b) => a.startMin - b.startMin);
  if (within.length === 0 || !(within[0].open > 0)) return null;
  return ((within[within.length - 1].close - within[0].open) / within[0].open) * 100;
}

function groupByDate(sessions: SlotSession[]): Map<string, SlotSession[]> {
  const out = new Map<string, SlotSession[]>();
  for (const s of sessions) {
    const list = out.get(s.date);
    if (list) list.push(s);
    else out.set(s.date, [s]);
  }
  return out;
}

/** A window's average movement against the day's typical slot, as a verdict. */
function movementClaim(
  id: string,
  claim: string,
  profile: TimeProfile,
  startMin: number,
  spanSlots: number
): ClaimResult {
  const slots = profile.slots.filter((s) => s.startMin >= startMin && s.startMin < startMin + spanSlots * SLOT_MINUTES && s.sessions > 0);
  const sessions = slots.length ? Math.min(...slots.map((s) => s.sessions)) : 0;
  const measured = `Average high-to-low range of ${slotLabel(startMin).split(" – ")[0]}–${slotLabel(startMin + (spanSlots - 1) * SLOT_MINUTES).split(" – ")[1]}, against the typical half hour of this session.`;
  if (sessions < MIN_SESSIONS_FOR_VERDICT || slots.length === 0) {
    return { id, claim, measured, finding: `Only ${sessions} sessions cover this window — not enough to say anything.`, verdict: "insufficient", sessions };
  }
  const avgIndex = slots.reduce((a, b) => a + b.movementIndex, 0) / slots.length;
  const avgRange = slots.reduce((a, b) => a + b.avgRangePct, 0) / slots.length;
  const verdict: ClaimVerdict = avgIndex >= 1.25 ? "supported" : avgIndex >= 1.05 ? "mixed" : "not_supported";
  const finding =
    avgIndex >= 1.25
      ? `Yes. This window moves ${avgIndex.toFixed(2)}× the typical half hour (${avgRange.toFixed(3)}% average range) across ${sessions} sessions.`
      : avgIndex >= 1.05
        ? `Only slightly. ${avgIndex.toFixed(2)}× the typical half hour (${avgRange.toFixed(3)}%) — real but not the standout it was described as.`
        : `Not in this data. It moves ${avgIndex.toFixed(2)}× the typical half hour (${avgRange.toFixed(3)}%), so it is average or quieter than the rest of the day.`;
  return { id, claim, measured, finding, verdict, sessions };
}

/** A directional claim: does this window drift one way more than a coin flip? */
function directionClaim(id: string, claim: string, profile: TimeProfile, startMin: number, expect: "up" | "down"): ClaimResult {
  const slot = profile.slots.find((s) => s.startMin === startMin);
  const measured = `Direction of ${slot?.label ?? slotLabel(startMin)} (close against open), across every session in the sample.`;
  if (!slot || slot.sessions < MIN_SESSIONS_FOR_VERDICT) {
    return { id, claim, measured, finding: `Only ${slot?.sessions ?? 0} sessions — not enough to call a direction.`, verdict: "insufficient", sessions: slot?.sessions ?? 0 };
  }
  const matches = slot.bias === expect;
  const finding =
    slot.confidence === "coin_flip"
      ? `No. It closed ${expect} ${expect === "up" ? slot.upRatePct : 100 - slot.upRatePct}% of ${slot.sessions} sessions, and the average move is ${pctText(slot.avgMovePct)}. That is a coin flip, not a pattern.`
      : matches
        ? `Holds up so far. ${expect === "up" ? slot.upRatePct : 100 - slot.upRatePct}% of ${slot.sessions} sessions closed ${expect}, average ${pctText(slot.avgMovePct)} (${slot.confidence === "reliable" ? "clears" : "just under"} the significance bar).`
        : `The opposite, if anything. It closed ${expect === "up" ? "down" : "up"} more often (${expect === "up" ? 100 - slot.upRatePct : slot.upRatePct}% of ${slot.sessions} sessions), average ${pctText(slot.avgMovePct)}.`;
  const verdict: ClaimVerdict = slot.confidence === "coin_flip" ? "not_supported" : matches ? (slot.confidence === "reliable" ? "supported" : "mixed") : "not_supported";
  return { id, claim, measured, finding, verdict, sessions: slot.sessions, caveat: slot.sessions < MIN_SESSIONS_FOR_CONFIDENCE ? `Only ${slot.sessions} sessions — treat as a hint, not a rule.` : undefined };
}

/**
 * The conditional claim: "if 5:00-5:55 PM is up, 6:00 PM definitely falls".
 * This is the one worth testing properly, because it is the only claim in the
 * list that is conditional -- and conditioning cuts the sample roughly in half,
 * which is exactly why claims like this survive in trading folklore unchecked.
 */
export function conditionalFadeClaim(sessions: SlotSession[], claim: string): ClaimResult {
  const measured = "Sessions where 5:00–6:00 PM closed UP, then what 6:00–6:30 PM did next.";
  const byDate = groupByDate(sessions);
  let upDays = 0;
  let fadedAfterUp = 0;
  let totalFadeMove = 0;
  for (const [, daySlots] of byDate) {
    const eveningUp = spanMove(daySlots, 17 * 60, 18 * 60);
    const nextSlot = daySlots.find((s) => s.startMin === 18 * 60);
    if (eveningUp === null || !nextSlot || !(nextSlot.open > 0)) continue;
    if (eveningUp <= 0) continue;
    upDays++;
    const fade = ((nextSlot.close - nextSlot.open) / nextSlot.open) * 100;
    totalFadeMove += fade;
    if (fade < 0) fadedAfterUp++;
  }
  if (upDays < MIN_SESSIONS_FOR_VERDICT) {
    return {
      id: "evening-fade",
      claim,
      measured,
      finding: `Only ${upDays} sessions in this sample had 5:00–6:00 PM close up. That is far too few to test a word like "definitely".`,
      verdict: "insufficient",
      sessions: upDays,
    };
  }
  const rate = Math.round((fadedAfterUp / upDays) * 100);
  const { confidence } = directionVerdict(upDays - fadedAfterUp, upDays);
  const avg = totalFadeMove / upDays;
  const verdict: ClaimVerdict = confidence === "reliable" && rate > 50 ? "supported" : rate > 55 ? "mixed" : "not_supported";
  return {
    id: "evening-fade",
    claim,
    measured,
    finding:
      rate > 55
        ? `After an up 5:00–6:00 PM, the 6:00–6:30 slot fell ${rate}% of ${upDays} times, averaging ${pctText(avg)}. ${confidence === "reliable" ? "That clears the significance bar." : "That leans that way but does not clear the bar — it is not “definitely”."}`
        : `It fell only ${rate}% of ${upDays} times after an up evening, averaging ${pctText(avg)}. On this contract that is a coin flip, not a rule.`,
    verdict,
    sessions: upDays,
    caveat: "Conditioning on an up evening roughly halves the sample, which is why a claim like this can feel true for years without being true.",
  };
}

/**
 * "MCX gaps with WTI and continues that trend."
 * Tested off the morning gap sessions the app already computes: when the
 * session gapped up, did the 9:00-11:00 window keep going up?
 */
export interface GapSessionLike {
  date: string;
  gapPct: number;
  movePct: number;
}

export function gapContinuationClaim(gapSessions: GapSessionLike[], claim: string): ClaimResult {
  const measured = "Every session that gapped more than 0.25% either way, and whether the 9:00–11:00 AM window then moved the SAME way as the gap.";
  const meaningful = gapSessions.filter((s) => Math.abs(s.gapPct) >= 0.25);
  if (meaningful.length < MIN_SESSIONS_FOR_VERDICT) {
    return {
      id: "gap-continuation",
      claim,
      measured,
      finding: `Only ${meaningful.length} sessions gapped meaningfully in this sample — not enough to test continuation.`,
      verdict: "insufficient",
      sessions: meaningful.length,
    };
  }
  const continued = meaningful.filter((s) => Math.sign(s.movePct) === Math.sign(s.gapPct) && s.movePct !== 0).length;
  const rate = Math.round((continued / meaningful.length) * 100);
  const { confidence } = directionVerdict(continued, meaningful.length);
  const verdict: ClaimVerdict = confidence === "reliable" && rate > 50 ? "supported" : rate >= 55 ? "mixed" : "not_supported";
  return {
    id: "gap-continuation",
    claim,
    measured,
    finding:
      rate >= 55
        ? `The gap direction continued through the morning ${rate}% of ${meaningful.length} gapping sessions. ${confidence === "reliable" ? "That clears the significance bar." : "That leans toward continuation without clearing the bar."}`
        : `The gap continued only ${rate}% of ${meaningful.length} gapping sessions — so on this contract, fading the gap was as good as following it.`,
    verdict,
    sessions: meaningful.length,
    caveat: "This measures the gap against the morning window only. It does not test whether WTI caused the gap — the app has no per-session WTI history to line up against it.",
  };
}

/** The full claim list, as the trader described it, each answered from data. */
export function testClaims(profile: TimeProfile, sessions: SlotSession[], gapSessions: GapSessionLike[]): ClaimResult[] {
  return [
    gapContinuationClaim(gapSessions, "MCX opens gap up or down following WTI, and continues that trend."),
    directionClaim("noon-fade", "By 12:00 PM the price falls back some.", profile, 11 * 60 + 30, "down"),
    movementClaim("half-past-twelve", "From 12:30 PM there is some movement.", profile, 12 * 60 + 30, 2),
    movementClaim("four-pm", "By 4:00 PM there is movement again.", profile, 16 * 60, 2),
    conditionalFadeClaim(sessions, "If 5:00–5:55 PM is up, by 6:00 PM the price definitely falls some."),
    movementClaim("six-thirty", "From 6:30 PM the direction changes and movement is high.", profile, 18 * 60 + 30, 2),
    movementClaim("nine-to-ten", "9:00–10:00 PM movement is high.", profile, 21 * 60, 2),
  ];
}

// ---- Scheduled events (EIA releases) ----
// Both reports are published on a fixed weekly schedule in US Eastern time, so
// the IST time they land at SHIFTS with US daylight saving -- 8:00 PM IST in
// summer, 9:00 PM IST in winter. Hard-coding either one would be wrong for half
// the year, so the offset is resolved from the actual calendar.

/** UTC offset of a timezone at a given instant, in minutes (e.g. -240 for EDT). */
export function tzOffsetMinutes(timeZone: string, at: number): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const parts = dtf.formatToParts(new Date(at));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return (asUtc - Math.floor(at / 1000) * 1000) / 60000;
}

/** The instant at which a given US-Eastern wall-clock time occurs. */
export function easternToInstant(year: number, month: number, day: number, hour: number, minute: number): number {
  const naive = Date.UTC(year, month, day, hour, minute);
  // Two passes: the first offset may be wrong across a DST boundary.
  let offset = tzOffsetMinutes("America/New_York", naive);
  let instant = naive - offset * 60000;
  offset = tzOffsetMinutes("America/New_York", instant);
  return naive - offset * 60000;
}

export interface ScheduledEvent {
  id: string;
  name: string;
  affects: "CRUDEOIL" | "NATURALGAS";
  /** The exact instant of the next release. */
  atIso: string;
  /** IST wall-clock label, e.g. "8:00 PM IST". */
  istLabel: string;
  /** The half-hour slot it lands in, so the profile can be looked up. */
  slotStartMin: number;
  minutesAway: number;
  source: string;
}

/** Next occurrence of a weekday at 10:30 AM US Eastern, strictly in the future. */
function nextEasternRelease(now: number, weekday: number): number {
  for (let i = 0; i <= 8; i++) {
    const probe = new Date(now + i * 86_400_000);
    const instant = easternToInstant(probe.getUTCFullYear(), probe.getUTCMonth(), probe.getUTCDate(), 10, 30);
    const etWeekday = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short" })
      .format(new Date(instant))
      .replace(/Sun|Mon|Tue|Wed|Thu|Fri|Sat/, (d) => String(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(d))));
    if (etWeekday === weekday && instant > now) return instant;
  }
  return now;
}

export function istLabelOf(instant: number): string {
  return `${new Date(instant).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" })} IST`;
}

export function istSlotOf(instant: number): number {
  const ist = new Date(instant + 5.5 * 60 * 60 * 1000);
  return slotStartOf(ist.getUTCHours() * 60 + ist.getUTCMinutes());
}

export function scheduledEvents(now: number = Date.now()): ScheduledEvent[] {
  const crude = nextEasternRelease(now, 3); // Wednesday
  const storage = nextEasternRelease(now, 4); // Thursday
  return [
    {
      id: "eia-crude",
      name: "EIA Weekly Crude Inventories",
      affects: "CRUDEOIL",
      atIso: new Date(crude).toISOString(),
      istLabel: istLabelOf(crude),
      slotStartMin: istSlotOf(crude),
      minutesAway: Math.round((crude - now) / 60000),
      source: "EIA standing schedule — Wednesday 10:30 AM US Eastern",
    },
    {
      id: "eia-storage",
      name: "EIA Weekly Natural Gas Storage",
      affects: "NATURALGAS",
      atIso: new Date(storage).toISOString(),
      istLabel: istLabelOf(storage),
      slotStartMin: istSlotOf(storage),
      minutesAway: Math.round((storage - now) / 60000),
      source: "EIA standing schedule — Thursday 10:30 AM US Eastern",
    },
  ];
}

/**
 * What the release half-hour has actually done, measured only on the weekday
 * the report lands. With roughly one release a week, 90 days of history is
 * about a dozen observations -- reported as such, never smoothed over.
 */
export interface EventProfile {
  eventId: string;
  slotStartMin: number;
  slotLabel: string;
  releaseDaySessions: number;
  releaseDayAvgRangePct: number;
  otherDayAvgRangePct: number;
  /** How many times bigger the release half-hour is than the same slot on other days. */
  multiple: number;
  upDays: number;
  downDays: number;
  verdict: "louder" | "normal" | "insufficient";
  note: string;
}

export function eventProfile(sessions: SlotSession[], event: ScheduledEvent, weekday: number): EventProfile {
  const rows = slotRows(sessions, event.slotStartMin);
  const isReleaseDay = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay() === weekday;
  const onRelease = rows.filter((r) => isReleaseDay(r.date));
  const otherDays = rows.filter((r) => !isReleaseDay(r.date));
  const rangeOf = (list: SlotSession[]) => (list.length ? list.reduce((a, b) => a + ((b.high - b.low) / b.open) * 100, 0) / list.length : 0);
  const releaseRange = r3(rangeOf(onRelease));
  const otherRange = r3(rangeOf(otherDays));
  const multiple = otherRange > 0 ? r3(releaseRange / otherRange) : 0;
  const upDays = onRelease.filter((r) => r.close > r.open).length;
  const downDays = onRelease.filter((r) => r.close < r.open).length;

  // Four observations is not a study. This threshold is deliberately blunt.
  const verdict: EventProfile["verdict"] = onRelease.length < 6 ? "insufficient" : multiple >= 1.3 ? "louder" : "normal";
  return {
    eventId: event.id,
    slotStartMin: event.slotStartMin,
    slotLabel: slotLabel(event.slotStartMin),
    releaseDaySessions: onRelease.length,
    releaseDayAvgRangePct: releaseRange,
    otherDayAvgRangePct: otherRange,
    multiple,
    upDays,
    downDays,
    verdict,
    note:
      onRelease.length < 6
        ? `Only ${onRelease.length} release days in this contract's history — nowhere near enough to describe what the release "usually" does.`
        : multiple >= 1.3
          ? `On release days this half hour ran ${multiple.toFixed(2)}× its normal size across ${onRelease.length} releases. Direction split ${upDays} up / ${downDays} down, which says nothing about WHICH way it goes.`
          : `Across ${onRelease.length} releases this half hour was ${multiple.toFixed(2)}× its normal size — not the fireworks it is reputed to be on this contract.`,
  };
}
