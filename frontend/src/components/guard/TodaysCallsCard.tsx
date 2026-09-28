import { Link } from "react-router-dom";
import { Sparkles, TrendingUp, TrendingDown, PauseCircle, Hourglass, ChevronRight } from "lucide-react";
import { useBuyDecision } from "../../hooks/useBuyDecision";
import { useAppStore } from "../../store/appStore";
import { dayStatus, LOT_SIZE, sizePosition, type GuardSymbol } from "../../utils/capitalGuard";
import type { Verdict } from "../../utils/buyDecisionEngine";

const NAME: Record<GuardSymbol, string> = { CRUDEOIL: "Crude Oil", NATURALGAS: "Natural Gas" };

const LOOK: Record<Verdict, { label: string; ink: string; bg: string; Icon: typeof TrendingUp }> = {
  BUY_CE: { label: "BUY CE", ink: "#047857", bg: "linear-gradient(135deg,#ECFDF5,#D1FAE5)", Icon: TrendingUp },
  BUY_PE: { label: "BUY PE", ink: "#BE123C", bg: "linear-gradient(135deg,#FFF1F2,#FFE4E6)", Icon: TrendingDown },
  FORMING_CE: { label: "CE forming", ink: "#B45309", bg: "linear-gradient(135deg,#FFFBEB,#FEF3C7)", Icon: Hourglass },
  FORMING_PE: { label: "PE forming", ink: "#B45309", bg: "linear-gradient(135deg,#FFFBEB,#FEF3C7)", Icon: Hourglass },
  WAIT: { label: "WAIT", ink: "#4338CA", bg: "linear-gradient(135deg,#EEF2FF,#E0E7FF)", Icon: PauseCircle },
  EVENT_WAIT: { label: "WAIT — EIA", ink: "#C2410C", bg: "linear-gradient(135deg,#FFF7ED,#FFEDD5)", Icon: PauseCircle },
  CLOSED: { label: "Market closed", ink: "#475569", bg: "linear-gradient(135deg,#F8FAFC,#F1F5F9)", Icon: PauseCircle },
};

function CallRow({ symbol, blocked }: { symbol: GuardSymbol; blocked: boolean }) {
  const { result, pick, loading } = useBuyDecision(symbol);
  const risk = useAppStore((s) => s.risk);
  if (!result) {
    return <div className="rounded-2xl bg-slate-50 p-3 text-[12px] text-slate-500">{NAME[symbol]}: {loading ? "reading the charts…" : "not enough finished candles yet"}</div>;
  }
  const L = LOOK[result.verdict];
  const buy = result.verdict === "BUY_CE" || result.verdict === "BUY_PE";
  const size = buy && pick && pick.ltp !== null && pick.atStop !== null
    ? sizePosition({ capital: risk.capital, riskPct: risk.riskPercent, premium: pick.ltp, stopPremium: pick.atStop, lotSize: LOT_SIZE[symbol] })
    : null;
  const why = buy
    ? `${result.strength}/100 of the evidence agrees; 1h/4h trend behind it.`
    : result.waitingFor[0] ?? (result.side ? `Leaning ${result.side}, not confirmed.` : "No clear edge either way.");

  return (
    <Link to="/ai-verify-pro" className="block rounded-2xl p-3" style={{ background: L.bg, opacity: blocked && buy ? 0.6 : 1 }}>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{NAME[symbol]}</p>
          <p className="text-[18px] font-black flex items-center gap-1.5" style={{ color: L.ink }}>
            <L.Icon size={18} strokeWidth={2.6} /> {L.label}
            {buy && pick && <span className="text-[13px] font-extrabold text-slate-700">· {pick.strike} {pick.side}{pick.ltp !== null ? ` @ ₹${pick.ltp}` : ""}</span>}
          </p>
        </div>
        <ChevronRight size={18} className="text-slate-400 shrink-0" />
      </div>
      <p className="text-[11.5px] text-slate-600 leading-snug mt-0.5">{why}</p>
      {buy && result.plan && (
        <p className="text-[11px] font-bold text-slate-700 mt-1">
          Stop ₹{result.plan.stop} · T1 ₹{result.plan.t1} · T2 ₹{result.plan.t2} <span className="font-normal text-slate-500">(futures price)</span>
        </p>
      )}
      {size && (
        <p className="text-[11.5px] font-black mt-1" style={{ color: size.lots > 0 ? "#3730A3" : "#9F1239" }}>
          {size.lots > 0 ? `Your size: ${size.lots} lot${size.lots > 1 ? "s" : ""} max` : `Your size: 0 lots — one lot risks ₹${Math.round(size.riskPerLot).toLocaleString("en-IN")}, too big. Skip.`}
        </p>
      )}
    </Link>
  );
}

export function TodaysCallsCard() {
  const { risk, guardDay } = useAppStore();
  const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
  const blocked = dayStatus(risk.capital, risk.dailyLossPercent, guardDay.date === today ? guardDay.realised : 0).state === "stop";

  return (
    <div className="card p-4 space-y-2.5">
      <div className="flex items-center gap-2">
        <span className="w-8 h-8 rounded-xl flex items-center justify-center text-white" style={{ background: "linear-gradient(140deg,#7C3AED,#2563EB)" }}>
          <Sparkles size={16} />
        </span>
        <div>
          <p className="text-[13px] font-black text-slate-800">Today's calls</p>
          <p className="text-[10px] text-slate-500">From AI Verify Pro — finished candles, 3 timeframes. Tap for every reason.</p>
        </div>
      </div>
      {blocked && <p className="text-[11px] font-bold rounded-xl px-2.5 py-2 bg-rose-50 text-rose-700">Daily loss limit reached — calls are shown for learning only today.</p>}
      <CallRow symbol="NATURALGAS" blocked={blocked} />
      <CallRow symbol="CRUDEOIL" blocked={blocked} />
      <p className="text-[10px] text-slate-400 leading-snug">WAIT is a real answer — most of the time there is no good trade, and not trading is how capital is kept.</p>
    </div>
  );
}
