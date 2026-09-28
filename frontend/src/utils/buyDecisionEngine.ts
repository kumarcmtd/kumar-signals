// Buy Decision engine -- "should I buy CE, buy PE, or wait?"
//
// WHY IT IS BUILT THIS WAY. The page this replaces re-scored every five
// seconds against the candle still forming, the live option premium and
// order-book ticks, then subtracted up to fifteen stacked penalties. A dip
// turned it red, a bounce turned it green, and three ordinary flags were
// enough to reject almost anything. This engine:
//
//   * reads CLOSED candles only, so a verdict can change only when a 15-minute
//     candle closes -- never mid-candle on a price spike;
//   * needs TWO closed candles in a row to give a BUY, and once given keeps
//     it until the evidence clearly weakens (a lower bar to hold than to enter),
//     so one wobble cannot flip it;
//   * weighs the higher timeframes most: a 15-minute setup against the
//     1-hour/4-hour trend is not a BUY, however good it looks;
//   * never shows a "win probability". The strength figure is how much of the
//     evidence agrees, capped at 94, and it says so.
//
// The live price is used for one thing only: a note beside the verdict when
// price has since run away from the entry or broken the stop. It never
// changes the verdict itself.

import type { Candle } from "../types";
import { closedBy, closedOnly, readFormation, readMomentum, readParticipation, readRoom, readSetupTrend, readTrend, type Note, type RoomRead, type Side, type TrendRead } from "./decisionPillars";

export type Verdict = "BUY_CE" | "BUY_PE" | "FORMING_CE" | "FORMING_PE" | "WAIT" | "EVENT_WAIT" | "CLOSED";

export const WEIGHTS = { bigTrend: 28, setup: 18, momentum: 18, formation: 14, room: 12, participation: 10 } as const;
const ENTER_SCORE = 66;
const HOLD_SCORE = 56;
const MAX_STRENGTH = 94;
const STEPS = 10;

export interface PillarView {
  key: keyof typeof WEIGHTS;
  title: string;
  weight: number;
  vote: number; // -1 bear .. +1 bull
  notes: Note[];
  insufficient?: boolean;
}

export interface TimeframeView {
  label: string;
  direction: Side;
  vote: number;
}

export interface Plan {
  side: "CE" | "PE";
  entry: number; // underlying, at the confirming candle's close
  stop: number;
  t1: number;
  t2: number;
  riskPts: number;
  stopBasis: string;
  t1Basis: string;
}

export interface StepView {
  at: string; // IST HH:MM of the candle
  bull: number;
  bear: number;
  state: "BULL" | "BEAR" | "WAIT";
}

export interface DecisionResult {
  verdict: Verdict;
  /** What the candles alone say, before the event / market-closed overrides. */
  technical: Verdict;
  side: "CE" | "PE" | null; // the side the verdict (or the lean) is about
  bull: number;
  bear: number;
  strength: number; // agreement for `side`, 0..94
  since: string | null;
  lastClosedAt: string | null;
  timeframes: TimeframeView[];
  pillars: PillarView[];
  waitingFor: string[];
  cautions: string[];
  plan: Plan | null;
  room: RoomRead;
  history: StepView[];
}

export interface DecisionInput {
  c15: Candle[];
  c60: Candle[];
  c240: Candle[];
  now: number;
  marketOpen: boolean;
  /** Minutes to the next EIA release for this symbol, and since the last one. */
  eia?: { minutesAway: number; minutesSince: number; label: string } | null;
  minutesToClose?: number | null;
  daysToOptionExpiry?: number | null;
}

interface StepScore {
  bull: number;
  bear: number;
  big: number;
  h1: TrendRead;
  h4: TrendRead;
  setup: TrendRead;
  pillars: PillarView[];
  room: RoomRead;
  close: number;
  at: string;
}

const istTime = (stamp: string) => stamp.slice(11, 16);

