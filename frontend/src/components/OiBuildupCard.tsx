import { useMemo, useState } from "react";
import { Layers, TrendingUp, TrendingDown, Minus, AlertTriangle, Clock, ChevronDown } from "lucide-react";
import { useOiBuildup } from "../api/hooks";
import { buildOiView, ROLLOVER_DAYS, type BuildupRead } from "../utils/oiBuildup";
import type { InstrumentSymbol } from "../types";

const TONE: Record<BuildupRead["tone"], { ink: string; bg: string; Icon: typeof TrendingUp }> = {
  bull: { ink: "#16A34A", bg: "#16A34A18", Icon: TrendingUp },
  "bull-weak": { ink: "#65A30D", bg: "#65A30D14", Icon: TrendingUp },
  bear: { ink: "#DC2626", bg: "#DC262618", Icon: TrendingDown },
  "bear-weak": { ink: "#EA580C", bg: "#EA580C14", Icon: TrendingDown },
  neutral: { ink: "#CA8A04", bg: "#CA8A0414", Icon: Minus },
};

function signed(n: number | null, digits = 2): string {
  if (n === null) return "—";
  return `${n > 0 ? "+" : ""}${n.toFixed(digits)}%`;
}

function ReadBadge({ read, big }: { read: BuildupRead; big?: boolean }) {
  const t = TONE[read.tone];
  return (
    <div className="rounded-xl px-3 py-2" style={{ background: t.bg }}>
      <div className="flex items-center gap-1.5 font-black" style={{ color: t.ink, fontSize: big ? 17 : 13.5 }}>
        <t.Icon size={big ? 18 : 14} strokeWidth={2.6} />
        {read.title}
      </div>
      <p className="text-[11px] text-slate-600 leading-snug mt-0.5">
        Price <b style={{ color: t.ink }}>{signed(read.priceChangePct)}</b> · OI <b style={{ color: t.ink }}>{signed(read.oiChangePct)}</b>
      </p>
      <p className="text-[11px] text-slate-600 leading-snug mt-1">{read.meaning}</p>
    </div>
  );
}

const TABLE: [string, string, string, string][] = [
  ["↑", "↑", "Long build-up", "New buyers — bullish"],
  ["↓", "↑", "Short build-up", "New sellers — bearish"],
  ["↑", "↓", "Short covering", "Sellers exiting — weak up"],
  ["↓", "↓", "Long unwinding", "Buyers exiting — weak down"],
];

export function OiBuildupCard({ symbol }: { symbol: InstrumentSymbol }) {
  const { data, isLoading, error } = useOiBuildup(symbol);
  const view = useMemo(() => (data ? buildOiView(data) : null), [data]);
  const [showTable, setShowTable] = useState(false);

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className="w-8 h-8 rounded-xl flex items-center justify-center text-white" style={{ background: "linear-gradient(140deg,#6366F1,#8B5CF6)" }}>
          <Layers size={16} />
        </span>
        <div>
          <p className="text-[13.5px] font-black text-slate-800 leading-tight">Price + OI read (futures)</p>
          <p className="text-[10px] text-slate-500">
            {view?.session === "last" ? "Market shut — last session vs the one before" : "Today vs yesterday's close"}
          </p>
        </div>
      </div>

      {isLoading && <p className="text-sm text-[var(--color-muted)]">Loading futures OI…</p>}
      {error && <p className="text-sm text-[var(--color-sell)]">{(error as Error).message}</p>}
      {data?.error && <p className="text-sm text-[var(--color-sell)]">{data.error}</p>}
      {data && !data.error && !view && <p className="text-sm text-[var(--color-muted)]">Upstox returned no futures prices yet.</p>}

      {view && (
        <>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1">Day read · {view.headlineBasis}</p>
            <ReadBadge read={view.headline} big />
          </div>

          {view.rollover && (
            <div className="flex items-start gap-1.5 rounded-xl bg-amber-50 px-3 py-2">
              <AlertTriangle size={14} className="shrink-0 mt-[2px] text-amber-600" />
              <p className="text-[11px] text-amber-900 leading-snug">
                <b>Rollover week</b> — this month expires in {view.rollover.daysToExpiry} day{view.rollover.daysToExpiry === 1 ? "" : "s"}. Its OI alone is{" "}
                <b>{signed(view.rollover.nearOiChangePct)}</b>, but much of that is traders moving to next month, not a signal. Both months
                together: <b>{signed(view.rollover.combinedOiChangePct)}</b> — that is what the day read above uses.
              </p>
            </div>
          )}

          {view.lastHour && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1 flex items-center gap-1">
                <Clock size={11} /> Last 60 minutes
              </p>
              <ReadBadge read={view.lastHour} />
            </div>
          )}

          <div className="grid gap-1.5">
            {view.perContract.map((c) => {
              const t = TONE[c.read.tone];
              return (
                <div key={c.tradingSymbol} className="flex items-center justify-between rounded-lg border border-slate-100 px-2.5 py-1.5 text-[11px]">
                  <span className="font-bold text-slate-700">
                    {c.tradingSymbol}
                    {c.daysToExpiry !== null && <span className="font-normal text-slate-400"> · {c.daysToExpiry}d to expiry</span>}
                  </span>
                  <span className="text-right">
                    <span className="text-slate-500">OI {c.oi !== null ? c.oi.toLocaleString("en-IN") : "—"} </span>
                    <b style={{ color: t.ink }}>{c.read.title}</b>
                  </span>
                </div>
              );
            })}
          </div>

          <button onClick={() => setShowTable((v) => !v)} className="flex items-center gap-1 text-[11px] font-bold text-indigo-600">
            How to read this <ChevronDown size={13} className={showTable ? "rotate-180" : ""} />
          </button>
          {showTable && (
            <div className="space-y-2">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-slate-400">
                    <th className="text-left py-1">Price</th>
                    <th className="text-left py-1">OI</th>
                    <th className="text-left py-1">Name</th>
                    <th className="text-left py-1">Meaning</th>
                  </tr>
                </thead>
                <tbody>
                  {TABLE.map(([p, o, name, meaning]) => (
                    <tr key={name} className="border-t border-slate-100">
                      <td className="py-1 font-black">{p}</td>
                      <td className="py-1 font-black">{o}</td>
                      <td className="py-1 font-bold text-slate-700">{name}</td>
                      <td className="py-1 text-slate-600">{meaning}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-[10.5px] text-slate-500 leading-snug">
                Every contract has a buyer and a seller, so OI never shows who is "right" or who the big players are — only whether
                positions are being added or closed. This describes what has happened, not what price will do next. Within{" "}
                {ROLLOVER_DAYS} days of expiry, OI in the expiring month falls anyway as positions roll over, so the two months are added
                together.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
