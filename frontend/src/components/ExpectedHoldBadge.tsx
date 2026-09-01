import { Clock, Hourglass } from "lucide-react";
import type { TradeLogEntry } from "../store/appStore";
import { historicalHold, paceEtaMin, formatDuration } from "../utils/holdTime";

// A compact "how long to wait" read shown on a live call. Combines the call's
// own realized pace with how long this page's past winners took, so the trader
// has a real sense of the minimum patience a call deserves.
export function ExpectedHoldBadge({
  entries,
  open,
  className,
}: {
  entries: TradeLogEntry[];
  open: { entry: number; current: number | null; openedAt: number; nextTarget: number } | null;
  className?: string;
}) {
  const hist = historicalHold(entries);
  const eta = open ? paceEtaMin(open.entry, open.current, open.openedAt, open.nextTarget) : null;

  if (!hist && eta === null) {
    return (
      <div className={className}>
        <div className="rounded-xl px-3 py-2 flex items-start gap-1.5" style={{ background: "var(--color-surface-soft)", border: "1px solid var(--color-border)" }}>
          <Hourglass size={12} className="shrink-0 mt-0.5 text-violet-500" />
          <p className="text-[11px] text-[var(--color-muted)]">
            Expected wait to target fills in as this call moves and as past calls close — give a fresh call at least a few candles before judging it.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={className}>
      <div className="rounded-xl px-3 py-2" style={{ background: "var(--color-surface-soft)", border: "1px solid var(--color-border)" }}>
        <p className="text-[10px] font-bold uppercase text-[var(--color-muted)] flex items-center gap-1.5 mb-1">
          <Clock size={12} className="text-violet-500" /> Expected Wait To Target
        </p>
        {eta !== null && (
          <p className="text-[12px] font-bold">
            ~{formatDuration(eta)} <span className="font-normal text-[var(--color-muted)]">to the next target at its current pace</span>
          </p>
        )}
        {hist && (
          <p className="text-[11px] text-[var(--color-muted)] mt-0.5">
            Your winning calls here usually take about <b>{formatDuration(hist.medianWinMin)}</b> ({hist.winCount} past {hist.winCount === 1 ? "call" : "calls"}) — don't bail far too early.
          </p>
        )}
      </div>
    </div>
  );
}
