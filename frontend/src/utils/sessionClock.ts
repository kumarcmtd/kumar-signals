// The session clock -- the times of day when crude and gas habitually move,
// in IST, shifting automatically with US and UK daylight saving -- and, for
// each, what the last 90 days of 30-minute candles say actually happened.
//
// The trader's own rule is tested exactly: "if price has already rallied in
// the MCX / European session, it falls when the US opens (6:00-6:30 PM IST)".
// For every window the days are split by the move BEFORE it (bottom third =
// fell into it, top third = rallied into it) and the window's own close is
// counted in each group. A direction is only called when it clears the same
// significance bar as the Price-Alerts page (directionVerdict) -- otherwise
// it is reported as a coin flip, with the numbers.

import type { Candle } from "../types";
import { directionVerdict, type Bias, type Confidence } from "./timeProfileEngine";

export type Sym = "CRUDEOIL" | "NATURALGAS";

export interface WindowDef {
  id: string;
  label: string;
  why: string;
  /** IST start minute for a given date (DST-aware); null = not on that date. */
  startFor: (date: string) => number | null;
  minutes: number;
  markets: Sym[];
}

// ---- daylight saving ----
const nthSunday = (y: number, month: number, n: number) => {
  const d = new Date(Date.UTC(y, month, 1));
  const first = (7 - d.getUTCDay()) % 7;
  return 1 + first + (n - 1) * 7;
};
const lastSunday = (y: number, month: number) => {
  const d = new Date(Date.UTC(y, month + 1, 0));
  return d.getUTCDate() - d.getUTCDay();
};
/** US on daylight time (EDT) on this date: 2nd Sunday of March to 1st Sunday of November. */
export function usDst(date: string): boolean {
  const [y, m, d] = date.split("-").map(Number);
  const start = Date.UTC(y, 2, nthSunday(y, 2, 2));
  const end = Date.UTC(y, 10, nthSunday(y, 10, 1));
  const t = Date.UTC(y, m - 1, d);
  return t >= start && t < end;
}
/** UK on summer time (BST): last Sunday of March to last Sunday of October. */
export function ukDst(date: string): boolean {
  const [y, m, d] = date.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d);
  return t >= Date.UTC(y, 2, lastSunday(y, 2)) && t < Date.UTC(y, 9, lastSunday(y, 9));
}
/** New York clock time -> IST minutes. IST is 9:30 ahead of EDT, 10:30 ahead of EST. */
const fromNY = (h: number, m: number) => (date: string) => h * 60 + m + (usDst(date) ? 570 : 630);
const fromLondon = (h: number, m: number) => (date: string) => h * 60 + m + (ukDst(date) ? 270 : 330);
const weekday = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();

export const WINDOWS: WindowDef[] = [
  { id: "mcx_open", label: "MCX open", why: "The overnight move (US night session) lands as a gap; the first half hour often settles it.", startFor: () => 9 * 60, minutes: 30, markets: ["CRUDEOIL", "NATURALGAS"] },
  { id: "europe_open", label: "Europe / London opens", why: "European traders arrive (8:00 AM London).", startFor: fromLondon(8, 0), minutes: 30, markets: ["CRUDEOIL", "NATURALGAS"] },
  { id: "ng_4pm", label: "NG afternoon (4:00 PM)", why: "Your observation — European afternoon, US weather-model updates arriving.", startFor: () => 16 * 60, minutes: 30, markets: ["NATURALGAS"] },
  { id: "us_data", label: "US data + pre-open", why: "8:30 AM New York: US economic data; pre-open positioning.", startFor: fromNY(8, 30), minutes: 30, markets: ["CRUDEOIL", "NATURALGAS"] },
  { id: "nymex_open", label: "NYMEX day session opens", why: "9:00 AM New York — the main US energy trading day starts.", startFor: fromNY(9, 0), minutes: 30, markets: ["CRUDEOIL", "NATURALGAS"] },
  { id: "us_stocks", label: "US stock market opens", why: "9:30 AM New York — risk appetite moves crude with stocks.", startFor: fromNY(9, 30), minutes: 30, markets: ["CRUDEOIL"] },
  { id: "eia_crude", label: "EIA crude inventories (Wed)", why: "Weekly US crude stocks, 10:30 AM New York — big either-way spikes.", startFor: (d) => (weekday(d) === 3 ? fromNY(10, 30)(d) : null), minutes: 30, markets: ["CRUDEOIL"] },
  { id: "eia_gas", label: "EIA gas storage (Thu)", why: "Weekly US gas storage, 10:30 AM New York — big either-way spikes.", startFor: (d) => (weekday(d) === 4 ? fromNY(10, 30)(d) : null), minutes: 30, markets: ["NATURALGAS"] },
];

/** The US exchange's daily break -- MCX is shut, but the reopen spike shows up as tomorrow's gap. */
export function cmeBreakIst(date: string): { from: string; to: string } {
  const s = 17 * 60 + (usDst(date) ? 570 : 630) - 24 * 60;
  const f = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  return { from: f(s), to: f(s + 60) };
}

