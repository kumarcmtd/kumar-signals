import { useState } from "react";
import { ChevronDown, Check, X } from "lucide-react";
import type { Candle } from "../types";
import { assessCallStrength, strengthSignal, type CallStrengthContext, type CallStrengthTier } from "../utils/callStrength";

const TIER_COLOR: Record<CallStrengthTier, string> = {
  strong: "#16A34A",
  holding: "#CA8A04",
  weakening: "#EA580C",
  weak: "#DC2626",
};

// The at-a-glance signal-bars glyph (like phone signal): four ascending bars,
// the lit ones in the signal's colour, so the call's health reads instantly
// without opening the panel.
function SignalBars({ litBars, color }: { litBars: number; color: string }) {
  const heights = [7, 10, 13, 16];
  return (
    <span className="inline-flex items-end gap-[2px]" style={{ height: 16 }} aria-hidden>
      {heights.map((h, i) => (
        <span
          key={i}
          style={{ width: 4, height: h, borderRadius: 1, background: i < litBars ? color : "var(--color-border)" }}
        />
      ))}
    </span>
  );
}

// A tap-to-check "does this call still have potential?" button, now with a
// live signal-bars indicator shown right on the button. Both the indicator and
// the expanded detail are computed off the same real candles every render, so
// they always reflect the market right now -- not a number frozen at entry.
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
  const result = assessCallStrength(candles, direction, ctx);
  const signal = result ? strengthSignal(result.score) : null;

  return (
    <div className={className}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-xs font-bold border"
        style={{ background: "var(--color-surface-soft)", borderColor: signal ? `${signal.color}55` : "var(--color-border)", color: "var(--color-ink)" }}
      >
        <span className="flex items-center gap-1.5">Check Call Strength</span>
        <span className="flex items-center gap-1.5">
          {signal ? (
            <>
              <SignalBars litBars={signal.litBars} color={signal.color} />
              <span className="text-[11px] font-black" style={{ color: signal.color }}>
                {signal.label}
              </span>
            </>
          ) : (
            <span className="text-[10px] text-[var(--color-muted)]">—</span>
          )}
          <ChevronDown size={13} className={`transition-transform ${open ? "rotate-180" : ""}`} />
        </span>
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