function scoreAt(c15: Candle[], c60: Candle[], c240: Candle[]): StepScore {
  const h1 = readTrend(c60, "1h");
  const h4 = readTrend(c240, "4h");
  // The 1-hour counts a little more than the 4-hour for intraday options.
  const big = h1.insufficient && h4.insufficient ? 0 : h1.insufficient ? h4.vote : h4.insufficient ? h1.vote : h1.vote * 0.55 + h4.vote * 0.45;
  const setup = readSetupTrend(c15);
  const momentum = readMomentum(c15);
  const formation = readFormation(c15);
  const room = readRoom(c15);
  const participation = readParticipation(c15);

  const signed: [keyof typeof WEIGHTS, number][] = [
    ["bigTrend", big],
    ["setup", setup.vote],
    ["momentum", momentum.vote],
    ["formation", formation.vote],
    ["participation", participation.vote],
  ];
  let bull = 0;
  let bear = 0;
  for (const [k, v] of signed) {
    bull += (WEIGHTS[k] * (1 + v)) / 2;
    bear += (WEIGHTS[k] * (1 - v)) / 2;
  }
  bull += (WEIGHTS.room * (1 + room.bull)) / 2;
  bear += (WEIGHTS.room * (1 + room.bear)) / 2;

  const pillars: PillarView[] = [
    { key: "bigTrend", title: "Big trend (1h + 4h)", weight: WEIGHTS.bigTrend, vote: big, notes: [...h1.notes, ...h4.notes], insufficient: h1.insufficient && h4.insufficient },
    { key: "setup", title: "15-min trend & structure", weight: WEIGHTS.setup, vote: setup.vote, notes: setup.notes, insufficient: setup.insufficient },
    { key: "momentum", title: "Momentum", weight: WEIGHTS.momentum, vote: momentum.vote, notes: momentum.notes, insufficient: momentum.insufficient },
    { key: "formation", title: "Candle formation", weight: WEIGHTS.formation, vote: formation.vote, notes: formation.notes, insufficient: formation.insufficient },
    { key: "room", title: "Room to move", weight: WEIGHTS.room, vote: (room.bull - room.bear) / 2, notes: room.notes },
    { key: "participation", title: "VWAP & volume", weight: WEIGHTS.participation, vote: participation.vote, notes: participation.notes, insufficient: participation.insufficient },
  ];
  const last = c15[c15.length - 1];
  return { bull: Math.round(bull), bear: Math.round(bear), big, h1, h4, setup, pillars, room, close: last.close, at: last.date };
}

const qualifies = (s: StepScore, side: "bull" | "bear") => {
  const sign = side === "bull" ? 1 : -1;
  const score = side === "bull" ? s.bull : s.bear;
  const room = side === "bull" ? s.room.bull : s.room.bear;
  const momentum = s.pillars.find((p) => p.key === "momentum")!.vote * sign;
  // Never clearly against the 4-hour trend, even when the 1-hour agrees.
  const h4Ok = s.h4.insufficient || s.h4.vote * sign > -0.5;
  return score >= ENTER_SCORE && s.big * sign >= 0.25 && h4Ok && s.setup.vote * sign > 0 && momentum > -0.2 && room > -0.5;
};
const holds = (s: StepScore, side: "bull" | "bear") => {
  const sign = side === "bull" ? 1 : -1;
  const score = side === "bull" ? s.bull : s.bear;
  return score >= HOLD_SCORE && s.big * sign > -0.25 && s.setup.vote * sign > -0.4;
};

function planFor(side: "CE" | "PE", s: StepScore, c15: Candle[]): Plan {
  const a = s.room.atr;
  const entry = s.close;
  const recent = c15.slice(-6);
  const up = side === "CE";
  const swing = up ? Math.min(...recent.map((c) => c.low)) : Math.max(...recent.map((c) => c.high));
  let dist = Math.abs(entry - swing) + a * 0.15;
  let stopBasis = up ? "just below the last 6 candles' low" : "just above the last 6 candles' high";
  if (dist < a * 0.8) { dist = a * 0.8; stopBasis = "0.8× ATR (the swing was too close to give room)"; }
  if (dist > a * 2.5) { dist = a * 2.5; stopBasis = "2.5× ATR (capped — the swing was too far)"; }
  const stop = up ? entry - dist : entry + dist;
  const level = up ? s.room.resistance : s.room.support;
  const levelDist = level !== null ? Math.abs(level - entry) : null;
  const useLevel = levelDist !== null && levelDist >= dist * 0.8;
  const t1 = useLevel ? level! : up ? entry + dist : entry - dist;
  // Target 2 is at least 2x the risk, and always a full risk-unit past T1.
  const t2 = up ? Math.max(entry + dist * 2, t1 + dist) : Math.min(entry - dist * 2, t1 - dist);
  const r = (n: number) => Math.round(n * 100) / 100;
  return {
    side, entry: r(entry), stop: r(stop), t1: r(t1), t2: r(t2), riskPts: r(dist), stopBasis,
    t1Basis: useLevel ? `the next swing ${up ? "resistance" : "support"}` : "1× the risk (no swing level in the way)",
  };
}

function waitingList(s: StepScore, side: "bull" | "bear", streak: number): string[] {
  const sign = side === "bull" ? 1 : -1;
  const word = side === "bull" ? "up" : "down";
  const out: string[] = [];
  if (s.big * sign < 0.25) {
    const d = (t: TrendRead) => (t.insufficient ? "not enough data" : t.direction === "bull" ? "up" : t.direction === "bear" ? "down" : "sideways");
    out.push(`The bigger trend to turn ${word} (1-hour: ${d(s.h1)}, 4-hour: ${d(s.h4)}).`);
  }
  if (s.setup.vote * sign <= 0) out.push(`The 15-minute trend to turn ${word} (EMA20/EMA50, SuperTrend).`);
  const score = side === "bull" ? s.bull : s.bear;
  if (score < ENTER_SCORE) out.push(`More of the evidence to agree — ${score}/100 now, ${ENTER_SCORE} needed.`);
  const room = side === "bull" ? s.room.bull : s.room.bear;
  const level = side === "bull" ? s.room.resistance : s.room.support;
  if (room <= -0.5 && level !== null) out.push(`A 15-minute close ${side === "bull" ? "above" : "below"} ₹${level.toLocaleString("en-IN")} — that level is too close to leave room.`);
  if (streak === 1) out.push("One more candle close that still qualifies, to confirm.");
  return out;
}

