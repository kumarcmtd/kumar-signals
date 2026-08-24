import { useEffect, useMemo, useState } from "react";
import { Globe } from "lucide-react";
import { globalEnergyVenues, moveDirection, aggregateBias, type MoveDir } from "../utils/globalMarketHours";
import { useGlobalMarkets } from "../api/hooks";
import type { GlobalQuote } from "../types";

const DIR_VISUAL: Record<MoveDir, { label: string; color: string; emoji: string }> = {
  bullish: { label: "Bullish", color: "#16A34A", emoji: "🟢" },
  bearish: { label: "Bearish", color: "#DC2626", emoji: "🔴" },
  neutral: { label: "Neutral", color: "#CA8A04", emoji: "🟡" },
};

function pct(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${n > 0 ? "+" : ""}${n.toFixed(2)}%`;
}

// Shows which global energy venues are open right now AND which way each is
// moving. The point: even when MCX is "CLOSED", the international benchmarks
// that drive it keep trading -- and their overnight direction is the single
// best hint of where MCX will open. Crude's read averages WTI + Brent; Natural
// Gas's read is Henry Hub.
export function GlobalMarketHours({ mcxOpen }: { mcxOpen?: boolean }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);

  const { data: quotes } = useGlobalMarkets();
  const venues = useMemo(() => globalEnergyVenues(now, mcxOpen), [now, mcxOpen]);

  const quoteBySymbol = useMemo(() => {
    const m = new Map<string, GlobalQuote>();
    for (const q of quotes ?? []) m.set(q.symbol, q);
    return m;
  }, [quotes]);

  const changeFor = (mcxSym: "CRUDEOIL" | "NATURALGAS") =>
    venues.filter((v) => v.tracksMcx === mcxSym && v.quoteSymbol).map((v) => quoteBySymbol.get(v.quoteSymbol!)?.changePercent ?? null);

  const crude = aggregateBias(changeFor("CRUDEOIL"));
  const gas = aggregateBias(changeFor("NATURALGAS"));
  const haveBias = crude.avgPct !== null || gas.avgPct !== null;

  const openCount = venues.filter((v) => v.open).length;

  return (
    <div className="rounded-2xl bg-white border border-slate-100 shadow-sm overflow-hidden">
      <div className="px-4 pt-3.5 pb-2 flex items-center justify-between">
        <p className="text-xs font-black uppercase tracking-wide text-slate-500 flex items-center gap-1.5">
          <Globe size={13} className="text-sky-600" /> Global Energy Markets
        </p>
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ color: openCount ? "#16A34A" : "#DC2626", background: openCount ? "#16A34A14" : "#DC262614" }}>
          {openCount} of {venues.length} open
        </span>
      </div>

      {/* Overnight bias -- the quick read the trader actually wants. */}
      {haveBias && (
        <div className="px-4 pb-2">
          <p className="text-[10px] font-bold uppercase text-slate-400 mb-1.5">Overnight lean (drives MCX open)</p>
          <div className="grid grid-cols-2 gap-2">
            {([["Crude Oil", crude], ["Natural Gas", gas]] as const).map(([label, b]) => {
              const vis = DIR_VISUAL[b.dir];
              return (
                <div key={label} className="rounded-xl px-3 py-2" style={{ background: `${vis.color}0F`, border: `1px solid ${vis.color}33` }}>
                  <p className="text-[10px] text-slate-500">{label}</p>
                  <p className="text-sm font-black leading-tight" style={{ color: vis.color }}>
                    {vis.emoji} {vis.label}
                  </p>
                  <p className="text-[10px] font-semibold tabular-nums" style={{ color: vis.color }}>
                    {pct(b.avgPct)}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="px-3 pb-3 space-y-1.5">
        {venues.map((v) => {
          const q = v.quoteSymbol ? quoteBySymbol.get(v.quoteSymbol) : undefined;
          const dir = q ? moveDirection(q.changePercent) : null;
          const vis = dir ? DIR_VISUAL[dir] : null;
          return (
            <div key={v.id} className="flex items-center justify-between gap-2 rounded-xl px-3 py-2" style={{ background: "var(--color-surface-soft)" }}>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: v.open ? "#16A34A" : "#CBD5E1" }} />
                  <span className="text-xs font-bold truncate">{v.product}</span>
                </div>
                <p className="text-[10px] text-slate-400 mt-0.5 truncate">
                  {v.name} · {v.region} · {v.hoursNote}
                </p>
              </div>
              <div className="text-right shrink-0">
                {vis && q ? (
                  <>
                    <p className="text-[11px] font-black tabular-nums leading-tight" style={{ color: vis.color }}>
                      {vis.emoji} {pct(q.changePercent)}
                    </p>
                    <p className="text-[9px] font-bold uppercase" style={{ color: v.open ? "#16A34A" : "#94A3B8" }}>
                      {v.open ? "Open" : "Closed"}
                    </p>
                  </>
                ) : (
                  <p className="text-[10px] font-black uppercase" style={{ color: v.open ? "#16A34A" : "#94A3B8" }}>
                    {v.open ? "Open" : "Closed"}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {!haveBias && (
        <p className="px-4 pb-3 text-[10px] text-slate-400">Live global prices unavailable right now — showing open/closed only.</p>
      )}
    </div>
  );
}
