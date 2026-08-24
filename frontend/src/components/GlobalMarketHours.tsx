import { useEffect, useMemo, useState } from "react";
import { Globe } from "lucide-react";
import { globalEnergyVenues } from "../utils/globalMarketHours";

// Shows which global energy venues are open right now. The point: even when
// MCX is "CLOSED", the international benchmarks that drive it (NYMEX WTI &
// Henry Hub gas, ICE Brent) usually aren't -- that's why global prices keep
// moving overnight in India.
export function GlobalMarketHours({ mcxOpen }: { mcxOpen?: boolean }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);

  const venues = useMemo(() => globalEnergyVenues(now, mcxOpen), [now, mcxOpen]);
  const openCount = venues.filter((v) => v.open).length;
  const globalOpen = venues.some((v) => v.id !== "mcx" && v.open);
  const mcx = venues.find((v) => v.id === "mcx");

  return (
    <div className="rounded-2xl bg-white border border-slate-100 shadow-sm overflow-hidden">
      <div className="px-4 pt-3.5 pb-3 flex items-center justify-between">
        <p className="text-xs font-black uppercase tracking-wide text-slate-500 flex items-center gap-1.5">
          <Globe size={13} className="text-sky-600" /> Global Energy Markets
        </p>
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ color: openCount ? "#16A34A" : "#DC2626", background: openCount ? "#16A34A14" : "#DC262614" }}>
          {openCount} of {venues.length} open
        </span>
      </div>

      {mcx && !mcx.open && globalOpen && (
        <p className="px-4 pb-2 text-[11px] text-slate-500 leading-snug">
          MCX is closed, but the global futures that drive it are trading — that's why WTI, Brent and Henry Hub keep moving overnight.
        </p>
      )}

      <div className="px-3 pb-3 space-y-1.5">
        {venues.map((v) => (
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
            <span className="text-[10px] font-black uppercase shrink-0" style={{ color: v.open ? "#16A34A" : "#94A3B8" }}>
              {v.open ? "Open" : "Closed"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
