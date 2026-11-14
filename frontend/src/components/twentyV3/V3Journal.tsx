// The v3 journal: every real v3 call with its result in rupees (per lot and
// for the trader's lots), plus the running totals a trade manager reviews.

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, NotebookPen } from "lucide-react";
import type { TradeLogEntry } from "../../utils/tradeLogCore";
import { exitPriceFor } from "../../utils/tradeLogPnl";
import { verifiedEntryIds } from "../../utils/dedupeTradeLog";
import { LAB_COST_RS, LAB_LOT, type LabSym } from "../../utils/twentyLab";
import { fmtWhen } from "../CallCardKit";

const signed = (n: number) => `${n >= 0 ? "+" : "−"}₹${Math.abs(Math.round(n)).toLocaleString("en-IN")}`;
const STATUS: Record<string, string> = {
  running: "Running",
  sl_hit: "Stop hit",
  stopped_breakeven: "Out at entry after T1",
  stopped_after_t1: "Out at T1 after T2",
  target3_hit: "Target 3",
  closed_eod: "Closed at the bell",
  closed_manual: "Closed",
};

export interface JournalRow {
  sym: LabSym;
  entry: TradeLogEntry;
}

export function V3Journal({ rows, lots, onOpen }: { rows: JournalRow[]; lots: number; onOpen: (r: JournalRow) => void }) {
  const [all, setAll] = useState(false);
  const stats = useMemo(() => {
    const closed = rows.filter((r) => r.entry.closed);
    const pnl = closed.map((r) => (exitPriceFor(r.entry) - r.entry.entry) * LAB_LOT[r.sym]);
    const wins = pnl.filter((x) => x > 0);
    const losses = pnl.filter((x) => x < 0);
    let peak = 0;
    let eq = 0;
    let dd = 0;
    for (const x of [...pnl].reverse()) {
      eq += x;
      peak = Math.max(peak, eq);
      dd = Math.max(dd, peak - eq);
    }
    return {
      n: closed.length,
      // After the same estimated costs the lab and the trade report take off.
      net: pnl.reduce((a, x) => a + x, 0) - closed.reduce((a, r) => a + LAB_COST_RS[r.sym], 0),
      winPct: closed.length ? Math.round((wins.length / closed.length) * 100) : null,
      avgWin: wins.length ? wins.reduce((a, x) => a + x, 0) / wins.length : null,
      avgLoss: losses.length ? losses.reduce((a, x) => a + x, 0) / losses.length : null,
      dd,
    };
  }, [rows]);
  const verified = useMemo(() => {
    const out = new Set<string>();
    for (const sym of ["CRUDEOIL", "NATURALGAS"] as const) for (const id of verifiedEntryIds(rows.filter((r) => r.sym === sym).map((r) => r.entry))) out.add(`${sym}-${id}`);
    return out;
  }, [rows]);
  const shown = all ? rows : rows.slice(0, 6);
  return (
    <section className="rounded-3xl bg-white shadow-md p-4 space-y-3">
      <p className="text-[13px] font-black text-slate-800 flex items-center gap-1.5">
        <NotebookPen size={15} className="text-amber-500" /> My v3 journal{rows.length && rows.every((r) => r.entry.practice) ? " — practice calls" : ""}
      </p>
      {stats.n === 0 ? (
        <p className="text-[11.5px] text-slate-500">No v3 call has closed yet. Each one lands here with its result — practice calls too — so v3 is judged on what really happens, not on promises.</p>
      ) : (
        <div className="grid grid-cols-3 gap-2 text-center">
          {[
            ["Closed", String(stats.n), "#334155"],
            ["Winners", `${stats.winPct}%`, "#334155"],
            ["Net / lot*", signed(stats.net), stats.net >= 0 ? "#059669" : "#E11D48"],
            ["Avg win", stats.avgWin !== null ? signed(stats.avgWin) : "—", "#059669"],
            ["Avg loss", stats.avgLoss !== null ? signed(stats.avgLoss) : "—", "#E11D48"],
            ["Worst dip", stats.dd ? signed(-stats.dd) : "—", "#E11D48"],
          ].map(([label, value, color]) => (
            <div key={label} className="rounded-xl bg-slate-50 py-2">
              <p className="text-[9px] text-slate-400 font-bold uppercase">{label}</p>
              <p className="text-[13px] font-black" style={{ color }}>
                {value}
              </p>
            </div>
          ))}
        </div>
      )}
      {stats.n > 0 && (
        <p className="text-[10px] text-slate-400">
          *After estimated costs (₹150 crude / ₹200 gas a call). Rows show the premium move.{lots > 1 ? ` With your ${lots} lots: net ${signed(stats.net * lots)}.` : ""}
        </p>
      )}
      <div className="space-y-2">
        {shown.map((r) => {
          const e = r.entry;
          const exit = e.closed ? exitPriceFor(e) : null;
          const pnl = exit !== null ? (exit - e.entry) * LAB_LOT[r.sym] : null;
          const ok = verified.has(`${r.sym}-${e.id}`);
          return (
            <button key={`${r.sym}-${e.id}`} onClick={() => onOpen(r)} className="w-full text-left rounded-xl border px-3 py-2.5 active:bg-slate-50" style={{ borderColor: ok ? "#E2E8F0" : "#FCA5A5", opacity: ok ? 1 : 0.6 }}>
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-bold truncate text-slate-700">
                    {e.practice && <span className="mr-1 text-[9px] font-black px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800">PAPER</span>}
                    {r.sym === "CRUDEOIL" ? "Crude" : "Gas"} {e.strike} {e.optSide} <span className="text-[10px] font-semibold text-slate-400">· {(e.meta?.label ?? "").replace("Ai20-20 v3 · ", "").replace(" (practice)", "")}</span>
                  </p>
                  <p className="text-[10px] text-slate-400">
                    {fmtWhen(e.openedAt)} at ₹{e.entry}
                    {exit !== null && <> → ₹{exit}</>}
                  </p>
                  {!ok && <span className="inline-block mt-1 text-[9px] font-black px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-700">Duplicate — not counted</span>}
                </div>
                <div className="text-right shrink-0 flex items-center gap-1">
                  <div>
                    <p className="text-xs font-bold" style={{ color: pnl === null ? "#B45309" : pnl > 0 ? "#059669" : pnl < 0 ? "#E11D48" : "#B45309" }}>
                      {STATUS[e.status] ?? e.status}
                    </p>
                    {pnl !== null && <p className="text-[10px] font-bold text-slate-500">{signed(pnl)}/lot</p>}
                  </div>
                  <ChevronRight size={14} className="text-slate-400" />
                </div>
              </div>
            </button>
          );
        })}
        {rows.length > 6 && (
          <button onClick={() => setAll((o) => !o)} className="w-full flex items-center justify-center gap-1 text-[11px] font-bold text-sky-600 py-1.5">
            {all ? "Show less" : `Show all ${rows.length}`}
            <ChevronDown size={13} className={`transition-transform ${all ? "rotate-180" : ""}`} />
          </button>
        )}
      </div>
    </section>
  );
}
