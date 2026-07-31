import type { EntryTimingTier, EntryTimingVerdict } from "../utils/entryTiming";

const LIGHT_STYLE: Record<EntryTimingTier, { bg: string; text: string }> = {
  excellent: { bg: "#DCFCE7", text: "#15803D" },
  good: { bg: "#DCFCE7", text: "#15803D" },
  fair: { bg: "#FEF3C7", text: "#B45309" },
  late: { bg: "#FEE2E2", text: "#B91C1C" },
  past_target: { bg: "#FEE2E2", text: "#B91C1C" },
  underwater: { bg: "#FEF3C7", text: "#B45309" },
  past_stop: { bg: "#FEE2E2", text: "#B91C1C" },
};

// Dark pages use the same translucent-color-on-dark convention as this
// app's other verdict/confluence chips (e.g. ConfluenceChip's `#00E67622`) --
// a solid pastel card like the light theme's would look like a stray white
// tile dropped onto a near-black page.
const DARK_STYLE: Record<EntryTimingTier, { bg: string; text: string }> = {
  excellent: { bg: "#00E67622", text: "#00E676" },
  good: { bg: "#00E67622", text: "#00E676" },
  fair: { bg: "#FFC10722", text: "#FFC107" },
  late: { bg: "#FF4D4F22", text: "#FF4D4F" },
  past_target: { bg: "#FF4D4F22", text: "#FF4D4F" },
  underwater: { bg: "#FFC10722", text: "#FFC107" },
  past_stop: { bg: "#FF4D4F22", text: "#FF4D4F" },
};

// Answers "should I enter at THIS price, right now" -- distinct from every
// other number shown alongside a live call, which describes the call itself,
// not whether this particular moment is a good time to act on it. Meant to
// sit right under wherever a page shows its own "current premium"/live price,
// since that's the number this verdict is actually about. Same verdict logic
// (evaluateEntryTiming) everywhere it appears -- only the color theme differs
// per page.
export function EntryTimingBadge({ verdict, theme = "light", className }: { verdict: EntryTimingVerdict; theme?: "light" | "dark"; className?: string }) {
  const style = (theme === "dark" ? DARK_STYLE : LIGHT_STYLE)[verdict.tier];
  return (
    <div className={`rounded-lg px-2 py-1.5 ${className ?? ""}`} style={{ background: style.bg }}>
      <p className="text-[10px] font-black leading-tight" style={{ color: style.text }}>
        {verdict.label}
      </p>
      <p className="text-[9px] leading-snug mt-0.5" style={{ color: style.text, opacity: 0.85 }}>
        {verdict.note}
      </p>
    </div>
  );
}
