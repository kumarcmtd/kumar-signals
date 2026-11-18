// AI-Test V2 results, folded into one strip at the top: win rate, net rupees
// per lot, calls closed and running for the chosen period, with the last
// seven trading days as bars. Tap to open the full report (tiles, best and
// worst call, by timeframe / day / signal). Same counting as every page's
// trade report (buildPageReport), so the numbers match everywhere.

import { useMemo, useState } from "react";
import { ChevronDown, Trophy } from "lucide-react";
import type { TradeLogEntry } from "../../store/appStore";
import { ENGINES } from "../../utils/aiEdgeEngine";
import { verifiedEntryIds } from "../../utils/dedupeTradeLog";
import { buildPageReport, EST_COST_RS, periodStart, readReportPeriod, saveReportPeriod, type ReportMarket, type ReportPeriod, type ReportRow } from "../../utils/pageReport";
import { rankSignalsByWinRate } from "../../utils/tradeLogStats";
import { ownLogs, rupees } from "./kit";

const engineOf = (id: string) => ENGINES.find((e) => e.id === id)!;
const PERIODS: [ReportPeriod, string][] = [["today", "Today"], ["7d", "7 days"], ["30d", "30 days"], ["all", "All"]];
const MARKETS: [ReportMarket, string][] = [["ALL", "Both"], ["CRUDEOIL", "🛢️ Crude"], ["NATURALGAS", "🔥 NG"]];
type Tab = "summary" | "tf" | "days" | "signals";
const TABS: [Tab, string][] = [["summary", "Summary"], ["tf", "Timeframes"], ["days", "Days"], ["signals", "Signals"]];
const PERIOD_WORD: Record<ReportPeriod, string> = { today: "today", "7d": "7 days", "30d": "30 days", all: "all time" };
const GREEN = "#059669";
const RED = "#E11D48";

