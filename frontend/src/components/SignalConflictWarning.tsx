import { AlertTriangle, TrendingUp, TrendingDown } from "lucide-react";
import { useAppStore } from "../store/appStore";
import { detectSignalConflicts, type TradableSymbol } from "../utils/signalConflict";
import { useMemo } from "react";

const DISPLAY_NAME: Record<TradableSymbol, string> = { CRUDEOIL: "Crude Oil", NATURALGAS: "Natural Gas" };

// A single, loud "the app is arguing with itself on this symbol" banner.
// Fires only when at least one page is holding a live CE (up) call and
// another is holding a live PE (down) call on the SAME symbol at the same
// time -- the exact situation in which buying either leg is a coin flip.
export function SignalConflictWarning() {
  const tradeLogs = useAppStore((s) => s.tradeLogs);
  const conflicts = useMemo(() => detectSignalConflicts(tradeLogs), [tradeLogs]);

  if (conflicts.length === 0) return null;

  return (
    <div className="space-y-3">
      {conflicts.map((c) => {
        const ce = c.ceSources.map((s) => s.page).join(", ");
        const pe = c.peSources.map((s) => s.page).join(", ");
        return (
          <div
            key={c.symbol}
            className="rounded-3xl overflow-hidden shadow-md border-2"
            style={{ borderColor: "#F59E0B", background: "linear-gradient(135deg,#FFFBEB,#FFF7ED)" }}
          >
            <div className="px-4 pt-3.5 pb-2 flex items-center gap-2 text-white" style={{ background: "linear-gradient(135deg,#D97706,#DC2626)" }}>
              <AlertTriangle size={18} className="shrink-0" />
              <p className="text-sm font-black uppercase tracking-wide">Don't Trade {DISPLAY_NAME[c.symbol]} — CE &amp; PE Both Live</p>
            </div>

            <div className="p-4 space-y-3">
              <p className="text-[13px] font-bold text-amber-800 leading-snug">
                Two pages disagree on {DISPLAY_NAME[c.symbol]} right now — one is calling it UP, another DOWN. Buying either the Call or the Put here is a coin flip. Wait for a clear view.
              </p>

              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-2xl bg-white border border-emerald-200 p-3">
                  <p className="text-[10px] font-bold uppercase text-emerald-600 flex items-center gap-1">
                    <TrendingUp size={12} /> CE · Betting Up
                  </p>
                  <p className="text-[11px] font-semibold text-slate-600 mt-1 leading-snug">{ce}</p>
                </div>
                <div className="rounded-2xl bg-white border border-rose-200 p-3">
                  <p className="text-[10px] font-bold uppercase text-rose-500 flex items-center gap-1">
                    <TrendingDown size={12} /> PE · Betting Down
                  </p>
                  <p className="text-[11px] font-semibold text-slate-600 mt-1 leading-snug">{pe}</p>
                </div>
              </div>

              <p className="text-[10px] text-amber-700/80 leading-snug">
                This is a safety check across every page's own live calls — it only shows when the app is genuinely contradicting itself. When one side closes out, it clears on its own.
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
