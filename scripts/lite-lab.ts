// Ai Lite lab: replays the Ai Lite rules (frontend/src/utils/lite) over years
// of 5-minute prices and prints ONLY aggregates (no prices) -- the rules as
// live, plus a few switches to show what each rule adds. Rs per lot after
// costs; option premium at delta 0.5 of the futures move.
//
//   DUKA_DIR=/tmp/duka LAB_MARKET=CRUDEOIL npx -y tsx scripts/lite-lab.ts
//   LAB_SYNTH=1 npx -y tsx scripts/lite-lab.ts     (offline smoke test)

import type { Candle } from "../frontend/src/types";
import { liteStats, simulateLite, type LiteSimOpts, type LiteTrade } from "../frontend/src/utils/lite/sim";
import type { LiteSym } from "../frontend/src/utils/lite/engine";
import { dukascopy, mcx, yahoo } from "./lab-data";

const FROM = process.env.LAB_FROM || "2022-01-01";
const TO = process.env.LAB_TO || new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
const HOLDOUT = !!process.env.LAB_TO;
const IST_MS = 5.5 * 3600_000;

const VARIANTS: [string, LiteSimOpts][] = [
  ["Ai Lite as it will run (stop Rs 1,000)", {}],
  ["Stop Rs 1,500 instead", { stopRs: 1500 }],
  ["Pullback trigger only", { only: "pullback" }],
  ["Breakout trigger only", { only: "breakout" }],
  ["Without the no-chase rule", { noChase: true }],
  ["Without the day rules (2 stops / Rs 2,000 goal)", { noDayRules: true }],
];

const days = (c: Candle[]) => new Set(c.map((k) => Math.floor((Date.parse(k.date) + IST_MS) / 86_400_000))).size;
const fmt = (n: number | null) => (n === null ? "—" : String(n));

function byYear(t: LiteTrade[]): string {
  const m = new Map<string, LiteTrade[]>();
  for (const x of t) {
    const y = new Date(x.openAt + IST_MS).toISOString().slice(0, 4);
    m.set(y, [...(m.get(y) ?? []), x]);
  }
  return [...m.entries()].sort().map(([y, xs]) => `${y}: ${xs.length} calls, avg ${Math.round(xs.reduce((a, x) => a + x.rs, 0) / xs.length)}, net ${xs.reduce((a, x) => a + x.rs, 0)}`).join(" · ");
}

function months(t: LiteTrade[]): string {
  const m = new Map<string, number>();
  for (const x of t) {
    const k = new Date(x.openAt + IST_MS).toISOString().slice(0, 7);
    m.set(k, (m.get(k) ?? 0) + x.rs);
  }
  const v = [...m.values()];
  return `months ${v.length}, winning ${v.filter((x) => x > 0).length}, worst ${Math.min(0, ...v)}, best ${Math.max(0, ...v)}`;
}

function dayRange(t: LiteTrade[]): string {
  const m = new Map<number, number>();
  for (const x of t) {
    const d = Math.floor((x.openAt + IST_MS) / 86_400_000);
    m.set(d, (m.get(d) ?? 0) + x.rs);
  }
  const v = [...m.values()];
  return `trading days with a call ${v.length}, winning ${v.filter((x) => x > 0).length}, days reaching +2,000: ${v.filter((x) => x >= 2000).length}, worst day ${Math.min(0, ...v)}`;
}

function report(title: string, c: Candle[], sym: LiteSym, full: boolean): string[] {
  const lines = [`\n## ${title} — ${c.length} candles, ${days(c)} days`, "", "| Version | Calls | /month | Win | Avg Rs | Net Rs | PF | Max DD | 1st / 2nd half avg |", "|---|---|---|---|---|---|---|---|---|"];
  for (const [name, opts] of full ? VARIANTS : VARIANTS.slice(0, 1)) {
    const t = simulateLite(c, sym, opts);
    const s = liteStats(t, days(c));
    lines.push(`| ${name} | ${s.trades} | ${s.perMonth} | ${s.winPct}% | ${s.avgRs} | ${s.netRs} | ${fmt(s.pf)} | ${s.maxDdRs} | ${fmt(s.firstHalfAvg)} / ${fmt(s.secondHalfAvg)} |`);
  }
  const live = simulateLite(c, sym);
  const s = liteStats(live, days(c));
  lines.push("", `- Exits: ${Object.entries(s.exits).map(([k, n]) => `${k} ${n}`).join(" · ")}`);
  lines.push(`- Pullback calls: ${live.filter((x) => x.kind === "pullback").length}, breakout calls: ${live.filter((x) => x.kind === "breakout").length}`);
  if (full) {
    lines.push(`- By year: ${byYear(live)}`);
    lines.push(`- ${months(live)}`);
  }
  lines.push(`- ${dayRange(live)}`);
  return lines;
}

function synth(n: number, base: number): Candle[] {
  const out: Candle[] = [];
  let px = base;
  let s = 7;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let d = 0; d < n; d++) {
    const day = Date.UTC(2026, 6, 1) + d * 86_400_000;
    const wd = new Date(day).getUTCDay();
    if (wd === 0 || wd === 6) continue;
    for (let m = 9 * 60; m < 23 * 60 + 30; m += 5) {
      const o = px;
      px += (rnd() - 0.5) * base * 0.002;
      out.push({ date: new Date(day - IST_MS + m * 60_000).toISOString(), open: o, high: Math.max(o, px) + base * 0.0004, low: Math.min(o, px) - base * 0.0004, close: px, volume: 100 });
    }
  }
  return out;
}

async function main() {
  const t0 = Date.now();
  const log = (x: string) => console.error(`[${Math.round((Date.now() - t0) / 1000)}s] ${x}`);
  console.log(`# Ai Lite lab — ${new Date().toISOString()}\n\nRs per lot after costs (Rs 150 crude / Rs 200 gas a call + ~Rs 50 an hour time decay), option at delta 0.5. Target Rs 2,000, stop Rs 1,000; stop to entry at +1,000, locks +1,000 at +1,500. Estimates, not live fills.`);
  for (const [sym, duka, yh, label] of [["CRUDEOIL", "lightcmdusd", "CL=F", "WTI crude"], ["NATURALGAS", "gascmdusd", "NG=F", "Henry Hub gas"]] as const) {
    if (process.env.LAB_MARKET && process.env.LAB_MARKET !== sym) continue;
    try {
      const c = process.env.LAB_SYNTH === "1" ? synth(160, sym === "CRUDEOIL" ? 7000 : 300) : await dukascopy(duka, FROM, TO, log);
      if (c.length < 5000) throw new Error(`only ${c.length} candles`);
      console.log(report(`${label} 5-min, ${FROM} to ${TO} (Dukascopy, as MCX ${sym})`, c, sym, true).join("\n"));
    } catch (e) {
      console.log(`\n## ${label}: years failed — ${String(e)}`);
    }
    if (process.env.LAB_SYNTH === "1" || HOLDOUT) continue;
    try {
      console.log(report(`${label} — last 60 days of NYMEX futures (Yahoo)`, await yahoo(yh, true), sym, false).join("\n"));
    } catch (e) {
      console.log(`\nYahoo ${yh} failed: ${String(e)}`);
    }
    const m = await mcx(sym);
    if (typeof m === "string") console.log(`\nMCX ${sym}: not available (${m})`);
    else console.log(report(`MCX ${sym} 5-min (the app's own candles)`, m, sym, false).join("\n"));
  }
  log("done");
}

main();
