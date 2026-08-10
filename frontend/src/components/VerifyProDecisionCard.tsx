import { CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import type { VerifyProResult, TradeGrade, FinalAction } from "../utils/verifyProEngine";

const GRADE_COLOR: Record<TradeGrade, string> = {
  "S+": "#D97706",
  S: "#059669",
  "A+": "#16A34A",
  A: "#65A30D",
  B: "#D97706",
  C: "#EA580C",
  REJECT: "#DC2626",
};

const ACTION_VISUAL: Record<FinalAction, { bg: string; border: string; text: string; emoji: string; approval: string; Icon: typeof CheckCircle2 }> = {
  "STRONG BUY": { bg: "#DCFCE7", border: "#86EFAC", text: "#15803D", emoji: "🟢", approval: "APPROVED", Icon: CheckCircle2 },
  BUY: { bg: "#DCFCE7", border: "#86EFAC", text: "#15803D", emoji: "🟢", approval: "APPROVED", Icon: CheckCircle2 },
  WAIT: { bg: "#FEF3C7", border: "#FCD34D", text: "#B45309", emoji: "🟡", approval: "WAIT", Icon: AlertTriangle },
  "NO TRADE": { bg: "#FEE2E2", border: "#FCA5A5", text: "#B91C1C", emoji: "🔴", approval: "REJECTED", Icon: XCircle },
};

export function VerifyProDecisionCard({ result, label, entry }: { result: VerifyProResult; label: string; entry: number }) {
  const action = ACTION_VISUAL[result.finalAction];
  const gradeColor = GRADE_COLOR[result.tradeGrade];

  return (
    <div className="rounded-3xl p-5 bg-white shadow-md border-l-8" style={{ borderColor: gradeColor }}>
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-[var(--color-muted)] font-bold">AI Verify Pro</p>
          <p className="text-sm font-black">{label}</p>
        </div>
        <span className="text-2xl font-black px-3 py-1 rounded-xl" style={{ background: `${gradeColor}1A`, color: gradeColor, border: `1px solid ${gradeColor}55` }}>
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

      <div className="rounded-2xl p-3 mb-4" style={{ background: "var(--color-surface-soft)", border: "1px solid var(--color-border)" }}>
        <div className="grid grid-cols-3 gap-2 text-center mb-2">
          <MiniRow label="Entry" value={`₹${entry.toFixed(2)}`} />
          <MiniRow label="Stop Loss" value={`₹${result.risk.stopLoss.toFixed(2)}`} />
          <MiniRow label="Risk:Reward" value={result.risk.riskRewardLabel} />
        </div>
        <div className="grid grid-cols-4 gap-1.5 text-center">
          {result.risk.targets.map((t, i) => (
            <div key={i} className="rounded-lg py-1.5 bg-white border border-[var(--color-border)]">
              <p className="text-[8px] text-[var(--color-muted)] uppercase">T{i + 1}</p>
              <p className="text-[11px] font-bold" style={{ color: "var(--color-buy)" }}>
                ₹{t.toFixed(2)}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl p-3.5 flex items-center justify-between" style={{ background: action.bg, border: `1px solid ${action.border}` }}>
        <div className="flex items-center gap-2">
          <action.Icon size={20} style={{ color: action.text }} />
          <div>
            <p className="text-[9px] uppercase tracking-wide font-bold" style={{ color: action.text, opacity: 0.85 }}>
              Institutional Approval: {action.approval}
            </p>
            <p className="text-base font-black" style={{ color: action.text }}>
              {action.emoji} {result.finalAction}
            </p>
          </div>
        </div>
      </div>

      {result.hardRejectionReasons.length > 0 && (
        <div className="mt-3 rounded-xl px-3 py-2.5" style={{ background: "#FEE2E2", border: "1px solid #FCA5A5" }}>
          <p className="text-[9px] font-bold uppercase mb-1" style={{ color: "#B91C1C" }}>
            Hard Rejection Rules Triggered
          </p>
          {result.hardRejectionReasons.map((r, i) => (
            <p key={i} className="text-[11px]" style={{ color: "#991B1B" }}>
              • {r}
            </p>
          ))}
        </div>
      )}

      {result.reasons.positive.length > 0 && (
        <p className="text-[10.5px] text-[var(--color-muted)] mt-3 leading-relaxed">
          <span className="font-bold text-[var(--color-ink)]">Reason: </span>
          {[...result.reasons.positive.slice(0, 6), ...result.reasons.negative.slice(0, 3)].join(", ")}.
        </p>
      )}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="rounded-xl py-2 px-1" style={{ background: `${accent}14` }}>
      <p className="text-[8px] text-[var(--color-muted)] uppercase">{label}</p>
      <p className="text-sm font-black" style={{ color: accent }}>
        {value}
      </p>
    </div>
  );
}

function MiniRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl px-2.5 py-2" style={{ background: "var(--color-surface-soft)", border: "1px solid var(--color-border)" }}>
      <p className="text-[8px] text-[var(--color-muted)] uppercase">{label}</p>
      <p className="text-[11px] font-bold truncate">{value}</p>
    </div>
  );
}
