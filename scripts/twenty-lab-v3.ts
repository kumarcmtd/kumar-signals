// Ai20-20 v3 rules lab: replays every candidate setup (frontend/src/utils/
// twentyV3/setups.ts) over years of 5-minute prices and picks the ones that
// earn their place by a rule written down BEFORE the run:
//
//   on the multi-year history of that market: at least 80 trades, average at
//   least Rs 100 per lot after costs, profit in BOTH halves of the years, and
//   profit factor at least 1.15.
//
// The picked setups then run together (one trade at a time, max 2 stops and
// 3 trades a day, stop for the day at -Rs 3,000 per lot) and are checked on
// the last 60 days of real NYMEX futures and the app's own MCX candles.
// Aggregates only -- no prices are printed or stored.
//
//   DUKA_DIR=/tmp/duka npx -y tsx scripts/twenty-lab-v3.ts > lab.md
//   LAB_SYNTH=1 npx -y tsx scripts/twenty-lab-v3.ts   (offline smoke test)

import { gateTrades, prepare, simulate, statsOf, type LabSym, type Prepared } from "../frontend/src/utils/twentyLab";
import { V2_RULES } from "../frontend/src/utils/twentyV2";
import { computeFeatures } from "../frontend/src/utils/twentyV3/features";
import { SETUP_NAMES, type V3Ctx, type V3SetupId } from "../frontend/src/utils/twentyV3/setups";
import { simulateV3, type V3SimOpts, type V3Trade } from "../frontend/src/utils/twentyV3/sim";
import type { Candle } from "../frontend/src/types";
import { dukascopy, mcx, yahoo } from "./lab-data";

const CANDIDATES: V3SetupId[] = ["trend", "noise", "noise30", "orb", "orbTrend", "drive", "drive60", "vwapPull", "eia", "eiaFade"];
/** Round 2: three research-motivated refinements of the best round-1 idea, judged by the same pick rule. */
const ROUND2: V3SetupId[] = ["driveTrend", "driveBusy", "driveSteps"];
const PICK = { minTrades: 80, minAvgRs: 100, minPf: 1.15 };
const GUARDS = { maxStopsPerDay: 2, maxTradesPerDay: 3, dayLossLimitRs: 3000 };
const FROM = process.env.LAB_FROM ?? "2022-01-01";
const TO = process.env.LAB_TO ?? new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);

interface Data {
  name: string;
  sym: LabSym;
  ctx: V3Ctx;
  years: boolean;
}

const fmt = (n: number | null | undefined) => (n === null || n === undefined || !Number.isFinite(n) ? "—" : String(Math.round(n)));
const avg = (t: V3Trade[]) => (t.length ? t.reduce((a, x) => a + x.rs, 0) / t.length : null);

function load(name: string, sym: LabSym, candles: Candle[], years: boolean): Data {
  const p: Prepared = prepare(candles, { etFrom: 10 * 60 + 30, etTo: 13 * 60 + 15 });
  return { name, sym, ctx: { p, f: computeFeatures(p) }, years };
}

function worstDay(t: V3Trade[], p: Prepared): number {
  const by = new Map<number, number>();
  for (const x of t) by.set(p.day[x.openIdx], (by.get(p.day[x.openIdx]) ?? 0) + x.rs);
  return Math.min(0, ...by.values());
}

const HEAD = "| Setup | Trades | /month | Win | Avg Rs | Net Rs | PF | Max DD | Worst day | 1st half / 2nd half avg |\n|---|---|---|---|---|---|---|---|---|---|";
function row(label: string, t: V3Trade[], d: Data): string {
  const s = statsOf(t, d.ctx.p, label);
  const perMonth = s.days ? (t.length / s.days) * 21 : 0;
  return `| ${label} | ${s.trades} | ${perMonth.toFixed(1)} | ${fmt(s.winPct)}% | ${fmt(s.avgRs)} | ${s.netRs} | ${s.profitFactor ?? "—"} | ${s.maxDrawdownRs} | ${worstDay(t, d.ctx.p)} | ${fmt(s.firstHalfAvg)} / ${fmt(s.secondHalfAvg)} |`;
}

