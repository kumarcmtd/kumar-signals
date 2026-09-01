import { useState } from "react";
import { Gauge, ChevronDown, Check, X } from "lucide-react";
import type { Candle } from "../types";
import { assessCallStrength, type CallStrengthContext, type CallStrengthTier } from "../utils/callStrength";

const TIER_COLOR: Record<CallStrengthTier, string> = {
  strong: "#16A34A",
  holding: "#CA8A04",
  weakening: "#EA580C",
  weak: "#DC2626",
};

// A tap-to-check "does this call still have potential?" button. Computed live
// off the same real candles every time it's opened, so it always reflects the
// market right now -- not a number frozen when the call was first raised.
export function CallStrengthButton({
  candles,
  direction,
  ctx,
  className,
}: {
  candles: Candle[];
  direction: "bullish" | "bearish";
  ctx: CallStrengthContext;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const result = open ? assessCallStrength(candles, direction, ctx) : null;

  return (
    <div className={className}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-bold border"
        style={{ background: "var(--color-surface-soft)", borderColor: "var(--color-border)", color: "var(--color-ink)" }}
      >
        <Gauge size={14} className="text-violet-600" />
        Check Call Strength
        <ChevronDown size={13} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="mt-2 rounded-xl overflow-hidden border" style={{ borderColor: result ? `${TIER_COLOR[result.tier]}55` : "var(--color-border)" }}>
          {!result ? (
            <p className="p-3 text-[11px] text-[var(--color-muted)]">Not enough live candle data to score this call right now — try again in a moment.</p>
          ) : (
            <>
              <div className="px-3 py-2.5 flex items-center justify-between" style={{ background: `${TIER_COLOR[result.tier]}12` }}>
                <div>
                  <p className="text-sm font-black" style={{ color: TIER_COLOR[result.tier] }}>
                    {result.label}
                  </p>
                  <p className="text-[10px] text-[var(--color-muted)]">Live strength check</p>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-black tabular-nums" style={{ color: TIER_COLOR[result.tier] }}>
                    {result.score}
                  </p>
                  <p className="text-[9px] text-[var(--color-muted)]">out of 100</p>
                </div>
              </div>

              <div className="h-1.5 w-full" style={{ background: "var(--color-border)" }}>
                <div className="h-full" style={{ width: `${result.score}%`, background: TIER_COLOR[result.tier] }} />
              </div>

              <div className="p-3 space-y-1.5">
                <p className="text-[11px] font-semibold leading-snug" style={{ color: TIER_COLOR[result.tier] }}>
                  {result.headline}
                </p>
                <div className="space-y-1 pt-0.5">
                  {result.reasons.map((r, i) => (
                    <p key={i} className="text-[11px] text-[var(--color-muted)] flex items-start gap-1.5">
                      {r.ok ? <Check size={12} className="shrink-0 mt-0.5 text-emerald-500" /> : <X size={12} className="shrink-0 mt-0.5 text-rose-500" />}
                      {r.text}
                    </p>
                  ))}
                </div>
                <p className="text-[9px] text-[var(--color-muted)] pt-1">Recomputed live from real candles each time you open it. A strength read, not a stop — always confirm on the chart.</p>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
