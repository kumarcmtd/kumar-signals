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

const ENGINE = ENGINES.find((e) => e.id === "aitest")!;
const PERIODS: [ReportPeriod, string][] = [["today", "Today"], ["7d", "7 days"], ["30d", "30 days"], ["all", "All"]];
const MARKETS: [ReportMarket, string][] = [["ALL", "Both"], ["CRUDEOIL", "Crude"], ["NATURALGAS", "NG"]];
type Tab = "summary" | "tf" | "days" | "signals";
const TABS: [Tab, string][] = [["summary", "Summary"], ["tf", "Timeframes"], ["days", "Days"], ["signals", "Signals"]];
const PERIOD_WORD: Record<ReportPeriod, string> = { today: "today", "7d": "7 days", "30d": "30 days", all: "all time" };

function Table({ rows, first }: { rows: ReportRow[]; first: string }) {
  if (!rows.length) return <p className="text-[11px] text-white/40 text-center py-2">Nothing closed in this period yet.</p>;
  return (
    <table className="w-full text-[11.5px]">
      <thead>
        <tr className="text-white/40 text-left">
          <th className="font-semibold pb-1">{first}</th>
          <th className="font-semibold pb-1">Calls</th>
          <th className="font-semibold pb-1">Won / SL</th>
          <th className="font-semibold pb-1">Win</th>
          <th className="font-semibold pb-1 text-right">Net</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.label} className="border-t border-white/10">
            <td className="py-1.5 font-bold">{r.label}</td>
            <td className="py-1.5 text-white/60">{r.closed}</td>
            <td className="py-1.5">
              <span className="font-bold text-emerald-400">{r.won}</span> / <span className="font-bold text-rose-400">{r.stopped}</span>
            </td>
            <td className="py-1.5 text-white/70">{r.winPct === null ? "—" : `${r.winPct}%`}</td>
            <td className="py-1.5 text-right font-black" style={{ color: r.netRs >= 0 ? "#34D399" : "#FB7185" }}>
              {rupees(r.netRs)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Stat({ big, small, color }: { big: string; small: string; color?: string }) {
  return (
    <div className="text-center min-w-0">
      <p className={`${big.length > 7 ? "text-[16px]" : "text-[19px]"} font-black leading-none whitespace-nowrap`} style={{ color }}>
        {big}
      </p>
      <p className="text-[9.5px] font-bold uppercase text-white/45 mt-1">{small}</p>
    </div>
  );
}

export function ResultsStrip({ logs }: { logs: Record<string, TradeLogEntry[]> }) {
  const [period, setPeriodState] = useState<ReportPeriod>(readReportPeriod);
  const [market, setMarket] = useState<ReportMarket>("ALL");
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("summary");
  const r = useMemo(() => buildPageReport(logs, ENGINE, { period, market }), [logs, period, market]);
  const signals = useMemo(() => {
    const since = periodStart(period, Date.now());
    const list: TradeLogEntry[] = [];
    for (const [k, entries] of Object.entries(ownLogs(logs))) {
      if (market !== "ALL" && !k.startsWith(`${market}-`)) continue;
      const keep = verifiedEntryIds(entries);
      list.push(...entries.filter((e) => keep.has(e.id) && e.closed && (since === null || (e.closedAt ?? e.openedAt) >= since)));
    }
    return rankSignalsByWinRate(list);
  }, [logs, period, market]);
  const days = [...r.days].reverse();
  const peak = Math.max(1, ...days.map((d) => Math.abs(d.netRs)));
  const up = r.netRs >= 0;
  const chip = (on: boolean) => `rounded-full px-2.5 py-1 text-[11px] font-black ${on ? "bg-white text-slate-900" : "bg-white/10 text-white/70"}`;
  const setPeriod = (p: ReportPeriod) => {
    setPeriodState(p);
    saveReportPeriod(p);
  };

  return (
    <section className="rounded-3xl border p-3.5 space-y-3" style={{ borderColor: up ? "rgba(52,211,153,.35)" : "rgba(251,113,133,.35)", background: up ? "linear-gradient(135deg,rgba(16,185,129,.18),rgba(6,182,212,.08) 60%,rgba(255,255,255,.02))" : "linear-gradient(135deg,rgba(244,63,94,.18),rgba(249,115,22,.06) 60%,rgba(255,255,255,.02))" }}>
      <button onClick={() => setOpen((o) => !o)} className="w-full text-left space-y-3" aria-expanded={open}>
        <div className="flex items-center gap-2">
          <Trophy size={16} className="text-amber-300" />
          <p className="flex-1 text-[13px] font-black">{`Results · ${PERIOD_WORD[period]}${market === "ALL" ? "" : ` · ${market === "CRUDEOIL" ? "Crude" : "NG"}`}`}</p>
          <span className="text-[10.5px] font-bold text-white/55">{open ? "Hide" : "Full report"}</span>
          <ChevronDown size={15} className={`text-white/55 transition-transform ${open ? "rotate-180" : ""}`} />
        </div>
        {r.closed === 0 ? (
          <p className="text-[12px] text-white/55">{`No closed calls ${period === "today" ? "today" : "in this period"} yet${r.running ? ` · ${r.running} running now` : ""}. Each call lands here when it closes.`}</p>
        ) : (
          <div className="grid grid-cols-[1fr_1.5fr_1fr_1fr] gap-1.5">
            <Stat big={r.winPct === null ? "—" : `${r.winPct}%`} small="win rate" color="#6EE7B7" />
            <Stat big={rupees(r.netRs)} small="net / lot" color={up ? "#34D399" : "#FB7185"} />
            <Stat big={String(r.closed)} small="closed" />
            <Stat big={String(r.running)} small="running" color="#FCD34D" />
          </div>
        )}
        {days.length > 1 && (
          <div className="flex items-end gap-1 h-9" aria-label="Net per day, last trading days">
            {days.map((d) => (
              <div key={d.day} className="flex-1 flex flex-col justify-end h-full" title={`${d.label}: ${rupees(d.netRs)}`}>
                <div className="rounded-t-md" style={{ height: `${Math.max(8, (Math.abs(d.netRs) / peak) * 100)}%`, background: d.netRs >= 0 ? "linear-gradient(180deg,#34D399,#059669)" : "linear-gradient(180deg,#FB7185,#BE123C)" }} />
              </div>
            ))}
          </div>
        )}
      </button>

      {open && (
        <div className="space-y-2.5">
          <div className="flex flex-wrap gap-1.5">
            {PERIODS.map(([k, t]) => (
              <button key={k} onClick={() => setPeriod(k)} className={chip(period === k)}>
                {t}
              </button>
            ))}
            <span className="w-1" />
            {MARKETS.map(([k, t]) => (
              <button key={k} onClick={() => setMarket(k)} className={chip(market === k)}>
                {t}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-4 gap-1 rounded-2xl bg-black/25 p-1">
            {TABS.map(([k, t]) => (
              <button key={k} onClick={() => setTab(k)} className={`rounded-xl py-1.5 text-[11px] font-black ${tab === k ? "bg-white/15 text-white" : "text-white/50"}`}>
                {t}
              </button>
            ))}
          </div>
          <div className="rounded-2xl bg-black/25 p-3 space-y-2">
            {tab === "summary" && (
              <>
                <div className="grid grid-cols-3 gap-2">
                  <Stat big={r.t1Pct === null ? "—" : `${r.t1Pct}%`} small="reached T1" />
                  <Stat big={r.avgNetRs === null ? "—" : rupees(r.avgNetRs)} small="per call" color={(r.avgNetRs ?? 0) >= 0 ? "#34D399" : "#FB7185"} />
                  <Stat big={`${r.won}W ${r.stopped}L`} small="won / stopped" />
                </div>
                {r.other > 0 && <p className="text-[10.5px] text-white/45">{`${r.other} more closed at cost, at day end or by hand — counted in the money, not in the win rate.`}</p>}
                {r.streak && r.streak.n >= 3 && <p className={`text-[11.5px] font-black ${r.streak.kind === "stopped" ? "text-rose-300" : "text-emerald-300"}`}>{r.streak.kind === "stopped" ? `⚠️ ${r.streak.n} stop-losses in a row — slow down: half size or skip the next call.` : `🔥 ${r.streak.n} wins in a row — keep the same size; don't get greedy.`}</p>}
                {r.best && <p className="text-[11px] text-white/70">{`Best: ${r.best.symbol === "CRUDEOIL" ? "Crude" : "NG"} ${r.best.entry.strike} ${r.best.entry.optSide} (${r.best.group}) ${rupees(r.best.rs)}`}</p>}
                {r.worst && <p className="text-[11px] text-white/70">{`Worst: ${r.worst.symbol === "CRUDEOIL" ? "Crude" : "NG"} ${r.worst.entry.strike} ${r.worst.entry.optSide} (${r.worst.group}) ${rupees(r.worst.rs)}`}</p>}
              </>
            )}
            {tab === "tf" && <Table rows={r.groups} first="Timeframe" />}
            {tab === "days" && <Table rows={r.days} first="Day" />}
            {tab === "signals" && (
              <>
                <p className="text-[10.5px] text-white/45">Which signal tier wins more. Win = Target 3 or out after T2; breakeven closes are left out.</p>
                <table className="w-full text-[11.5px]">
                  <tbody>
                    {signals.map((s) => (
                      <tr key={s.label} className="border-t border-white/10 first:border-0">
                        <td className="py-1.5 font-bold">{s.label}</td>
                        <td className="py-1.5 text-white/60">{`${s.total} closed`}</td>
                        <td className="py-1.5">
                          <span className="font-bold text-emerald-400">{s.targetHit}</span> / <span className="font-bold text-lime-300">{s.breakeven}</span> / <span className="font-bold text-rose-400">{s.slHit}</span>
                        </td>
                        <td className="py-1.5 text-right font-black" style={{ color: s.winRate === null ? "#94A3B8" : s.winRate >= 50 ? "#34D399" : "#FB7185" }}>
                          {s.winRate === null ? "—" : `${s.winRate}%`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-[10px] text-white/35">Columns: target / breakeven / stop-loss, then win rate.</p>
              </>
            )}
          </div>
          <p className="text-[9.5px] text-white/35 leading-snug">{`1 lot a call. Net = the real exit premium minus the entry, less about ₹${EST_COST_RS.CRUDEOIL} (Crude) / ₹${EST_COST_RS.NATURALGAS} (NG) a call for spread, brokerage and taxes.${r.duplicatesSkipped ? ` ${r.duplicatesSkipped} duplicate copies from a second phone not counted.` : ""}`}</p>
        </div>
      )}
    </section>
  );
}
