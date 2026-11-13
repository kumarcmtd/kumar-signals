// Ai20-20 v2: the rule set the rules lab measured best, as the live engine.
//
// What the lab found (5-min candles; NYMEX 50 days + real MCX 15 days, to
// 10 Nov 2026; Rs per lot after costs, option at delta 0.5):
//   old rules: about 18-20 calls a day, Crude -139 / -246 per call, NG -436 / -404
//   v2 rules (Crude): about 1 call a day, +1,107 / +2,420 per call
//   NG: no rule set we tried made money on both data sets -> no NG calls
// A test on past prices, not a promise: real fills and new markets differ.
// The page shows the same rules re-measured on the last ~15 days of real MCX
// candles, so the record is always visible. Final check (lab, old vs v2):
//   NYMEX 50 days: v2 46 calls, T1 hit 37%, 54% winners, +1,110/call,
//     worst run of losses -15,057, worst day -4,203 (per lot)
//   MCX 15 days:   v2 11 calls, T1 hit 45%, 55% winners, +2,420/call
//
// The v2 call, all on FINISHED 5-minute candles (nothing repaints):
//   1. the page's own 5-min strength read turns strong (58+ CE / 42- PE) ...
//   2. ... on THIS candle (a fresh turn, not one already running = no chase)
//   3. the 1-hour trend (EMA 20 vs 50 of finished 1-hour candles) agrees
//   4. inside 10:30-13:15 New York time (after the US session's first, choppiest
//      hour; 9:00-11:30 PM IST in winter, 8:00-10:45 PM in summer)
//   5. not Wednesday 10:20-10:50 New York (the EIA crude report at 10:30:
//      option premiums are pumped up before scheduled news and drop after it)
// Plus no new call on the option's expiry day (see expiryBlock).
// Re-audit (13 Nov 2026): starting at 10:30 instead of 10:00 did better on
// both data sets and halved the worst losing run; booking half at T1 and an
// ATR trailing stop did not beat the fixed T1/T2/T3 exits.
// Levels: futures stop = 2 x ATR(14, 5-min); T1 = 1.5 x the stop distance;
// T2 = 1.6 x T1; T3 = 2.25 x T1 -- moved to the option by its delta.

import type { Candle, OptionsAnalytics } from "../types";
import { CURRENT_RULES, LAB_LOT, prepare, signalAt, simulate, statsOf, type LabRules, type LabStats, type LabSym, type LabTrade } from "./twentyLab";
import { usDstForSession } from "./mcxSession";
import { openNewEntry, type TradeLogEntry } from "./tradeLogCore";
import { daysToExpiry } from "./oiBuildup";

/** The lab's longer test (NYMEX 5-min candles, 1 Sep - 10 Nov 2026), shown on the page beside the live MCX record. */
export const V2_LAB_FACTS = {
  to: "10 Nov 2026",
  days: 50,
  ruleSetsTried: 264 + 673,
  crude: { v2Calls: 46, v2T1: 37, v2Win: 54, v2Avg: 1110, v2WorstDay: -4203, v2WorstRun: -15057, oldCalls: 889, oldAvg: -138 },
  gas: { v2Calls: 46, v2Avg: -113, oldCalls: 261, oldAvg: -433 },
} as const;

export const V2_RULES: LabRules = { signal: "score", mode: "fresh", minScore: 58, htf: "60", chop: "none", hours: "et", window: [10 * 60 + 30, 13 * 60 + 15], eiaPause: true, exits: "atr", stopAtr: 2, t1R: 1.5, timeStop: false };

/** Markets that get NEW v2 calls. NG: every rule set lost money on 50 days of NYMEX gas. */
export const V2_MARKETS: Record<LabSym, boolean> = { CRUDEOIL: true, NATURALGAS: false };

export const v2Key = (sym: LabSym) => `TWENTY20-${sym}-V2`;

/** No more calls on a market after this many stop-losses in one day. */
export const V2_MAX_STOPS_PER_DAY = 2;
const REENTRY_COOLDOWN_MS = 10 * 60_000;
const BAR_MS = 5 * 60_000;
const IST_MS = 5.5 * 3600_000;
/** ~7 sessions: room for 50 finished 1-hour candles and the 300-candle strength read. */
const LIVE_BARS = 1200;
const MIN_BARS = 650;
const WIN_FROM = 10 * 60 + 30; // New York minutes -- the same window as V2_RULES
const WIN_TO = 13 * 60 + 15;
const IST_LAST_ENTRY = 23 * 60 + 30;

// ---- the New York window ----

function nyOffsetMs(ms: number): number {
  const d = new Date(ms);
  return (usDstForSession(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()) ? 4 : 5) * 3600_000;
}

const istClock = (ms: number) => {
  const d = new Date(ms + IST_MS);
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};

