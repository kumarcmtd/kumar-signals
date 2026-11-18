// One market on Ai Lite: what it is doing now (the three plain rules, ticked
// or not), the running call with its levels and buttons, why a setup was
// skipped, today's money rules, and the last few calls.

import { useState } from "react";
import { CheckCircle2, ChevronDown, Circle } from "lucide-react";
import { useCreateTrade } from "../../api/hooks";
import type { TradeLogEntry } from "../../store/appStore";
import { liveLtpFor } from "../../utils/tradeLogCore";
import { LITE, LITE_LOT } from "../../utils/lite/engine";
import type { AiLiteState } from "../../hooks/useAiLite";
import { LiveCallCard } from "../aiTest/LiveCallCard";
import { TradeLogDetailModal, TradeLogLine } from "../aiTest/TradeLogKit";
import { copyTip, DISPLAY_NAME, rupees } from "../aiTest/kit";

const PILL: Record<string, [string, string]> = {
  running: ["CALL RUNNING", "linear-gradient(135deg,#F97316,#DB2777)"],
  CE: ["BUY CE", "linear-gradient(135deg,#10B981,#0D9488)"],
  PE: ["BUY PE", "linear-gradient(135deg,#F43F5E,#DB2777)"],
  skipped: ["SETUP SKIPPED", "linear-gradient(135deg,#F59E0B,#F97316)"],
  watch: ["WATCHING", "linear-gradient(135deg,#0EA5E9,#6366F1)"],
  closed: ["MARKET CLOSED", "linear-gradient(135deg,#64748B,#94A3B8)"],
  none: ["NO DATA", "linear-gradient(135deg,#94A3B8,#CBD5E1)"],
};

