import { useState } from "react";
import { CheckCircle2, AlertTriangle, XCircle, Info } from "lucide-react";
import type { StrategyResult, StrategyTier } from "../utils/strategyVerification";

const TIER_STYLE: Record<StrategyTier, { bg: string; border: string; text: string; glow: string; barPct: number; label: string; Icon: typeof CheckCircle2 }> = {
  pass: { bg: "#F0FDF4", border: "#86EFAC", text: "#15803D", glow: "0 0 18px rgba(34,197,94,.28)", barPct: 100, label: "PASS", Icon: CheckCircle2 },
  wait: { bg: "#FFFBEB", border: "#FCD34D", text: "#B45309", glow: "0 0 18px rgba(245,158,11,.28)", barPct: 55, label: "WAIT", Icon: AlertTriangle },
  fail: { bg: "#FEF2F2", border: "#FCA5A5", text: "#B91C1C", glow: "0 0 18px rgba(239,68,68,.28)", barPct: 15, label: "FAIL", Icon: XCircle },
};

export function StrategyCard({ strategy }: { strategy: StrategyResult }) {
  const [open, setOpen] = useState(false);
  const style = TIER_STYLE[strategy.tier];
  const Icon = style.Icon;

  return (
    <div
      className="rounded-2xl p-3.5 border transition-shadow duration-500"
      style={{ background: style.bg, borderColor: style.border, boxShadow: style.glow }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 min-w-0">
          <Icon size={18} style={{ color: style.text }} className="shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-[13px] font-black" style={{ color: style.text }}>
              {strategy.name}
            </p>
            <p className="text-[10.5px] mt-0.5 leading-snug" style={{ color: style.text, opacity: 0.85 }}>
              {strategy.reason}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full" style={{ background: style.text, color: "#fff" }}>
            {strategy.weightPct}%
          </span>
          <button
            onClick={() => setOpen((v) => !v)}
            aria-label={`Why ${style.label} for ${strategy.name}`}
            className="w-6 h-6 rounded-full flex items-center justify-center shrink-0"
            style={{ background: "rgba(255,255,255,.7)", border: `1px solid ${style.border}` }}
          >
            <Info size={12} style={{ color: style.text }} />
          </button>
        </div>
      </div>

      <div className="mt-2.5 h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(0,0,0,.07)" }}>
        <div className="h-full rounded-full transition-all duration-700 ease-out" style={{ width: `${style.barPct}%`, background: style.text }} />
      </div>

      {open && (
        <div className="mt-2.5 pt-2.5 border-t text-[10.5px] leading-relaxed" style={{ borderColor: style.border }}>
          <p className="font-black mb-1" style={{ color: style.text }}>
            Why {style.label}?
          </p>
          <p style={{ color: style.text, opacity: 0.9 }}>{strategy.explain}</p>
        </div>
      )}
    </div>
  );
}
