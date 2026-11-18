// Smart Ai20-20 lab -- what to keep strict and what to set free:
//   1. the v2 trend calls (the ones the trader earned from) as they were, and
//      with a recent-record switch: live only while the rule's own last N days
//      were profitable (it trades its good seasons, rests in its bad ones);
//   2. the trader's "run to the recent high" setups (twentyV3/gapRun.ts), from
//      strict to liberal, so the data says which filters earn their place.
// Rs per lot after costs (Rs 150 crude / Rs 200 gas + ~Rs 50 an hour of time
// decay), option at delta 0.5. Aggregates only -- no prices are printed.
//
//   DUKA_DIR=/tmp/duka LAB_MARKET=CRUDEOIL npx -y tsx scripts/smart-lab.ts
//   LAB_SYNTH=1 npx -y tsx scripts/smart-lab.ts     (offline smoke test)

import { gateTrades, prepare, statsOf, type LabSym, type LabTrade, type Prepared } from "../frontend/src/utils/twentyLab";
import { computeFeatures } from "../frontend/src/utils/twentyV3/features";
import { GAP_DEFAULT, type GapParams } from "../frontend/src/utils/twentyV3/gapRun";
import type { V3Ctx, V3SetupId } from "../frontend/src/utils/twentyV3/setups";
import { simulateV3, type V3SimOpts, type V3Trade } from "../frontend/src/utils/twentyV3/sim";
import type { Candle } from "../frontend/src/types";
import { dukascopy, mcx, yahoo } from "./lab-data";

const FROM = process.env.LAB_FROM || "2022-01-01";
const TO = process.env.LAB_TO || new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
const HOLDOUT = !!process.env.LAB_TO;
const GUARDS: Partial<V3SimOpts> = { maxStopsPerDay: 2, maxTradesPerDay: 4, dayLossLimitRs: 3000 };

interface Data {
  name: string;
  sym: LabSym;
  ctx: V3Ctx;
}

const fmt = (n: number | null | undefined) => (n === null || n === undefined || !Number.isFinite(n) ? "—" : String(Math.round(n)));
const avg = (t: LabTrade[]) => (t.length ? t.reduce((a, x) => a + x.rs, 0) / t.length : null);

const HEAD = "| Version | Calls | /month | Win | Avg Rs | Net Rs | PF | Max DD | 1st / 2nd half avg |\n|---|---|---|---|---|---|---|---|---|";
function row(label: string, t: LabTrade[], d: Data): string {
  const s = statsOf(t, d.ctx.p, label);
  const perMonth = s.days ? (t.length / s.days) * 21 : 0;
  return `| ${label} | ${s.trades} | ${perMonth.toFixed(1)} | ${fmt(s.winPct)}% | ${fmt(s.avgRs)} | ${s.netRs} | ${s.profitFactor ?? "—"} | ${s.maxDrawdownRs} | ${fmt(s.firstHalfAvg)} / ${fmt(s.secondHalfAvg)} |`;
}

function byYear(t: LabTrade[]): string {
  const m = new Map<string, LabTrade[]>();
  for (const x of t) m.set(x.openAt.slice(0, 4), [...(m.get(x.openAt.slice(0, 4)) ?? []), x]);
  return [...m.entries()].sort().map(([y, xs]) => `${y}: ${xs.length} / ${fmt(avg(xs))}`).join(" · ");
}

function months(t: LabTrade[]): string {
  const m = new Map<string, number>();
  for (const x of t) m.set(x.openAt.slice(0, 7), (m.get(x.openAt.slice(0, 7)) ?? 0) + x.rs);
  const v = [...m.values()];
  return `${v.filter((x) => x > 0).length} of ${v.length} months profitable`;
}

function byIstHour(t: V3Trade[], p: Prepared): string {
  const m = new Map<number, V3Trade[]>();
  for (const x of t) {
    const h = Math.floor(p.minute[x.openIdx] / 60);
    m.set(h, [...(m.get(h) ?? []), x]);
  }
  return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([h, xs]) => `${h}h: ${xs.length} / ${fmt(avg(xs))}`).join(" · ");
}

function exits(t: LabTrade[]): string {
  const m = new Map<string, number>();
  for (const x of t) m.set(x.exit, (m.get(x.exit) ?? 0) + 1);
  return [...m.entries()].map(([k, n]) => `${k} ${n}`).join(" · ");
}

const run = (d: Data, ids: V3SetupId[], gap?: Partial<GapParams>, extra: Partial<V3SimOpts> = {}) => simulateV3(gap ? { ...d.ctx, gap } : d.ctx, ids, { sym: d.sym, ...extra });

