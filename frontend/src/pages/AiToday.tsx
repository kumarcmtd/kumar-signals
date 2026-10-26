// Ai-Today -- focus on ONE market for the day.
//
// Some days crude moves, some days gas. This page takes one of them and puts
// everything about it in one place: the long-range picture (is it at a
// many-month low? a run-up top?), 5m / 10m / 15m / 1h / 4h calls priced as
// option calls with targets, the timeframe whose record on THIS market is
// best right now, and the market's own session clock and proven strategies.

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Target } from "lucide-react";
import { useTodayFocus, TODAY_TFS, tfRecord, type FocusSym } from "../hooks/useTodayFocus";
import { marketPicture } from "../utils/marketPicture";
import type { TfCall } from "../utils/todayPick";
import { PLAN, planVerdict, actionable } from "../utils/playbook";
import { TodayCallCard } from "../components/today/TodayCallCard";
import { SessionClock } from "../components/trust/SessionClock";
import { StrategyLab } from "../components/trust/StrategyLab";
import { useTradeVerdict } from "../hooks/useTradeVerdict";

const KEY = "aiToday.symbol";
const LOOK: Record<FocusSym, { name: string; bg: string; emoji: string }> = {
  CRUDEOIL: { name: "Crude Oil", bg: "linear-gradient(135deg,#7C2D12,#EA580C 50%,#F59E0B)", emoji: "🛢️" },
  NATURALGAS: { name: "Natural Gas", bg: "linear-gradient(135deg,#1E3A8A,#2563EB 50%,#06B6D4)", emoji: "🔥" },
};
const TONE = {
  reversal_up_watch: { bg: "#ECFDF5", fg: "#065F46" },
  reversal_down_watch: { bg: "#FFF1F2", fg: "#9F1239" },
  trend_up: { bg: "#ECFDF5", fg: "#065F46" },
  trend_down: { bg: "#FFF1F2", fg: "#9F1239" },
  range: { bg: "#F8FAFC", fg: "#334155" },
} as const;
const istDay = (ms: number) => new Date(ms + 5.5 * 3600_000).toISOString().slice(0, 10);

function readSym(): FocusSym {
  try {
    return localStorage.getItem(KEY) === "NATURALGAS" ? "NATURALGAS" : "CRUDEOIL";
  } catch {
    return "CRUDEOIL";
  }
}

export function AiToday() {
  const [sym, setSymState] = useState<FocusSym>(readSym);
  const setSym = (s: FocusSym) => {
    setSymState(s);
    try {
      localStorage.setItem(KEY, s);
    } catch {
      /* private mode */
    }
  };
  return <Focus key={sym} sym={sym} setSym={setSym} />;
}