function byYear(t: V3Trade[]): string {
  const m = new Map<string, V3Trade[]>();
  for (const x of t) {
    const y = x.openAt.slice(0, 4);
    m.set(y, [...(m.get(y) ?? []), x]);
  }
  return [...m.entries()].sort().map(([y, xs]) => `${y}: ${xs.length} trades, avg ${fmt(avg(xs))}, net ${Math.round(xs.reduce((a, x) => a + x.rs, 0))}`).join(" · ");
}

function byHour(t: V3Trade[], d: Data): string {
  const m = new Map<number, V3Trade[]>();
  for (const x of t) {
    const h = Math.floor(d.ctx.p.etMinute[x.openIdx] / 60);
    m.set(h, [...(m.get(h) ?? []), x]);
  }
  return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([h, xs]) => `${h}h NY: ${xs.length} / avg ${fmt(avg(xs))}`).join(" · ");
}

function run(d: Data, setups: V3SetupId[], extra: Partial<V3SimOpts> = {}, k?: number): V3Trade[] {
  return simulateV3(k ? { ...d.ctx, k } : d.ctx, setups, { sym: d.sym, ...extra });
}

function header(d: Data): string {
  const c = d.ctx.p.c;
  return `\n## ${d.name} — ${c.length} candles, ${new Set(d.ctx.p.day).size} days (${c[0]?.date.slice(0, 10)} to ${c[c.length - 1]?.date.slice(0, 10)})\n`;
}

function candidateTable(d: Data, lines: string[]): Map<V3SetupId, V3Trade[]> {
  lines.push(header(d), HEAD);
  const res = new Map<V3SetupId, V3Trade[]>();
  for (const id of [...CANDIDATES, ...ROUND2]) {
    const t = run(d, [id]);
    res.set(id, t);
    lines.push(row(`${ROUND2.includes(id) ? "R2 · " : ""}${SETUP_NAMES[id]}`, t, d));
  }
  // The v3 replay of "trend" must equal the v2 lab's own replay.
  const v2 = simulate(d.ctx.p, V2_RULES, d.sym);
  const v3 = res.get("trend")!;
  const same = v2.length === v3.length && v2.every((x, i) => x.openIdx === v3[i].openIdx && x.rs === v3[i].rs);
  lines.push(`\nCheck: v3 replay of the v2 rules ${same ? "matches" : "DIFFERS FROM"} the v2 lab (${v3.length} vs ${v2.length} trades).`);
  return res;
}

function pick(d: Data, res: Map<V3SetupId, V3Trade[]>): V3SetupId[] {
  const ok: { id: V3SetupId; a: number }[] = [];
  for (const [id, t] of res) {
    const s = statsOf(t, d.ctx.p, id);
    if (s.trades >= PICK.minTrades && (s.avgRs ?? -1) >= PICK.minAvgRs && (s.firstHalfAvg ?? -1) > 0 && (s.secondHalfAvg ?? -1) > 0 && (s.profitFactor ?? 0) >= PICK.minPf) ok.push({ id, a: s.avgRs! });
  }
  return ok.sort((x, y) => y.a - x.a).map((x) => x.id);
}

