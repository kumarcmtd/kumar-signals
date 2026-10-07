import { useMemo } from "react";
import { Database } from "lucide-react";
import { useNgStorage } from "../api/hooks";
import { buildStorage, readChange, readLevel, type StorageView } from "../utils/storageCompare";

const YEAR_INK = ["#94A3B8", "#F59E0B", "#0EA5E9", "#7C3AED"]; // oldest -> newest
const TONE = {
  bullish: { bg: "#ECFDF5", fg: "#047857" },
  bearish: { bg: "#FEF2F2", fg: "#B91C1C" },
  neutral: { bg: "#F1F5F9", fg: "#334155" },
  unknown: { bg: "#F8FAFC", fg: "#64748B" },
};

const bcf = (v: number | null) => (v === null ? "—" : Math.round(v).toLocaleString("en-IN"));
const sbcf = (v: number | null) => (v === null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(Math.round(v))}`);
function spct(v: number | null): string {
  if (v === null) return "—";
  const r = Number(v.toFixed(1));
  return r === 0 ? "0.0%" : `${r > 0 ? "+" : ""}${r.toFixed(1)}%`;
}
const fmtDate = (d: string, year = false) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", ...(year ? { year: "numeric" } : {}), timeZone: "UTC" });

/** This year and the last three, with the 5-year min-max range shaded. */
function StorageChart({ v }: { v: StorageView }) {
  const W = 320;
  const H = 150;
  const pad = { l: 34, r: 8, t: 8, b: 18 };
  const vals = v.chart.flatMap((p) => [...v.chartYears.map((y) => p[String(y)]), p.min5, p.max5]).filter((x): x is number => typeof x === "number");
  if (!vals.length) return null;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const x = (w: number) => pad.l + ((w - 1) / 52) * (W - pad.l - pad.r);
  const y = (val: number) => pad.t + (1 - (val - min) / (max - min || 1)) * (H - pad.t - pad.b);
  const band = v.chart.filter((p) => p.min5 !== null && p.max5 !== null);
  const bandPath = band.length
    ? `M${band.map((p) => `${x(p.week).toFixed(1)},${y(p.max5!).toFixed(1)}`).join("L")}L${[...band].reverse().map((p) => `${x(p.week).toFixed(1)},${y(p.min5!).toFixed(1)}`).join("L")}Z`
    : "";
  const ticks = [min, (min + max) / 2, max];
  const months = [["Jan", 1], ["Apr", 14], ["Jul", 27], ["Oct", 40], ["Dec", 50]] as const;
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="#E2E8F0" strokeWidth={0.6} />
            <text x={pad.l - 3} y={y(t) + 3} fontSize={7} textAnchor="end" fill="#94A3B8">{Math.round(t)}</text>
          </g>
        ))}
        {months.map(([m, w]) => (
          <text key={m} x={x(w)} y={H - 5} fontSize={7} textAnchor="middle" fill="#94A3B8">{m}</text>
        ))}
        {bandPath && <path d={bandPath} fill="#CBD5E1" opacity={0.45} />}
        {v.chartYears.map((yr, i) => {
          const pts = v.chart.filter((p) => typeof p[String(yr)] === "number");
          const d = pts.map((p, j) => `${j ? "L" : "M"}${x(p.week).toFixed(1)},${y(p[String(yr)] as number).toFixed(1)}`).join("");
          return <path key={yr} d={d} fill="none" stroke={YEAR_INK[i]} strokeWidth={i === v.chartYears.length - 1 ? 2.2 : 1.2} />;
        })}
      </svg>
      <div className="flex flex-wrap gap-3 justify-center text-[10px] font-bold mt-0.5">
        {v.chartYears.map((yr, i) => (
          <span key={yr} className="flex items-center gap-1">
            <i className="w-3 h-[3px] rounded inline-block" style={{ background: YEAR_INK[i] }} /> {yr}
          </span>
        ))}
        <span className="flex items-center gap-1 text-slate-500">
          <i className="w-3 h-2 rounded-sm inline-block bg-slate-300" /> 5-yr range
        </span>
      </div>
    </div>
  );
}

function Chip({ label, value, sub }: { label: string; value: number | null; sub?: string }) {
  const ink = value === null ? "#64748B" : value > 0 ? "#B91C1C" : value < 0 ? "#047857" : "#334155";
  return (
    <div className="rounded-xl bg-slate-50 px-2 py-1.5 text-center">
      <p className="text-[9.5px] font-bold text-slate-500">{label}</p>
      <p className="text-[14px] font-black tabular-nums" style={{ color: ink }}>{spct(value)}</p>
      {sub && <p className="text-[9px] text-slate-500 tabular-nums">{sub}</p>}
    </div>
  );
}

export function GasStorageCard() {
  const { data, isLoading } = useNgStorage();
  const v = useMemo(() => (data?.weeks?.length ? buildStorage(data.weeks) : null), [data]);
  if (isLoading) return null;
  if (!v) {
    return (
      <div className="card p-4">
        <p className="text-[12px] font-black text-slate-700">US gas storage</p>
        <p className="text-[10.5px] text-slate-500">EIA storage data is not available right now{data?.error ? ` (${data.error})` : ""}. Nothing is shown rather than guessing.</p>
      </div>
    );
  }
  const L = v.latest;
  const level = readLevel(L.vs5Pct);
  const change = readChange(L.change, L.avg5Change);
  const injecting = (L.change ?? 0) >= 0;

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className="w-8 h-8 rounded-xl flex items-center justify-center text-white" style={{ background: "linear-gradient(140deg,#0F766E,#6366F1)" }}>
          <Database size={16} />
        </span>
        <div>
          <p className="text-[13px] font-black text-slate-800">US gas storage vs past years</p>
          <p className="text-[10px] text-slate-500">EIA weekly report · week ending {fmtDate(L.period, true)}</p>
        </div>
      </div>

      <div className="flex items-end justify-between gap-2">
        <div>
          <p className="text-[26px] leading-none font-black text-slate-900 tabular-nums">{bcf(L.value)} <span className="text-[12px] text-slate-500">Bcf</span></p>
          <p className="text-[11px] font-bold mt-1" style={{ color: injecting ? "#0F766E" : "#B45309" }}>
            {sbcf(L.change)} Bcf {injecting ? "injection (gas added)" : "withdrawal (gas used)"} this week
          </p>
        </div>
        <div className="text-right text-[10px] text-slate-500">
          <p>Usual for this week</p>
          <p className="font-black text-slate-700 tabular-nums">{sbcf(L.avg5Change)} Bcf</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        <Chip label="vs last year" value={L.vsLyPct} sub={`${bcf(L.lastYear)} Bcf`} />
        <Chip label="vs 3-yr avg" value={L.vs3Pct} sub={`${bcf(L.avg3)} Bcf`} />
        <Chip label="vs 5-yr avg" value={L.vs5Pct} sub={`${sbcf(L.vs5Bcf)} Bcf`} />
      </div>

      <div className="rounded-xl px-2.5 py-2 space-y-1" style={{ background: TONE[level.tone].bg }}>
        <p className="text-[11px] font-black leading-snug" style={{ color: TONE[level.tone].fg }}>{level.text}</p>
        {change.text && <p className="text-[10.5px] font-bold leading-snug" style={{ color: TONE[change.tone].fg }}>{change.text}</p>}
      </div>

      <StorageChart v={v} />

      <div>
        <p className="text-[11px] font-black text-slate-700 mb-1">Same week in past years</p>
        <table className="w-full text-[10.5px]">
          <thead>
            <tr className="text-slate-400">
              <th className="text-left font-bold">Year</th>
              <th className="text-right font-bold">Storage</th>
              <th className="text-right font-bold">Weekly change</th>
              <th className="text-right font-bold">Now vs then</th>
            </tr>
          </thead>
          <tbody>
            <tr className="font-black text-slate-900">
              <td>{L.period.slice(0, 4)}</td>
              <td className="text-right tabular-nums">{bcf(L.value)}</td>
              <td className="text-right tabular-nums">{sbcf(L.change)}</td>
              <td className="text-right">—</td>
            </tr>
            {v.pastSameWeek.map((p) => (
              <tr key={p.year} className="text-slate-700">
                <td className="font-bold">{p.year}</td>
                <td className="text-right tabular-nums">{bcf(p.value)}</td>
                <td className="text-right tabular-nums">{sbcf(p.change)}</td>
                <td className="text-right tabular-nums font-bold">{sbcf(L.value - p.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <p className="text-[11px] font-black text-slate-700 mb-1">Last 8 weeks</p>
        <table className="w-full text-[10.5px]">
          <thead>
            <tr className="text-slate-400">
              <th className="text-left font-bold">Week</th>
              <th className="text-right font-bold">Storage</th>
              <th className="text-right font-bold">Change</th>
              <th className="text-right font-bold">Usual</th>
              <th className="text-right font-bold">vs 5-yr</th>
            </tr>
          </thead>
          <tbody>
            {v.recent.map((r) => {
              const tight = r.change !== null && r.avg5Change !== null ? r.change - r.avg5Change : null;
              return (
                <tr key={r.period} className="text-slate-700">
                  <td className="font-bold whitespace-nowrap">{fmtDate(r.period)}</td>
                  <td className="text-right tabular-nums">{bcf(r.value)}</td>
                  <td className={`text-right tabular-nums font-black ${tight === null || Math.abs(tight) < 5 ? "" : tight < 0 ? "text-emerald-700" : "text-rose-700"}`}>{sbcf(r.change)}</td>
                  <td className="text-right tabular-nums text-slate-500">{sbcf(r.avg5Change)}</td>
                  <td className="text-right tabular-nums font-bold">{spct(r.vs5Pct)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="text-[9.5px] text-slate-500 mt-0.5">Green change = tighter than usual (supportive), red = looser (weighs on price).</p>
      </div>

      <div className="rounded-xl border border-slate-200 p-2.5 space-y-1">
        <p className="text-[11px] font-black text-slate-700">Next 4 weeks in past years</p>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10.5px] tabular-nums">
          {v.next4.byYear.map((b) => (
            <span key={b.year}>
              <span className="text-slate-500">{b.year}</span> <b>{sbcf(b.change)}</b>
            </span>
          ))}
        </div>
        {v.next4.projected !== null && (
          <p className="text-[10.5px] text-slate-700 leading-snug">
            Average {sbcf(v.next4.avg5)} Bcf. If this year simply followed that average, storage would be about <b>{bcf(v.next4.projected)} Bcf</b> in 4 weeks
            {v.next4.projectedAvg5 !== null && <> (5-yr average for that week: {bcf(v.next4.projectedAvg5)})</>}. Arithmetic, not a forecast — weather decides.
          </p>
        )}
      </div>

      <div>
        <p className="text-[11px] font-black text-slate-700 mb-1">Season low and refill peak</p>
        <table className="w-full text-[10.5px]">
          <thead>
            <tr className="text-slate-400">
              <th className="text-left font-bold">Year</th>
              <th className="text-right font-bold">Winter low (Mar–May)</th>
              <th className="text-right font-bold">Refill peak (Sep–Dec)</th>
            </tr>
          </thead>
          <tbody>
            {v.seasons.map((s) => (
              <tr key={s.year} className="text-slate-700">
                <td className="font-bold">{s.year}</td>
                <td className="text-right tabular-nums">{bcf(s.low)}{s.lowPartial && s.low !== null ? "*" : ""}</td>
                <td className="text-right tabular-nums">{bcf(s.peak)}{s.peakPartial && s.peak !== null ? " so far" : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[10.5px] font-bold text-indigo-700">
        Next report: Thu {fmtDate(v.nextReport.date)}, about {v.nextReport.istTime} (10:30 AM ET). US holidays can move it.
      </p>
      <p className="text-[9.5px] text-slate-400 leading-snug">
        On report day the price reacts to the number versus what analysts expected, which is not shown here. Lower 48 working gas in Bcf (billion cubic feet). Source: {data?.source}.
      </p>
    </div>
  );
}
