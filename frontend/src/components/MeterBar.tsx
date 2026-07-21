import type { Direction } from "../types";

const dirColor: Record<Direction, string> = {
  bullish: "bg-[var(--color-buy)]",
  bearish: "bg-[var(--color-sell)]",
  neutral: "bg-slate-400",
};

export function MeterBar({ label, score, direction }: { label: string; score: number; direction: Direction }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs font-semibold text-[var(--color-muted)]">{label}</p>
        <p className="text-xs font-bold">{score}</p>
      </div>
      <div className="h-2 rounded-full bg-[var(--color-surface-soft)] overflow-hidden">
        <div className={`h-full rounded-full ${dirColor[direction]}`} style={{ width: `${Math.min(Math.max(score, 0), 100)}%` }} />
      </div>
    </div>
  );
}
