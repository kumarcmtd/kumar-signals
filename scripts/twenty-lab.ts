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

import { CURRENT_RULES, prepare, ruleGrid, rulesLabel, simulate, statsOf, type LabStats, type LabSym, type Prepared } from "../frontend/src/utils/twentyLab";
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
    const res = await fetch(`${SITE}/api/candles?symbol=${symbol}&tf=5`, { headers: { Accept: "application/json" } });
    const j: any = await res.json();
    if (j.error) return String(j.error);
    return j.candles as Candle[];
  } catch (e) {
    return `${String(e)} ${String((e as any)?.cause?.message ?? "")}`;
  }
}

const fmt = (n: number | null) => (n === null ? "—" : String(n));
function row(s: LabStats): string {
  return `| ${s.label} | ${s.trades} | ${s.perDay} | ${fmt(s.t1Pct)}% | ${fmt(s.winPct)}% | ${fmt(s.avgRs)} | ${s.netRs} | ${fmt(s.profitFactor)} | ${s.maxDrawdownRs} | ${fmt(s.firstHalfAvg)} / ${fmt(s.secondHalfAvg)} |`;
}
const HEAD = "| Rules | Trades | /day | T1 hit | Win | Avg Rs | Net Rs | PF | Max DD | Halves avg |\n|---|---|---|---|---|---|---|---|---|---|";

function report(name: string, sym: LabSym, candles: Candle[]): string {
  const p: Prepared = prepare(candles);
  const lines: string[] = [];
  const days = new Set(p.day).size;
  lines.push(`\n## ${name} — ${candles.length} candles, ${days} days (${candles[0]?.date.slice(0, 10)} to ${candles[candles.length - 1]?.date.slice(0, 10)})\n`);
  const all = ruleGrid().map((r) => ({ r, s: statsOf(simulate(p, r, sym), p, rulesLabel(r)) }));
  const base = all.find((x) => rulesLabel(x.r) === rulesLabel(CURRENT_RULES))!;
  lines.push("### Current Ai20-20 rules\n", HEAD, row(base.s));
  const ranked = all.filter((x) => x.s.trades >= 15 && x.s.avgRs !== null).sort((a, b) => b.s.avgRs! - a.s.avgRs!);
  lines.push("\n### Top 25 by average Rs per trade (15+ trades)\n", HEAD, ...ranked.slice(0, 25).map((x) => row(x.s)));
  const robust = ranked.filter((x) => (x.s.firstHalfAvg ?? -1) > 0 && (x.s.secondHalfAvg ?? -1) > 0);
  lines.push(`\n### Positive in BOTH halves: ${robust.length} of ${all.length}\n`, HEAD, ...robust.slice(0, 25).map((x) => row(x.s)));
  lines.push("\n### Bottom 5\n", HEAD, ...ranked.slice(-5).map((x) => row(x.s)));
  // Current rules by entry hour (IST)
  const t = simulate(p, CURRENT_RULES, sym);
  const byHour = new Map<number, { n: number; rs: number; t1: number }>();
  for (const x of t) {
    const h = Math.floor(x.entryMinute / 60);
    const b = byHour.get(h) ?? { n: 0, rs: 0, t1: 0 };
    b.n++;
    b.rs += x.rs;
    b.t1 += x.t1 ? 1 : 0;
    byHour.set(h, b);
  }
  lines.push("\n### Current rules by entry hour (IST)\n", "| Hour | Trades | T1 hit | Avg Rs |\n|---|---|---|---|");
  for (const [h, b] of [...byHour.entries()].sort((a, b) => a[0] - b[0])) lines.push(`| ${h}:00 | ${b.n} | ${Math.round((b.t1 / b.n) * 100)}% | ${Math.round(b.rs / b.n)} |`);
  // Machine-readable summary of every rule set, for comparing datasets.
  lines.push("\n<details><summary>All rule sets (label avgRs trades firstHalf secondHalf)</summary>\n\n```");
  for (const x of all) lines.push(`${x.s.label} ${fmt(x.s.avgRs)} ${x.s.trades} ${fmt(x.s.firstHalfAvg)} ${fmt(x.s.secondHalfAvg)}`);
  lines.push("```\n</details>");
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
