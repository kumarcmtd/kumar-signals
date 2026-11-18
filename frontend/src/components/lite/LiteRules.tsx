// How Ai Lite trades, in plain words, and what the 10-year test said --
// folded by default so the page stays about the live calls.

import { useState } from "react";
import { BookOpen, ChevronDown } from "lucide-react";
import { LITE } from "../../utils/lite/engine";
import { LITE_LAB } from "../../utils/lite/labFacts";
import { rupees } from "../aiTest/kit";

const Rs = (n: number) => `₹${n.toLocaleString("en-IN")}`;

export function LiteRules() {
  const [open, setOpen] = useState(false);
  const c = LITE_LAB.crude;
  const g = LITE_LAB.gas;
  return (
    <section className="rounded-3xl bg-white shadow-md overflow-hidden">
      <button onClick={() => setOpen((o) => !o)} className="w-full p-3.5 flex items-center gap-3 text-left" aria-expanded={open}>
        <span className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0" style={{ background: "linear-gradient(135deg,#22C55E,#06B6D4)" }}>
          <BookOpen size={16} className="text-white" />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-black text-slate-800">3 rules + 2 money rules — that's all</p>
          <p className="text-[11px] text-slate-500">{`Target ${Rs(LITE.targetRs)}, stop ${Rs(LITE.stopRs)} a lot · tap for how it works and the 10-year test`}</p>
        </div>
        <ChevronDown size={16} className={`text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="px-3.5 pb-3.5 space-y-2.5 text-[12px] text-slate-700 leading-snug">
          <div className="rounded-2xl bg-gradient-to-br from-emerald-50 to-cyan-50 p-3 space-y-1.5">
            <p><b>1. Trend</b> — on 15-minute candles, EMA 9 above EMA 21 with price above it: only CE. The mirror: only PE.</p>
            <p><b>2. Trigger</b> — price dips to EMA 9 and turns back with the trend (buy the dip), or closes strongly beyond the last 2 hours' high / low (breakout).</p>
            <p><b>3. No chase</b> — no call when price is already more than 2 ATR away from EMA 21, or the candle has a long wick against the call (sellers pushed back). This is what stops buying at the top after everyone books profit.</p>
          </div>
          <div className="rounded-2xl bg-gradient-to-br from-violet-50 to-pink-50 p-3 space-y-1.5">
            <p><b>Money</b> — buy the liquid strike nearest delta 0.55. Target <b>{Rs(LITE.targetRs)}</b> a lot, stop <b>{Rs(LITE.stopRs)}</b>. At +{Rs(LITE.t1Rs)} the stop moves to entry (no loss); at +{Rs(LITE.t2Rs)} it locks +{Rs(LITE.t1Rs)}.</p>
            <p><b>Day</b> — one call at a time per market. {Rs(LITE.dayGoalRs)} booked = day done (protect it). 2 stop-losses = day done (protect capital). Nothing new in the last 30 minutes; open calls close at the bell.</p>
          </div>
          <div className="rounded-2xl bg-amber-50 border border-amber-200 p-3 space-y-1.5">
            <p className="font-black text-amber-900">{`The honest 10-year test (${LITE_LAB.ranAt})`}</p>
            <p>
              {`Crude 2022–26: ${c.recent.calls.toLocaleString("en-IN")} calls, ${c.recent.winPct}% winners. It reached +₹2,000 on ${c.recent.goalDays} days — the rallies are caught — but choppy days cost more: `}
              <b className="text-rose-600">{`${rupees(c.recent.avgRs)} a call`}</b>
              {` after costs (2017–21: ${rupees(c.holdout.avgRs)}). Last 50 days: `}
              <b>{`${rupees(c.last50.avgRs)} a call`}</b>
              {`; the app's own MCX candles, last 15 days: `}
              <b className="text-emerald-700">{`${rupees(c.mcx15.avgRs)} a call`}</b>.
            </p>
            <p>
              {`Gas 2022–26: `}
              <b className="text-rose-600">{`${rupees(g.recent.avgRs)} a call`}</b>
              {`; last 50 days ${rupees(g.last50.avgRs)}. Gas is harder — trade it smaller.`}
            </p>
            <p className="text-[11px] text-amber-900/80">Costs counted on every call: about ₹150 crude / ₹200 gas (spread, brokerage, taxes) plus time decay. Fewer rules give more calls, not automatically more profit — so start with 1 lot and judge Ai Lite by its own live record above.</p>
          </div>
        </div>
      )}
    </section>
  );
}
