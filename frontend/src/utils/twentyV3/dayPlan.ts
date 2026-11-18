// Ai20-20 v3 day plan: what today looks like before the first call -- when
// calls can come, what is on the calendar, and what kind of market it is.

import type { OptionsAnalytics } from "../../types";
import { mcxCloseMinutes, usDstForSession } from "../mcxSession";
import { daysToExpiry } from "../oiBuildup";
import type { Prepared } from "../twentyLab";
import type { V3Features } from "./features";
import { LAST_CALL_BEFORE_BELL_MIN, type V3SetupId } from "./setups";

/**
 * When each setup can make a call. "ny": minutes on the New York clock, the
 * signal candle's end (the 9:30 opening drive is one moment). "ist": minutes on
 * the IST clock, from when watching starts to the last candle's end; "bell" =
 * 30 minutes before that day's MCX close (11:00 PM in US summer, 11:25 PM in
 * US winter) -- running calls are closed at the bell itself.
 */
export type SetupWindow = { clock: "ny"; from: number; to: number } | { clock: "ist"; from: number; to: number | "bell" };
const ny = (from: number, to = from): SetupWindow => ({ clock: "ny", from, to });
const ist = (from: number, to: number | "bell"): SetupWindow => ({ clock: "ist", from, to });

export const SETUP_WINDOWS: Record<V3SetupId, SetupWindow> = {
  trend: ny(10 * 60 + 35, 13 * 60 + 20),
  noise: ny(9 * 60 + 30, 12 * 60 + 30),
  noise30: ny(9 * 60 + 30, 12 * 60 + 30),
  orb: ny(9 * 60 + 35, 11 * 60),
  orbTrend: ny(9 * 60 + 35, 11 * 60),
  drive: ny(9 * 60 + 30),
  drive60: ny(10 * 60),
  vwapPull: ny(10 * 60 + 5, 12 * 60 + 35),
  eia: ny(10 * 60 + 45),
  eiaFade: ny(10 * 60 + 45),
  driveTrend: ny(9 * 60 + 30),
  driveBusy: ny(9 * 60 + 30),
  driveSteps: ny(9 * 60 + 30),
  driveStrict: ny(9 * 60 + 30),
  fastTurnUS: ny(9 * 60 + 30, 13 * 60 + 20),
  fastBreakUS: ny(9 * 60 + 30, 13 * 60 + 20),
  fastNoiseUS: ny(9 * 60 + 30, 12 * 60 + 30),
  // The whole MCX day (setups.ts): from the 9:00 AM open to 30 minutes before the bell.
  trendDay: ist(9 * 60, "bell"),
  fastTurnDay: ist(10 * 60, 23 * 60),
  fastBreakDay: ist(10 * 60, 23 * 60),
  // gapRun.ts, window "all": 9:30 AM IST to 30 minutes before the bell.
  gapRun: ist(9 * 60 + 30, "bell"),
  gapBreak: ist(9 * 60 + 30, "bell"),
  trendGap: ny(10 * 60 + 35, 13 * 60 + 20),
};

/** Checked on one candle only (the 9:30 opening drive). */
export const isOneMoment = (id: V3SetupId) => {
  const w = SETUP_WINDOWS[id];
  return w.clock === "ny" && w.from === w.to;
};

const IST_MS = 5.5 * 3600_000;
/** No New York-clock call after 23:30 IST: too close to the bell. */
const IST_LAST_CALL = 23 * 60 + 30;
/** A one-moment setup stays "open" 10 minutes so the 5-minute server check and a late data feed can still act on that candle. */
const MOMENT_GRACE_MS = 10 * 60_000;

const nyOffsetMs = (ms: number) => {
  const d = new Date(ms);
  return (usDstForSession(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()) ? 4 : 5) * 3600_000;
};

export const istClock = (ms: number) => {
  const d = new Date(ms + IST_MS);
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};

/** The instant of New York clock minute `etMin` on the New York day that contains `now`'s MCX session. */
function etInstant(dayStartEt: number, etMin: number): number {
  return dayStartEt + etMin * 60_000 + nyOffsetMs(dayStartEt + 12 * 3600_000);
}

export interface CallWindow {
  open: boolean;
  from: number;
  /** When new calls stop (a one-moment setup: plus its 10-minute grace). */
  to: number;
  /** e.g. "8:00 PM – 11:00 PM IST", "at 8:00 PM IST", "9:00 AM – 11:55 PM IST" */
  label: string;
  /** The MCX close, when the window runs to the bell (all-day setups). */
  bell: number | null;
}

/** One setup's window on the MCX day dated `day` (that date's UTC midnight): [from, last call, until, bell]. */
function spanOn(id: V3SetupId, day: number): [number, number, number, number | null] {
  const w = SETUP_WINDOWS[id];
  const istMidnight = day - IST_MS;
  if (w.clock === "ist") {
    const d = new Date(day);
    const bell = istMidnight + mcxCloseMinutes(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()) * 60_000;
    const to = w.to === "bell" ? bell - LAST_CALL_BEFORE_BELL_MIN * 60_000 : istMidnight + w.to * 60_000;
    return [istMidnight + w.from * 60_000, to, to, w.to === "bell" ? bell : null];
  }
  const to = Math.min(etInstant(day, w.to), istMidnight + IST_LAST_CALL * 60_000);
  return [etInstant(day, w.from), to, to + (w.from === w.to ? MOMENT_GRACE_MS : 0), null];
}

