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
import { pickBest, type TfCall } from "../utils/todayPick";
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
  const pick = pickBest(calls, pic?.favour ?? null);
  const ordered = [...calls].sort((a, b) => Number(b.tf === pick?.tf) - Number(a.tf === pick?.tf));
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

      <section className="space-y-3">
        <p className="text-[14px] font-black text-slate-900 flex items-center gap-1.5 px-1">
          <Target size={16} className="text-violet-600" /> Calls by timeframe
        </p>
        {pick ? (
          <p className="text-[11.5px] text-slate-600 px-1 leading-snug">
            <b>Best now: {TODAY_TFS.find((t) => t.tf === pick.tf)!.short}</b> — {pick.reasons.join("; ")}.
          </p>
        ) : (
          <p className="text-[11.5px] text-slate-600 px-1">No timeframe has a running call right now — that is a no-trade moment.</p>
        )}
        {ordered.map((c) => {
          const side = c.entry?.optSide;
          const known = c.higherSides.filter((x) => x !== null);
          const against = !!side && known.length > 0 && known.every((x) => x !== side);
          const warn = against ? "Against the 1h / 4h trend — quick, small, or skip" : side && pic?.favour && side !== pic.favour ? "Against today's daily picture — quick trade only" : null;
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
              best={c.tf === pick?.tf}
              warn={warn}
            />
          );
        })}
      </section>

      <SessionClock symbol={sym} />
      <StrategyLab symbol={sym} />

      <p className="text-[10px] text-slate-400 leading-snug px-1">
        Calls come from the same confluence engine the Trade Report ranks, priced on the at-the-money option (premium targets use the option's delta). Records combine this page and the same engine's earlier calls on this market. 5m and 10m calls are the noisiest — trust them only with a good record and the higher timeframes agreeing. Not a guarantee; keep the stop.
      </p>
    </div>
  );
}
