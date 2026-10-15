// Ai-Trust's track record: ONLY the calls that were trust grade when they
// fired, from the server's Trade Card log, with how each one ended.

import { Trophy } from "lucide-react";
import { useTradeCardLog } from "../../api/hooks";
import { cardStats, type CardCall } from "../../utils/tradeCardLog";

const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
const NAME = { CRUDEOIL: "Crude", NATURALGAS: "NG" } as const;
const END: Record<NonNullable<CardCall["result"]> | "open", { t: string; bg: string; fg: string }> = {
  target: { t: "TARGET ✓", bg: "#D1FAE5", fg: "#065F46" },
  stop: { t: "STOP ✗", bg: "#FFE4E6", fg: "#9F1239" },
  day_end: { t: "DAY END", bg: "#E0E7FF", fg: "#3730A3" },
  open: { t: "RUNNING", bg: "#FEF3C7", fg: "#92400E" },
};

export function TrustRecord() {
  const q = useTradeCardLog();
  const all = [...(q.data?.CRUDEOIL ?? []), ...(q.data?.NATURALGAS ?? [])];
  const trusted = all.filter((c) => c.trust).sort((a, b) => b.openedAt.localeCompare(a.openedAt));
  const s = cardStats(trusted);
  const tiles = [
    { big: s.winRate === null ? "—" : `${s.winRate}%`, small: "win rate", bg: "linear-gradient(135deg,#10B981,#059669)" },
    { big: `${s.wins}/${s.losses}`, small: "wins / losses", bg: "linear-gradient(135deg,#6366F1,#8B5CF6)" },
    { big: `${s.totalR >= 0 ? "+" : ""}${s.totalR}R`, small: "total profit in R", bg: s.totalR >= 0 ? "linear-gradient(135deg,#F59E0B,#F97316)" : "linear-gradient(135deg,#F43F5E,#E11D48)" },
  ];
  return (
    <section className="rounded-3xl bg-white p-4 shadow-lg border border-violet-100 space-y-3">
      <p className="text-[13px] font-black text-slate-900 flex items-center gap-1.5">
        <Trophy size={16} className="text-amber-500" /> Trust calls — track record
      </p>
      <div className="grid grid-cols-3 gap-2">
        {tiles.map((t) => (
          <div key={t.small} className="rounded-2xl py-2.5 text-center text-white shadow" style={{ background: t.bg }}>
            <p className="text-[20px] font-black leading-none">{t.big}</p>
            <p className="text-[9.5px] font-bold opacity-90 mt-1">{t.small}</p>
          </div>
        ))}
      </div>
      {trusted.length === 0 ? (
        <p className="text-[12px] text-slate-500 leading-snug">
          No trust call yet. That is normal — they are rare by design. Every one will be listed here with how it ended, wins and losses alike.
        </p>
      ) : (
        <div className="space-y-1.5">
          {trusted.slice(0, 12).map((c) => {
            const e = END[c.result ?? "open"];
            return (
              <div key={c.id} className="flex items-center gap-2 rounded-xl px-2.5 py-2" style={{ background: "#F8FAFC" }}>
                <span className={`text-[11px] font-black rounded-md px-1.5 py-0.5 text-white ${c.side === "CE" ? "bg-emerald-600" : "bg-rose-600"}`}>
                  {NAME[c.symbol]} {c.side}
                </span>
                <span className="flex-1 min-w-0 truncate text-[11px] text-slate-600">
                  {when(c.openedAt)} · in {c.entry} · SL {c.stop} · T {c.t1}
                </span>
                <span className="text-[10.5px] font-black rounded-md px-1.5 py-0.5 shrink-0" style={{ background: e.bg, color: e.fg }}>
                  {e.t}
                  {c.r !== null ? ` ${c.r >= 0 ? "+" : ""}${c.r}R` : ""}
                </span>
              </div>
            );
          })}
        </div>
      )}
      <p className="text-[10px] text-slate-400 leading-snug">
        Logged by the server the moment each call fired (also when the app is closed), followed on 5-min futures candles: target first = win, stop first = loss, both in one candle = loss. R = profit ÷ risk.
      </p>
    </section>
  );
}
