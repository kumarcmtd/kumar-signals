// The setups board: every strategy v3 tested, what years of prices said about
// it, and -- for the live ones -- how it did on the last ~20 days of real MCX
// candles. Only setups that earned it make calls.

import { useState } from "react";
import { FlaskConical, ChevronDown } from "lucide-react";
import type { TwentyV3State } from "../../hooks/useTwentyV3";
import { V3_LAB, type MarketFacts } from "../../utils/twentyV3/labFacts";
import { SETUP_NAMES, type V3SetupId } from "../../utils/twentyV3/setups";
import { V3_LIVE } from "../../utils/twentyV3/live";

const signed = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${n >= 0 ? "+" : "−"}₹${Math.abs(Math.round(n)).toLocaleString("en-IN")}`);
const ORDER: V3SetupId[] = ["trend", "noise", "noise30", "orb", "orbTrend", "drive", "drive60", "vwapPull", "eia", "eiaFade", "driveTrend", "driveBusy", "driveSteps"];

const ABOUT: Record<V3SetupId, string> = {
  trend: "v2's rule: the 5-minute strength turns strong on a finished candle, with the 1-hour trend, 10:30 AM–1:15 PM New York.",
  noise: "Price closes outside its normal range from the 9:00 AM New York open (half-hour checks); exits when it falls back inside or across VWAP. From Zarattini, Aziz & Barbon (2024).",
  noise30: "Same as Noise breakout, but the exit is also checked only on the half hour, as in the paper.",
  orb: "The day's first close outside the 9:00–9:30 AM New York range.",
  orbTrend: "Opening range breakout only when the 1-hour trend agrees.",
  drive: "At 9:30 AM New York: if the first half hour moved more than usual, follow it to the close (crude-oil research: the first half hour predicts the rest).",
  drive60: "The same at 10:00 AM New York.",
  vwapPull: "In a 1-hour trend, buy the dip back to the day's VWAP.",
  eia: "Wednesday: follow a big move in the 15 minutes after the 10:30 EIA report.",
  eiaFade: "Wednesday: bet against a very big EIA move (research says the first jump partly reverses).",
  driveTrend: "Opening drive (9:30), only when the 1-hour trend points the same way.",
  driveBusy: "Opening drive (9:30), only on busy days (swings 1.2× normal) — research finds the first half hour predicts more on volatile days.",
  driveSteps: "Opening drive (9:30) managed like every other call: stop to entry at T1, out at T3.",
};

function MarketBoard({ title, facts, live, s }: { title: string; facts: MarketFacts; live: V3SetupId[]; s: TwentyV3State }) {
  return (
    <div className="space-y-2">
      <p className="text-[11px] font-black uppercase text-slate-500">{title}</p>
      {facts.together && (
        <p className="text-[11.5px] leading-snug rounded-xl bg-emerald-50 border border-emerald-200 px-2.5 py-2 text-emerald-900">
          <b>Live setups together</b> on {V3_LAB.days} days: {facts.together.trades} test calls, {facts.together.winPct}% winners, average {signed(facts.together.avgRs)} a call; {facts.together.winningMonths} months positive; worst month {signed(facts.together.worstMonth)}.
        </p>
      )}
      {ORDER.map((id) => {
        const f = facts.setups[id];
        const isLive = live.includes(id);
        const rec = isLive ? s.record?.bySetup[id] : undefined;
        return (
          <div key={id} className={`rounded-xl border px-2.5 py-2 ${isLive ? "border-emerald-300 bg-white" : "border-slate-100 bg-slate-50"}`}>
            <div className="flex items-center justify-between gap-2">
              <p className={`text-[12px] font-black ${isLive ? "text-slate-800" : "text-slate-500"}`}>{SETUP_NAMES[id]}</p>
              <span className={`text-[9.5px] font-black px-2 py-0.5 rounded-full ${isLive ? "bg-emerald-600 text-white" : "bg-slate-200 text-slate-600"}`}>{isLive ? "LIVE" : f ? "NOT USED" : "—"}</span>
            </div>
            <p className="text-[10.5px] text-slate-500 leading-snug">{ABOUT[id]}</p>
            {f && (
              <p className="text-[10.5px] mt-1 text-slate-600">
                Years test: {f.trades} calls ({f.perMonth}/month), {f.winPct}% winners, avg <b style={{ color: f.avgRs >= 0 ? "#059669" : "#E11D48" }}>{signed(f.avgRs)}</b>, halves {signed(f.halves[0])} / {signed(f.halves[1])}
              </p>
            )}
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
          <p className="text-[14px] font-black text-slate-800">Setups board — 10 strategies tested</p>
          <p className="text-[11px] text-slate-500 leading-snug">
            {V3_LAB.days ? `Each replayed on ${V3_LAB.days} days of 5-minute prices (${V3_LAB.from} – ${V3_LAB.to}), costs taken off. ` : ""}
            Live: {V3_LIVE.CRUDEOIL.map((id) => SETUP_NAMES[id]).join(", ") || "none"} on crude{V3_LIVE.NATURALGAS.length ? `; ${V3_LIVE.NATURALGAS.map((id) => SETUP_NAMES[id]).join(", ")} on gas` : "; none on gas"}.
          </p>
        </div>
        <ChevronDown size={16} className={`text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="p-4 pt-1 space-y-4">
          <p className="text-[11px] text-slate-600 leading-snug">
            The rule for going live was written down <b>before</b> the test: 80+ calls, average at least ₹100 a call after costs, profit in <b>both</b> halves of the years, and profit factor 1.15+. Most popular strategies fail it — that is the point.
          </p>
          <MarketBoard title="Crude oil" facts={V3_LAB.crude} live={V3_LIVE.CRUDEOIL} s={crude} />
          <MarketBoard title="Natural gas" facts={V3_LAB.gas} live={V3_LIVE.NATURALGAS} s={gas} />
        </div>
      )}
    </section>
  );
}
