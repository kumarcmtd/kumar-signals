// Ai-Super Fast's honest headline: the trader's own idea (only trade when
// price is moving fast -- Speed 70+), tested on ten years of crude prices.

import { useState } from "react";
import { ShieldAlert, ChevronDown } from "lucide-react";
import { FAST_LAB } from "../../utils/twentyV3/labFacts";

const signed = (n: number) => `${n >= 0 ? "+" : "−"}₹${Math.abs(Math.round(n)).toLocaleString("en-IN")}`;

export function FastTruthCard() {
  const [open, setOpen] = useState(false);
  const live = FAST_LAB.crude.fastTurnUS!;
  return (
    <section className="rounded-3xl shadow-md overflow-hidden bg-white border-2 border-amber-300">
      <button onClick={() => setOpen((o) => !o)} className="w-full p-4 flex items-start gap-3 text-left" style={{ background: "linear-gradient(135deg,#FFFBEB,#FFFFFF)" }}>
        <ShieldAlert size={22} className="text-amber-500 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-black text-slate-800">Your idea, tested on 10 years</p>
          <p className="text-[11.5px] text-slate-600 leading-snug mt-0.5">
            Speed 70+ calls, 5 versions, every 5-minute crude candle since 2017, costs included: <b>each lost money or only broke even.</b> Your news and liquidity checks could not be tested on old years — so Ai-Super Fast gives <b>practice calls</b>, and its live record will show whether those checks make the difference.
          </p>
        </div>
        <ChevronDown size={16} className={`text-slate-400 shrink-0 mt-1 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-2.5 text-[11.5px] text-slate-700 leading-snug">
          <p>
            <b>The rule this page runs</b> is yours: Ai20-20's signal (a fresh 5-minute strength turn with the 1-hour trend, US session, the same step exits) — but only while the Speed gauge reads 70 or more. Speed was 70+ on about {FAST_LAB.speed70Share}% of 5-minute candles.
          </p>
          <p>
            <b>Its record:</b> {signed(live.recent.avgRs)} a call over {live.recent.trades} calls in 2022–26 and {signed(live.holdout!.avgRs)} over {live.holdout!.trades} calls in 2017–21. By year: {FAST_LAB.liveByYear.map(([y, v]) => `${y} ${signed(v)}`).join(" · ")}. Lately it looks great — {signed(FAST_LAB.liveLast50.avgRs)} a call over the last {FAST_LAB.liveLast50.calls} calls on real NYMEX futures — but so did the v2 rules before 2025 cost them dearly.
          </p>
          <p>
            <b>Why fast is not enough:</b> a burst of speed often comes at the end of a move, the stops get wider when price swings more, and every option trade still pays about ₹150 a lot in spread, brokerage and taxes plus time decay.
          </p>
          <p>
            <b>What is new here:</b> a call needs a liquid strike (it trades well, so the order fills near the screen price) and the news on its side. Those two checks are untested — practice calls are how we find out, without risking your money.
          </p>
        </div>
      )}
    </section>
  );
}