export function LiteMarketCard({ s, lab }: { s: AiLiteState; lab: { avgRs: number; last50: number } }) {
  const createTrade = useCreateTrade();
  const [logged, setLogged] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const [history, setHistory] = useState(false);
  const [detail, setDetail] = useState<TradeLogEntry | null>(null);
  const r = s.read;
  const sig = r.signal;
  const fired = r.state === "call" && !!sig?.side;
  const skipReason = fired && !s.running ? (s.expiry ?? (!s.open ? "MCX is closed." : !s.guard.ok ? s.guard.reason : !s.choice ? "No live option price to buy — nothing opened." : null)) : null;
  const pill = s.running ? PILL.running : fired ? (skipReason ? PILL.skipped : PILL[sig!.side!]) : r.state === "watch" ? PILL.watch : r.state === "stale" ? PILL.closed : PILL.none;
  const closedCalls = [...s.log].reverse().filter((e) => e.closed);
  const lean = sig?.lean;
  return (
    <section className="rounded-3xl bg-white shadow-md overflow-hidden">
      <div className="px-3.5 py-3 flex items-center justify-between gap-2" style={{ background: s.sym === "CRUDEOIL" ? "linear-gradient(135deg,#FEF3C7,#FFF7ED)" : "linear-gradient(135deg,#E0F2FE,#F0FDFA)" }}>
        <div className="min-w-0">
          <p className="text-[16px] font-black text-slate-800">{`${s.sym === "CRUDEOIL" ? "🛢️" : "🔥"} ${DISPLAY_NAME[s.sym]}`}</p>
          <p className="text-[11px] font-semibold text-slate-500">
            {lean ? `Leaning ${lean} — trend ${lean === "CE" ? "up" : "down"}` : r.state === "no_data" ? (s.liveDataUnavailable ? "No live data right now" : "Loading candles…") : "No clear trend right now"}
            {r.fut !== null && ` · fut ₹${Math.round(r.fut).toLocaleString("en-IN")}`}
          </p>
        </div>
        <span className="shrink-0 text-[10.5px] font-black px-2.5 py-1 rounded-full text-white shadow-sm" style={{ background: pill[1] }}>
          {pill[0]}
        </span>
      </div>
      <div className="p-3.5 space-y-3">
        {sig && (
          <div className="space-y-1.5">
            {(["trend", "trigger", "chase"] as const).map((k, n) => {
              const c = sig.checks.find((x) => x.key === k);
              const label = c?.label ?? (k === "trigger" ? "Trigger" : "No chase");
              return (
                <div key={k} className={`flex items-start gap-2 rounded-xl px-2.5 py-1.5 ${c?.ok ? "bg-emerald-50" : "bg-slate-50"}`}>
                  {c?.ok ? <CheckCircle2 size={16} className="text-emerald-500 shrink-0 mt-px" /> : <Circle size={16} className="text-slate-300 shrink-0 mt-px" />}
                  <p className="text-[12px] leading-snug text-slate-700">
                    <b className={c?.ok ? "text-emerald-700" : "text-slate-500"}>{`${n + 1}. ${label}: `}</b>
                    {c?.detail ?? "Waits for a clear trend first."}
                  </p>
                </div>
              );
            })}
          </div>
        )}
        {r.state === "stale" && <p className="text-[11.5px] text-slate-500">Read from the last finished candle — new calls only while MCX is open.</p>}
        {s.liveDataUnavailable && <p className="text-[11.5px] font-semibold rounded-xl bg-amber-50 border border-amber-200 text-amber-900 px-2.5 py-2">{`${s.errorMessage ?? "Live data unavailable"} — no call is made from stale or missing prices.`}</p>}
        {skipReason && <p className="text-[11.5px] font-semibold rounded-xl bg-amber-50 border border-amber-200 text-amber-900 px-2.5 py-2">{`The rules fired, but: ${skipReason}`}</p>}
        {s.running && (
          <LiveCallCard
            sym={s.sym}
            tf="15"
            e={s.running}
            live={liveLtpFor(s.options, s.running.strike, s.running.optSide)}
            logged={logged.includes(s.running.id)}
            copied={copied}
            onCopy={() => {
              copyTip(s.sym, s.running!, s.options?.expiry);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
            onLog={() =>
              createTrade.mutate(
                { symbol: s.sym, optSide: s.running!.optSide, strike: s.running!.strike, entryPrice: s.running!.entry, stopLoss: s.running!.stop, target: s.running!.targets[2], quantity: 1, lotSize: LITE_LOT[s.sym], source: "master-ai", notes: "Logged from Ai Lite" },
                { onSuccess: () => setLogged((ids) => [...ids, s.running!.id]) }
              )
            }
          />
        )}
        <div className="grid grid-cols-3 gap-1.5 text-center">
          <div className="rounded-xl bg-slate-50 py-1.5">
            <p className="text-[9px] font-black uppercase text-slate-400">Today</p>
            <p className="text-[13px] font-black text-slate-700">{`${s.guard.callsToday} call${s.guard.callsToday === 1 ? "" : "s"}`}</p>
          </div>
          <div className="rounded-xl bg-slate-50 py-1.5">
            <p className="text-[9px] font-black uppercase text-slate-400">Booked / lot</p>
            <p className="text-[13px] font-black" style={{ color: s.guard.bookedRs > 0 ? "#059669" : s.guard.bookedRs < 0 ? "#E11D48" : "#334155" }}>
              {s.guard.bookedRs === 0 ? "₹0" : rupees(s.guard.bookedRs)}
            </p>
          </div>
          <div className="rounded-xl bg-slate-50 py-1.5">
            <p className="text-[9px] font-black uppercase text-slate-400">Stops left</p>
            <p className="text-[13px] font-black text-slate-700">{Math.max(0, LITE.maxStopsPerDay - s.guard.stopsToday)}</p>
          </div>
        </div>
        <p className="text-[10.5px] text-slate-400 leading-snug">
          {`Day goal ₹${LITE.dayGoalRs.toLocaleString("en-IN")} a lot: reach it and the day is done; 2 stop-losses also end the day. 10-year test here: `}
          <b style={{ color: lab.avgRs >= 0 ? "#059669" : "#E11D48" }}>{`${rupees(lab.avgRs)} a call`}</b>
          {` · last 50 days ${rupees(lab.last50)} a call.`}
        </p>
        {closedCalls.length > 0 && (
          <div className="rounded-2xl bg-slate-50 px-2.5 py-1.5">
            <button onClick={() => setHistory((o) => !o)} className="w-full flex items-center justify-between text-[12px] font-black text-slate-700 py-1">
              {`Last calls (${closedCalls.length})`}
              <ChevronDown size={15} className={`text-emerald-600 transition-transform ${history ? "rotate-180" : ""}`} />
            </button>
            {history && (
              <div className="space-y-1.5 mt-1 pb-1">
                {closedCalls.slice(0, 8).map((e) => (
                  <TradeLogLine key={e.id} entry={e} liveLtp={null} onOpen={() => setDetail(e)} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      {detail && <TradeLogDetailModal symbol={s.sym} entry={detail} onClose={() => setDetail(null)} />}
    </section>
  );
}
