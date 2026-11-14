// Today's plan, before any call: when calls can come, what is on the
// calendar, what kind of market it is, and how much of the day's risk is used.

import { CalendarClock, Gauge, ShieldCheck, AlertTriangle, Info } from "lucide-react";
import type { TwentyV3State } from "../../hooks/useTwentyV3";
import { callWindow, dayEvents } from "../../utils/twentyV3/dayPlan";
import { isPracticeSetup, V3_ACTIVE } from "../../utils/twentyV3/live";
import { perTradeRs } from "../../utils/twentyV3/riskPlan";

const inr = (n: number) => `₹${Math.abs(Math.round(n)).toLocaleString("en-IN")}`;
const countdown = (ms: number) => {
  const m = Math.max(0, Math.round(ms / 60_000));
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
};

export function TodayPlanCard({ s }: { s: TwentyV3State }) {
  const now = Date.now();
  const w = callWindow(V3_ACTIVE[s.sym], now);
  const noun = V3_ACTIVE[s.sym].every(isPracticeSetup) ? "Practice call" : "Calls";
  const events = dayEvents(s.options, now);
  const day = new Date(now + 5.5 * 3600_000).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" });
  const istDate = (ms: number) => new Date(ms + 5.5 * 3600_000).toISOString().slice(0, 10);
  const nextDay = w && istDate(w.from) !== istDate(now) ? new Date(w.from + 5.5 * 3600_000).toLocaleDateString("en-IN", { weekday: "long", timeZone: "UTC" }) : null;
  const b = s.budget;
  // Closed market: the regime read is from the last session's final candle.
  const lastClose = s.read.barEnd && now - s.read.barEnd > 15 * 60_000 ? new Date(s.read.barEnd + 5.5 * 3600_000).toLocaleString("en-IN", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "UTC" }) : null;
  const usedPct = b.bookedRs < 0 ? Math.min(100, Math.round((-b.bookedRs / b.limitRs) * 100)) : 0;
  return (
    <section className="rounded-3xl shadow-md overflow-hidden bg-white">
      <div className="px-4 py-3 text-white" style={{ background: w?.open ? "linear-gradient(135deg,#059669,#0D9488)" : "linear-gradient(135deg,#1E293B,#334155)" }}>
        <p className="text-[10px] font-black uppercase tracking-wide opacity-80">Today's plan · {day}</p>
        <p className="text-[15px] font-black flex items-center gap-1.5">
          <CalendarClock size={16} />
          {w ? (w.open ? `${noun} window OPEN · closes in ${countdown(w.to - now)}` : nextDay ? `Next ${noun.toLowerCase()} ${nextDay} ${w.label}` : `${noun} ${w.label}`) : "No calls on this market"}
        </p>
        {w && !w.open && w.from > now && <p className="text-[11px] opacity-85">{nextDay ? "Nothing today. " : ""}In {countdown(w.from - now)} — the app alerts your phone the moment a call comes (only on days with a big opening move).</p>}
        {w?.open && <p className="text-[11px] opacity-85">{w.label} — the New York open, when crude moves most.</p>}
      </div>
      <div className="p-4 space-y-2.5">
        {events.map((e) => (
          <p key={e.label} className={`text-[11.5px] leading-snug rounded-xl px-2.5 py-2 flex gap-2 ${e.tone === "warn" ? "bg-amber-50 border border-amber-200 text-amber-900" : "bg-sky-50 border border-sky-100 text-sky-900"}`}>
            {e.tone === "warn" ? <AlertTriangle size={14} className="shrink-0 mt-0.5" /> : <Info size={14} className="shrink-0 mt-0.5" />}
            {e.label}
          </p>
        ))}
        {s.read.regime && (
          <p className="text-[11.5px] text-slate-600 leading-snug flex gap-2">
            <Gauge size={14} className="shrink-0 mt-0.5 text-violet-500" />
            <span>
              <span className="font-black text-slate-800">{lastClose ? `At the last close (${lastClose}): ` : "Market now: "}</span>
              {s.read.regime.text}.
            </span>
          </p>
        )}
        <div className="rounded-2xl bg-slate-50 border border-slate-100 p-3 space-y-1.5">
          <p className="text-[11.5px] font-black text-slate-800 flex items-center gap-1.5">
            <ShieldCheck size={14} className="text-emerald-600" /> Your risk today
          </p>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <p className="text-[9px] font-bold text-slate-400 uppercase">Per trade</p>
              <p className="text-[13px] font-black text-slate-700">{inr(perTradeRs(s.plan))}</p>
            </div>
            <div>
              <p className="text-[9px] font-bold text-slate-400 uppercase">Booked today</p>
              <p className="text-[13px] font-black" style={{ color: b.bookedRs >= 0 ? "#059669" : "#E11D48" }}>
                {b.bookedRs >= 0 ? "+" : "−"}
                {inr(b.bookedRs)}
              </p>
            </div>
            <div>
              <p className="text-[9px] font-bold text-slate-400 uppercase">Trades left</p>
              <p className="text-[13px] font-black text-slate-700">{b.tradesLeft}</p>
            </div>
          </div>
          <div className="h-2 rounded-full bg-slate-200 overflow-hidden" aria-label="Day's loss limit used">
            <div className="h-full rounded-full" style={{ width: `${usedPct}%`, background: usedPct >= 100 ? "#E11D48" : usedPct >= 60 ? "#F59E0B" : "#10B981" }} />
          </div>
          <p className="text-[10px] text-slate-500">
            Day's loss limit {inr(b.limitRs)} — {usedPct}% used.
          </p>
          {b.stopped && <p className="text-[11.5px] font-black text-rose-700">{b.stopped}</p>}
        </div>
      </div>
    </section>
  );
}
