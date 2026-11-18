// "Strict where it protects, free where it doesn't": every rule the main line
// keeps or drops, each with the reason the 10-year test gave.

import { useState } from "react";
import { ChevronDown, ShieldCheck, Sparkles } from "lucide-react";

const STRICT: [string, string][] = [
  ["Your “careful at the high” rule", "No CE within 1 ATR under the 3-hour high (no PE just over the low) until a 5-minute candle closes through. It lifted 2022–26 from +₹55 to +₹228 a call."],
  ["The New York morning window", "Calls only 10:30 AM – 1:15 PM New York. Starting earlier lost more in both test periods, running later added nothing, and all-day lost in every year."],
  ["The season switch", "Rests after 5+ losing calls in 10 trading days, returns by itself. It sat out most of the bad years."],
  ["Money rules", "Stop on every call; one call at a time; day over after 2 stops, 3 calls or −₹3,000 a lot; no calls on expiry day; out by the bell."],
];

const FREE: [string, string][] = [
  ["No news requirement", "Past headlines can't be tested, so news never blocks a call — it is shown for your judgement."],
  ["No Speed / momentum filter", "Speed 60+ looked good in 2022–26 but lost more in 2017–21. Dropped."],
  ["No extra confirmations", "One signal (a fresh strength turn with the 1-hour trend) and one caution check. Nothing else."],
  ["No ‘run to the high’ entries", "Buying the run itself lost in all 72 versions tried, every year. Not used."],
];

export function SmartRulesCard() {
  const [open, setOpen] = useState(false);
  return (
    <section className="rounded-3xl bg-white shadow-md overflow-hidden">
      <button onClick={() => setOpen((o) => !o)} className="w-full p-4 flex items-center gap-3 text-left" aria-expanded={open}>
        <span className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0" style={{ background: "linear-gradient(135deg,#6366F1,#EC4899)" }}>
          <Sparkles size={16} className="text-white" />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-black text-slate-800">Strict where it protects · free where it doesn't</p>
          <p className="text-[11px] text-slate-500">4 rules kept, 4 dropped — each because of the 10-year test</p>
        </div>
        <ChevronDown size={16} className={`text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="px-4 pb-4 grid gap-2.5">
          <div className="rounded-2xl bg-gradient-to-br from-rose-50 to-amber-50 p-3 space-y-2">
            <p className="flex items-center gap-1.5 text-[11px] font-black uppercase text-rose-700">
              <ShieldCheck size={14} /> Strict — kept
            </p>
            {STRICT.map(([t, d]) => (
              <p key={t} className="text-[11.5px] text-slate-700 leading-snug">
                <b>{t}.</b> {d}
              </p>
            ))}
          </div>
          <div className="rounded-2xl bg-gradient-to-br from-emerald-50 to-cyan-50 p-3 space-y-2">
            <p className="flex items-center gap-1.5 text-[11px] font-black uppercase text-emerald-700">
              <Sparkles size={14} /> Free — dropped
            </p>
            {FREE.map(([t, d]) => (
              <p key={t} className="text-[11.5px] text-slate-700 leading-snug">
                <b>{t}.</b> {d}
              </p>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
