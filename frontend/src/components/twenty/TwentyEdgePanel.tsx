// "Measured on real MCX prices": the v2 rules and the old rules re-run on
// the last ~15 days of 5-minute candles, per market -- so whether Ai20-20 is
// working is a number on the screen, not a feeling.

import { useState } from "react";
import { FlaskConical, ChevronDown, AlertTriangle } from "lucide-react";
import type { V2Record } from "../../utils/twentyV2";
import { V2_LAB_FACTS, V2_MARKETS } from "../../utils/twentyV2";
import type { LabStats } from "../../utils/twentyLab";

type Rec = { record: V2Record | null; state: "loading" | "ready" | "error" };
const rs = (n: number | null) => (n === null ? "—" : `${n >= 0 ? "+" : "−"}₹${Math.abs(n).toLocaleString("en-IN")}`);
const day = (iso: string) => new Date(Date.parse(iso) + 5.5 * 3600_000).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });

function Tile({ s, title, tone }: { s: LabStats; title: string; tone: "good" | "bad" | "dim" }) {
  const bg = tone === "good" ? "linear-gradient(135deg,#059669,#10B981)" : tone === "bad" ? "linear-gradient(135deg,#BE123C,#F43F5E)" : "linear-gradient(135deg,#475569,#64748B)";
  return (
    <div className="rounded-2xl p-2.5 text-white" style={{ background: bg }}>
      <p className="text-[10px] font-black uppercase opacity-85">{title}</p>
      <p className="text-[18px] font-black leading-tight">{rs(s.avgRs)}<span className="text-[10px] font-bold opacity-80"> /call</span></p>
      <p className="text-[10.5px] font-semibold opacity-90">
        {s.trades} calls · T1 hit {s.t1Pct ?? "—"}% · {s.winPct ?? "—"}% winners
      </p>
      <p className="text-[10.5px] font-semibold opacity-90">Total {rs(s.netRs)} per lot</p>
    </div>
  );
}

function Market({ name, on, r }: { name: string; on: boolean; r: Rec }) {
  const rec = r.record;
  return (
    <div className="rounded-2xl bg-white/95 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <p className="text-[13px] font-black text-slate-800 flex-1">{name}</p>
        <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${on ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"}`}>{on ? "CALLS ON" : "CALLS OFF"}</span>
      </div>
      {r.state === "loading" && <p className="text-[11px] text-slate-500">Re-running the rules on recent candles…</p>}
      {r.state === "error" && <p className="text-[11px] text-slate-500">Recent 5-minute history did not load — try again later.</p>}
      {rec && (
        <>
          <p className="text-[10.5px] text-slate-500">
            Last {rec.days} trading days ({day(rec.from)} – {day(rec.to)}), real MCX 5-min candles
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Tile s={rec.v2} title={on ? "Ai20-20 v2 (now)" : "v2 rules (not used)"} tone={!on ? "dim" : (rec.v2.avgRs ?? 0) > 0 ? "good" : "bad"} />
            {rec.old && <Tile s={rec.old} title="Old rules" tone={(rec.old.avgRs ?? 0) > 0 ? "good" : "bad"} />}
          </div>
          {on && rec.caution && (
            <p className="flex items-start gap-1.5 text-[11px] font-bold text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-2.5 py-2">
              <AlertTriangle size={13} className="shrink-0 mt-0.5" /> These rules lost money over the last {rec.recent.days} days ({rs(rec.recent.avgRs)} per call). Calls still come — take half size or skip until this turns.
            </p>
          )}
          {!on && (
            <p className="text-[11px] text-slate-600 leading-snug">
              Gas stays off: over {V2_LAB_FACTS.days} days of NYMEX gas the same rules lost {rs(V2_LAB_FACTS.gas.v2Avg)} per call and the old rules {rs(V2_LAB_FACTS.gas.oldAvg)}. A few good weeks are not enough to trust. For gas use Ai-Today's 1-hour plan.
            </p>
          )}
        </>
      )}
    </div>
  );
}

export function TwentyEdgePanel({ crude, gas }: { crude: Rec; gas: Rec }) {
  const [open, setOpen] = useState(false);
  const f = V2_LAB_FACTS;
  return (
    <section className="rounded-3xl p-3 shadow-lg space-y-2.5" style={{ background: "linear-gradient(135deg,#0F766E,#0E7490 55%,#4338CA)" }}>
      <div className="flex items-center gap-2 px-1">
        <FlaskConical size={17} className="text-teal-100" />
        <p className="text-[14px] font-black text-white flex-1">Measured on real prices</p>
      </div>
      <p className="text-[11px] text-teal-50 px-1 leading-snug">The exact Ai20-20 rules, re-run on recent 5-minute candles the way the page trades them. Spread, charges and time decay are taken off. A test on past prices — not live fills, not a promise.</p>
      <Market name="🛢️ Crude Oil" on={V2_MARKETS.CRUDEOIL} r={crude} />
      <Market name="🔥 Natural Gas" on={V2_MARKETS.NATURALGAS} r={gas} />
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-center gap-1 text-[11.5px] font-black text-white/90 py-1">
        How these rules were chosen <ChevronDown size={14} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="rounded-2xl bg-white/95 p-3 space-y-1.5 text-[11px] text-slate-700 leading-snug">
          <p>
            • {f.ruleSetsTried} rule sets were tested on {f.days} days of NYMEX 5-minute candles (to {f.to}; MCX Crude and Gas follow them tick for tick) and on 15 days of real MCX candles.
          </p>
          <p>
            • The old Ai20-20 rules called about 18 times a day and lost on every test: Crude {rs(f.crude.oldAvg)} per call over {f.crude.oldCalls} calls.
          </p>
          <p>
            • Kept only rules that made money in both halves of the period and on both data sets — and a middle setting whose neighbours also worked, not the single luckiest one.
          </p>
          <p>
            • Crude v2 over {f.days} days: {f.crude.v2Calls} calls, T1 hit {f.crude.v2T1}%, {f.crude.v2Win}% winners, {rs(f.crude.v2Avg)} per call. Worst day {rs(f.crude.v2WorstDay)}; worst losing run {rs(f.crude.v2WorstRun)} per lot — size so that would not hurt.
          </p>
          <p>• What made the difference: waiting for the US session to settle (after 10:00 AM New York), trading only with the 1-hour trend, entering on a fresh turn instead of chasing, and stops wide enough (2× the recent 5-minute range) not to be shaken out.</p>
        </div>
      )}
    </section>
  );
}
