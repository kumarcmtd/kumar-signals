// Ai20-20 v3 day plan: what today looks like before the first call -- when
// calls can come, what is on the calendar, and what kind of market it is.

import type { OptionsAnalytics } from "../../types";
import { usDstForSession } from "../mcxSession";
import { daysToExpiry } from "../oiBuildup";
import type { Prepared } from "../twentyLab";
import type { V3Features } from "./features";
import type { V3SetupId } from "./setups";

/** New York minutes [from, to] at which each setup can make a call (the candle's end). */
export const SETUP_WINDOWS: Record<V3SetupId, [number, number]> = {
  trend: [10 * 60 + 35, 13 * 60 + 20],
  noise: [9 * 60 + 30, 12 * 60 + 30],
  noise30: [9 * 60 + 30, 12 * 60 + 30],
  orb: [9 * 60 + 35, 11 * 60],
  orbTrend: [9 * 60 + 35, 11 * 60],
  drive: [9 * 60 + 30, 9 * 60 + 30],
  drive60: [10 * 60, 10 * 60],
  vwapPull: [10 * 60 + 5, 12 * 60 + 35],
  eia: [10 * 60 + 45, 10 * 60 + 45],
  eiaFade: [10 * 60 + 45, 10 * 60 + 45],
  driveTrend: [9 * 60 + 30, 9 * 60 + 30],
  driveBusy: [9 * 60 + 30, 9 * 60 + 30],
  driveSteps: [9 * 60 + 30, 9 * 60 + 30],
};

const IST_MS = 5.5 * 3600_000;
/** No call after 23:30 IST, whatever the setup: too close to the bell. */
const IST_LAST_CALL = 23 * 60 + 30;

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
  to: number;
  /** e.g. "8:00 PM – 11:00 PM IST" */
  label: string;
}

/** Today's (or the next weekday's) call window for these setups. */
export function callWindow(setups: readonly V3SetupId[], now: number = Date.now()): CallWindow | null {
  if (!setups.length) return null;
  const fromEt = Math.min(...setups.map((s) => SETUP_WINDOWS[s][0]));
  const toEt = Math.max(...setups.map((s) => SETUP_WINDOWS[s][1]));
  let dayStart = Math.floor((now - nyOffsetMs(now)) / 86_400_000) * 86_400_000;
  for (let k = 0; k < 8; k++, dayStart += 86_400_000) {
    const wd = new Date(dayStart).getUTCDay();
    if (wd === 0 || wd === 6) continue;
    const from = etInstant(dayStart, fromEt);
    const istMidnight = Math.floor((from + IST_MS) / 86_400_000) * 86_400_000 - IST_MS;
    const to = Math.min(etInstant(dayStart, toEt), istMidnight + IST_LAST_CALL * 60_000);
    if (now <= to) return { open: now >= from, from, to, label: `${istClock(from)} – ${istClock(to)} IST` };
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
    out.push({ label: `EIA weekly crude stocks report at ${istClock(at)} IST — prices jump; no new trend calls 10 minutes before to 20 after.`, tone: "warn" });
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
