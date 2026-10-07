import { useMemo, useState } from "react";
import { CloudSun } from "lucide-react";
import { useSeasonal, useWeather } from "../api/hooks";
import { buildSeasonal } from "../utils/seasonalCompare";
import { buildWeatherView, describe, type Comparison, type Metric } from "../utils/weatherCompare";

const TONE = {
  more: { bg: "#EEF2FF", fg: "#3730A3" },
  less: { bg: "#FFF7ED", fg: "#9A3412" },
  normal: { bg: "#F1F5F9", fg: "#334155" },
  unknown: { bg: "#F8FAFC", fg: "#64748B" },
};

function fmtDate(d: string): string {
  const [, m, day] = d.split("-").map(Number);
  return `${day} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]}`;
}

function signed(v: number | null): string {
  if (v === null) return "—";
  const r = Math.round(v);
  return r === 0 ? "0%" : `${r > 0 ? "+" : ""}${r}%`;
}

/** Deeper colour = more gas demand than the same week's past-year average. */
function cellStyle(value: number, avg: number | null, metric: Metric) {
  const ratio = avg && avg > 0 ? value / avg : 1;
  const a = Math.max(0, Math.min(1, (ratio - 0.6) / 0.8));
  const rgb = metric === "hdd" ? "37,99,235" : "234,88,12";
  return { background: `rgba(${rgb},${0.08 + a * 0.5})`, color: a > 0.6 ? "#fff" : "#0F172A" };
}

function Bars({ c, label, metric, thisYear }: { c: Comparison; label: string; metric: Metric; thisYear: number }) {
  const rows = [{ name: `${thisYear}`, value: c.now, now: true }, ...[...c.byYear].reverse().map((b) => ({ name: `${b.year}`, value: b.value, now: false })), { name: "3-yr avg", value: c.avg, now: false }];
  const max = Math.max(1, ...rows.map((r) => r.value ?? 0));
  const d = describe(c, metric);
  return (
    <div className="rounded-xl p-2.5 space-y-1.5" style={{ background: TONE[d.tone].bg }}>
      <p className="text-[11px] font-black text-slate-700">{label}</p>
      {rows.map((r) => (
        <div key={r.name} className="flex items-center gap-2 text-[10.5px]">
          <span className={`w-14 shrink-0 ${r.now ? "font-black text-slate-900" : "font-bold text-slate-500"}`}>{r.name}</span>
          <div className="flex-1 h-2.5 rounded-full bg-white/70 overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${((r.value ?? 0) / max) * 100}%`, background: r.now ? (metric === "hdd" ? "#2563EB" : "#EA580C") : "#94A3B8" }} />
          </div>
          <span className="w-9 text-right tabular-nums font-bold text-slate-700">{r.value === null ? "—" : Math.round(r.value)}</span>
        </div>
      ))}
      <p className="text-[10.5px] font-black leading-snug" style={{ color: TONE[d.tone].fg }}>{d.text}</p>
    </div>
  );
}