function Focus({ sym, setSym }: { sym: FocusSym; setSym: (s: FocusSym) => void }) {
  const f = useTodayFocus(sym);
  const card = useTradeVerdict(sym);
  const qc = useQueryClient();
  const [spin, setSpin] = useState(false);
  const pic = useMemo(() => marketPicture(f.daily), [f.daily]);
  const look = LOOK[sym];
  const today = istDay(Date.now());

  const calls: (TfCall & { i: number })[] = TODAY_TFS.map(({ tf, short }, i) => {
    const log = f.logs[`TODAY-${sym}-${tf}`] ?? [];
    const last = log[log.length - 1] ?? null;
    const entry = last && (!last.closed || istDay(last.closedAt ?? last.openedAt) === today) ? last : null;
    const higher = tf === "240" ? [f.analyses[3].optSide] : tf === "60" ? [f.analyses[4].optSide] : [f.analyses[3].optSide, f.analyses[4].optSide];
    return { tf, short, entry, record: tfRecord(f.logs, sym, tf), higherSides: higher, i };
  });
  // The trader's plan for this market decides; other timeframes are background.
  const plan = PLAN[sym];
  const reads = TODAY_TFS.map(({ tf }, i) => ({ tf, optSide: f.analyses[i].optSide, decision: f.analyses[i].decision }));
  const verdict = planVerdict(sym, reads, calls.find((c) => c.tf === plan.lead)?.record);
  const planCalls = plan.tfs.map((tf) => calls.find((c) => c.tf === tf)!).reverse();
  const otherCalls = calls.filter((c) => !plan.tfs.includes(c.tf));
  const [showOthers, setShowOthers] = useState(false);
  const last = f.candles["5"].at(-1);

  const refresh = async () => {
    setSpin(true);
    await Promise.all([f.refetch(), qc.refetchQueries({ queryKey: ["history-30m"] })]).finally(() => setSpin(false));
  };

  return (
    <div className="-mx-4 -mt-4 px-4 pt-4 pb-8 min-h-screen space-y-4" style={{ background: "linear-gradient(180deg,#F5F3FF,#FFFFFF 35%)" }}>
      {/* the one-market switch */}
      <div className="grid grid-cols-2 gap-2">
        {(["CRUDEOIL", "NATURALGAS"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setSym(s)}
            className={`rounded-2xl py-3 text-[15px] font-black transition ${sym === s ? "text-white shadow-lg scale-[1.02]" : "bg-white text-slate-500 border border-slate-200"}`}
            style={sym === s ? { background: LOOK[s].bg } : undefined}
          >
            {LOOK[s].emoji} {LOOK[s].name}
          </button>
        ))}
      </div>

      <section className="relative rounded-3xl p-4 text-white overflow-hidden shadow-xl" style={{ background: look.bg }}>
        <div className="absolute -right-10 -top-12 w-44 h-44 rounded-full bg-white/15 blur-2xl" />
        <div className="relative flex items-center gap-2">
          <div className="flex-1">
            <p className="text-[11px] font-bold uppercase tracking-[.18em] text-white/80">Ai-Today · focus</p>
            <p className="text-[26px] font-black leading-tight">{look.name}</p>
            {last && <p className="text-[13px] font-bold text-white/90">Futures {last.close.toFixed(sym === "NATURALGAS" ? 2 : 0)}</p>}
          </div>
          <button onClick={refresh} className="rounded-xl bg-white/20 px-2.5 py-2 text-[11px] font-black flex items-center gap-1">
            <RefreshCw size={12} className={spin ? "animate-spin" : ""} /> Refresh
          </button>
        </div>
        {pic ? (
          <div className="relative mt-3 rounded-2xl bg-white/15 backdrop-blur px-3 py-2.5">
            <p className="text-[16px] font-black leading-snug">{pic.headline}</p>
            <div className="mt-2 h-2.5 rounded-full bg-black/25 relative">
              <div className="absolute -top-1 w-4 h-4 rounded-full bg-white shadow" style={{ left: `calc(${pic.positionPct}% - 8px)` }} />
            </div>
            <div className="flex justify-between text-[10px] font-bold text-white/80 mt-1">
              <span>Low {pic.rangeLow.toFixed(2)}</span>
              <span>{pic.positionPct}% of {Math.round(pic.days / 21)}-month range</span>
              <span>High {pic.rangeHigh.toFixed(2)}</span>
            </div>
            <ul className="mt-2 space-y-1">
              {pic.bullets.map((b) => (
                <li key={b} className="text-[11.5px] text-white/95 leading-snug">• {b}</li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="relative mt-2 text-[12px] text-white/85">Daily history is loading…</p>
        )}
        <p className="relative mt-2 text-[11px] font-bold text-white/85">
          Trade Card: {card.verdict.headline}
          {card.news?.available ? ` · News ${card.news.net > 0 ? "+" : ""}${card.news.net} ${card.news.direction}` : ""}
        </p>
      </section>

      {pic && pic.tone !== "range" && (
        <p className="rounded-2xl px-3 py-2 text-[12px] font-black" style={{ background: TONE[pic.tone].bg, color: TONE[pic.tone].fg }}>
          Today's side: {pic.favour === "CE" ? "favour CE (buy calls)" : "favour PE (buy puts)"} — calls the other way are quick trades only.
        </p>
      )}

      {/* YOUR PLAN -- the one answer for this market */}
      <section
        className="rounded-3xl p-4 shadow-xl text-white"
        style={{ background: verdict.trade ? (verdict.side === "CE" ? "linear-gradient(135deg,#065F46,#10B981)" : "linear-gradient(135deg,#9F1239,#F43F5E)") : "linear-gradient(135deg,#1E293B,#475569)" }}
      >
        <p className="text-[11px] font-black uppercase tracking-[.16em] text-white/80 flex items-center gap-1.5">
          <Target size={13} /> Your plan · {plan.rule}
        </p>
        <p className="text-[24px] font-black leading-tight mt-1">{verdict.headline}</p>
        <p className="text-[12px] text-white/90 leading-snug mt-1">{verdict.detail}</p>
        <div className="flex gap-1.5 mt-2.5 flex-wrap">
          {plan.tfs.map((tf) => {
            const a = actionable(reads.find((r) => r.tf === tf));
            const short = TODAY_TFS.find((t) => t.tf === tf)!.short;
            return (
              <span key={tf} className={`text-[12px] font-black rounded-lg px-2.5 py-1 ${a === "CE" ? "bg-emerald-300 text-emerald-950" : a === "PE" ? "bg-rose-300 text-rose-950" : "bg-white/20 text-white"}`}>
                {short} {a ?? "—"}
              </span>
            );
          })}
          {sym === "NATURALGAS" && (
            <span className="text-[12px] font-black rounded-lg px-2.5 py-1 bg-white/15">4h trend {f.analyses[4].optSide ?? "—"}</span>
          )}
        </div>
        <p className="text-[10.5px] text-white/70 mt-2">{plan.why}</p>
      </section>

      <section className="space-y-3">
        {planCalls.map((c) => {
          const side = c.entry?.optSide;
          const warn = side && verdict.side && side !== verdict.side ? "Not the plan's side — skip" : side && pic?.favour && side !== pic.favour ? "Against today's daily picture — book quickly" : null;
          return (
            <TodayCallCard
              key={c.tf}
              sym={sym}
              short={c.short}
              entry={c.entry}
              analysis={f.analyses[c.i]}
              record={c.record}
              options={f.options}
              candles={f.candles[c.tf]}
              best={verdict.trade && c.tf === plan.lead}
              warn={warn}
            />
          );
        })}
        <button onClick={() => setShowOthers((x) => !x)} className="w-full rounded-2xl bg-white border border-slate-200 py-2.5 text-[12px] font-black text-slate-600">
          {showOthers ? "Hide" : "Show"} other timeframes ({otherCalls.map((c) => c.short).join(", ")}) — background only
        </button>
        {showOthers &&
          otherCalls.map((c) => (
            <TodayCallCard key={c.tf} sym={sym} short={c.short} entry={c.entry} analysis={f.analyses[c.i]} record={c.record} options={f.options} candles={f.candles[c.tf]} best={false} warn="Outside your plan for this market — background only" />
          ))}
      </section>

      <SessionClock symbol={sym} />
      <StrategyLab symbol={sym} />

      <p className="text-[10px] text-slate-400 leading-snug px-1">
        Calls come from the same confluence engine the Trade Report ranks, priced on the at-the-money option (premium targets use the option's delta). Records combine this page and the same engine's earlier calls on this market. 5m and 10m calls are the noisiest — trust them only with a good record and the higher timeframes agreeing. Not a guarantee; keep the stop.
      </p>
    </div>
  );
}