// ---- measurement ----
export interface Group {
  days: number;
  downPct: number | null;
  avgMovePct: number | null;
  bias: Bias;
  confidence: Confidence;
}
export interface WindowStat {
  def: WindowDef;
  all: Group;
  afterRally: Group; // top third of the move into the window
  afterFall: Group; // bottom third
  avgRangePct: number | null;
  rallyCut: number | null; // % move into the window that counts as "rallied" (top-third cut)
  fallCut: number | null;
}

const istParts = (iso: string) => {
  const t = new Date(Date.parse(iso) + 5.5 * 3600_000).toISOString();
  return { date: t.slice(0, 10), min: Number(t.slice(11, 13)) * 60 + Number(t.slice(14, 16)) };
};
const r2 = (n: number) => Math.round(n * 100) / 100;

function group(moves: number[]): Group {
  const n = moves.length;
  const up = moves.filter((m) => m > 0).length;
  const v = directionVerdict(up, n);
  return { days: n, downPct: n ? Math.round(((n - up) / n) * 100) : null, avgMovePct: n ? r2(moves.reduce((a, b) => a + b, 0) / n) : null, bias: v.bias, confidence: v.confidence };
}

interface DayRow {
  pre: number; // % from the 9:00 open to the window's start
  move: number; // % inside the window
  range: number;
}

export function windowRows(candles30: Candle[], def: WindowDef): DayRow[] {
  const byDay = new Map<string, { min: number; c: Candle }[]>();
  for (const c of candles30) {
    const p = istParts(c.date);
    if (!byDay.has(p.date)) byDay.set(p.date, []);
    byDay.get(p.date)!.push({ min: p.min, c });
  }
  const rows: DayRow[] = [];
  for (const [date, list] of byDay) {
    const start = def.startFor(date);
    if (start === null) continue;
    list.sort((a, b) => a.min - b.min);
    const open = list.find((x) => x.min >= 9 * 60);
    const inside = list.filter((x) => x.min >= start && x.min < start + def.minutes);
    if (!open || !inside.length || !(open.c.open > 0)) continue;
    const wOpen = inside[0].c.open;
    const wClose = inside[inside.length - 1].c.close;
    const hi = Math.max(...inside.map((x) => x.c.high));
    const lo = Math.min(...inside.map((x) => x.c.low));
    rows.push({ pre: ((wOpen - open.c.open) / open.c.open) * 100, move: ((wClose - wOpen) / wOpen) * 100, range: ((hi - lo) / wOpen) * 100 });
  }
  return rows;
}

export function measureWindow(candles30: Candle[], def: WindowDef): WindowStat {
  const rows = windowRows(candles30, def);
  const pres = rows.map((r) => r.pre).sort((a, b) => a - b);
  const cut = (q: number) => (pres.length >= 9 ? pres[Math.floor(pres.length * q)] : null);
  const lowCut = cut(1 / 3);
  const highCut = cut(2 / 3);
  const rally = highCut === null ? [] : rows.filter((r) => r.pre >= highCut && r.pre > 0);
  const fall = lowCut === null ? [] : rows.filter((r) => r.pre <= lowCut && r.pre < 0);
  return {
    def,
    all: group(rows.map((r) => r.move)),
    afterRally: group(rally.map((r) => r.move)),
    afterFall: group(fall.map((r) => r.move)),
    avgRangePct: rows.length ? r2(rows.reduce((a, r) => a + r.range, 0) / rows.length) : null,
    rallyCut: highCut === null ? null : r2(highCut),
    fallCut: lowCut === null ? null : r2(lowCut),
  };
}

/** Which group today is in, given today's move from the 9:00 open so far. */
export function todaysGroup(stat: WindowStat, preTodayPct: number | null): { key: "afterRally" | "afterFall" | "all"; g: Group } {
  if (preTodayPct !== null && stat.rallyCut !== null && preTodayPct >= stat.rallyCut && preTodayPct > 0) return { key: "afterRally", g: stat.afterRally };
  if (preTodayPct !== null && stat.fallCut !== null && preTodayPct <= stat.fallCut && preTodayPct < 0) return { key: "afterFall", g: stat.afterFall };
  return { key: "all", g: stat.all };
}

/** The plain-language line for a group: what happened, how often, and whether it is an edge. */
export function groupLine(g: Group, who: string): string {
  if (g.days < 10) return `${who}: only ${g.days} days — too few to say.`;
  const dir = g.bias === "down" ? "FELL" : g.bias === "up" ? "ROSE" : null;
  const conf = g.confidence === "reliable" ? "reliable" : g.confidence === "leaning" ? "leaning" : "coin flip";
  return dir
    ? `${who}: ${dir} on ${g.bias === "down" ? g.downPct : 100 - (g.downPct ?? 0)}% of ${g.days} days (avg ${g.avgMovePct! > 0 ? "+" : ""}${g.avgMovePct}%) — ${conf}.`
    : `${who}: fell on ${g.downPct}% of ${g.days} days — coin flip, no edge.`;
}

export const hhmm = (m: number) => {
  const h = Math.floor(m / 60);
  const mm = String(m % 60).padStart(2, "0");
  return `${((h + 11) % 12) + 1}:${mm} ${h < 12 ? "AM" : "PM"}`;
};