export function evaluateBuyDecision(input: DecisionInput): DecisionResult | null {
  const c15 = closedOnly(input.c15, 15, input.now, input.marketOpen).slice(-300);
  const c60 = closedOnly(input.c60, 60, input.now, input.marketOpen).slice(-300);
  const c240 = closedOnly(input.c240, 240, input.now, input.marketOpen).slice(-200);
  if (c15.length < 60) return null;

  // Walk the last STEPS closed 15-minute candles, oldest first, so the
  // verdict carries its own history: BUY needs two qualifying closes in a
  // row and is held until the evidence clearly weakens.
  const steps: StepScore[] = [];
  for (let back = Math.min(STEPS, c15.length - 60) - 1; back >= 0; back--) {
    const upto = c15.slice(0, c15.length - back);
    const cutoff = Date.parse(upto[upto.length - 1].date) + 15 * 60_000;
    steps.push(scoreAt(upto, closedBy(c60, 60, cutoff), closedBy(c240, 240, cutoff)));
  }

  let state: "BULL" | "BEAR" | "WAIT" = "WAIT";
  let since: string | null = null;
  let bullStreak = 0;
  let bearStreak = 0;
  const history: StepView[] = [];
  for (const s of steps) {
    if (state === "BULL" && !holds(s, "bull")) state = "WAIT";
    if (state === "BEAR" && !holds(s, "bear")) state = "WAIT";
    bullStreak = qualifies(s, "bull") ? bullStreak + 1 : 0;
    bearStreak = qualifies(s, "bear") ? bearStreak + 1 : 0;
    if (state === "WAIT" && bullStreak >= 2) { state = "BULL"; since = s.at; }
    else if (state === "WAIT" && bearStreak >= 2) { state = "BEAR"; since = s.at; }
    if (state === "WAIT") since = null;
    history.push({ at: istTime(s.at), bull: s.bull, bear: s.bear, state });
  }

  const now = steps[steps.length - 1];
  const lean: "bull" | "bear" = state === "BULL" ? "bull" : state === "BEAR" ? "bear" : now.bull >= now.bear ? "bull" : "bear";
  const side: "CE" | "PE" = lean === "bull" ? "CE" : "PE";
  let verdict: Verdict = state === "BULL" ? "BUY_CE" : state === "BEAR" ? "BUY_PE" : bullStreak === 1 ? "FORMING_CE" : bearStreak === 1 ? "FORMING_PE" : "WAIT";

  const technical = verdict;
  const cautions: string[] = [];
  const eia = input.eia;
  if (eia && (eia.minutesAway <= 45 || eia.minutesSince <= 30)) {
    if (verdict !== "WAIT") cautions.push(`The technical read was ${verdict.startsWith("BUY") ? "a BUY" : "forming"}, but it is held back for the report.`);
    verdict = "EVENT_WAIT";
    cautions.unshift(
      eia.minutesAway <= 45
        ? `${eia.label} in ${eia.minutesAway} min — price can jump either way in seconds. Wait until it is out.`
        : `${eia.label} came out ${eia.minutesSince} min ago — let the first spike settle.`
    );
  }
  if (!input.marketOpen) verdict = "CLOSED";
  if (input.minutesToClose != null && input.minutesToClose < 30 && input.marketOpen) cautions.push(`Only ${input.minutesToClose} min to MCX close — little time for a new option buy to work.`);
  if (input.daysToOptionExpiry != null && input.daysToOptionExpiry <= 2) cautions.push(`Options expire in ${input.daysToOptionExpiry} day${input.daysToOptionExpiry === 1 ? "" : "s"} — premium loses value fast; keep size small.`);

  const bothHigh = now.bull >= 55 && now.bear >= 55;
  if (bothHigh) cautions.push("Evidence is split both ways — a choppy market.");

  const streak = lean === "bull" ? bullStreak : bearStreak;
  const waitingFor = state === "WAIT" ? waitingList(now, lean, streak) : [];
  const score = lean === "bull" ? now.bull : now.bear;

  return {
    verdict,
    technical,
    side: verdict === "WAIT" && score < 55 ? null : side,
    bull: now.bull,
    bear: now.bear,
    strength: Math.min(MAX_STRENGTH, score),
    since: since ? istTime(since) : null,
    lastClosedAt: istTime(now.at),
    timeframes: [
      { label: "4 Hours", direction: now.h4.insufficient ? "neutral" : now.h4.direction, vote: now.h4.vote },
      { label: "1 Hour", direction: now.h1.insufficient ? "neutral" : now.h1.direction, vote: now.h1.vote },
      { label: "15 Min", direction: now.setup.direction, vote: now.setup.vote },
    ],
    pillars: now.pillars,
    waitingFor,
    cautions,
    plan: planFor(side, now, c15),
    room: now.room,
    history,
  };
}
