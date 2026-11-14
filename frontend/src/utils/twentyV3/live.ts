// Ai20-20 v3 live engine: the setups the lab picked, read on FINISHED
// 5-minute candles -- the same functions the lab replayed, so a live call is
// exactly a call the lab would have made.

import type { Candle } from "../../types";
import { openNewEntry, type TradeLogEntry } from "../tradeLogCore";
import { exitPriceFor } from "../tradeLogPnl";
import { LAB_LOT, prepare, statsOf, type LabStats, type LabSym, type Prepared } from "../twentyLab";
import { computeFeatures, type V3Features } from "./features";
import { callWindow, istClock, readRegime, SETUP_WINDOWS, type Regime } from "./dayPlan";
import { entryAt, SETUP_NAMES, type V3Ctx, type V3Entry, type V3SetupId } from "./setups";
import { simulateV3, type V3Trade } from "./sim";
import type { V3Ticket } from "./ticket";

/**
 * Setups the engine runs, best first. The 10-year lab (labFacts.ts) found no
 * setup with a proven edge after costs: the big opening drive made +Rs 205 a
 * call over ten years in total, but it was flat on the five years no rule was
 * chosen on. So it runs as PRACTICE -- tracked and alerted like a real call,
 * marked "no real money" -- until it proves itself live. Gas: nothing came close.
 */
export const V3_ACTIVE: Record<LabSym, V3SetupId[]> = { CRUDEOIL: ["driveStrict"], NATURALGAS: [] };

/** Active setups that are practice only (paper trades): not proven on the holdout years. */
export const V3_PRACTICE: ReadonlySet<V3SetupId> = new Set<V3SetupId>(["driveStrict"]);

export const isPracticeSetup = (id: V3SetupId) => V3_PRACTICE.has(id);

/** Same day guards as the lab's "together" replay. */
export const V3_GUARDS = { maxStopsPerDay: 2, maxTradesPerDay: 3, dayLossLimitRs: 3000 } as const;

export const v3Key = (sym: LabSym) => `TWENTY20-${sym}-V3`;

const BAR_MS = 5 * 60_000;
const IST_MS = 5.5 * 3600_000;
/** ~20 days of 5-minute candles: the noise band needs 10+ earlier sessions. */
const LIVE_BARS = 3200;
const MIN_BARS = 650;
const REENTRY_COOLDOWN_MS = 10 * 60_000;

export interface SetupStatus {
  id: V3SetupId;
  name: string;
  fired: boolean;
  line: string;
}

export interface V3Read {
  state: "call" | "watch" | "window_closed" | "off" | "no_data";
  entry: V3Entry | null;
  barEnd: number | null;
  fut: number | null;
  setups: SetupStatus[];
  regime: Regime | null;
  headline: string;
}

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const nyLabel = (etMin: number) => `${((Math.floor(etMin / 60) + 11) % 12) + 1}:${String(etMin % 60).padStart(2, "0")} ${etMin < 720 ? "AM" : "PM"} New York`;

function statusLine(ctx: V3Ctx, i: number, id: V3SetupId, fired: boolean): string {
  const { p, f } = ctx;
  const sm = f.sessMin[i];
  const [from, to] = SETUP_WINDOWS[id];
  const et = p.etMinute[i] + 5; // the candle's end
  if (fired) return "Fired on this candle.";
  if (id === "trend") {
    const sc = p.score[i];
    const s = Number.isFinite(sc) ? Math.round(sc) : null;
    const trend = p.htf60[i] === 1 ? "1-hour trend up" : p.htf60[i] === -1 ? "1-hour trend down" : "1-hour trend flat";
    return `Strength ${s ?? "—"} (CE needs a fresh 58+, PE 42 or less) · ${trend} · ${nyLabel(from)} – ${nyLabel(to)}.`;
  }
  if (!Number.isFinite(sm)) return `Starts after the 9:00 AM New York open (${nyLabel(from)}).`;
  if (id === "noise" || id === "noise30") {
    if (!Number.isFinite(f.upper[i])) return "Needs 10 earlier sessions of candles for its normal-range band.";
    const next = Math.ceil((et + 0.01) / 30) * 30;
    return `Buys CE on a half-hour close above ${inr(f.upper[i])}, PE below ${inr(f.lower[i])} (VWAP ${inr(f.vwap[i])}). ${et >= to ? "No more checks today." : `Next check ${nyLabel(Math.max(next, from))}.`}`;
  }
  if (id === "orb" || id === "orbTrend") {
    if (sm < 30) return "Opening range forming until 9:30 AM New York.";
    if (!Number.isFinite(f.orHigh[i])) return "No opening range today.";
    return et > to ? `Range ${inr(f.orLow[i])} – ${inr(f.orHigh[i])}; window over for today.` : `Range ${inr(f.orLow[i])} – ${inr(f.orHigh[i])}: waiting for the day's first close outside it (until ${nyLabel(to)}).`;
  }
  if (id === "drive" || id === "drive60" || id === "driveTrend" || id === "driveBusy" || id === "driveSteps" || id === "driveStrict") return et > to ? "Checked once today — price was inside its normal range." : `Checks once at ${nyLabel(to)}: is price outside its normal range from the open?`;
  if (id === "vwapPull") return `Needs a 1-hour trend, price holding on one side of VWAP ${Number.isFinite(f.vwap[i]) ? inr(f.vwap[i]) : ""} and a dip back to it.`;
  return p.etWeekday[i] === 3 ? "Wednesday 10:45 AM New York: a big move after the EIA report?" : "Only on Wednesdays (EIA report day).";
}