function deepDive(d: Data, picked: V3SetupId[], lines: string[]) {
  lines.push(`\n### ${d.name}: picked setups in detail`);
  for (const id of picked) {
    const base = run(d, [id]);
    const lo = run(d, [id], {}, 0.8);
    const hi = run(d, [id], {}, 1.2);
    const stress = run(d, [id], { extraCostRs: 100 });
    const s = (t: V3Trade[]) => statsOf(t, d.ctx.p, id);
    lines.push(`\n**${SETUP_NAMES[id]}** — by year: ${byYear(base)}`);
    lines.push(`- Settings x0.8: avg ${fmt(s(lo).avgRs)} (${s(lo).trades}), halves ${fmt(s(lo).firstHalfAvg)} / ${fmt(s(lo).secondHalfAvg)} · x1.2: avg ${fmt(s(hi).avgRs)} (${s(hi).trades}), halves ${fmt(s(hi).firstHalfAvg)} / ${fmt(s(hi).secondHalfAvg)}`);
    lines.push(`- With Rs 100 more cost per trade: avg ${fmt(s(stress).avgRs)}, PF ${s(stress).profitFactor ?? "—"}`);
    lines.push(`- Entry hour: ${byHour(base, d)}`);
    const ex = s(base).exits;
    lines.push(`- Exits: ${Object.entries(ex).map(([k, n]) => `${k} ${n}`).join(" · ")}`);
  }
}

function ensemble(d: Data, picked: V3SetupId[], lines: string[], title: string) {
  if (!picked.length) return;
  const t = run(d, picked, GUARDS);
  lines.push(`\n**${title}** (${picked.map((id) => SETUP_NAMES[id]).join(" > ")}; one at a time, max 2 stops / 3 trades a day, stop at -Rs 3,000)`, HEAD, row("Together", t, d));
  if (d.years) {
    lines.push(`- By year: ${byYear(t)}`);
    lines.push(`- Entry hour: ${byHour(t, d)}`);
    const days = new Map<number, number>();
    for (const x of t) days.set(d.ctx.p.day[x.openIdx], (days.get(d.ctx.p.day[x.openIdx]) ?? 0) + x.rs);
    const v = [...days.values()];
    const months = new Map<string, number>();
    for (const x of t) months.set(x.openAt.slice(0, 7), (months.get(x.openAt.slice(0, 7)) ?? 0) + x.rs);
    const mv = [...months.values()];
    lines.push(`- Trading days ${v.length}, winning days ${v.filter((x) => x > 0).length}; months ${mv.length}, winning months ${mv.filter((x) => x > 0).length}, worst month ${fmt(Math.min(0, ...mv))}, best month ${fmt(Math.max(0, ...mv))}`);
    for (const [look, n, floor] of [[10, 8, -300], [20, 10, 0]] as const) {
      const g = gateTrades(t, d.ctx.p, look, n, floor, true);
      lines.push(`- Pause when the last ${look} days averaged below Rs ${floor} (${n}+ trades): avg ${fmt(avg(g.eligible as V3Trade[]))} (${g.eligible.length}) -> ${fmt(avg(g.gated as V3Trade[]))} (${g.gated.length})`);
    }
  }
}

function synth(days: number, start: number): Candle[] {
  const out: Candle[] = [];
  let px = start;
  for (let d = 0; d < days; d++) {
    const base = Date.UTC(2026, 8, 1) + d * 86_400_000;
    const wd = new Date(base).getUTCDay();
    if (wd === 0 || wd === 6) continue;
    for (let m = 9 * 60; m < 23 * 60 + 30; m += 5) {
      const o = px;
      px = Math.max(1, px + (Math.random() - 0.5) * start * 0.003);
      out.push({ date: new Date(base - 5.5 * 3600_000 + m * 60_000).toISOString(), open: o, high: Math.max(o, px) + start * 0.0005, low: Math.min(o, px) - start * 0.0005, close: px, volume: 100 + Math.random() * 100 });
    }
  }
  return out;
}

