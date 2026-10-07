import { useEffect, useMemo, useState } from "react";
import { CalendarDays } from "lucide-react";
import { useSeasonal } from "../api/hooks";
import { buildMonthly, MONTH_LABELS } from "../utils/seasonalCompare";
import type { InstrumentSymbol } from "../types";

function signed(v: number | null, d = 1): string {
  if (v === null) return "—";
  const r = Number(v.toFixed(d));
  return r === 0 ? `${(0).toFixed(d)}%` : `${r > 0 ? "+" : ""}${r.toFixed(d)}%`; // never "-0%"
}

/** Green/red tint whose strength follows the size of the move (capped at ±15%). */
function tint(v: number | null): { background: string; color: string } {
  if (v === null) return { background: "#F8FAFC", color: "#CBD5E1" };
  const a = Math.min(1, Math.abs(v) / 15);
  return v >= 0
    ? { background: `rgba(22,163,74,${0.1 + a * 0.45})`, color: a > 0.55 ? "#fff" : "#166534" }
    : { background: `rgba(220,38,38,${0.1 + a * 0.45})`, color: a > 0.55 ? "#fff" : "#991B1B" };
}

export function SeasonalMonthCard({ symbol }: { symbol: InstrumentSymbol }) {
  const { data } = useSeasonal(symbol);
  const view = useMemo(() => (data?.months?.length ? buildMonthly(data.months) : null), [data]);
  const [rupees, setRupees] = useState(false);
  const [month, setMonth] = useState<number | null>(null);
  useEffect(() => {
    if (view && month === null) setMonth(view.currentMonth);
  }, [view, month]);
  if (!view) return null;
  const isGas = symbol === "NATURALGAS";
  const row = view.rows[month ?? view.currentMonth];
  const price = (v: number, fx: number | null) => (rupees ? (fx ? `₹${(v * fx).toFixed(0)}` : "—") : `$${v.toFixed(isGas ? 3 : 2)}`);

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="w-8 h-8 rounded-xl flex items-center justify-center text-white" style={{ background: "linear-gradient(140deg,#16A34A,#0EA5E9)" }}>
            <CalendarDays size={16} />
          </span>
          <div>
            <p className="text-[13px] font-black text-slate-800">Month by month, past years</p>
            <p className="text-[10px] text-slate-500">% move from the month's open to its close · tap a month</p>
          </div>
        </div>
        <div className="flex gap-1 p-0.5 rounded-lg bg-slate-100 shrink-0">
          {([false, true] as const).map((r) => (
            <button key={String(r)} onClick={() => setRupees(r)} className="px-2 py-1 rounded-md text-[10.5px] font-black" style={rupees === r ? { background: "#fff", color: "#4338CA" } : { color: "#64748B" }}>
              {r ? "≈ ₹" : "$"}
            </button>
          ))}
        </div>
      </div>

      {/* Season at a glance: every month x every year. */}
      <div className="overflow-x-auto -mx-1">
        <table className="w-full text-[10.5px] border-separate" style={{ borderSpacing: 2 }}>
          <thead>
            <tr className="text-slate-400">
              <th className="text-left px-1 font-bold">Month</th>
              {view.years.map((y) => (
                <th key={y} className="text-center font-bold">{y}</th>
              ))}
              <th className="text-center font-bold">Typical</th>
            </tr>
          </thead>
          <tbody>
            {view.rows.map((r) => {
              const selected = r.month === (month ?? view.currentMonth);
              return (
                <tr key={r.month} onClick={() => setMonth(r.month)} className="cursor-pointer">
                  <td className={`px-1 py-1 rounded-md font-black ${selected ? "bg-violet-600 text-white" : r.month === view.currentMonth ? "text-violet-700" : "text-slate-700"}`}>
                    {r.label}
                  </td>
                  {view.years.map((y) => {
                    const c = r.cells[y];
                    return (
                      <td key={y} className="text-center py-1 rounded-md font-bold tabular-nums" style={tint(c ? c.changePct : null)}>
                        {c ? `${signed(c.changePct, 0)}${c.partial ? "*" : ""}` : "·"}
                      </td>
                    );
                  })}
                  <td className="text-center py-1 rounded-md tabular-nums bg-slate-50">
                    <span className="font-black" style={{ color: r.avgChangePct === null ? "#94A3B8" : r.avgChangePct >= 0 ? "#166534" : "#991B1B" }}>{signed(r.avgChangePct, 0)}</span>
                    <span className="block text-[8.5px] text-slate-400">up {r.up}/{r.years}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* The selected month, in full. */}
      <div className="rounded-2xl border border-slate-100 p-2.5">
        <p className="text-[12px] font-black text-slate-800 mb-1.5">
          {MONTH_LABELS[row.month]} — each year
          <span className="font-normal text-slate-500"> · typical range {row.avgRangePct !== null ? `${row.avgRangePct.toFixed(0)}%` : "—"} low-to-high</span>
        </p>
        <table className="w-full text-[10.5px]">
          <thead>
            <tr className="text-slate-400">
              <th className="text-left py-0.5">Year</th>
              <th className="text-right">Open</th>
              <th className="text-right">High</th>
              <th className="text-right">Low</th>
              <th className="text-right">Close</th>
              <th className="text-right">Move</th>
              <th className="text-right">Range</th>
            </tr>
          </thead>
          <tbody>
            {view.years
              .slice()
              .reverse()
              .map((y) => {
                const c = row.cells[y];
                return (
                  <tr key={y} className="border-t border-slate-100">
                    <td className="py-1 font-black text-slate-700">{y}{c?.partial ? "*" : ""}</td>
                    {c ? (
                      <>
                        <td className="text-right tabular-nums text-slate-600">{price(c.open, c.usdInr)}</td>
                        <td className="text-right tabular-nums text-green-700 font-bold">{price(c.high, c.usdInr)}</td>
                        <td className="text-right tabular-nums text-red-700 font-bold">{price(c.low, c.usdInr)}</td>
                        <td className="text-right tabular-nums text-slate-800 font-bold">{price(c.close, c.usdInr)}</td>
                        <td className="text-right tabular-nums font-black" style={{ color: c.changePct >= 0 ? "#16A34A" : "#DC2626" }}>{signed(c.changePct)}</td>
                        <td className="text-right tabular-nums text-slate-600">{c.rangePct.toFixed(0)}%</td>
                      </>
                    ) : (
                      <td colSpan={6} className="text-right text-slate-300">not yet</td>
                    )}
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      <p className="text-[10px] text-slate-400 leading-snug">
        Monthly NYMEX bars. Move = open to close; Range = low to high as % of the low — how much room the month gave either way. * = month in progress
        (so far). "Typical" counts the past {view.years.length - 1} complete years only. ≈ ₹ uses that month's USD/INR.
      </p>
    </div>
  );
}
