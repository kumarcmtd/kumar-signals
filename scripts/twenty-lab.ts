// Ai20-20 rules lab runner: fetches past 5-minute candles and prints how each
// rule set would have traded them (see frontend/src/utils/twentyLab.ts).
//
//   npx -y tsx scripts/twenty-lab.ts > lab.md
//
// Data: NYMEX WTI (CL=F) and Henry Hub gas (NG=F) 5-minute candles from
// Yahoo, 60 days, kept to MCX hours and scaled to rupees at USDINR 88 (MCX
// Crude and NG track these contracts tick for tick). Plus the app's own MCX
// 5-minute candles (~20 days) when MCX is open. Only aggregate results are
// printed; no raw price data is written anywhere.

import { CURRENT_RULES, gateTrades, prepare, ruleGrid, rulesLabel, sensitivityGrid, simulate, statsOf, type LabStats, type LabSym, type LabTrade, type Prepared } from "../frontend/src/utils/twentyLab";
import type { Candle } from "../frontend/src/types";

const SITE = process.env.SITE ?? "https://kumar-signals.akumalla-kumar-sbh.workers.dev";
const USDINR = 88;

async function yahoo(ticker: string): Promise<Candle[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=5m&range=60d`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" } });
  if (!res.ok) throw new Error(`Yahoo ${ticker}: HTTP ${res.status}`);
  const j: any = await res.json();
  const r = j?.chart?.result?.[0];
  const ts: number[] = r?.timestamp ?? [];
  const q = r?.indicators?.quote?.[0] ?? {};
  const out: Candle[] = [];
  for (let i = 0; i < ts.length; i++) {
    const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i];
    if ([o, h, l, c].some((x) => typeof x !== "number" || !Number.isFinite(x))) continue;
    const ms = ts[i] * 1000;
    const ist = new Date(ms + 5.5 * 3600_000);
    const min = ist.getUTCHours() * 60 + ist.getUTCMinutes();
    const wd = ist.getUTCDay();
    if (wd === 0 || wd === 6 || min < 9 * 60 || min >= 23 * 60 + 30) continue; // MCX hours only
    out.push({ date: new Date(ms).toISOString(), open: o * USDINR, high: h * USDINR, low: l * USDINR, close: c * USDINR, volume: q.volume?.[i] ?? 0 });
  }
  return out;
}

async function mcx(symbol: LabSym): Promise<Candle[] | string> {
  try {
    // /api/history-5m answers while MCX is shut too; /api/candles only while it is open.
    for (const path of [`/api/history-5m?symbol=${symbol}`, `/api/candles?symbol=${symbol}&tf=5`]) {
      const res = await fetch(`${SITE}${path}`, { headers: { Accept: "application/json" } });
      const j: any = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      if (!j.error && Array.isArray(j.candles) && j.candles.length >= 100) return j.candles as Candle[];
      if (path.startsWith("/api/candles")) return String(j.error ?? `HTTP ${res.status}`);
    }
    return "no data";
  } catch (e) {
    return `${String(e)} ${String((e as any)?.cause?.message ?? "")}`;
  }
}

const fmt = (n: number | null) => (n === null ? "—" : String(n));
const avgOf = (t: LabTrade[]) => (t.length ? Math.round(t.reduce((a, x) => a + x.rs, 0) / t.length) : null);
function row(s: LabStats, g: { gated: LabTrade[]; eligible: LabTrade[] }): string {
  return `| ${s.label} | ${s.trades} | ${s.perDay} | ${fmt(s.t1Pct)}% | ${fmt(s.winPct)}% | ${fmt(s.avgRs)} | ${s.netRs} | ${fmt(s.profitFactor)} | ${s.maxDrawdownRs} | ${fmt(s.firstHalfAvg)} / ${fmt(s.secondHalfAvg)} | ${fmt(avgOf(g.eligible))} (${g.eligible.length}) -> ${fmt(avgOf(g.gated))} (${g.gated.length}) |`;
}
const HEAD = "| Rules | Trades | /day | T1 hit | Win | Avg Rs | Net Rs | PF | Max DD | Halves avg | After day 15: all -> gated |\n|---|---|---|---|---|---|---|---|---|---|---|";

function report(name: string, sym: LabSym, candles: Candle[]): string {
  const p: Prepared = prepare(candles);
  const lines: string[] = [];
  const days = new Set(p.day).size;
  lines.push(`\n## ${name} — ${candles.length} candles, ${days} days (${candles[0]?.date.slice(0, 10)} to ${candles[candles.length - 1]?.date.slice(0, 10)})\n`);
  const grid = process.env.LAB_GRID === "sensitivity" ? sensitivityGrid() : ruleGrid();
  const all = grid.map((r) => {
    const t = simulate(p, r, sym);
    return { r, t, s: statsOf(t, p, rulesLabel(r)), g: gateTrades(t, p) };
  });
  const base = all[0];
  lines.push(HEAD, row(base.s, base.g));
  const ranked = all.filter((x) => x.s.trades >= 15 && x.s.avgRs !== null).sort((a, b) => b.s.avgRs! - a.s.avgRs!);
  const robust = ranked.filter((x) => (x.s.firstHalfAvg ?? -1) > 0 && (x.s.secondHalfAvg ?? -1) > 0);
  lines.push(`\nTop 12 of ${all.length} (15+ trades); positive in both halves: ${robust.length}`, HEAD, ...ranked.slice(0, 12).map((x) => row(x.s, x.g)));
  if (robust.length) lines.push("\nBoth halves positive (top 12)", HEAD, ...robust.slice(0, 12).map((x) => row(x.s, x.g)));
  const gatedBest = all
    .map((x) => ({ x, ga: avgOf(x.g.gated), gn: x.g.gated.length }))
    .filter((y) => y.gn >= 15 && y.ga !== null)
    .sort((a, b) => b.ga! - a.ga!);
  lines.push("\nBest AFTER the 15-day gate (15+ gated trades)", HEAD, ...gatedBest.slice(0, 8).map((y) => row(y.x.s, y.x.g)));
  const pos = all.filter((x) => (x.s.avgRs ?? -1) > 0).length;
  const gpos = all.filter((x) => x.g.gated.length >= 10 && (avgOf(x.g.gated) ?? -1) > 0).length;
  lines.push(`\nRule sets with positive average: ${pos} of ${all.length}; positive after the gate (10+ trades): ${gpos}`);
  // By New York hour for the current rules and the best robust set.
  const hourTable = (t: LabTrade[], title: string) => {
    const by = new Map<number, LabTrade[]>();
    for (const x of t) {
      const h = Math.floor(p.etMinute[x.openIdx] / 60);
      by.set(h, [...(by.get(h) ?? []), x]);
    }
    lines.push(`\n${title} by New York hour: ` + [...by.entries()].sort((a, b) => a[0] - b[0]).map(([h, xs]) => `${h}h ${xs.length}/${avgOf(xs)}`).join(" · "));
  };
  hourTable(base.t, "Current rules");
  if (robust[0]) hourTable(robust[0].t, robust[0].s.label);
  lines.push("\nCSV label,avg,n,first,second,eligibleAvg,eligibleN,gatedAvg,gatedN");
  for (const x of all) lines.push(`CSV ${x.s.label},${fmt(x.s.avgRs)},${x.s.trades},${fmt(x.s.firstHalfAvg)},${fmt(x.s.secondHalfAvg)},${fmt(avgOf(x.g.eligible))},${x.g.eligible.length},${fmt(avgOf(x.g.gated))},${x.g.gated.length}`);
  return lines.join("\n");
}

async function main() {
  const out: string[] = [`# Ai20-20 rules lab — ${new Date().toISOString()}`, "", "Rs per lot after costs (spread+charges Rs150 Crude / Rs200 NG, time decay ~Rs50/hour). Option modelled at delta 0.5. Estimates, not live fills."];
  for (const [ticker, sym, name] of [["CL=F", "CRUDEOIL", "NYMEX WTI (as MCX Crude)"], ["NG=F", "NATURALGAS", "NYMEX gas (as MCX NG)"]] as const) {
    try {
      const c = await yahoo(ticker);
      out.push(report(name, sym, c));
    } catch (e) {
      out.push(`\n## ${name}\n\nFailed: ${String(e)} ${String((e as any)?.cause?.message ?? "")}`);
    }
  }
  for (const sym of ["CRUDEOIL", "NATURALGAS"] as const) {
    const c = await mcx(sym);
    if (typeof c === "string") out.push(`\n## MCX ${sym} 5-min\n\nNot available: ${c}`);
    else out.push(report(`MCX ${sym} 5-min (real)`, sym, c));
  }
  console.log(out.join("\n"));
}

main();
