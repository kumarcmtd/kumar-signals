import { Coins, Check } from "lucide-react";
import type { TradeLogEntry } from "../store/appStore";
import { peakProfitRs, milestoneStates } from "../utils/profitMilestones";

const INR = (n: number) => `₹${n.toLocaleString("en-IN")}`;

// A row of fixed ₹-profit milestones for 1 lot, each ticking green once the
// call's peak profit passed it -- and staying ticked even if the call later
// hit its stop. Shows the exact best-ever rupee profit too, so runs past the
// top milestone are still clear.
export function ProfitMilestones({ entry, current, lotSize, className }: { entry: TradeLogEntry; current: number | null; lotSize: number; className?: string }) {
  const peak = peakProfitRs(entry.entry, entry.highWaterMark, current, lotSize);
  const states = milestoneStates(peak);
  const anyHit = peak >= states[0].value;

  return (
    <div className={className}>
      <div className="rounded-2xl overflow-hidden shadow-sm" style={{ border: "1px solid #16A34A44" }}>
        <div className="px-3.5 py-2 flex items-center justify-between text-white" style={{ background: "linear-gradient(135deg,#15803D,#16A34A 60%,#22C55E)" }}>
          <p className="text-[11px] font-black uppercase tracking-wide flex items-center gap-1.5">
            <Coins size={14} /> Best Profit Hit · 1 Lot
          </p>
          <p className="text-sm font-black">{anyHit ? `+${INR(peak)}` : INR(0)}</p>
        </div>

        <div className="p-2.5" style={{ background: "#F0FDF4" }}>
          <div className="grid grid-cols-5 gap-1.5">
            {states.map((m) => (
              <div
                key={m.value}
                className="rounded-lg px-1 py-1.5 text-center border"
                style={
                  m.hit
                    ? { background: "#16A34A", borderColor: "#16A34A", color: "#fff" }
                    : { background: "#fff", borderColor: "#E2E8F0", color: "#94A3B8" }
                }
              >
                <div className="flex items-center justify-center h-3.5">{m.hit ? <Check size={12} strokeWidth={3} /> : <span className="text-[10px]">○</span>}</div>
                <p className="text-[10px] font-black mt-0.5 tabular-nums">{m.value >= 1000 ? `${m.value / 1000}k` : m.value}</p>
              </div>
            ))}
          </div>
          <p className="text-[9px] text-slate-500 mt-1.5 leading-snug">
            {anyHit
              ? `If you'd bought 1 lot at this call, it reached +${INR(peak)} at its best. Ticks stay even if it later hits the stop.`
              : "This is the most 1 lot would have made off this call — fills in as it moves; a ✓ never disappears if it later reverses."}
          </p>
        </div>
      </div>
    </div>
  );
}
