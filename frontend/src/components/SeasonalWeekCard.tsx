import { useMemo, useState } from "react";
import { CalendarRange, TrendingUp, TrendingDown, Info, ChevronDown } from "lucide-react";
import { useSeasonal } from "../api/hooks";
import { buildSeasonal, FORWARD_WEEKS, seasonGrid, type SeasonalView } from "../utils/seasonalCompare";
import type { InstrumentSymbol } from "../types";

const YEAR_INK = ["#94A3B8", "#F59E0B", "#0EA5E9", "#7C3AED"]; // oldest -> newest
const UP = "#16A34A";
const DOWN = "#DC2626";

function signed(v: number | null, digits = 1): string {
  if (v === null) return "—";
  const r = Number(v.toFixed(digits));
  return r === 0 ? `${(0).toFixed(digits)}%` : `${r > 0 ? "+" : ""}${r.toFixed(digits)}%`; // never "-0%"
}
const inkOf = (v: number | null) => (v === null ? "#94A3B8" : v > 0 ? UP : v < 0 ? DOWN : "#64748B");
const fmtDate = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });

/** One line per year across the 52 weeks, current week marked. */
function SeasonChart({ view, rupees, usdInrNow }: { view: SeasonalView; rupees: boolean; usdInrNow: number | null }) {
  const W = 320;
  const H = 150;
  const pad = { l: 34, r: 8, t: 8, b: 18 };
  const val = (v: number | null) => (v === null ? null : rupees && usdInrNow ? v * usdInrNow : v);
  const all = view.chart.flatMap((p) => view.chartYears.map((y) => val(p[String(y)] as number | null))).filter((v): v is number => v !== null);
  if (all.length === 0) return null;
  const min = Math.min(...all);
  const max = Math.max(...all);
  const x = (w: number) => pad.l + ((w - 1) / 52) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - min) / (max - min || 1)) * (H - pad.t - pad.b);
  const ticks = [min, (min + max) / 2, max];
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="#E2E8F0" strokeWidth={0.6} />
            <text x={pad.l - 3} y={y(t) + 3} fontSize={7} textAnchor="end" fill="#94A3B8">{t.toFixed(rupees ? 0 : 2)}</text>
          </g>
        ))}
        {[1, 14, 27, 40, 52].map((w) => (
          <text key={w} x={x(w)} y={H - 5} fontSize={7} textAnchor="middle" fill="#94A3B8">wk {w}</text>
        ))}
        <line x1={x(view.week)} x2={x(view.week)} y1={pad.t} y2={H - pad.b} stroke="#7C3AED" strokeDasharray="2 2" strokeWidth={0.8} />
        {view.chartYears.map((yr, i) => {
          const pts = view.chart
            .map((p) => ({ w: p.week, v: val(p[String(yr)] as number | null) }))
            .filter((p): p is { w: number; v: number } => p.v !== null);
          const d = pts.map((p, j) => `${j ? "L" : "M"}${x(p.w).toFixed(1)},${y(p.v).toFixed(1)}`).join("");
          const ink = YEAR_INK[YEAR_INK.length - view.chartYears.length + i] ?? "#94A3B8";
          return <path key={yr} d={d} fill="none" stroke={ink} strokeWidth={i === view.chartYears.length - 1 ? 2 : 1.2} />;
        })}
      </svg>
      <div className="flex flex-wrap gap-3 justify-center text-[10px] font-bold mt-0.5">
        {view.chartYears.map((yr, i) => (
          <span key={yr} className="flex items-center gap-1">
            <i className="w-3 h-[3px] rounded inline-block" style={{ background: YEAR_INK[YEAR_INK.length - view.chartYears.length + i] }} /> {yr}
          </span>
        ))}
        <span className="flex items-center gap-1 text-violet-600">┆ this week</span>
      </div>
    </div>
  );
}

