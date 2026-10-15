// The Trade Card's real scorecard: every TRADE call it made, and how each
// ended -- target, stop, or closed at the end of the day. Logged on the
// server every 5 minutes, so it counts calls made while the app was closed.

import { ShieldCheck } from "lucide-react";
import { useTradeCardLog } from "../api/hooks";
import { cardStats, type CardCall } from "../utils/tradeCardLog";
import { LOT_SIZE } from "../utils/aiTwentyTwentyEngine";

type Sym = "CRUDEOIL" | "NATURALGAS";
const NAME: Record<Sym, string> = { CRUDEOIL: "Crude Oil", NATURALGAS: "Natural Gas" };
// An ATM option moves roughly half as much as the futures (delta ~0.5).
const ATM_DELTA = 0.5;

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
const sign = (n: number) => (n > 0 ? "+" : n < 0 ? "−" : "");

const RESULT: Record<NonNullable<CardCall["result"]> | "open", { label: string; cls: string }> = {
  target: { label: "TARGET ✓", cls: "bg-emerald-100 text-emerald-800" },
  stop: { label: "STOP ✗", cls: "bg-rose-100 text-rose-700" },
  day_end: { label: "DAY END", cls: "bg-slate-100 text-slate-700" },
  open: { label: "RUNNING", cls: "bg-amber-100 text-amber-800" },
};

function Market({ sym, log }: { sym: Sym; log: CardCall[] }) {
  const s = cardStats(log);
  const rupees = Math.round(s.totalPts * ATM_DELTA * LOT_SIZE[sym]);
  const recent = [...log].reverse().slice(0, 8);
  return (
    <div className="rounded-2xl border border-slate-100 p-3">
      <div className="flex items-center gap-2">
        <p className="text-[13px] font-black text-slate-800">{NAME[sym]}</p>
        <p className="ml-auto text-[11px] font-bold text-slate-500">
          {s.calls} calls · {s.open} running
        </p>
      </div>
      {s.closed === 0 ? (
        <p className="text-[11.5px] text-slate-500 mt-1">No finished Trade Card call yet. It only says TRADE when all 6 checks pass, so expect few calls.</p>
      ) : (
        <div className="grid grid-cols-3 gap-1.5 mt-2 text-center">
          <Stat big={s.winRate === null ? "—" : `${s.winRate}%`} small={`win rate · ${s.wins}W ${s.losses}L`} tone={s.winRate !== null && s.winRate >= 50 ? "good" : "bad"} />
          <Stat big={`${sign(s.totalR)}${Math.abs(s.totalR)}R`} small="total, in risk units" tone={s.totalR >= 0 ? "good" : "bad"} />
          <Stat big={`${sign(rupees)}₹${Math.abs(rupees).toLocaleString("en-IN")}`} small="≈ per ATM lot (est.)" tone={rupees >= 0 ? "good" : "bad"} />
        </div>
      )}
      {s.closed > 0 && (
        <p className="text-[10.5px] text-slate-500 mt-1.5">
          Average win {s.avgWinR !== null ? `+${s.avgWinR}R` : "—"} · average loss {s.avgLossR !== null ? `${s.avgLossR}R` : "—"} · futures {sign(s.totalPts)}
          {Math.abs(s.totalPts)} pts
        </p>
      )}
      {recent.length > 0 && (
        <div className="mt-2 space-y-1">
          {recent.map((c) => {
            const look = RESULT[c.result ?? "open"];
            return (
              <div key={c.id} className="flex items-center gap-2 text-[11px]">
                <span className={`font-black rounded px-1.5 py-[1px] ${c.side === "CE" ? "bg-emerald-600 text-white" : "bg-rose-600 text-white"}`}>{c.side}</span>
                <span className="text-slate-600 min-w-0 flex-1 truncate">
                  {when(c.openedAt)} · in ₹{c.entry} · SL {c.stop} · T {c.t1}
                </span>
                <span className={`font-black rounded px-1.5 py-[1px] shrink-0 ${look.cls}`}>
                  {look.label}
                  {c.r !== null && c.result === "day_end" ? ` ${sign(c.r)}${Math.abs(c.r)}R` : ""}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Stat({ big, small, tone }: { big: string; small: string; tone: "good" | "bad" }) {
  return (
    <div className={`rounded-xl py-1.5 ${tone === "good" ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-700"}`}>
      <p className="text-[16px] font-black leading-tight">{big}</p>
      <p className="text-[9px] font-bold opacity-80">{small}</p>
    </div>
  );
}

export function TradeCardResults() {
  const q = useTradeCardLog();
  const logs = q.data ?? {};
  return (
    <section className="rounded-2xl bg-white shadow-md border border-indigo-100 p-4 space-y-2">
      <p className="text-xs font-bold uppercase text-indigo-600 flex items-center gap-1.5">
        <ShieldCheck size={14} /> Trade Card — real results
      </p>
      {q.isError && <p className="text-[11px] text-rose-600">Could not load the Trade Card log.</p>}
      <Market sym="CRUDEOIL" log={logs.CRUDEOIL ?? []} />
      <Market sym="NATURALGAS" log={logs.NATURALGAS ?? []} />
      <p className="text-[9.5px] text-slate-400 leading-snug">
        Every TRADE CE / TRADE PE the card gave, logged by the server (also while the app is closed). Each is followed on 5-min futures candles: target first = win, stop first = loss (if one candle hits both, it counts as a loss), neither = closed at the day's last price.
        R = profit ÷ the risk taken. ₹ is an estimate for one at-the-money option lot (about half the futures move); your real premium can differ. Past results don't promise future ones.
      </p>
    </section>
  );
}