function Table({ rows, first }: { rows: ReportRow[]; first: string }) {
  if (!rows.length) return <p className="text-[11px] text-slate-400 text-center py-2">Nothing closed in this period yet.</p>;
  return (
    <table className="w-full text-[11.5px]">
      <thead>
        <tr className="text-slate-400 text-left">
          <th className="font-semibold pb-1">{first}</th>
          <th className="font-semibold pb-1">Calls</th>
          <th className="font-semibold pb-1">Won / SL</th>
          <th className="font-semibold pb-1">Win</th>
          <th className="font-semibold pb-1 text-right">Net</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.label} className="border-t border-slate-100">
            <td className="py-1.5 font-bold text-slate-700">{r.label}</td>
            <td className="py-1.5 text-slate-500">{r.closed}</td>
            <td className="py-1.5">
              <span className="font-bold text-emerald-600">{r.won}</span> / <span className="font-bold text-rose-500">{r.stopped}</span>
            </td>
            <td className="py-1.5 text-slate-600">{r.winPct === null ? "—" : `${r.winPct}%`}</td>
            <td className="py-1.5 text-right font-black" style={{ color: r.netRs >= 0 ? GREEN : RED }}>
              {rupees(r.netRs)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** A colourful tile: big number on its own gradient. */
function Tile({ big, small, bg }: { big: string; small: string; bg: string }) {
  return (
    <div className="rounded-2xl px-1 py-2 text-center text-white shadow-sm min-w-0" style={{ background: bg }}>
      <p className={`${big.length > 7 ? "text-[14px]" : "text-[18px]"} font-black leading-none whitespace-nowrap drop-shadow-sm`}>{big}</p>
      <p className="text-[9px] font-black uppercase text-white/90 mt-1">{small}</p>
    </div>
  );
}

function Small({ big, small, color }: { big: string; small: string; color?: string }) {
  return (
    <div className="rounded-xl bg-slate-50 border border-slate-100 py-1.5 text-center min-w-0">
      <p className="text-[14px] font-black leading-none whitespace-nowrap" style={{ color: color ?? "#334155" }}>
        {big}
      </p>
      <p className="text-[9px] font-bold uppercase text-slate-400 mt-1">{small}</p>
    </div>
  );
}

/** engineId: whose calls (AI-Test V2 by default; Ai Lite reuses this). signalsTab: AI-Test's signal-tier ranking. */
export function ResultsStrip({ logs, engineId = "aitest", signalsTab = true }: { logs: Record<string, TradeLogEntry[]>; engineId?: string; signalsTab?: boolean }) {
  const [period, setPeriodState] = useState<ReportPeriod>(readReportPeriod);
  const [market, setMarket] = useState<ReportMarket>("ALL");
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("summary");
  const r = useMemo(() => buildPageReport(logs, engineOf(engineId), { period, market }), [logs, engineId, period, market]);
  const tabs = signalsTab ? TABS : TABS.filter(([k]) => k !== "signals");
  const signals = useMemo(() => {
    if (!signalsTab) return [];
    const since = periodStart(period, Date.now());
    const list: TradeLogEntry[] = [];
    for (const [k, entries] of Object.entries(ownLogs(logs))) {
      if (market !== "ALL" && !k.startsWith(`${market}-`)) continue;
      const keep = verifiedEntryIds(entries);
      list.push(...entries.filter((e) => keep.has(e.id) && e.closed && (since === null || (e.closedAt ?? e.openedAt) >= since)));
    }
    return rankSignalsByWinRate(list);
  }, [logs, period, market, signalsTab]);
  const days = [...r.days].reverse();
  const peak = Math.max(1, ...days.map((d) => Math.abs(d.netRs)));
  const up = r.netRs >= 0;
  const chip = (on: boolean) => `rounded-full px-2.5 py-1 text-[11px] font-black ${on ? "text-white shadow" : "bg-slate-100 text-slate-500"}`;
  const chipBg = (on: boolean) => (on ? { background: "linear-gradient(135deg,#7C3AED,#DB2777)" } : undefined);
  const setPeriod = (p: ReportPeriod) => {
    setPeriodState(p);
    saveReportPeriod(p);
  };

  return (
    <section className="rounded-3xl bg-white shadow-md shadow-violet-200/50 p-3.5 space-y-3">
      <button onClick={() => setOpen((o) => !o)} className="w-full text-left space-y-3" aria-expanded={open}>
        <div className="flex items-center gap-2">
          <span className="w-7 h-7 rounded-xl flex items-center justify-center shrink-0" style={{ background: "linear-gradient(135deg,#F59E0B,#F97316)" }}>
            <Trophy size={15} className="text-white" />
          </span>
          <p className="flex-1 text-[14px] font-black text-slate-800">{`Results · ${PERIOD_WORD[period]}${market === "ALL" ? "" : ` · ${market === "CRUDEOIL" ? "Crude" : "NG"}`}`}</p>
          <span className="text-[11px] font-black text-violet-600">{open ? "Hide" : "Full report"}</span>
          <ChevronDown size={15} className={`text-violet-500 transition-transform ${open ? "rotate-180" : ""}`} />
        </div>
        {r.closed === 0 ? (
          <p className="text-[12px] text-slate-500">{`No closed calls ${period === "today" ? "today" : "in this period"} yet${r.running ? ` · ${r.running} running now` : ""}. Each call lands here when it closes.`}</p>
        ) : (
          <div className="grid grid-cols-[1fr_1.45fr_1fr_1fr] gap-1.5">
            <Tile big={r.winPct === null ? "—" : `${r.winPct}%`} small="win rate" bg="linear-gradient(135deg,#10B981,#059669)" />
            <Tile big={rupees(r.netRs)} small="net / lot" bg={up ? "linear-gradient(135deg,#22C55E,#0D9488)" : "linear-gradient(135deg,#F43F5E,#BE123C)"} />
            <Tile big={String(r.closed)} small="closed" bg="linear-gradient(135deg,#0EA5E9,#6366F1)" />
            <Tile big={String(r.running)} small="running" bg="linear-gradient(135deg,#F59E0B,#F97316)" />
          </div>
        )}
        {days.length > 1 && (
          <div>
            <div className="flex items-end gap-1 h-9" aria-label="Net per day, last trading days">
              {days.map((d) => (
                <div key={d.day} className="flex-1 flex flex-col justify-end h-full" title={`${d.label}: ${rupees(d.netRs)}`}>
                  <div className="rounded-t-md" style={{ height: `${Math.max(10, (Math.abs(d.netRs) / peak) * 100)}%`, background: d.netRs >= 0 ? "linear-gradient(180deg,#4ADE80,#059669)" : "linear-gradient(180deg,#FB7185,#E11D48)" }} />
                </div>
              ))}
            </div>
            <p className="text-[9.5px] text-slate-400 mt-1">Net per day, last trading days</p>
          </div>
        )}
      </button>

      {open && (
        <div className="space-y-2.5">
          <div className="flex flex-wrap gap-1.5">
            {PERIODS.map(([k, t]) => (
              <button key={k} onClick={() => setPeriod(k)} className={chip(period === k)} style={chipBg(period === k)}>
                {t}
              </button>
            ))}
            <span className="w-1" />
            {MARKETS.map(([k, t]) => (
              <button key={k} onClick={() => setMarket(k)} className={chip(market === k)} style={chipBg(market === k)}>
                {t}
              </button>
            ))}
          </div>
          <div className={`grid ${tabs.length === 4 ? "grid-cols-4" : "grid-cols-3"} gap-1 rounded-2xl bg-slate-100 p-1`}>
            {tabs.map(([k, t]) => (
              <button key={k} onClick={() => setTab(k)} className={`rounded-xl py-1.5 text-[11px] font-black ${tab === k ? "bg-white text-violet-700 shadow" : "text-slate-500"}`}>
                {t}
              </button>
            ))}
          </div>
          <div className="rounded-2xl border border-slate-100 bg-gradient-to-br from-violet-50/60 to-sky-50/60 p-3 space-y-2">
            {tab === "summary" && (
              <>
                <div className="grid grid-cols-3 gap-2">
                  <Small big={r.t1Pct === null ? "—" : `${r.t1Pct}%`} small="reached T1" color="#7C3AED" />
                  <Small big={r.avgNetRs === null ? "—" : rupees(r.avgNetRs)} small="per call" color={(r.avgNetRs ?? 0) >= 0 ? GREEN : RED} />
                  <Small big={`${r.won}W ${r.stopped}L`} small="won / stopped" />
                </div>
                {r.other > 0 && <p className="text-[10.5px] text-slate-500">{`${r.other} more closed at cost, at day end or by hand — counted in the money, not in the win rate.`}</p>}
                {r.streak && r.streak.n >= 3 && (
                  <p className={`text-[11.5px] font-black rounded-xl px-2.5 py-1.5 ${r.streak.kind === "stopped" ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"}`}>
                    {r.streak.kind === "stopped" ? `⚠️ ${r.streak.n} stop-losses in a row — slow down: half size or skip the next call.` : `🔥 ${r.streak.n} wins in a row — keep the same size; don't get greedy.`}
                  </p>
                )}
                {r.best && <p className="text-[11px] text-slate-600"><b className="text-emerald-700">Best:</b>{` ${r.best.symbol === "CRUDEOIL" ? "Crude" : "NG"} ${r.best.entry.strike} ${r.best.entry.optSide} (${r.best.group}) ${rupees(r.best.rs)}`}</p>}
                {r.worst && <p className="text-[11px] text-slate-600"><b className="text-rose-600">Worst:</b>{` ${r.worst.symbol === "CRUDEOIL" ? "Crude" : "NG"} ${r.worst.entry.strike} ${r.worst.entry.optSide} (${r.worst.group}) ${rupees(r.worst.rs)}`}</p>}
              </>
            )}
            {tab === "tf" && <Table rows={r.groups} first="Timeframe" />}
            {tab === "days" && <Table rows={r.days} first="Day" />}
            {tab === "signals" && (
              <>
                <p className="text-[10.5px] text-slate-500">Which signal tier wins more. Win = Target 3 or out after T2; breakeven closes are left out.</p>
                <table className="w-full text-[11.5px]">
                  <tbody>
                    {signals.map((s) => (
                      <tr key={s.label} className="border-t border-slate-100 first:border-0">
                        <td className="py-1.5 font-bold text-slate-700">{s.label}</td>
                        <td className="py-1.5 text-slate-500">{`${s.total} closed`}</td>
                        <td className="py-1.5">
                          <span className="font-bold text-emerald-600">{s.targetHit}</span> / <span className="font-bold text-lime-600">{s.breakeven}</span> / <span className="font-bold text-rose-500">{s.slHit}</span>
                        </td>
                        <td className="py-1.5 text-right font-black" style={{ color: s.winRate === null ? "#94A3B8" : s.winRate >= 50 ? GREEN : RED }}>
                          {s.winRate === null ? "—" : `${s.winRate}%`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-[10px] text-slate-400">Columns: target / breakeven / stop-loss, then win rate.</p>
              </>
            )}
          </div>
          <p className="text-[9.5px] text-slate-400 leading-snug">{`1 lot a call. Net = the real exit premium minus the entry, less about ₹${EST_COST_RS.CRUDEOIL} (Crude) / ₹${EST_COST_RS.NATURALGAS} (NG) a call for spread, brokerage and taxes.${r.duplicatesSkipped ? ` ${r.duplicatesSkipped} duplicate copies from a second phone not counted.` : ""}`}</p>
        </div>
      )}
    </section>
  );
}
