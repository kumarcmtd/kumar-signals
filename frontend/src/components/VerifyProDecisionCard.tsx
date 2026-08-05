import { CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import type { VerifyProResult, TradeGrade, FinalAction } from "../utils/verifyProEngine";

const GRADE_COLOR: Record<TradeGrade, string> = {
  "S+": "#FBBF24",
  S: "#34D399",
  "A+": "#4ADE80",
  A: "#A3E635",
  B: "#FBBF24",
  C: "#FB923C",
  REJECT: "#F87171",
};

const ACTION_VISUAL: Record<FinalAction, { bg: string; text: string; emoji: string; approval: string; Icon: typeof CheckCircle2 }> = {
  "STRONG BUY": { bg: "#065F46", text: "#6EE7B7", emoji: "🟢", approval: "APPROVED", Icon: CheckCircle2 },
  BUY: { bg: "#065F46", text: "#6EE7B7", emoji: "🟢", approval: "APPROVED", Icon: CheckCircle2 },
  WAIT: { bg: "#78350F", text: "#FCD34D", emoji: "🟡", approval: "WAIT", Icon: AlertTriangle },
  "NO TRADE": { bg: "#7F1D1D", text: "#FCA5A5", emoji: "⚫", approval: "REJECTED", Icon: XCircle },
};

export function VerifyProDecisionCard({ result, label, entry }: { result: VerifyProResult; label: string; entry: number }) {
  const action = ACTION_VISUAL[result.finalAction];
  const gradeColor = GRADE_COLOR[result.tradeGrade];

  return (
    <div className="rounded-3xl p-5 text-white" style={{ background: "linear-gradient(160deg,#0F172A,#1E293B 60%,#111827)", boxShadow: "0 12px 32px rgba(15,23,42,.45)" }}>
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-white/50 font-bold">AI Verify Pro</p>
          <p className="text-sm font-black">{label}</p>
        </div>
        <span className="text-2xl font-black px-3 py-1 rounded-xl" style={{ background: `${gradeColor}22`, color: gradeColor, border: `1px solid ${gradeColor}55` }}>
          {result.tradeGrade}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-4 text-center">
        <Stat label="Institutional Score" value={`${result.weightedScorePct}/100`} accent={gradeColor} />
        <Stat label="Confidence" value={`${result.weightedScorePct}%`} accent={gradeColor} />
        <Stat label="Win Probability" value={`${result.winningProbabilityPct}%`} accent={gradeColor} />
      </div>

      <div className="grid grid-cols-2 gap-2 mb-4">
        <MiniRow label="Trend" value={result.regime.label} />
        <MiniRow label="Risk" value={result.riskLevel} />
        <MiniRow label="Entry Timing" value={result.entryTiming.label} />
        <MiniRow label="Reversal Risk" value={result.reversalProbability} />
      </div>

      <div className="rounded-2xl p-3 mb-4" style={{ background: "rgba(255,255,255,.06)" }}>
        <div className="grid grid-cols-3 gap-2 text-center mb-2">
          <MiniRow label="Entry" value={`₹${entry.toFixed(2)}`} />
          <MiniRow label="Stop Loss" value={`₹${result.risk.stopLoss.toFixed(2)}`} />
          <MiniRow label="Risk:Reward" value={result.risk.riskRewardLabel} />
        </div>
        <div className="grid grid-cols-4 gap-1.5 text-center">
          {result.risk.targets.map((t, i) => (
            <div key={i} className="rounded-lg py-1.5" style={{ background: "rgba(255,255,255,.06)" }}>
              <p className="text-[8px] text-white/50 uppercase">T{i + 1}</p>
              <p className="text-[11px] font-bold">₹{t.toFixed(2)}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl p-3.5 flex items-center justify-between" style={{ background: action.bg }}>
        <div className="flex items-center gap-2">
          <action.Icon size={20} style={{ color: action.text }} />
          <div>
            <p className="text-[9px] uppercase tracking-wide font-bold" style={{ color: action.text, opacity: 0.8 }}>
              Institutional Approval: {action.approval}
            </p>
            <p className="text-base font-black" style={{ color: action.text }}>
              {action.emoji} {result.finalAction}
            </p>
          </div>
        </div>
      </div>

      {result.hardRejectionReasons.length > 0 && (
        <div className="mt-3 rounded-xl px-3 py-2.5" style={{ background: "rgba(248,113,113,.12)", border: "1px solid rgba(248,113,113,.3)" }}>
          <p className="text-[9px] font-bold uppercase text-red-300 mb-1">Hard Rejection Rules Triggered</p>
          {result.hardRejectionReasons.map((r, i) => (
            <p key={i} className="text-[11px] text-red-200">
              • {r}
            </p>
          ))}
        </div>
      )}

      {result.reasons.positive.length > 0 && (
        <p className="text-[10.5px] text-white/60 mt-3 leading-relaxed">
          <span className="text-white/80 font-bold">Reason: </span>
          {[...result.reasons.positive.slice(0, 6), ...result.reasons.negative.slice(0, 3)].join(", ")}.
        </p>
      )}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="rounded-xl py-2 px-1" style={{ background: "rgba(255,255,255,.06)" }}>
      <p className="text-[8px] text-white/50 uppercase">{label}</p>
      <p className="text-sm font-black" style={{ color: accent }}>
        {value}
      </p>
    </div>
  );
}

function MiniRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl px-2.5 py-2" style={{ background: "rgba(255,255,255,.06)" }}>
      <p className="text-[8px] text-white/50 uppercase">{label}</p>
      <p className="text-[11px] font-bold text-white/90 truncate">{value}</p>
    </div>
  );
}