/** Today's (or the next weekday's) call window for these setups: from the earliest start to the latest end. */
export function callWindow(setups: readonly V3SetupId[], now: number = Date.now()): CallWindow | null {
  if (!setups.length) return null;
  let day = Math.floor((now - nyOffsetMs(now)) / 86_400_000) * 86_400_000;
  for (let k = 0; k < 8; k++, day += 86_400_000) {
    const wd = new Date(day).getUTCDay();
    if (wd === 0 || wd === 6) continue;
    const spans = setups.map((id) => spanOn(id, day));
    const until = Math.max(...spans.map((x) => x[2]));
    if (now > until) continue;
    const from = Math.min(...spans.map((x) => x[0]));
    const last = Math.max(...spans.map((x) => x[1]));
    const bells = spans.map((x) => x[3]).filter((b): b is number => b !== null);
    const bell = bells.length ? Math.max(...bells) : null;
    const label = from === last ? `at ${istClock(from)} IST` : `${istClock(from)} – ${istClock(bell ?? last)} IST`;
    return { open: now >= from, from, to: until, label, bell };
  }
  return null;
}

export interface DayEvent {
  label: string;
  tone: "warn" | "info";
}

/** Calendar items for the MCX day holding `now`: EIA Wednesday, API Tuesday night, option expiry. */
export function dayEvents(options: OptionsAnalytics | undefined, now: number = Date.now()): DayEvent[] {
  const out: DayEvent[] = [];
  const ist = new Date(now + IST_MS);
  const istWd = ist.getUTCDay();
  // The New York morning inside an MCX day falls on the same calendar date.
  const dayStartEt = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate());
  if (istWd === 3) {
    const at = etInstant(dayStartEt, 10 * 60 + 30);
    out.push({ label: `EIA weekly crude stocks report at ${istClock(at)} IST — prices can jump hard; a running call can swing either way.`, tone: "warn" });
  }
  if (istWd === 2) out.push({ label: "API's crude stock estimate comes out after MCX closes tonight — tomorrow can open with a jump.", tone: "info" });
  if (options && !options.error && options.expiry) {
    const d = daysToExpiry(options.expiry, now);
    if (d !== null && d <= 0) out.push({ label: "Option expiry day — no new calls (fastest time decay; in-the-money options turn into futures).", tone: "warn" });
    else if (d !== null && d <= 3) out.push({ label: `Option expires in ${d} day${d === 1 ? "" : "s"} — calls use a strike slightly in the money (less time decay).`, tone: "info" });
  }
  return out;
}

export interface Regime {
  trend: "up" | "down" | "flat";
  /** ATR now vs a normal day at the same hour. */
  volRatio: number | null;
  vol: "calm" | "normal" | "busy" | "unknown";
  /** How far price is from the New York open, in "normal noise" units (1 = a usual move). */
  noiseRatio: number | null;
  text: string;
}

export function readRegime(p: Prepared, f: V3Features): Regime | null {
  const i = p.c.length - 1;
  if (i < 0) return null;
  const trend = p.htf60[i] === 1 ? "up" : p.htf60[i] === -1 ? "down" : "flat";
  const same: number[] = [];
  for (let j = i - 1; j >= 0 && same.length < 10; j--) if (p.minute[j] === p.minute[i] && p.day[j] !== p.day[i] && Number.isFinite(p.atr[j])) same.push(p.atr[j]);
  const med = same.length >= 5 ? [...same].sort((a, b) => a - b)[Math.floor(same.length / 2)] : NaN;
  const volRatio = Number.isFinite(med) && med > 0 && Number.isFinite(p.atr[i]) ? Math.round((p.atr[i] / med) * 10) / 10 : null;
  const vol = volRatio === null ? "unknown" : volRatio < 0.75 ? "calm" : volRatio > 1.35 ? "busy" : "normal";
  const sig = f.sigma[i];
  const noiseRatio = Number.isFinite(sig) && sig > 0 ? Math.round((Math.abs(p.c[i].close / f.sessOpen[i] - 1) / sig) * 10) / 10 : null;
  const parts = [trend === "flat" ? "1-hour trend flat" : `1-hour trend ${trend}`];
  if (volRatio !== null) parts.push(vol === "busy" ? `busier than usual (${volRatio}× normal swings for this hour)` : vol === "calm" ? `quieter than usual (${volRatio}× normal swings)` : "normal swings for this hour");
  if (noiseRatio !== null) parts.push(noiseRatio > 1 ? `price is outside its normal range from the New York open (${noiseRatio}×)` : "price is inside its normal range from the New York open");
  return { trend, volRatio, vol, noiseRatio, text: parts.join(" · ") };
}