export function finishedCandles(c: Candle[], now: number): Candle[] {
  return c.filter((k) => Date.parse(k.date) + BAR_MS <= now);
}

/** Prepared candles + features for the live read (the slow strength score only on the last 3 candles). */
export function liveCtx(candles: Candle[], now: number): V3Ctx | null {
  const closed = finishedCandles(candles, now);
  if (closed.length < MIN_BARS) return null;
  const p: Prepared = prepare(closed.slice(-LIVE_BARS), 3);
  const f: V3Features = computeFeatures(p);
  return { p, f };
}

export function readV3(candles: Candle[], sym: LabSym, now: number = Date.now(), ctxIn?: V3Ctx | null): V3Read {
  const setups = V3_ACTIVE[sym];
  const none = (headline: string, state: V3Read["state"]): V3Read => ({ state, entry: null, barEnd: null, fut: null, setups: [], regime: null, headline });
  if (!setups.length) return none("Every setup lost money on years of gas prices — no gas calls.", "off");
  const w = callWindow(setups, now);
  const ctx = ctxIn === undefined ? liveCtx(candles, now) : ctxIn;
  if (!ctx) return none(w && !w.open ? `Calls only ${w.label}.` : "Waiting for the 5-minute candles to load.", w && !w.open ? "window_closed" : "no_data");
  const { p } = ctx;
  const i = p.c.length - 1;
  const barEnd = Date.parse(p.c[i].date) + BAR_MS;
  const stale = now - barEnd > 15 * 60_000;
  let entry: V3Entry | null = null;
  let at = i;
  if (!stale) {
    for (const id of setups) {
      entry = entryAt(ctx, i, id);
      if (entry) break;
    }
    // One-moment setups (the 9:30 opening drive): if that candle was already
    // passed by a newer one (a late check or feed), still act on it for 15 minutes.
    for (let j = i - 1; !entry && j >= i - 2 && j >= 0 && p.day[j] === p.day[i]; j--) {
      if (now - (Date.parse(p.c[j].date) + BAR_MS) > 15 * 60_000) break;
      for (const id of setups) {
        if (SETUP_WINDOWS[id][0] !== SETUP_WINDOWS[id][1]) continue;
        entry = entryAt(ctx, j, id);
        if (entry) {
          at = j;
          break;
        }
      }
    }
  }
  const callEnd = Date.parse(p.c[at].date) + BAR_MS;
  const statuses = setups.map((id) => ({ id, name: SETUP_NAMES[id], fired: entry?.setup === id, line: statusLine(ctx, i, id, entry?.setup === id) }));
  const base = { barEnd, fut: p.c[i].close, setups: statuses, regime: readRegime(p, ctx.f) };
  if (entry) return { ...base, barEnd: callEnd, state: "call", entry, headline: `${isPracticeSetup(entry.setup) ? "Practice " : ""}${entry.side} call — ${SETUP_NAMES[entry.setup]} on the ${istClock(callEnd)} candle.` };
  if (w && !w.open) return { ...base, state: "window_closed", entry: null, headline: `Calls only ${w.label}.${w.from > now ? ` Next window opens ${istClock(w.from)}.` : ""}` };
  return { ...base, state: "watch", entry: null, headline: "Watching — no setup has fired yet." };
}

