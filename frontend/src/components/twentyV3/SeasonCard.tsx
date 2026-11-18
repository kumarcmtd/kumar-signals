// The season switch on the page: is the main line live today or resting, the
// last 10 trading days of its replayed calls as little bars, and what the
// switch did over ten years -- in plain words.

import type { TwentyV3State } from "../../hooks/useTwentyV3";
import { SEASON } from "../../utils/twentyV3/season";
import { SMART_LAB } from "../../utils/twentyV3/labFacts";

const signed = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${n >= 0 ? "+" : "−"}₹${Math.abs(Math.round(n)).toLocaleString("en-IN")}`);

export function SeasonCard({ s }: { s: TwentyV3State }) {
  const ss = s.season;
  const state = s.resting === null ? (s.recordState === "error" ? "unknown" : "checking") : s.resting ? "resting" : "live";
  const look = {
    live: { chip: "IN SEASON · CALLS LIVE", grad: "linear-gradient(135deg,#10B981,#0EA5E9)", line: "Its last 10 trading days did not lose — calls are live (real money, your plan's size)." },
    resting: { chip: "RESTING · PRACTICE ONLY", grad: "linear-gradient(135deg,#F59E0B,#EF4444)", line: "Its last 10 trading days lost — calls come as practice (paper) until the record turns." },
    checking: { chip: "CHECKING THE SEASON…", grad: "linear-gradient(135deg,#94A3B8,#64748B)", line: "Replaying the last 10 trading days on the app's own MCX candles…" },
    unknown: { chip: "SEASON UNKNOWN", grad: "linear-gradient(135deg,#94A3B8,#64748B)", line: "Recent candles could not load, so no call opens on this phone — the server still checks and alerts." },
  }[state];
  const max = Math.max(1, ...(ss?.days ?? []).map((d) => Math.abs(d.netRs)));
  return (
    <section className="rounded-3xl bg-white shadow-md overflow-hidden">
      <div className="px-4 py-3 text-white" style={{ background: look.grad }}>
        <p className="text-[10px] font-black uppercase tracking-wide text-white/85">Season switch</p>
        <p className="text-[18px] font-black leading-tight">{look.chip}</p>
        <p className="text-[11.5px] text-white/95 leading-snug mt-0.5">{look.line}</p>
      </div>
      <div className="p-4 space-y-3">
        {ss && (
          <div>
            <div className="flex items-end gap-1 h-14">
              {ss.days.map((d) => (
                <div key={d.date} className="flex-1 flex flex-col justify-end items-center h-full" title={`${d.date}: ${d.calls} calls, ${signed(d.netRs)}`}>
                  <div className="w-full rounded-t-md" style={{ height: `${Math.max(4, (Math.abs(d.netRs) / max) * 100)}%`, background: d.calls === 0 ? "#E2E8F0" : d.netRs >= 0 ? "linear-gradient(180deg,#34D399,#059669)" : "linear-gradient(180deg,#FB7185,#E11D48)" }} />
                </div>
              ))}
            </div>
            <p className="text-[11px] text-slate-500 mt-1.5">
              {`Last ${SEASON.lookbackDays} trading days, replayed: ${ss.calls} calls · `}
              <b style={{ color: (ss.avgRs ?? 0) >= 0 ? "#059669" : "#E11D48" }}>{`${signed(ss.avgRs)} a call`}</b>
              {` · ${signed(ss.netRs)} a lot in all.`}
            </p>
          </div>
        )}
        <div className="rounded-2xl bg-gradient-to-br from-sky-50 to-violet-50 p-3 space-y-1.5 text-[11.5px] text-slate-700 leading-snug">
          <p>
            <b>Why a switch?</b> These calls earn in some stretches and lose in others (2026 {signed(SMART_LAB.lineByYear[9][1])} a call, 2025 {signed(SMART_LAB.lineByYear[8][1])}). A fund manager runs such a strategy only while it works — so it rests after {SEASON.minCalls}+ losing calls in {SEASON.lookbackDays} days and comes back by itself when they turn.
          </p>
          <p>
            <b>10-year test</b> (with your “careful at the high” rule): {SMART_LAB.tenYears.calls} live calls, <b className="text-emerald-700">{signed(SMART_LAB.tenYears.avgRs)} a call</b> after costs — 2022–26 {signed(SMART_LAB.line.recent.avgRs)}, 2017–21 {signed(SMART_LAB.line.holdout.avgRs)}. Without the switch and the rule, the same calls averaged <b className="text-rose-600">{signed(SMART_LAB.v2Always.avgRs)}</b>.
          </p>
        </div>
      </div>
    </section>
  );
}
