// "My trade plan": the trader's own money rules. Every call's lot count, the
// day's loss limit and the trades-a-day cap on the page come from here.

import { useState } from "react";
import { Wallet, ChevronDown } from "lucide-react";
import { useMyPlan } from "../../store/myPlanStore";
import { dayLimitRs, perTradeRs, type MyPlan } from "../../utils/twentyV3/riskPlan";

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

function Field({ label, hint, value, step, min, max, suffix, onChange }: { label: string; hint: string; value: number; step: number; min: number; max: number; suffix?: string; onChange: (v: number) => void }) {
  return (
    <label className="block rounded-xl bg-slate-50 border border-slate-100 px-3 py-2">
      <span className="flex items-center justify-between gap-2">
        <span className="text-[11.5px] font-black text-slate-700">{label}</span>
        <span className="flex items-center gap-1">
          <input
            type="number"
            inputMode="decimal"
            className="w-24 text-right text-[13px] font-black text-slate-800 bg-white border border-slate-200 rounded-lg px-2 py-1"
            value={value}
            step={step}
            min={min}
            max={max}
            onChange={(e) => onChange(Number(e.target.value))}
          />
          {suffix && <span className="text-[11px] font-bold text-slate-500">{suffix}</span>}
        </span>
      </span>
      <span className="block text-[10px] text-slate-500 leading-snug mt-0.5">{hint}</span>
    </label>
  );
}

export function MyPlanPanel() {
  const { plan, confirmed, setPlan } = useMyPlan();
  const [open, setOpen] = useState(!confirmed);
  const [draft, setDraft] = useState<MyPlan>(plan);
  const set = (k: keyof MyPlan) => (v: number) => setDraft((d) => ({ ...d, [k]: v }));
  return (
    <section className="rounded-3xl bg-white shadow-md overflow-hidden">
      <button onClick={() => setOpen((o) => !o)} className="w-full p-4 flex items-center gap-3 text-left" style={{ background: "linear-gradient(135deg,#EEF2FF,#FFFFFF)" }}>
        <Wallet size={20} className="text-indigo-500 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-black text-slate-800">My trade plan</p>
          <p className="text-[11px] text-slate-500 leading-snug">
            {inr(plan.capitalRs)} capital · risk {inr(perTradeRs(plan))} a trade · stop the day at −{inr(dayLimitRs(plan))} · max {plan.maxTradesPerDay} trades
          </p>
        </div>
        <ChevronDown size={16} className={`text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="p-4 pt-1 space-y-2">
          {!confirmed && <p className="text-[11px] font-bold text-indigo-700 rounded-xl bg-indigo-50 px-3 py-2">Set this once. Every call then tells you exactly how many lots to buy, and the page stops you for the day at your loss limit.</p>}
          <Field label="Trading capital" hint="Money set aside for trading — not savings you need." value={draft.capitalRs} step={5000} min={10000} max={10000000} suffix="₹" onChange={set("capitalRs")} />
          <Field label="Risk per trade" hint="Loss at the stop, as % of capital. Professionals use about 1%; 0.5% while learning." value={draft.riskPct} step={0.25} min={0.25} max={3} suffix="%" onChange={set("riskPct")} />
          <Field label="Daily loss limit" hint="Lose this much in a day and you stop until tomorrow. About 3% (three full losses) is common." value={draft.dayLossPct} step={0.5} min={1} max={10} suffix="%" onChange={set("dayLossPct")} />
          <Field label="Max trades a day" hint="More trades is not more profit — the best setups are few." value={draft.maxTradesPerDay} step={1} min={1} max={5} onChange={set("maxTradesPerDay")} />
          <Field label="Max lots" hint="A hard cap, whatever the maths allows." value={draft.maxLots} step={1} min={1} max={20} onChange={set("maxLots")} />
          <button onClick={() => { setPlan(draft); setOpen(false); }} className="w-full py-2.5 rounded-xl text-[12.5px] font-black text-white" style={{ background: "linear-gradient(135deg,#4F46E5,#7C3AED)" }}>
            Save my plan
          </button>
          <p className="text-[10px] text-slate-400 leading-snug">Saved on this phone. At 1% a trade, ten losses in a row cost about 10% — painful but survivable. At 5% a trade the same run costs about 40%.</p>
        </div>
      )}
    </section>
  );
}
