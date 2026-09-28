import { Target, ShieldAlert, LogIn } from "lucide-react";
import type { DecisionResult } from "../../utils/buyDecisionEngine";
import type { OptionPick } from "../../hooks/useBuyDecision";

const fmt = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`);

function Rung({ label, level, premium, ink, Icon, note }: { label: string; level: number; premium: number | null; ink: string; Icon: typeof Target; note?: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${ink}16`, color: ink }}>
        <Icon size={15} strokeWidth={2.6} />
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-[11px] font-black" style={{ color: ink }}>{label}</p>
        {note && <p className="text-[9.5px] text-slate-400 leading-tight">{note}</p>}
      </div>
      <div className="text-right">
        <p className="text-[13px] font-black text-slate-800 tabular-nums">{fmt(level)}</p>
        {premium !== null && <p className="text-[10px] font-bold text-slate-500 tabular-nums">option ≈ {fmt(premium)}</p>}
      </div>
    </div>
  );
}

export function TradePlanCard({ result, pick }: { result: DecisionResult; pick: OptionPick | null }) {
  const plan = result.plan;
  if (!plan || !result.side) return null;
  const confirmed = result.verdict === "BUY_CE" || result.verdict === "BUY_PE";
  const rr1 = plan.riskPts > 0 ? Math.abs(plan.t1 - plan.entry) / plan.riskPts : null;
  const rr2 = plan.riskPts > 0 ? Math.abs(plan.t2 - plan.entry) / plan.riskPts : null;

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[12.5px] font-black text-slate-800">{confirmed ? `Trade plan — ${plan.side}` : `If it confirms — ${plan.side} plan`}</p>
          <p className="text-[10px] text-slate-500">Levels are on the futures price; option premiums are estimates.</p>
        </div>
        {pick && (
          <div className="text-right shrink-0 rounded-xl px-2.5 py-1.5" style={{ background: plan.side === "CE" ? "#ECFDF5" : "#FFF1F2" }}>
            <p className="text-[13px] font-black" style={{ color: plan.side === "CE" ? "#047857" : "#BE123C" }}>{pick.strike} {pick.side}</p>
            <p className="text-[9.5px] font-bold text-slate-500">ATM · exp {pick.expiry.slice(5)}</p>
          </div>
        )}
      </div>

      <div className="relative space-y-2.5 pl-1">
        <Rung label="Target 2" level={plan.t2} premium={pick?.atT2 ?? null} ink="#047857" Icon={Target} note={rr2 ? `${rr2.toFixed(1)}× the risk` : undefined} />
        <Rung label="Target 1" level={plan.t1} premium={pick?.atT1 ?? null} ink="#10B981" Icon={Target} note={`${plan.t1Basis}${rr1 ? ` · ${rr1.toFixed(1)}× risk` : ""}`} />
        <Rung label="Entry" level={plan.entry} premium={pick?.ltp ?? null} ink="#4F46E5" Icon={LogIn} note="close of the last finished candle" />
        <Rung label="Stop loss" level={plan.stop} premium={pick?.atStop ?? null} ink="#E11D48" Icon={ShieldAlert} note={plan.stopBasis} />
      </div>

      <p className="text-[10px] text-slate-400 leading-snug">
        Risk is {fmt(plan.riskPts)} on the futures price.
        {pick?.delta != null
          ? ` Option figures use the chain's delta (${pick.delta.toFixed(2)}) — real premiums also move with time decay and IV, so treat them as rough.`
          : " The chain gave no delta, so option premiums at each level are not estimated."}
      </p>
    </div>
  );
}
