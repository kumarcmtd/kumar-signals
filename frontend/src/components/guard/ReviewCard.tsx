import { useMemo } from "react";
import { Link } from "react-router-dom";
import { LineChart, Lightbulb } from "lucide-react";
import { usePortfolio } from "../../api/hooks";
import { useAppStore } from "../../store/appStore";
import { reviewTrades } from "../../utils/capitalGuard";

const inr = (n: number) => `${n < 0 ? "−" : ""}₹${Math.abs(Math.round(n)).toLocaleString("en-IN")}`;

export function ReviewCard() {
  const { data: trades } = usePortfolio();
  const capital = useAppStore((s) => s.risk.capital);
  const r = useMemo(() => reviewTrades(trades ?? [], capital), [trades, capital]);

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className="w-8 h-8 rounded-xl flex items-center justify-center text-white" style={{ background: "linear-gradient(140deg,#F59E0B,#EA580C)" }}>
          <LineChart size={16} />
        </span>
        <div>
          <p className="text-[13px] font-black text-slate-800">What your own trades say</p>
          <p className="text-[10px] text-slate-500">From the closed trades in your Journal.</p>
        </div>
      </div>

      {r.closed === 0 ? (
        <p className="text-[11.5px] text-slate-600 leading-snug">
          No closed trades in the Journal yet. Log every trade there — entry, exit, and why — and this card will show where your money actually leaks.{" "}
          <Link to="/journal" className="font-bold text-indigo-600">Open Journal →</Link>
        </p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-1.5 text-center">
            <Stat label="Trades" value={String(r.closed)} />
            <Stat label="Win rate" value={r.winRate !== null ? `${r.winRate.toFixed(0)}%` : "—"} />
            <Stat label="Total" value={inr(r.total)} ink={r.total < 0 ? "#DC2626" : "#059669"} />
            <Stat label="Avg win" value={r.avgWin !== null ? inr(r.avgWin) : "—"} ink="#059669" />
            <Stat label="Avg loss" value={r.avgLoss !== null ? inr(-r.avgLoss) : "—"} ink="#DC2626" />
            <Stat label="Win ÷ loss" value={r.payoff !== null ? r.payoff.toFixed(2) : "—"} />
          </div>
          <div className="grid grid-cols-2 gap-1.5 text-center">
            <Stat label={`Same-day (${r.sameDay.count})`} value={inr(r.sameDay.pnl)} ink={r.sameDay.pnl < 0 ? "#DC2626" : "#059669"} />
            <Stat label={`Held overnight (${r.overnight.count})`} value={inr(r.overnight.pnl)} ink={r.overnight.pnl < 0 ? "#DC2626" : "#059669"} />
          </div>
          {r.lessons.map((l) => (
            <div key={l} className="flex gap-1.5 rounded-xl bg-amber-50 px-2.5 py-2">
              <Lightbulb size={14} className="shrink-0 mt-[1px] text-amber-600" />
              <p className="text-[11.5px] text-amber-900 leading-snug">{l}</p>
            </div>
          ))}
          <p className="text-[10px] text-slate-400">"Win ÷ loss" above 1 means your average win is bigger than your average loss — with that, even a 45% win rate can make money.</p>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, ink }: { label: string; value: string; ink?: string }) {
  return (
    <div className="rounded-xl bg-slate-50 py-1.5">
      <p className="text-[8.5px] font-bold uppercase text-slate-500">{label}</p>
      <p className="text-[12.5px] font-black" style={{ color: ink ?? "#1E293B" }}>{value}</p>
    </div>
  );
}