/** The recent-record switch: [lookback days, min trades, pause only on clear evidence of losing]. */
const SWITCHES: [number, number, boolean][] = [
  [10, 5, false],
  [20, 8, false],
  [40, 15, false],
  [10, 5, true],
  [20, 8, true],
  [40, 15, true],
];
function switchRows(label: string, t: LabTrade[], d: Data, lines: string[]) {
  for (const [look, n, evidence] of SWITCHES) {
    const g = gateTrades(t, d.ctx.p, look, n, 0, evidence);
    lines.push(row(`${label} · ${evidence ? "rest only when" : "live only when"} last ${look} days ${evidence ? "lost" : "made money"} (${n}+ calls)`, g.gated, d));
  }
}

const gapLabel = (g: Partial<GapParams>) => {
  const x = { ...GAP_DEFAULT, ...g };
  return `look ${x.lookback} · room ${x.roomAtr}${x.breakBuf !== 0.1 ? ` · clear ${x.breakBuf}` : ""} · speed ${x.speedMin || "off"} · 1h ${x.trend} · ${x.window}${x.dropAtr !== 2 ? ` · drop ${x.dropAtr}` : ""}${x.recAtr !== 1.5 ? ` · back ${x.recAtr}` : ""}${x.recBars !== 6 ? ` in ${x.recBars}` : ""}${x.stopAtr !== 1.5 ? ` · stop ${x.stopAtr}` : ""}`;
};

function grid(keys: ("lookback" | "roomAtr" | "speedMin" | "trend" | "window")[]): Partial<GapParams>[] {
  const vals: Record<string, unknown[]> = { lookback: [24, 36, 60], roomAtr: [2, 3], speedMin: [0, 60], trend: ["none", "agree"], window: ["all", "us"] };
  let out: Partial<GapParams>[] = [{}];
  for (const k of keys) out = out.flatMap((g) => vals[k].map((v) => ({ ...g, [k]: v })));
  return out;
}

// gapRun: the fall from the high is implied by room + recovery, so it is not varied; gapBreak has no recovery or ATR stop.
const ONE_OFFS: Record<"gapRun" | "gapBreak", Partial<GapParams>[]> = {
  gapRun: [{ recAtr: 1 }, { recAtr: 2 }, { recBars: 3 }, { recBars: 10 }, { roomAtr: 4 }, { stopAtr: 1 }, { stopAtr: 2 }, { trend: "notAgainst" }, { window: "euus" }, { speedMin: 70 }],
  gapBreak: [{ dropAtr: 1.5 }, { dropAtr: 3 }, { breakBuf: 0.25 }, { trend: "notAgainst" }, { window: "euus" }, { speedMin: 70 }],
};

function gapSection(d: Data, id: "gapRun" | "gapBreak", title: string, keys: Parameters<typeof grid>[0], lines: string[]) {
  lines.push(`\n### ${title}`, "\n**As described (the trader's rule, no extra filters)**", HEAD);
  const base = run(d, [id]);
  lines.push(row("As described", base, d), row("As described, with day limits (2 stops / 4 calls / -Rs 3,000)", run(d, [id], undefined, GUARDS), d));
  lines.push(`- By year: ${byYear(base)}`, `- ${months(base)}`, `- Entry hour (IST): ${byIstHour(base, d.ctx.p)}`, `- Exits: ${exits(base)}`);
  lines.push("\n**One rule at a time** (each row changes one thing from the rule as described)", HEAD);
  for (const g of ONE_OFFS[id]) lines.push(row(gapLabel(g), run(d, [id], g), d));
  const all = grid(keys).map((g) => ({ g, t: run(d, [id], g) }));
  const scored = all.map((x) => ({ ...x, s: statsOf(x.t, d.ctx.p, "x") }));
  const good = scored.filter((x) => x.s.trades >= 80 && (x.s.avgRs ?? -1) > 0);
  const big = scored.filter((x) => x.s.trades >= 80);
  lines.push(`\n**Strict to liberal: ${all.length} versions** — ${big.length} have 80+ calls, ${good.length} of them made money. Best 10 of those by average:`, HEAD);
  for (const x of [...big].sort((a, b) => (b.s.avgRs ?? -1e9) - (a.s.avgRs ?? -1e9)).slice(0, 10)) lines.push(row(gapLabel(x.g), x.t, d));
  // What each filter adds on average across the grid.
  for (const k of keys) {
    const groups = new Map<string, number[]>();
    for (const x of scored) {
      const v = String((x.g as Record<string, unknown>)[k]);
      groups.set(v, [...(groups.get(v) ?? []), x.s.avgRs ?? 0]);
    }
    lines.push(`- ${k}: ${[...groups.entries()].map(([v, a]) => `${v} → avg ${fmt(a.reduce((s, y) => s + y, 0) / a.length)}`).join(" · ")}`);
  }
  switchRows("As described", base, d, (lines.push("\n**With the recent-record switch**", HEAD), lines));
}

