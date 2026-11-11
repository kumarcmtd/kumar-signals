// The "Can I buy now?" answer on a running call, in one glance: green buy,
// amber wait, red don't chase, grey over / too late. See utils/buyNow.ts.

import type { BuyNowAdvice, BuyNowState } from "../utils/buyNow";

const LOOK: Record<BuyNowState, { bg: string; icon: string }> = {
  enter: { bg: "linear-gradient(135deg,#047857,#10B981)", icon: "✅" },
  wait_dip: { bg: "linear-gradient(135deg,#B45309,#F59E0B)", icon: "⏳" },
  weak: { bg: "linear-gradient(135deg,#B45309,#F59E0B)", icon: "⏳" },
  near_stop: { bg: "linear-gradient(135deg,#B45309,#F97316)", icon: "⚠️" },
  no_chase: { bg: "linear-gradient(135deg,#BE123C,#F43F5E)", icon: "🚫" },
  too_late: { bg: "linear-gradient(135deg,#334155,#64748B)", icon: "⛔" },
  over: { bg: "linear-gradient(135deg,#334155,#64748B)", icon: "⛔" },
  no_price: { bg: "linear-gradient(135deg,#334155,#64748B)", icon: "❔" },
};

export function BuyNowBanner({ advice, className = "" }: { advice: BuyNowAdvice; className?: string }) {
  const l = LOOK[advice.state];
  return (
    <div className={`rounded-2xl p-3 text-white shadow-sm ${className}`} style={{ background: l.bg }}>
      <p className="text-[10px] font-black uppercase tracking-wide opacity-85">Can I buy now?</p>
      <p className="text-[15px] font-black leading-snug">
        {l.icon} {advice.title}
      </p>
      <p className="text-[11.5px] font-semibold leading-snug opacity-95 mt-0.5">{advice.detail}</p>
      {advice.holding && <p className="text-[11px] font-bold leading-snug mt-1.5 rounded-lg bg-black/15 px-2 py-1">{advice.holding}</p>}
    </div>
  );
}
