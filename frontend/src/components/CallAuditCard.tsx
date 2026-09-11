import { useState } from "react";
import { CheckCircle2, AlertTriangle, XCircle, HelpCircle, ChevronDown, ShieldCheck, History } from "lucide-react";
import type { CallAudit, AuditGrade, AuditStatus } from "../utils/callAuditEngine";

export const GRADE_STYLE: Record<AuditGrade, { color: string; soft: string; ring: string }> = {
  "A+": { color: "#15803D", soft: "#DCFCE7", ring: "#16A34A" },
  A: { color: "#15803D", soft: "#DCFCE7", ring: "#22C55E" },
  B: { color: "#0369A1", soft: "#E0F2FE", ring: "#0EA5E9" },
  C: { color: "#B45309", soft: "#FEF3C7", ring: "#F59E0B" },
  D: { color: "#B91C1C", soft: "#FEE2E2", ring: "#EF4444" },
};

const STATUS_STYLE: Record<AuditStatus, { color: string; Icon: typeof CheckCircle2 }> = {
  pass: { color: "#16A34A", Icon: CheckCircle2 },
  warn: { color: "#D97706", Icon: AlertTriangle },
  fail: { color: "#DC2626", Icon: XCircle },
  unknown: { color: "#94A3B8", Icon: HelpCircle },
};

// The grade a call earned, and exactly which checks produced it. Deliberately
// expandable rather than a bare letter -- a rating you cannot interrogate is
// just another number to distrust.
export function CallAuditCard({
  audit,
  atCall,
  className,
}: {
  audit: CallAudit;
  /** The grade frozen when the call was first given, if this is a tracked trade. */
  atCall?: { score: number; grade: AuditGrade } | null;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const g = GRADE_STYLE[audit.grade];

  // Only worth showing the drift when it actually moved a grade.
  const drifted = atCall && atCall.grade !== audit.grade;
  const better = atCall ? audit.score > atCall.score : false;

  return (
    <div className={`rounded-2xl overflow-hidden shadow-md ${className ?? ""}`} style={{ border: `2px solid ${g.ring}` }}>
      <div className="px-4 py-3 flex items-center gap-3" style={{ background: g.soft }}>
        <div
          className="shrink-0 w-14 h-14 rounded-2xl flex flex-col items-center justify-center"
          style={{ background: g.color, color: "#fff" }}
        >
          <span className="text-xl font-black leading-none">{audit.grade}</span>
          <span className="text-[9px] font-bold opacity-80 leading-none mt-0.5">{audit.score}/100</span>
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-wide flex items-center gap-1" style={{ color: g.color }}>
            <ShieldCheck size={12} /> Call Audit
          </p>
          <p className="text-[15px] font-black leading-tight" style={{ color: g.color }}>
            {audit.headline}
          </p>
          <p className="text-[10.5px] text-slate-600 leading-snug mt-0.5">{audit.verdict}</p>
        </div>
      </div>

      {atCall && (
        <div className="px-4 py-2 flex items-center gap-1.5 border-b" style={{ background: "#FFFFFF", borderColor: "var(--color-border)" }}>
          <History size={11} className="text-slate-400 shrink-0" />
          <p className="text-[10px] text-slate-500">
            Rated <span className="font-black" style={{ color: GRADE_STYLE[atCall.grade].color }}>{atCall.grade} ({atCall.score})</span> when the call was given
            {drifted ? (
              <>
                {" "}— now <span className="font-black" style={{ color: g.color }}>{audit.grade} ({audit.score})</span>, so it has {better ? "improved" : "weakened"} since.
              </>
            ) : (
              <> — unchanged.</>
            )}
          </p>
        </div>
      )}

      <div className="bg-white">
        {/* Compact pass/warn/fail strip: the whole audit at a glance. */}
        <div className="px-4 pt-2.5 flex flex-wrap gap-1">
          {audit.checks.map((c) => {
            const s = STATUS_STYLE[c.status];
            return (
              <span key={c.id} className="w-2 h-2 rounded-full" style={{ background: s.color, opacity: c.status === "unknown" ? 0.35 : 1 }} title={`${c.label}: ${c.status}`} />
            );
          })}
          <span className="text-[9px] text-slate-400 ml-auto">
            {audit.checks.filter((c) => c.status === "pass").length} passed · {audit.checks.filter((c) => c.status === "fail").length} failed
            {audit.unknownChecks > 0 && ` · ${audit.unknownChecks} no data`}
          </span>
        </div>

        <button type="button" onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-center gap-1 text-[10px] font-bold text-slate-400 py-2">
          {open ? "Hide the breakdown" : "See all " + audit.checks.length + " checks"}
          <ChevronDown size={11} className={open ? "rotate-180 transition-transform" : "transition-transform"} />
        </button>

        {open && (
          <div className="px-3.5 pb-3 space-y-1.5">
            {audit.checks.map((c) => {
              const s = STATUS_STYLE[c.status];
              const { Icon } = s;
              return (
                <div key={c.id} className="rounded-xl px-2.5 py-2" style={{ background: "var(--color-surface-soft)", border: "1px solid var(--color-border)" }}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 min-w-0">
                      <Icon size={12} style={{ color: s.color }} className="shrink-0" />
                      <span className="text-[11px] font-bold text-slate-700 truncate">{c.label}</span>
                    </span>
                    <span className="text-[9px] font-bold shrink-0" style={{ color: s.color }}>
                      {c.status === "unknown" ? "no data" : `${Math.round(c.earned)}/${c.weight}`}
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-500 leading-snug mt-1">{c.detail}</p>
                </div>
              );
            })}
            <p className="text-[9.5px] text-slate-400 leading-relaxed pt-1">
              Scored out of the {audit.knownChecks} checks that had live data; anything unavailable is dropped from the total rather than counted against the call. Thresholds are either standard
              (Wilder's ADX bands, delta at the money) or measured against this option chain's own median — never an invented "good" number.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