const ROUND2 = process.env.LAB_SET === "round2";

function load(name: string, sym: LabSym, candles: Candle[]): Data {
  // The v2 strength score is only needed in its own New York window (round 2 tries wider ones).
  const p = prepare(candles, ROUND2 ? { etFrom: 9 * 60 + 30, etTo: 14 * 60 } : { etFrom: 10 * 60 + 30, etTo: 13 * 60 + 15 });
  return { name, sym, ctx: { p, f: computeFeatures(p) } };
}

function header(d: Data): string {
  const c = d.ctx.p.c;
  return `\n## ${d.name} — ${c.length} candles, ${new Set(d.ctx.p.day).size} days (${c[0]?.date.slice(0, 10)} to ${c[c.length - 1]?.date.slice(0, 10)})\n`;
}

function full(d: Data, lines: string[]) {
  lines.push(header(d), "### The v2 trend calls (10:30 AM – 1:15 PM New York)", HEAD);
  const trend = run(d, ["trend"]);
  lines.push(row("v2 as it was", trend, d), row("v2 with day limits", run(d, ["trend"], undefined, GUARDS), d));
  lines.push(`- By year: ${byYear(trend)}`, `- ${months(trend)}`);
  switchRows("v2", trend, d, lines);
  for (const [look, n, ev] of [[20, 8, false], [20, 8, true]] as const) lines.push(`- v2, ${ev ? "rest only when last 20 days lost" : "live only when last 20 days made money"}, by year: ${byYear(gateTrades(trend, d.ctx.p, look, n, 0, ev).gated)}`);
  gapSection(d, "gapRun", "Run to the recent high / low (gapRun)", ["lookback", "roomAtr", "speedMin", "trend", "window"], lines);
  gapSection(d, "gapBreak", "Stable 5-minute close beyond the high / low (gapBreak)", ["lookback", "speedMin", "trend", "window"], lines);
  lines.push("\n### Together (one call at a time, day limits)", HEAD);
  for (const ids of [["gapBreak", "gapRun"], ["trend", "gapBreak", "gapRun"]] as V3SetupId[][]) {
    const t = run(d, ids, undefined, GUARDS);
    lines.push(row(ids.join(" > "), t, d));
  }
}

/** Round 2: the v2 rule with the trader's "care at the high" check, wider windows and Speed; each also with the season switch. */
const R2: [string, V3SetupId, Partial<V3Ctx>][] = [
  ["v2 as it was (10:30 AM - 1:15 PM NY)", "trend", {}],
  ["v2, from 9:30 AM NY", "trend", { v2Window: [570, 795] }],
  ["v2, from 10:00 AM NY", "trend", { v2Window: [600, 795] }],
  ["v2, until 2:00 PM NY", "trend", { v2Window: [630, 840] }],
  ["v2 + care at the high 0.5 ATR", "trendGap", { gap: { nearAtr: 0.5 } }],
  ["v2 + care at the high 1 ATR", "trendGap", { gap: { nearAtr: 1 } }],
  ["v2 + care at the high 1.5 ATR", "trendGap", { gap: { nearAtr: 1.5 } }],
  ["v2 + care at the high 2 ATR", "trendGap", { gap: { nearAtr: 2 } }],
  ["v2 + care at the 5-hour high 1 ATR", "trendGap", { gap: { nearAtr: 1, lookback: 60 } }],
  ["v2 + care at the 2-hour high 1 ATR", "trendGap", { gap: { nearAtr: 1, lookback: 24 } }],
  ["v2 + fast (Speed 60+)", "trendGap", { gap: { speedMin: 60 } }],
  ["v2 + care 1 ATR + Speed 60+", "trendGap", { gap: { nearAtr: 1, speedMin: 60 } }],
];
const season = (t: LabTrade[], d: Data) => gateTrades(t, d.ctx.p, 10, 5, 0, true).gated;