export function SeasonalWeekCard({ symbol }: { symbol: InstrumentSymbol }) {
  const { data, isLoading, error } = useSeasonal(symbol);
  const view = useMemo(() => (data?.weeks?.length ? buildSeasonal(data.weeks) : null), [data]);
  const usdInrNow = data?.weeks?.length ? data.weeks[data.weeks.length - 1].usdInr : null;
  const [rupees, setRupees] = useState(false);
  const [showGrid, setShowGrid] = useState(false);
  const grid = useMemo(() => (view && data ? seasonGrid(data.weeks, view) : []), [view, data]);
  const shortDate = (d: string | null) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: "UTC" }) : "");
  const isGas = symbol === "NATURALGAS";

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="w-8 h-8 rounded-xl flex items-center justify-center text-white" style={{ background: "linear-gradient(140deg,#0EA5E9,#7C3AED)" }}>
            <CalendarRange size={16} />
          </span>
          <div>
            <p className="text-[13px] font-black text-slate-800">Same week in past years</p>
            <p className="text-[10px] text-slate-500">{view ? `Week ${view.week} of the year · ` : ""}{isGas ? "gas is seasonal — compare like with like" : "weekly NYMEX history"}</p>
          </div>
        </div>
        <div className="flex gap-1 p-0.5 rounded-lg bg-slate-100 shrink-0">
          {([false, true] as const).map((r) => (
            <button
              key={String(r)}
              onClick={() => setRupees(r)}
              className="px-2 py-1 rounded-md text-[10.5px] font-black"
              style={rupees === r ? { background: "#fff", color: "#4338CA" } : { color: "#64748B" }}
            >
              {r ? "≈ ₹" : "$"}
            </button>
          ))}
        </div>
      </div>

      {isLoading && <p className="text-sm text-slate-500">Loading weekly history…</p>}
      {(error || data?.error) && <p className="text-sm text-rose-600">{(error as Error)?.message ?? data?.error}</p>}
      {data && !data.error && !view && <p className="text-sm text-slate-500">Not enough weekly history returned yet.</p>}

      {view && (
        <>
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-slate-400">
                  <th className="text-left px-1 py-1">Year · week of</th>
                  <th className="text-right px-1 py-1">Price</th>
                  <th className="text-right px-1 py-1">That week</th>
                  {FORWARD_WEEKS.map((n) => (
                    <th key={n} className="text-right px-1 py-1">+{n}w</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {view.rows.map((r) => (
                  <tr key={r.year} className={`border-t border-slate-100 ${r.isCurrent ? "bg-violet-50/60" : ""}`}>
                    <td className="px-1 py-1.5">
                      <p className="font-black text-slate-800">{r.year}{r.isCurrent ? " (now)" : ""}</p>
                      <p className="text-[9.5px] text-slate-400">{fmtDate(r.date)}</p>
                    </td>
                    <td className="text-right px-1 font-black text-slate-800 tabular-nums">
                      {rupees ? (r.inr !== null ? `₹${r.inr.toFixed(0)}` : "—") : `$${r.close.toFixed(isGas ? 3 : 2)}`}
                    </td>
                    <td className="text-right px-1 font-bold tabular-nums" style={{ color: inkOf(r.weekChangePct) }}>{signed(r.weekChangePct)}</td>
                    {FORWARD_WEEKS.map((n) => (
                      <td key={n} className="text-right px-1 font-bold tabular-nums" style={{ color: inkOf(r.forwardPct[n]) }}>
                        {r.isCurrent ? "?" : signed(r.forwardPct[n])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            {view.tendencies.map((t) => {
              const up = t.up > t.down;
              const Icon = up ? TrendingUp : TrendingDown;
              const ink = t.years === 0 ? "#94A3B8" : t.up === t.down ? "#64748B" : up ? UP : DOWN;
              return (
                <div key={t.weeks} className="rounded-xl px-2.5 py-1.5" style={{ background: `${ink}12` }}>
                  <p className="text-[9.5px] font-bold uppercase text-slate-500">Next {t.weeks} week{t.weeks > 1 ? "s" : ""}</p>
                  <p className="text-[12px] font-black flex items-center gap-1" style={{ color: ink }}>
                    <Icon size={13} /> Up {t.up} of {t.years} yrs
                  </p>
                  <p className="text-[10px] text-slate-500">avg {signed(t.avgPct)}</p>
                </div>
              );
            })}
          </div>

          <SeasonChart view={view} rupees={rupees} usdInrNow={usdInrNow} />

          <button onClick={() => setShowGrid((s) => !s)} className="w-full flex items-center justify-center gap-1 text-[11.5px] font-bold text-indigo-600 py-1">
            Week by week, next 12 weeks <ChevronDown size={13} className={showGrid ? "rotate-180" : ""} />
          </button>
          {showGrid && (
            <div className="overflow-x-auto -mx-1">
              <table className="w-full text-[10.5px]">
                <thead>
                  <tr className="text-slate-400">
                    <th className="text-left px-1 py-1">Week</th>
                    {view.rows.map((r) => (
                      <th key={r.year} className="text-right px-1 py-1">{r.year}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {grid.map((g) => (
                    <tr key={g.offset} className={`border-t border-slate-100 ${g.offset === 0 ? "bg-violet-50/60" : ""}`}>
                      <td className="px-1 py-1 font-bold text-slate-600">{g.offset === 0 ? "This wk" : `+${g.offset}`}</td>
                      {g.cells.map((c, i) => {
                        const base = grid[0].cells[i].close;
                        const chg = c.close !== null && base ? ((c.close - base) / base) * 100 : null;
                        return (
                          <td key={c.year} className="text-right px-1 py-1 tabular-nums">
                            {c.close === null ? (
                              <span className="text-slate-300">—</span>
                            ) : (
                              <>
                                <span className="font-bold text-slate-800">{rupees ? (c.inr !== null ? `₹${c.inr.toFixed(0)}` : "—") : `$${c.close.toFixed(isGas ? 2 : 1)}`}</span>
                                <span className="block text-[9px]" style={{ color: inkOf(g.offset ? chg : null) }}>
                                  {shortDate(c.date)}{g.offset ? ` · ${signed(chg, 0)}` : ""}
                                </span>
                              </>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex gap-1.5 rounded-xl bg-slate-50 px-2.5 py-2">
            <Info size={13} className="shrink-0 mt-[1px] text-slate-400" />
            <p className="text-[10.5px] text-slate-500 leading-snug">
              {data?.source}. Weeks matched by week-of-year, so each row is the same part of the season. ≈ ₹ = the $ price × that week's USD/INR — close to
              MCX's rupee price but not exact (MCX has its own contract dates and spread); the chart's ₹ uses today's rate. Three years is a small sample and
              {isGas ? " every winter's weather is different, so" : ""} this shows what the season has tended to do, not what it will do.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
