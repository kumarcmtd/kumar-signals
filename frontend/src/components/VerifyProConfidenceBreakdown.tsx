import { Gauge } from "lucide-react";
import type { CategoryScore } from "../utils/verifyProEngine";

function colorFor(pct: number): string {
  if (pct >= 70) return "#16A34A";
  if (pct >= 45) return "#D97706";
  return "#DC2626";
}

export function VerifyProConfidenceBreakdown({ categories }: { categories: CategoryScore[] }) {
  return (
    <div className="card p-4">
      <p className="text-xs font-black uppercase text-[var(--color-muted)] mb-3 flex items-center gap-1.5">
        <Gauge size={13} />
        AI Confidence Breakdown
      </p>
      <div className="space-y-2.5">
        {categories.map((c) => (
          <div key={c.category}>
            <div className="flex justify-between text-[10.5px] font-bold mb-1">
              <span>{c.label}</span>
              <span style={{ color: colorFor(c.scorePct) }}>{c.scorePct}%</span>
            </div>
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(0,0,0,.07)" }}>
              <div className="h-full rounded-full transition-all duration-700" style={{ width: `${c.scorePct}%`, background: colorFor(c.scorePct) }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