export interface V2Window {
  open: boolean;
  /** Today's window in IST, e.g. "9:00 PM – 11:30 PM IST". */
  label: string;
  /** When it next opens (null while open). */
  opensAt: number | null;
  closesAt: number;
}

/** The v2 entry window around `now`: 10:30-13:15 New York time, never after 23:30 IST, weekdays. */
export function v2Window(now: number = Date.now()): V2Window {
  const span = (dayStartEt: number) => {
    const from = dayStartEt + WIN_FROM * 60_000 + nyOffsetMs(dayStartEt + 12 * 3600_000);
    let to = dayStartEt + WIN_TO * 60_000 + nyOffsetMs(dayStartEt + 12 * 3600_000);
    const istMidnight = Math.floor((from + IST_MS) / 86_400_000) * 86_400_000 - IST_MS;
    to = Math.min(to, istMidnight + IST_LAST_ENTRY * 60_000);
    return { from, to };
  };
  const off = nyOffsetMs(now);
  let dayStart = Math.floor((now - off) / 86_400_000) * 86_400_000; // New York midnight, as a UTC instant label
  for (let k = 0; k < 8; k++) {
    const wd = new Date(dayStart).getUTCDay();
    const { from, to } = span(dayStart);
    if (wd !== 0 && wd !== 6 && now < to) {
      const open = now >= from;
      return { open, label: `${istClock(from)} – ${istClock(to)} IST`, opensAt: open ? null : from, closesAt: to };
    }
    dayStart += 86_400_000;
  }
  const { from, to } = span(dayStart);
  return { open: false, label: `${istClock(from)} – ${istClock(to)} IST`, opensAt: from, closesAt: to };
}

// ---- the live read ----

export interface V2Check {
  label: string;
  ok: boolean;
  detail: string;
}

export interface V2Read {
  state: "call" | "watch" | "window_closed" | "off" | "no_data";
  /** The call's side (state "call"), else which way the 5-min read leans. */
  side: "CE" | "PE" | null;
  /** End of the finished candle the read is from. */
  barEnd: number | null;
  fut: number | null;
  atr: number | null;
  stopPts: number | null;
  t1Pts: number | null;
  strength: number | null;
  checks: V2Check[];
  headline: string;
}

export function finishedCandles(c: Candle[], now: number): Candle[] {
  return c.filter((k) => Date.parse(k.date) + BAR_MS <= now);
}

export function readV2(candles: Candle[], sym: LabSym, now: number = Date.now()): V2Read {
  const closed = finishedCandles(candles, now);
  const none = (headline: string, state: V2Read["state"] = "no_data"): V2Read => ({ state, side: null, barEnd: null, fut: null, atr: null, stopPts: null, t1Pts: null, strength: null, checks: [], headline });
  const offText = "Ai20-20 calls are off for Natural Gas — 5-minute calls lost money on gas in every rule set tested.";
  if (closed.length < MIN_BARS) {
    if (!V2_MARKETS[sym]) return none(offText, "off");
    const w0 = v2Window(now);
    if (!w0.open) return none(w0.opensAt ? `Calls only ${w0.label}. Next window opens ${istClock(w0.opensAt)}.` : `Calls only ${w0.label}.`, "window_closed");
    return none("Waiting for the 5-minute candles to load.");
  }
  const p = prepare(closed.slice(-LIVE_BARS), 3);
  const i = p.c.length - 1;
  const sc = p.score[i];
  const prev = p.score[i - 1];
  const lean = sc >= 58 ? "CE" : sc <= 42 ? "PE" : null;
  const prevLean = prev >= 58 ? "CE" : prev <= 42 ? "PE" : null;
  const want = lean === "CE" ? 1 : -1;
  const inWin = p.etMinute[i] >= WIN_FROM && p.etMinute[i] < WIN_TO && p.minute[i] < IST_LAST_ENTRY;
  const w = v2Window(now);
  const checks: V2Check[] = [
    { label: "5-min strength", ok: lean !== null, detail: Number.isFinite(sc) ? `${Math.round(sc)} (CE needs 58+, PE 42 or less)` : "not ready" },
    { label: "Fresh turn, not a chase", ok: lean !== null && prevLean !== lean, detail: lean === null ? "no strong read" : prevLean === lean ? "already strong on the last candle" : "turned strong on this candle" },
    { label: "1-hour trend agrees", ok: lean !== null && p.htf60[i] === want, detail: p.htf60[i] === 1 ? "1-hour trend up" : p.htf60[i] === -1 ? "1-hour trend down" : "1-hour trend flat" },
    { label: "US session window", ok: inWin, detail: `${w.label} (10:30 AM – 1:15 PM New York)` },
    ...(p.etWeekday[i] === 3 && p.etMinute[i] >= 10 * 60 + 20 && p.etMinute[i] < 10 * 60 + 50
      ? [{ label: "EIA report pause", ok: false, detail: "Wednesday 10:20–10:50 New York — the weekly crude report comes out at 10:30" }]
      : []),
  ];
  const side = signalAt(p, i, V2_RULES);
  const atr = p.atr[i];
  const base = { side: side ?? lean, barEnd: Date.parse(p.c[i].date) + BAR_MS, fut: p.c[i].close, atr: Number.isFinite(atr) ? atr : null, strength: Number.isFinite(sc) ? Math.round(sc) : null, checks };
  if (!V2_MARKETS[sym]) {
    return { ...base, state: "off", stopPts: null, t1Pts: null, headline: offText };
  }
  if (side && base.atr) {
    const stopPts = (V2_RULES.stopAtr ?? 2) * base.atr;
    return { ...base, side, state: "call", stopPts, t1Pts: (V2_RULES.t1R ?? 1.5) * stopPts, headline: `${side} call — every check passed on the ${istClock(base.barEnd)} candle.` };
  }
  if (!w.open && !inWin) return { ...base, state: "window_closed", stopPts: null, t1Pts: null, headline: w.opensAt ? `Calls only ${w.label}. Next window opens ${istClock(w.opensAt)}.` : `Calls only ${w.label}.` };
  const missing = checks.filter((c) => !c.ok).map((c) => c.label.toLowerCase());
  return { ...base, state: "watch", stopPts: null, t1Pts: null, headline: `Watching — waiting for: ${missing.join(", ")}.` };
}