async function main() {
  const t0 = Date.now();
  const log = (s: string) => console.error(`[${Math.round((Date.now() - t0) / 1000)}s] ${s}`);
  const head: string[] = [
    `# Ai20-20 v3 rules lab — ${new Date().toISOString()}`,
    "",
    "Rs per lot after costs (Rs 150 Crude / Rs 200 NG per trade + ~Rs 50 an hour time decay), option at delta 0.5. Estimates, not live fills.",
    `Pick rule (fixed before the run): ${PICK.minTrades}+ trades, average >= Rs ${PICK.minAvgRs}, both halves positive, profit factor >= ${PICK.minPf}, on the multi-year history.`,
  ];
  console.log(head.join("\n"));
  const synthMode = process.env.LAB_SYNTH === "1";
  for (const [sym, duka, yh, label] of [["CRUDEOIL", "lightcmdusd", "CL=F", "WTI crude"], ["NATURALGAS", "gascmdusd", "NG=F", "Henry Hub gas"]] as const) {
    if (process.env.LAB_MARKET && process.env.LAB_MARKET !== sym) continue;
    const lines: string[] = [];
    let years: Data | null = null;
    try {
      const c = synthMode ? synth(120, sym === "CRUDEOIL" ? 6000 : 300) : await dukascopy(duka, FROM, TO, log);
      if (c.length < 5000) throw new Error(`only ${c.length} candles`);
      years = load(`${label} 5-min, ${FROM} to ${TO} (Dukascopy, as MCX ${sym})`, sym, c, true);
      log(`${sym} years loaded`);
    } catch (e) {
      lines.push(`\n## ${label} multi-year\n\nFailed: ${String(e)} ${String((e as any)?.cause?.message ?? "")}`);
    }
    const recent: Data[] = [];
    if (!synthMode) {
      try {
        recent.push(load(`${label} — last 60 days of NYMEX futures (Yahoo)`, sym, await yahoo(yh, true), false));
      } catch (e) {
        lines.push(`\nYahoo ${yh} failed: ${String(e)}`);
      }
      const m = await mcx(sym);
      if (typeof m === "string") lines.push(`\nMCX ${sym}: not available (${m})`);
      else recent.push(load(`MCX ${sym} 5-min (the app's own candles)`, sym, m, false));
    }
    let picked: V3SetupId[] = [];
    let yearsRes: Map<V3SetupId, V3Trade[]> | null = null;
    if (years) {
      const res = candidateTable(years, lines);
      picked = pick(years, res);
      lines.push("\n**Every setup by year** (calls / average Rs):");
      for (const id of [...CANDIDATES, ...ROUND2]) lines.push(`- ${SETUP_NAMES[id]}: ${byYear(res.get(id)!)}`);
      for (const kk of [0.8, 1.2]) {
        const t = run(years, ["drive"], {}, kk);
        const st = statsOf(t, years.ctx.p, "x");
        lines.push(`- Opening drive with the band x${kk}: ${st.trades} calls, avg ${fmt(st.avgRs)}, PF ${st.profitFactor ?? "—"}, halves ${fmt(st.firstHalfAvg)} / ${fmt(st.secondHalfAvg)}`);
      }
      yearsRes = res;
      lines.push(`\n**Picked for ${sym}: ${picked.length ? picked.map((id) => SETUP_NAMES[id]).join(", ") : "none"}**`);
      deepDive(years, picked, lines);
      ensemble(years, picked, lines, "Picked setups together");
      log(`${sym} years done`);
      console.log(lines.splice(0).join("\n")); // printed now: a later failure cannot lose it
    }
    for (const d of recent) {
      candidateTable(d, lines);
      ensemble(d, picked, lines, "Picked setups together");
      // Same dates on the multi-year source: does the data source change the answer?
      if (yearsRes && years) {
        const from = d.ctx.p.c[0].date;
        const to = d.ctx.p.c[d.ctx.p.c.length - 1].date;
        lines.push(`\nSame dates (${from.slice(0, 10)} to ${to.slice(0, 10)}) on the multi-year source:`);
        for (const id of [...CANDIDATES, ...ROUND2]) {
          const t = yearsRes.get(id)!.filter((x) => x.openAt >= from && x.openAt <= to);
          lines.push(`- ${SETUP_NAMES[id]}: ${t.length} calls, avg ${fmt(avg(t))}, win ${t.length ? Math.round((t.filter((x) => x.rs > 0).length / t.length) * 100) : 0}%`);
        }
      }
    }
    console.log(lines.join("\n"));
  }
  log("done");
}

main();
