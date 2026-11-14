// The setups board: every strategy v3 tested and what ten years of crude
// prices (five for gas) said about it -- including the five older years no
// rule was ever chosen on. Only a setup that holds up there may trade money.

import { useState } from "react";
import { FlaskConical, ChevronDown } from "lucide-react";
import type { TwentyV3State } from "../../hooks/useTwentyV3";
import { V3_LAB, type PeriodFact, type SetupFact } from "../../utils/twentyV3/labFacts";
import { SETUP_NAMES, type V3SetupId } from "../../utils/twentyV3/setups";
import { isPracticeSetup, V3_ACTIVE } from "../../utils/twentyV3/live";

const signed = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${n >= 0 ? "+" : "−"}₹${Math.abs(Math.round(n)).toLocaleString("en-IN")}`);
const ORDER: V3SetupId[] = ["driveStrict", "drive", "trend", "driveTrend", "driveBusy", "driveSteps", "drive60", "noise", "noise30", "orb", "orbTrend", "vwapPull", "eia", "eiaFade"];

const ABOUT: Record<V3SetupId, string> = {
  trend: "The v2 rule: the 5-minute strength turns strong on a finished candle, with the 1-hour trend, 10:30 AM–1:15 PM New York.",
  noise: "A half-hour close outside price's normal range from the 9:00 AM New York open; out when it falls back or crosses VWAP (Zarattini, Aziz & Barbon, 2024).",
  noise30: "Noise breakout with the exit also checked only on the half hour, as in the paper.",
  orb: "The day's first close outside the 9:00–9:30 AM New York range.",
  orbTrend: "Opening range breakout only with the 1-hour trend.",
  drive: "At 9:30 AM New York, follow a first half hour that moved more than usual, to the close (crude research: the first half hour predicts the rest).",
  drive60: "The same at 10:00 AM New York.",
  vwapPull: "In a 1-hour trend, buy the dip back to the day's VWAP.",
  eia: "Wednesday: follow a big move in the 15 minutes after the 10:30 EIA report.",
  eiaFade: "Wednesday: bet against a very big EIA move.",
  driveTrend: "Opening drive only when the 1-hour trend agrees.",
  driveBusy: "Opening drive only on busy days (swings 1.2× normal).",
  driveSteps: "Opening drive with the usual step exits instead of holding.",
  driveStrict: "Opening drive only when the first half hour moved at least 1.2× its usual range — hold to the close, stop only.",
};

function Period({ label, p }: { label: string; p: PeriodFact | undefined }) {
  if (!p) return null;
  return (
    <p className="text-[10.5px] text-slate-600">
      {label}: {p.trades} calls, {p.winPct}% winners, avg <b style={{ color: p.avgRs >= 0 ? "#059669" : "#E11D48" }}>{signed(p.avgRs)}</b> a call
    </p>
  );
}

function MarketBoard({ title, facts, active, s, gas }: { title: string; facts: Partial<Record<V3SetupId, SetupFact>>; active: V3SetupId[]; s: TwentyV3State; gas?: boolean }) {
  return (
    <div className="space-y-2">
      <p className="text-[11px] font-black uppercase text-slate-500">{title}</p>
      {ORDER.filter((id) => facts[id]).map((id) => {
        const f = facts[id]!;
        const on = active.includes(id);
        const chip = on ? (isPracticeSetup(id) ? "PRACTICE" : "LIVE") : "NOT USED";
        const rec = on ? s.record?.bySetup[id] : undefined;
        return (
          <div key={id} className={`rounded-xl border px-2.5 py-2 ${on ? "border-amber-300 bg-white" : "border-slate-100 bg-slate-50"}`}>
            <div className="flex items-center justify-between gap-2">
              <p className={`text-[12px] font-black ${on ? "text-slate-800" : "text-slate-500"}`}>{SETUP_NAMES[id]}</p>
              <span className={`text-[9.5px] font-black px-2 py-0.5 rounded-full ${chip === "LIVE" ? "bg-emerald-600 text-white" : chip === "PRACTICE" ? "bg-amber-500 text-white" : "bg-slate-200 text-slate-600"}`}>{chip}</span>
            </div>
            <p className="text-[10.5px] text-slate-500 leading-snug">{ABOUT[id]}</p>
            <Period label={gas ? "2022–26" : "2022–26 (rules chosen here)"} p={f.recent} />
            <Period label="2017–21 (never used to choose)" p={f.holdout} />
            {rec && (
              <p className="text-[10.5px] text-slate-600">
                Last {rec.days} days of real MCX: {rec.trades} test calls, avg <b style={{ color: (rec.avgRs ?? 0) >= 0 ? "#059669" : "#E11D48" }}>{signed(rec.avgRs)}</b>
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function SetupsBoard({ crude, gas }: { crude: TwentyV3State; gas: TwentyV3State }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="rounded-3xl bg-white shadow-md overflow-hidden">
      <button onClick={() => setOpen((o) => !o)} className="w-full p-4 flex items-center gap-3 text-left" style={{ background: "linear-gradient(135deg,#FDF4FF,#FFFFFF)" }}>
        <FlaskConical size={20} className="text-fuchsia-500 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-black text-slate-800">Setups board — 14 strategies, 10 years</p>
          <p className="text-[11px] text-slate-500 leading-snug">Every result after costs. Tap to see each one, good and bad.</p>
        </div>
        <ChevronDown size={16} className={`text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="p-4 pt-1 space-y-4">
          <p className="text-[11px] text-slate-600 leading-snug">
            The bar for real money was written down <b>before</b> testing: 80+ calls, at least ₹100 a call after costs, profit in both halves, and profit factor 1.15+ — and then it must also hold on 2017–21, years never used to pick anything. No setup cleared all of it.
          </p>
          <MarketBoard title="Crude oil" facts={V3_LAB.crude} active={V3_ACTIVE.CRUDEOIL} s={crude} />
          <MarketBoard title="Natural gas" facts={V3_LAB.gas} active={V3_ACTIVE.NATURALGAS} s={gas} gas />
        </div>
      )}
    </section>
  );
}