// ---- the option plan ----

export interface V2Plan {
  strike: number;
  optSide: "CE" | "PE";
  entry: number;
  targets: [number, number, number];
  stop: number;
  delta: number;
  lot: number;
  riskRs: number;
  t1Rs: number;
  t2Rs: number;
}

const r2 = (n: number) => Number(n.toFixed(2));

/** The at-the-money option priced at the call's futures levels, by the leg's delta (0.5 when missing). */
export function planV2(read: V2Read, options: OptionsAnalytics | undefined, sym: LabSym): V2Plan | null {
  if (read.state !== "call" || !read.side || !read.stopPts || !read.t1Pts || !options || options.error) return null;
  const row = options.rows.find((r) => r.strike === options.atmStrike) ?? options.rows[Math.floor(options.rows.length / 2)];
  if (!row) return null;
  const leg = read.side === "CE" ? row.call : row.put;
  if (leg.ltp === null || leg.ltp < 1) return null;
  const raw = typeof leg.delta === "number" ? Math.abs(leg.delta) : NaN;
  const delta = raw >= 0.1 && raw <= 0.9 ? raw : 0.5;
  const entry = leg.ltp;
  const stop = r2(Math.max(entry * 0.5, entry - delta * read.stopPts));
  const t1 = r2(entry + delta * read.t1Pts);
  const t2 = r2(entry + delta * 1.6 * read.t1Pts);
  const t3 = r2(entry + delta * 2.25 * read.t1Pts);
  const lot = LAB_LOT[sym];
  return { strike: row.strike, optSide: read.side, entry, targets: [t1, t2, t3], stop, delta: r2(delta), lot, riskRs: Math.round((entry - stop) * lot), t1Rs: Math.round((t1 - entry) * lot), t2Rs: Math.round((t2 - entry) * lot) };
}

// ---- opening a call ----

const istDay = (ms: number) => Math.floor((ms + IST_MS) / 86_400_000);

export interface V2Guard {
  ok: boolean;
  reason: string | null;
  stopsToday: number;
  callsToday: number;
}

/** One call at a time; a 10-minute pause after a stop on the same side; none after 2 stops in a day. */
export function v2Guard(log: TradeLogEntry[], side: "CE" | "PE" | null, now: number): V2Guard {
  const today = log.filter((e) => istDay(e.openedAt) === istDay(now));
  const stopsToday = today.filter((e) => e.status === "sl_hit").length;
  const last = log[log.length - 1];
  const base = { stopsToday, callsToday: today.length };
  if (last && !last.closed) return { ...base, ok: false, reason: `A ${last.optSide} call is still running — one at a time.` };
  if (stopsToday >= V2_MAX_STOPS_PER_DAY) return { ...base, ok: false, reason: `${stopsToday} stop-losses today — no more Ai20-20 calls on this market today.` };
  if (last && last.status === "sl_hit" && last.optSide === side && now - (last.closedAt ?? last.openedAt) < REENTRY_COOLDOWN_MS) return { ...base, ok: false, reason: "Stopped out a few minutes ago on this side — 10-minute pause." };
  return { ...base, ok: true, reason: null };
}

/**
 * No new calls on the option's expiry day: an at-the-money option loses value
 * fastest in its last session, and in-the-money MCX crude options turn into
 * futures (with futures margin) if still held at expiry.
 */