function round2(d: Data, lines: string[], withYears: boolean) {
  const res = R2.map(([label, id, extra]) => ({ label, t: simulateV3({ ...d.ctx, ...extra }, [id], { sym: d.sym }) }));
  lines.push(header(d), "### Every version as it is", HEAD);
  for (const r of res) lines.push(row(r.label, r.t, d));
  lines.push("\n### With the season switch (rest only when the last 10 days clearly lost: 5+ calls, average below zero)", HEAD);
  for (const r of res) lines.push(row(r.label, season(r.t, d), d));
  if (withYears) {
    lines.push("\n**By year** (calls / avg Rs; plain → with the season switch)");
    for (const r of res) lines.push(`- ${r.label}: ${byYear(r.t)} → ${byYear(season(r.t, d))}`);
  }
}

function brief(d: Data, years: Data | null, lines: string[]) {
  lines.push(header(d), HEAD);
  const sets: [string, V3SetupId[]][] = [["v2 trend", ["trend"]], ["Run to the high (as described)", ["gapRun"]], ["Stable close beyond (as described)", ["gapBreak"]]];
  for (const [label, ids] of sets) lines.push(row(label, run(d, ids), d));
  if (years) {
    const from = d.ctx.p.c[0].date;
    const to = d.ctx.p.c[d.ctx.p.c.length - 1].date;
    lines.push(`\nSame dates on the multi-year source:`);
    for (const [label, ids] of sets) {
      const t = run(years, ids).filter((x) => x.openAt >= from && x.openAt <= to);
      lines.push(`- ${label}: ${t.length} calls, avg ${fmt(avg(t))}`);
    }
  }
}

function synth(days: number, start: number): Candle[] {
  const out: Candle[] = [];
  let px = start;
  let drift = 0;
  for (let d = 0; d < days; d++) {
    const base = Date.UTC(2026, 3, 1) + d * 86_400_000;
    const wd = new Date(base).getUTCDay();
    if (wd === 0 || wd === 6) continue;
    for (let m = 9 * 60; m < 23 * 60 + 30; m += 5) {
      if (Math.random() < 0.03) drift = (Math.random() - 0.5) * start * 0.002;
      const o = px;
      px = Math.max(1, px + drift + (Math.random() - 0.5) * start * 0.003);
      out.push({ date: new Date(base - 5.5 * 3600_000 + m * 60_000).toISOString(), open: o, high: Math.max(o, px) + start * 0.0005, low: Math.min(o, px) - start * 0.0005, close: px, volume: 100 + Math.random() * 100 });
    }
  }
  return out;
}

async function main() {
  const t0 = Date.now();
  const log = (s: string) => console.error(`[${Math.round((Date.now() - t0) / 1000)}s] ${s}`);
  console.log(`# Smart Ai20-20 lab — ${new Date().toISOString()}\n\nRs per lot after costs (Rs 150 crude / Rs 200 gas a call + ~Rs 50 an hour of time decay), option at delta 0.5. Estimates on past prices, not live fills. News cannot be replayed (no archive of past headlines), so it is not in these numbers.`);
  const synthMode = process.env.LAB_SYNTH === "1";
  for (const [sym, duka, yh, label] of [["CRUDEOIL", "lightcmdusd", "CL=F", "WTI crude"], ["NATURALGAS", "gascmdusd", "NG=F", "Henry Hub gas"]] as const) {
    if (process.env.LAB_MARKET && process.env.LAB_MARKET !== sym) continue;
    const lines: string[] = [];
    let years: Data | null = null;
    try {
      const c = synthMode ? synth(150, sym === "CRUDEOIL" ? 6000 : 300) : await dukascopy(duka, FROM, TO, log);
      if (c.length < 5000) throw new Error(`only ${c.length} candles`);
      years = load(`${label} 5-min, ${FROM} to ${TO} (Dukascopy, as MCX ${sym})`, sym, c);
      log(`${sym} loaded`);
      if (ROUND2) round2(years, lines, true);
      else full(years, lines);
      log(`${sym} years done`);
    } catch (e) {
      lines.push(`\n## ${label} multi-year\n\nFailed: ${String(e)}`);
    }
    console.log(lines.splice(0).join("\n"));
    if (synthMode || HOLDOUT) continue;
    try {
      const y = load(`${label} — last 60 days of NYMEX futures (Yahoo)`, sym, await yahoo(yh, true));
      if (ROUND2) round2(y, lines, false);
      else brief(y, years, lines);
    } catch (e) {
      lines.push(`\nYahoo ${yh} failed: ${String(e)}`);
    }
    const m = await mcx(sym);
    if (typeof m === "string") lines.push(`\nMCX ${sym}: not available (${m})`);
    else if (ROUND2) round2(load(`MCX ${sym} 5-min (the app's own candles)`, sym, m), lines, false);
    else brief(load(`MCX ${sym} 5-min (the app's own candles)`, sym, m), years, lines);
    console.log(lines.join("\n"));
  }
  log("done");
}

main();
