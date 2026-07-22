import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

function formatAge(ms: number): string {
  if (ms < 1000) return "just now";
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ${secs % 60}s ago`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m ago`;
}

// Shows how long ago the live data actually last landed (React Query's real
// dataUpdatedAt, not "now" re-rendered every second) plus a manual refresh
// button, so it's never a guess whether the numbers on screen are current.
export function RefreshBar({
  dataUpdatedAt,
  isFetching,
  onRefresh,
  dark = false,
}: {
  dataUpdatedAt: number;
  isFetching: boolean;
  onRefresh: () => void;
  dark?: boolean;
}) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const age = dataUpdatedAt > 0 ? Date.now() - dataUpdatedAt : null;
  const label = age !== null ? `Updated ${formatAge(age)}` : "Not loaded yet";

  return (
    <div className={`flex items-center justify-between gap-2 text-[11px] ${dark ? "text-white/50" : "text-[var(--color-muted)]"}`}>
      <span>{label}</span>
      <button
        onClick={onRefresh}
        disabled={isFetching}
        className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 font-semibold transition-colors disabled:opacity-60 ${
          dark ? "bg-white/10 hover:bg-white/15 text-white/90 border border-white/15" : "bg-black/5 hover:bg-black/10 text-[var(--color-ink)] border border-[var(--color-border)]"
        }`}
      >
        <RefreshCw size={12} className={isFetching ? "animate-spin" : ""} />
        Refresh
      </button>
    </div>
  );
}
