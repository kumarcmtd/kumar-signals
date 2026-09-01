import { Clock, Hourglass, Gauge, History } from "lucide-react";
import type { TradeLogEntry } from "../store/appStore";
import { historicalHold, paceEtaMin, formatDuration } from "../utils/holdTime";

// A compact, colourful "how long to wait" read shown on a live call. Combines
// the call's own realized pace with how long this page's past winners took, so
// the trader has a real sense of the minimum patience a call deserves.
export function ExpectedHoldBadge({
  entries,
  open,
  className,
}: {
  entries: TradeLogEntry[];
  open: { entry: number; current: number | null; openedAt: number; nextTarget: number } | null;
  className?: string;
}) {
  const hist = historicalHold(entries);
  const eta = open ? paceEtaMin(open.entry, open.current, open.openedAt, open.nextTarget) : null;

  if (!hist && eta === null) {
    return (
      <div className={className}>
        <div className="rounded-2xl px-3.5 py-3 flex items-start gap-2" style={{ background: "linear-gradient(135deg,#F5F3FF,#EDE9FE)", border: "1px solid #DDD6FE" }}>
          <Hourglass size={15} className="shrink-0 mt-0.5 text-violet-500" />
          <p className="text-[11px] text-violet-900/70 leading-snug">
            Expected wait fills in as this call moves and past calls close — give a fresh call at least a few candles before judging it.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={className}>
      <div className="rounded-2xl overflow-hidden shadow-sm" style={{ border: "1px solid #C4B5FD" }}>
        <div className="px-3.5 py-2 flex items-center gap-1.5 text-white" style={{ background: "linear-gradient(135deg,#7C3AED,#4F46E5 60%,#2563EB)" }}>
          <Clock size={14} />
          <p className="text-[11px] font-black uppercase tracking-wide">Expected Wait To Target</p>
        </div>

        <div className="p-2.5 grid grid-cols-2 gap-2" style={{ background: "linear-gradient(135deg,#FAF5FF,#EFF6FF)" }}>
          <div className="rounded-xl px-3 py-2.5 bg-white/80 border border-violet-100">
            <p className="text-[9px] font-bold uppercase text-violet-500 flex items-center gap-1">
              <Gauge size={11} /> At current pace
            </p>
            {eta !== null ? (
              <>
                <p className="text-lg font-black text-violet-700 leading-tight mt-0.5">~{formatDuration(eta)}</p>
                <p className="text-[9px] text-slate-400 leading-tight">to next target</p>
              </>
            ) : (
              <p className="text-[11px] text-slate-400 mt-1 leading-snug">Too early / not moving yet</p>
            )}
          </div>

          <div className="rounded-xl px-3 py-2.5 bg-white/80 border border-indigo-100">
            <p className="text-[9px] font-bold uppercase text-indigo-500 flex items-center gap-1">
              <History size={11} /> Past winners
            </p>
            {hist ? (
              <>
                <p className="text-lg font-black text-indigo-700 leading-tight mt-0.5">~{formatDuration(hist.medianWinMin)}</p>
                <p className="text-[9px] text-slate-400 leading-tight">median · {hist.winCount} calls</p>
              </>
            ) : (
              <p className="text-[11px] text-slate-400 mt-1 leading-snug">Builds up as calls close</p>
            )}
          </div>
        </div>

        <p className="px-3 pb-2 text-[10px] font-semibold text-emerald-700" style={{ background: "linear-gradient(135deg,#FAF5FF,#EFF6FF)" }}>
          💡 Don't bail far too early — give it the time a winner usually needs.
        </p>
      </div>
    </div>
  );
}