export function expiryBlock(options: OptionsAnalytics | undefined, now: number = Date.now()): string | null {
  if (!options || options.error || !options.expiry) return null;
  const d = daysToExpiry(options.expiry, now);
  return d !== null && d <= 0 ? "The option expires today — no new Ai20-20 calls (fastest time decay; in-the-money options turn into futures at expiry)." : null;
}

/**
 * The trade-log entry for a v2 call. Its id and open time come from the
 * candle that made the call, so the page and the server -- which may both
 * see the same call -- write the SAME entry, never two.
 */
export function openV2Entry(plan: V2Plan, read: V2Read): TradeLogEntry {
  return openNewEntry(
    { strike: plan.strike, optSide: plan.optSide, entry: plan.entry, targets: plan.targets, stop: plan.stop },
    read.barEnd ?? Date.now(),
    { label: "Ai20-20 v2", reasons: read.checks.filter((c) => c.ok).map((c) => `${c.label}: ${c.detail}`), confirmingTimeframes: ["5m", "1h"] }
  );
}

// ---- the measured record (lab rules on recent real candles) ----

export interface V2Record {
  days: number;
  from: string;
  to: string;
  v2: LabStats;
  old: LabStats | null;
  /** The v2 test calls of the last V2_CAUTION.days trading days. */
  recent: { days: number; trades: number; avgRs: number | null };
  /** The rules clearly lost money lately: calls still come, marked "half size or skip". */
  caution: boolean;
  trades: LabTrade[];
}

/**
 * When to mark calls with a caution. The lab replayed several automatic
 * pauses: only this gentle one (last 10 days, 8+ calls, average below
 * -Rs 300) did not cost money on the good days, so it warns rather than
 * blocks.
 */
export const V2_CAUTION = { days: 10, minTrades: 8, floorRs: -300 } as const;

export function measureV2(history: Candle[], sym: LabSym, withOld = true): V2Record | null {
  if (history.length < MIN_BARS) return null;
  const p = prepare(history);
  const trades = simulate(p, V2_RULES, sym);
  const v2 = statsOf(trades, p, "Ai20-20 v2");
  const old = withOld ? statsOf(simulate(p, CURRENT_RULES, sym), p, "Old rules") : null;
  const days = [...new Set(p.day)].sort((a, b) => a - b);
  const since = days[Math.max(0, days.length - V2_CAUTION.days)];
  const recentT = trades.filter((t) => p.day[t.openIdx] >= since);
  const avg = recentT.length ? Math.round(recentT.reduce((a, t) => a + t.rs, 0) / recentT.length) : null;
  const caution = recentT.length >= V2_CAUTION.minTrades && (avg ?? 0) < V2_CAUTION.floorRs;
  return { days: v2.days, from: p.c[0].date, to: p.c[p.c.length - 1].date, v2, old, recent: { days: Math.min(V2_CAUTION.days, days.length), trades: recentT.length, avgRs: avg }, caution, trades };
}

// ---- the push ----

const rs = (n: number) => `Rs ${Math.abs(Math.round(n)).toLocaleString("en-IN")}`;

export function v2PushText(p: { displayName: string; plan: V2Plan; read: V2Read; record: { trades: number; avgRs: number | null; days: number } | null; cardLine: string | null; caution: boolean }): { title: string; body: string } {
  const { plan } = p;
  const why = p.read.checks.filter((c) => c.ok).map((c) => c.detail.split(" (")[0]);
  const lines = [
    `BUY ${p.displayName} ${plan.strike} ${plan.optSide} @ Rs ${plan.entry} (1 lot = ${plan.lot})`,
    `Stop Rs ${plan.stop} (-${rs(plan.riskRs)}/lot) | T1 Rs ${plan.targets[0]} (+${rs(plan.t1Rs)}/lot) | T2 Rs ${plan.targets[1]} | T3 Rs ${plan.targets[2]}`,
    `Why: ${why.join("; ")}.`,
    p.record && p.record.trades > 0 && p.record.avgRs !== null
      ? `These rules, last ${p.record.days} days on MCX: ${p.record.trades} calls, average ${p.record.avgRs >= 0 ? "+" : "-"}${rs(p.record.avgRs)}/lot (test, not live fills).`
      : "",
    p.caution ? "CAUTION: these rules lost money over the last 10 days -- half size or skip." : "",
    p.cardLine ? `Trade Card: ${p.cardLine}` : "",
    "After T1 move the stop to entry. Closes at the day's end if still open.",
  ];
  return { title: `⚡ Ai20-20: ${p.displayName} ${plan.strike} ${plan.optSide} @ Rs ${plan.entry}`, body: lines.filter(Boolean).join("\n") };
}
