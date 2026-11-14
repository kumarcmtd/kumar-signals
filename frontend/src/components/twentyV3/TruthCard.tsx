// What ten years of prices taught us -- the honest reason the page works the
// way it does. A trade manager's first job is to keep the capital.

import { useState } from "react";
import { ShieldAlert, ChevronDown } from "lucide-react";
import { V3_LAB } from "../../utils/twentyV3/labFacts";

const inr = (n: number) => `₹${Math.abs(Math.round(n)).toLocaleString("en-IN")}`;
const signed = (n: number) => `${n >= 0 ? "+" : "−"}${inr(n)}`;

export function TruthCard() {
  const [open, setOpen] = useState(false);
  const v2 = V3_LAB.v2TenYears;
  const bd = V3_LAB.bigDriveTenYears;
  return (
    <section className="rounded-3xl shadow-md overflow-hidden bg-white border-2 border-amber-300">
      <button onClick={() => setOpen((o) => !o)} className="w-full p-4 flex items-start gap-3 text-left" style={{ background: "linear-gradient(135deg,#FFFBEB,#FFFFFF)" }}>
        <ShieldAlert size={22} className="text-amber-500 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-black text-slate-800">The truth from 10 years of prices</p>
          <p className="text-[11.5px] text-slate-600 leading-snug mt-0.5">
            14 strategies replayed on every 5-minute crude candle since 2017, costs included. <b>None made money reliably.</b> So v3 gives <b>practice calls</b> — real-money calls only when a setup proves itself live.
          </p>
        </div>
        <ChevronDown size={16} className={`text-slate-400 shrink-0 mt-1 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-2.5 text-[11.5px] text-slate-700 leading-snug">
          <p>
            <b>The calls you had until now (v2):</b> {signed(v2.avgRs)} a call over {v2.calls.toLocaleString("en-IN")} calls in ten years — <b style={{ color: "#E11D48" }}>{signed(v2.netRs)} per lot</b>. They looked great lately ({signed(v2.last50DaysAvgRs)} a call over the last 50 days, {signed(v2.y2026Rs)} in 2026) but lost {inr(v2.y2025Rs)} per lot in 2025 alone. A hot streak is not an edge.
          </p>
          <p>
            <b>The best idea we found — the big opening drive</b> (at 9:30 AM New York, follow a first half hour that moved much more than usual): {signed(bd.avgRs)} a call over {bd.calls} calls in ten years. But it made {signed(bd.recentAvgRs)} a call in 2022–26 and {signed(bd.holdoutAvgRs)} in 2017–21, the years we kept aside to check it. Profitable months: {bd.winningMonths}. Not proven — so it runs as practice.
          </p>
          <p>
            <b>Natural gas:</b> every strategy lost money over 2022–26. No gas calls.
          </p>
          <p>
            <b>Why it is so hard:</b> every option trade has <b>direct costs</b> — spread, brokerage and taxes, about ₹150 a lot on crude (₹200 on gas) — and then <b>time decay</b> of about ₹50 a lot for each hour you hold. For a trade held 3–4 hours that is about <b>₹300–350 a lot in total</b>. Most 5-minute patterns move less than that.
          </p>
          <p>
            <b>What the page does for you now:</b> it guards your capital (your plan, lot size and a hard daily stop), shows the exact order and every step, and keeps an honest practice record. If the practice record stays positive over 20+ calls, that is real evidence — and it will show here.
          </p>
        </div>
      )}
    </section>
  );
}
