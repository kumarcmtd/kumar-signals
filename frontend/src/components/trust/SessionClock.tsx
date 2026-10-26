// The session clock on Ai-Trust: the day's known move-times in IST, each
// with what the last 90 days actually did -- and, for the next one, what it
// did on days like today (rallied / fell / flat into it).

import { useMemo, useState } from "react";
import { Clock } from "lucide-react";
import { useCandles, useHistory30m } from "../../api/hooks";
import { WINDOWS, measureWindow, todaysGroup, groupLine, hhmm, cmeBreakIst, type Sym } from "../../utils/sessionClock";
import type { Candle } from "../../types";

const NAME: Record<Sym, string> = { CRUDEOIL: "Crude Oil", NATURALGAS: "Natural Gas" };
const istNow = () => {
  const t = new Date(Date.now() + 5.5 * 3600_000).toISOString();
  return { date: t.slice(0, 10), min: Number(t.slice(11, 13)) * 60 + Number(t.slice(14, 16)) };
};
const TONE = { reliable: "#047857", leaning: "#B45309", coin_flip: "#64748B", insufficient: "#94A3B8" } as const;

function Market({ sym }: { sym: Sym }) {
  const hist = useHistory30m(sym, true);
  const today = useCandles(sym, "30");
  const history = hist.data && "candles" in hist.data ? (hist.data.candles as Candle[]) : null;
  const stats = useMemo(() => (history ? WINDOWS.filter((w) => w.markets.includes(sym)).map((w) => measureWindow(history, w)) : []), [history, sym]);
  const now = istNow();
  const istDate = (iso: string) => new Date(Date.parse(iso) + 5.5 * 3600_000).toISOString().slice(0, 10);
  const todayBars = today.data && "candles" in today.data ? today.data.candles.filter((c) => istDate(c.date) === now.date) : [];
  const preToday = todayBars.length ? ((todayBars[todayBars.length - 1].close - todayBars[0].open) / todayBars[0].open) * 100 : null;

  if (hist.isLoading) return <p className="text-[12px] text-slate-500 p-2">Measuring 90 days…</p>;
  if (!stats.length) return <p className="text-[12px] text-slate-500 p-2">No history to measure yet.</p>;

  const rows = stats
    .map((s) => ({ s, start: s.def.startFor(now.date) }))
    .filter((x): x is { s: (typeof stats)[number]; start: number } => x.start !== null)
    .sort((a, b) => a.start - b.start);
  const next = rows.find((x) => x.start + x.s.def.minutes > now.min);
  const brk = cmeBreakIst(now.date);

  return (
    <div className="space-y-2">
      {preToday !== null && (
        <p className="text-[11.5px] font-bold text-slate-700 px-1">
          Today since 9:00: <span className={preToday >= 0 ? "text-emerald-700" : "text-rose-700"}>{preToday >= 0 ? "+" : ""}{preToday.toFixed(2)}%</span>
        </p>
      )}
      {rows.map(({ s, start }) => {
        const isNext = next?.s.def.id === s.def.id;
        const live = now.min >= start && now.min < start + s.def.minutes;
        const mine = todaysGroup(s, preToday);
        return (
          <div key={s.def.id} className={`rounded-2xl px-3 py-2.5 ${isNext ? "text-white shadow-lg" : "bg-slate-50"}`} style={isNext ? { background: "linear-gradient(135deg,#1E1B4B,#6D28D9 60%,#DB2777)" } : undefined}>
            <div className="flex items-center gap-2">
              <p className={`text-[13px] font-black ${isNext ? "" : "text-slate-800"}`}>
                {hhmm(start)}–{hhmm(start + s.def.minutes)}
              </p>
              <p className={`text-[12px] font-bold truncate ${isNext ? "text-white/90" : "text-slate-600"}`}>{s.def.label}</p>
              {isNext && (
                <span className="ml-auto text-[10px] font-black rounded-md bg-white/20 px-1.5 py-0.5 shrink-0">{live ? "NOW" : `in ${start - now.min} min`}</span>
              )}
            </div>
            <p className={`text-[10.5px] mt-0.5 ${isNext ? "text-white/75" : "text-slate-500"}`}>{s.def.why} Typical swing {s.avgRangePct ?? "—"}%.</p>
            {isNext && mine.key !== "all" && (
              <p className="mt-1.5 rounded-lg bg-white/15 px-2 py-1 text-[12px] font-black">
                Days like today ({mine.key === "afterRally" ? "already rallied" : "already fell"}): {groupLine(mine.g, "the window").replace(/^the window: /, "")}
              </p>
            )}
            <div className={`mt-1 space-y-0.5 text-[10.5px] leading-snug ${isNext ? "text-white/90" : ""}`}>
              {[
                { g: s.all, who: "All days" },
                { g: s.afterRally, who: `After a rally into it (≥ +${s.rallyCut ?? "—"}%)` },
                { g: s.afterFall, who: `After a fall into it (≤ ${s.fallCut ?? "—"}%)` },
              ]
                .filter(({ g, who }) => who === "All days" || g.days > 0)
                .map(({ g, who }) => (
                <p key={who} style={isNext ? undefined : { color: TONE[g.confidence] }}>
                  {groupLine(g, who)}
                </p>
              ))}
            </div>
          </div>
        );
      })}
      <p className="text-[10.5px] text-slate-500 px-1">
        Night: the US exchange breaks {brk.from}–{brk.to} AM IST and reopens with a spike (MCX is shut — it shows as the 9:00 gap).
      </p>
    </div>
  );
}

/** With `symbol`, it shows that one market only (Ai-Today); without, a Crude / NG switch. */
export function SessionClock({ symbol }: { symbol?: Sym } = {}) {
  const [picked, setSym] = useState<Sym>("CRUDEOIL");
  const sym = symbol ?? picked;
  return (
    <section className="rounded-3xl bg-white p-4 shadow-lg border border-violet-100 space-y-3">
      <p className="text-[13.5px] font-black text-slate-900 flex items-center gap-1.5">
        <Clock size={16} className="text-violet-600" /> Session clock — when price usually moves (IST)
      </p>
      {!symbol && (
      <div className="grid grid-cols-2 gap-1 rounded-2xl bg-slate-100 p-1">
        {(["CRUDEOIL", "NATURALGAS"] as const).map((s) => (
          <button key={s} onClick={() => setSym(s)} className={`rounded-xl py-1.5 text-[12px] font-black ${sym === s ? "bg-white text-slate-900 shadow" : "text-slate-500"}`}>
            {NAME[s]}
          </button>
        ))}
      </div>
      )}
      <Market key={sym} sym={sym} />
      <p className="text-[9.5px] text-slate-400 leading-snug">
        Measured on the last 90 days of 30-min candles. "After a rally" = the top third of days by the move from 9:00 to the window; "after a fall" = the bottom third. Reliable / leaning only when the count beats chance clearly; otherwise coin flip. Times shift automatically when US / UK clocks change.
      </p>
    </section>
  );
}