export function WeatherDemandCard() {
  const { data, isLoading } = useWeather();
  const { data: gas } = useSeasonal("NATURALGAS");
  const [regionId, setRegionId] = useState<"US" | "EU" | "ASIA">("US");
  const region = data?.regions.find((r) => r.id === regionId) ?? null;
  const view = useMemo(() => (region && data ? buildWeatherView(region, data.asOf) : null), [region, data]);
  const gasView = useMemo(() => (gas?.weeks?.length ? buildSeasonal(gas.weeks) : null), [gas]);

  if (isLoading) return null;
  if (!data || data.error || !data.regions.length) {
    return (
      <div className="card p-4">
        <p className="text-[12px] font-black text-slate-700">Weather demand</p>
        <p className="text-[10.5px] text-slate-500">Weather data is not available right now{data?.error ? ` (${data.error})` : ""}. Nothing is shown rather than guessing.</p>
      </div>
    );
  }
  const unit = view?.metric === "cdd" ? "CDD" : "HDD";

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className="w-8 h-8 rounded-xl flex items-center justify-center text-white" style={{ background: "linear-gradient(140deg,#2563EB,#F97316)" }}>
          <CloudSun size={16} />
        </span>
        <div>
          <p className="text-[13px] font-black text-slate-800">Weather demand vs last 3 years</p>
          <p className="text-[10px] text-slate-500">Gas demand follows temperature · same calendar days each year</p>
        </div>
      </div>

      <div className="flex gap-1 p-0.5 rounded-lg bg-slate-100">
        {data.regions.map((r) => (
          <button key={r.id} onClick={() => setRegionId(r.id)} className="flex-1 px-2 py-1.5 rounded-md text-[11px] font-black" style={regionId === r.id ? { background: "#fff", color: "#1D4ED8" } : { color: "#64748B" }}>
            {r.name}
          </button>
        ))}
      </div>

      {region && <p className="text-[10.5px] text-slate-600 leading-snug">{region.why}</p>}

      {!view ? (
        <p className="text-[10.5px] text-slate-500">Not enough weather history for this region yet.</p>
      ) : (
        <>
          {view.mild && (
            <p className="text-[10.5px] font-bold rounded-lg px-2.5 py-1.5 bg-amber-50 text-amber-800">
              Mild time of year here: little heating or cooling is needed, so weather is a small driver right now. Storage and LNG flows usually matter more.
            </p>
          )}
          <div className="grid gap-2">
            <Bars c={view.next14} metric={view.metric} thisYear={view.thisYear} label={`Next 14 days (forecast) — total ${unit}`} />
            <Bars c={view.last28} metric={view.metric} thisYear={view.thisYear} label={`Last 4 weeks (actual) — total ${unit}`} />
          </div>

          {/* Week by week: past years' actual weather, this year actual then forecast. */}
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-[10.5px] border-separate" style={{ borderSpacing: 2 }}>
              <thead>
                <tr className="text-slate-400">
                  <th className="text-left px-1 font-bold">Week of</th>
                  {view.years.map((y) => (
                    <th key={y} className="text-center font-bold">{y}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {view.weeks.map((w) => (
                  <tr key={w.offset}>
                    <td className={`px-1 py-1 font-black whitespace-nowrap ${w.offset === 0 ? "text-blue-700" : "text-slate-700"}`}>
                      {fmtDate(w.start)}
                      {w.offset === 0 && <span className="text-[9px] font-bold"> now</span>}
                    </td>
                    {view.years.map((y) => {
                      const c = w.cells[y];
                      if (!c) return <td key={y} className="text-center text-slate-300">·</td>;
                      return (
                        <td key={y} className={`text-center py-1 rounded-md tabular-nums ${c.forecast ? "italic" : ""}`} style={cellStyle(c.value, w.pastAvg, view.metric)}>
                          <span className="font-black">{Math.round(c.value)}</span>
                          {c.forecast && <span className="text-[8.5px]">f</span>}
                          <span className="block text-[8.5px] opacity-80">{c.tC.toFixed(0)}°C</span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[9.5px] text-slate-500 leading-snug">
            Each box: total {unit} for that week (darker = more gas demand than the same week's past average) and the average temperature. <i>f</i> = forecast.
          </p>

          {regionId === "US" && (
            <div className="rounded-xl border border-slate-200 p-2.5 space-y-1">
              <p className="text-[11px] font-black text-slate-700">What followed in past years (next 4 weeks)</p>
              <table className="w-full text-[10.5px]">
                <thead>
                  <tr className="text-slate-400">
                    <th className="text-left font-bold">Year</th>
                    <th className="text-right font-bold">{unit} vs avg</th>
                    <th className="text-right font-bold">NG price</th>
                  </tr>
                </thead>
                <tbody>
                  {[...view.next4wkPast].reverse().map((p) => {
                    const move = gasView?.rows.find((r) => r.year === p.year)?.forwardPct[4] ?? null;
                    return (
                      <tr key={p.year}>
                        <td className="font-bold text-slate-700">{p.year}</td>
                        <td className="text-right tabular-nums font-bold">{signed(p.diffPct)}</td>
                        <td className={`text-right tabular-nums font-black ${move === null ? "text-slate-400" : move >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{signed(move)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="text-[9.5px] text-slate-500 leading-snug">NYMEX price change over the same 4 weeks. Weather is one driver; storage, production and LNG exports also move the price.</p>
            </div>
          )}

          <p className="text-[9.5px] text-slate-400 leading-snug">
            Degree days in °F (base 65°F), the NOAA/EIA convention. Region = weighted average of {region?.cities.map((c) => c.name).join(", ")} (approximate weights). Forecasts beyond ~10 days are uncertain and change daily;
            prices react when forecasts change versus what traders expected. Past years show what happened, not what will. Source: {data.source}.
          </p>
        </>
      )}
    </div>
  );
}