// ---- guards and the call log ----

const istDay = (ms: number) => Math.floor((ms + IST_MS) / 86_400_000);

export interface V3Guard {
  ok: boolean;
  reason: string | null;
  stopsToday: number;
  callsToday: number;
  bookedRsPerLot: number;
}

/** The lab's day guards on the real log: one call at a time, 2 stops / 3 calls a day, -Rs 3,000 a lot, 10 min after a stop. */
export function v3Guard(log: TradeLogEntry[], side: "CE" | "PE" | null, sym: LabSym, now: number): V3Guard {
  const today = log.filter((e) => istDay(e.openedAt) === istDay(now));
  const stopsToday = today.filter((e) => e.status === "sl_hit").length;
  const bookedRsPerLot = Math.round(today.filter((e) => e.closed).reduce((a, e) => a + (exitPriceFor(e) - e.entry) * LAB_LOT[sym], 0));
  const last = log[log.length - 1];
  const base = { stopsToday, callsToday: today.length, bookedRsPerLot };
  if (last && !last.closed) return { ...base, ok: false, reason: `A ${last.optSide} call is still running — one at a time.` };
  if (stopsToday >= V3_GUARDS.maxStopsPerDay) return { ...base, ok: false, reason: `${stopsToday} stop-losses today — no more calls today.` };
  if (today.length >= V3_GUARDS.maxTradesPerDay) return { ...base, ok: false, reason: `${today.length} calls today — the daily maximum.` };
  if (bookedRsPerLot <= -V3_GUARDS.dayLossLimitRs) return { ...base, ok: false, reason: `Down ${inr(-bookedRsPerLot)} a lot today — the day's loss limit. No more calls today.` };
  if (last && last.status === "sl_hit" && last.optSide === side && now - (last.closedAt ?? last.openedAt) < REENTRY_COOLDOWN_MS) return { ...base, ok: false, reason: "Stopped out a few minutes ago on this side — 10-minute pause." };
  return { ...base, ok: true, reason: null };
}

/** The log entry for a call; id and time come from the signal candle so page and server write the same one. */
export function openV3Entry(t: V3Ticket, read: V3Read): TradeLogEntry {
  const e = read.entry!;
  const why = read.setups.find((s) => s.id === e.setup);
  const entry = openNewEntry({ strike: t.strike, optSide: t.side, entry: t.entry, targets: t.targets, stop: t.stop }, read.barEnd ?? Date.now(), {
    label: `Ai20-20 v3 · ${SETUP_NAMES[e.setup]}${isPracticeSetup(e.setup) ? " (practice)" : ""}`,
    reasons: [why?.name ?? e.setup, read.regime?.text ?? ""].filter(Boolean),
    confirmingTimeframes: ["5m", "1h"],
  });
  // Hold setups keep their first stop and sell at the close, as the lab replayed them.
  return { ...entry, ...(e.manage === "hold" ? { manage: "hold" as const } : {}), ...(isPracticeSetup(e.setup) ? { practice: true } : {}) };
}

// ---- the measured record on recent real candles ----

export interface V3Record {
  from: string;
  to: string;
  together: LabStats;
  bySetup: Partial<Record<V3SetupId, LabStats>>;
  trades: V3Trade[];
}

export function measureV3(history: Candle[], sym: LabSym): V3Record | null {
  const setups = V3_ACTIVE[sym];
  if (history.length < MIN_BARS || !setups.length) return null;
  const p = prepare(history, { etFrom: 10 * 60 + 30, etTo: 13 * 60 + 15 });
  const ctx: V3Ctx = { p, f: computeFeatures(p) };
  const trades = simulateV3(ctx, setups, { sym, ...V3_GUARDS });
  const bySetup: Partial<Record<V3SetupId, LabStats>> = {};
  for (const id of setups) bySetup[id] = statsOf(simulateV3(ctx, [id], { sym }), p, SETUP_NAMES[id]);
  return { from: p.c[0].date, to: p.c[p.c.length - 1].date, together: statsOf(trades, p, "Ai20-20 v3"), bySetup, trades };
}
