import { ArrowUpRight, ArrowDownRight, ArrowRight, Link2 } from "lucide-react";
import type { DecisionResult } from "../../utils/buyDecisionEngine";

const LOOK = {
  bull: { ink: "#059669", bg: "linear-gradient(160deg,#ECFDF5,#D1FAE5)", Icon: ArrowUpRight, word: "Up" },
  bear: { ink: "#E11D48", bg: "linear-gradient(160deg,#FFF1F2,#FFE4E6)", Icon: ArrowDownRight, word: "Down" },
  neutral: { ink: "#64748B", bg: "linear-gradient(160deg,#F8FAFC,#F1F5F9)", Icon: ArrowRight, word: "Sideways" },
} as const;

export function TimeframeStrip({ result }: { result: DecisionResult }) {
  const dirs = result.timeframes.map((t) => t.direction);
  const aligned = dirs.every((d) => d === dirs[0]) && dirs[0] !== "neutral";
  const total = result.bull + result.bear || 1;
  const bullPct = Math.round((result.bull / total) * 100);

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[12.5px] font-black text-slate-800">Trend on each timeframe</p>
        {aligned ? (
          <span className="text-[10px] font-black rounded-full px-2 py-0.5 flex items-center gap-1" style={{ color: LOOK[dirs[0]].ink, background: `${LOOK[dirs[0]].ink}14` }}>
            <Link2 size={11} /> All aligned
          </span>
        ) : (
          <span className="text-[10px] font-bold rounded-full px-2 py-0.5 text-slate-500 bg-slate-100">Not aligned</span>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2">
        {result.timeframes.map((t) => {
          const L = LOOK[t.direction];
          return (
            <div key={t.label} className="rounded-2xl p-2.5 text-center" style={{ background: L.bg }}>
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{t.label}</p>
              <L.Icon size={26} strokeWidth={2.8} className="mx-auto my-1" style={{ color: L.ink }} />
              <p className="text-[12.5px] font-black" style={{ color: L.ink }}>{L.word}</p>
            </div>
          );
        })}
      </div>

      <div>
        <div className="flex justify-between text-[10.5px] font-black mb-1">
          <span style={{ color: "#059669" }}>Buyers' case {result.bull}</span>
          <span style={{ color: "#E11D48" }}>{result.bear} Sellers' case</span>
        </div>
        <div className="h-3 rounded-full overflow-hidden flex bg-slate-100">
          <div style={{ width: `${bullPct}%`, background: "linear-gradient(90deg,#10B981,#34D399)" }} />
          <div style={{ width: `${100 - bullPct}%`, background: "linear-gradient(90deg,#FB7185,#E11D48)" }} />
        </div>
        <p className="text-[10px] text-slate-500 mt-1">Out of 100 each. A buy needs 66+ on one side with the bigger trend agreeing.</p>
      </div>
    </div>
  );
}
