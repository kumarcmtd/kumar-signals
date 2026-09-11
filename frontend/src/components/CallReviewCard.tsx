import { useState } from "react";
import { ThumbsUp, AlertTriangle, XCircle, Eye, Clock, HelpCircle, ChevronDown, Stethoscope, TrendingDown } from "lucide-react";
import { formatMinutes, type CallReview, type ReviewVerdict, type FactorSide } from "../utils/callReviewEngine";

const VERDICT_STYLE: Record<ReviewVerdict, { color: string; soft: string; ring: string; Icon: typeof ThumbsUp; action: string }> = {
  hold: { color: "#15803D", soft: "#DCFCE7", ring: "#16A34A", Icon: ThumbsUp, action: "HOLD" },
  trim: { color: "#B45309", soft: "#FEF3C7", ring: "#F59E0B", Icon: AlertTriangle, action: "TAKE SOME" },
  exit: { color: "#B91C1C", soft: "#FEE2E2", ring: "#EF4444", Icon: XCircle, action: "GET OUT" },
  watch: { color: "#0369A1", soft: "#E0F2FE", ring: "#0EA5E9", Icon: Eye, action: "WATCH" },
  early: { color: "#475569", soft: "#F1F5F9", ring: "#CBD5E1", Icon: Clock, action: "TOO EARLY" },
  unknown: { color: "#475569", soft: "#F1F5F9", ring: "#CBD5E1", Icon: HelpCircle, action: "NO DATA" },
};

const SIDE_COLOR: Record<FactorSide, string> = { for: "#16A34A", against: "#DC2626", neutral: "#94A3B8" };

const rs = (n: number) => `₹${Math.abs(Math.round(n)).toLocaleString("en-IN")}`;

// A live read on a call already open, not a quality grade on a call being
// considered. The action word is the point -- everything below it is the
// evidence for that word, so it can be argued with rather than obeyed.
export function CallReviewCard({ review, className }: { review: CallReview; className?: string }) {
  const [open, setOpen] = useState(false);
  const v = VERDICT_STYLE[review.verdict];
  const { Icon } = v;

  const goal = review.goalProgressPct === null ? 0 : Math.max(0, Math.min(100, review.goalProgressPct));
  const pnlPositive = (review.pnlRs ?? 0) >= 0;

  return (
    <div className={`rounded-2xl overflow-hidden shadow-md ${className ?? ""}`} style={{ border: `2px solid ${v.ring}` }}>
      <div className="px-4 py-3" style={{ background: v.soft }}>
        <div className="flex items-center gap-2.5">
          <div className="shrink-0 w-11 h-11 rounded-xl flex items-center justify-center" style={{ background: v.color }}>
            <Icon size={20} color="#fff" strokeWidth={2.4} />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-wide flex items-center gap-1" style={{ color: v.color }}>
              <Stethoscope size={11} /> Call Review · {v.action}
            </p>
            <p className="text-[15px] font-black leading-tight" style={{ color: v.color }}>
              {review.headline}
            </p>
          </div>
        </div>
        <p className="text-[11px] text-slate-600 leading-snug mt-2">{review.reason}</p>
      </div>

      <div className="bg-white px-4 py-3">
        {review.pnlRs !== null && (
          <>
            <div className="flex items-end justify-between gap-2">
              <div>
                <p className="text-[9px] font-bold uppercase text-slate-400">Right now · 1 lot</p>
                <p className="text-2xl font-black leading-none mt-0.5" style={{ color: pnlPositive ? "#15803D" : "#DC2626" }}>
                  {pnlPositive ? "+" : "−"}
                  {rs(review.pnlRs)}
                </p>
              </div>
              {review.peakRs !== null && review.peakRs > 0 && (
                <div className="text-right">
                  <p className="text-[9px] font-bold uppercase text-slate-400">Best it reached</p>
                  <p className="text-[15px] font-black text-slate-500 leading-none mt-0.5">+{rs(review.peakRs)}</p>
                </div>
              )}
            </div>

            {/* Progress toward this page's flat rupee goal. */}
            <div className="mt-2.5">
              <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                <div className="h-full rounded-full transition-all" style={{ width: `${goal}%`, background: v.color }} />
              </div>
              <p className="text-[9px] text-slate-400 mt-1">
                {review.goalProgressPct === null ? "—" : `${review.goalProgressPct}% of the way to this page's goal`} · open {formatMinutes(review.minutesOpen)}
              </p>
            </div>

            {/* The give-back line only exists while still in profit, so when it
                shows it always means something. */}
            {review.giveBackPct !== null && review.giveBackPct > 0 && (
              <div className="mt-2.5 rounded-xl px-2.5 py-2 flex items-start gap-1.5" style={{ background: review.giveBackPct >= 35 ? "#FEF2F2" : "#F8FAFC", border: `1px solid ${review.giveBackPct >= 35 ? "#FECACA" : "#E2E8F0"}` }}>
                <TrendingDown size={12} className="shrink-0 mt-0.5" style={{ color: review.giveBackPct >= 35 ? "#DC2626" : "#94A3B8" }} />
                <p className="text-[10.5px] text-slate-600 leading-snug">
                  <span className="font-black" style={{ color: review.giveBackPct >= 35 ? "#DC2626" : "#475569" }}>
                    {review.giveBackPct}% of the run given back
                  </span>{" "}
                  — from +{rs(review.peakRs ?? 0)} down to +{rs(review.pnlRs)}.
                </p>
              </div>
            )}
          </>
        )}

        <div className="mt-2.5 rounded-xl px-2.5 py-2" style={{ background: "var(--color-surface-soft)", border: "1px solid var(--color-border)" }}>
          <p className="text-[9px] font-bold uppercase text-slate-400">What ends this call</p>
          <p className="text-[10.5px] text-slate-600 leading-snug mt-0.5">{review.invalidation}</p>
        </div>

        {review.factors.length > 0 && (
          <>
            <button type="button" onClick={() => setOpen((o) => !o)} className="w-full mt-1.5 flex items-center justify-center gap-1 text-[10px] font-bold text-slate-400 py-1.5">
              {open ? "Hide the evidence" : `Why — ${review.factors.length} live checks`}
              <ChevronDown size={11} className={open ? "rotate-180 transition-transform" : "transition-transform"} />
            </button>
            {open && (
              <div className="space-y-1.5 pb-1">
                {review.factors.map((f) => (
                  <div key={f.id} className="flex items-start gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full shrink-0 mt-1.5" style={{ background: SIDE_COLOR[f.side] }} />
                    <p className="text-[10.5px] text-slate-600 leading-snug">
                      <span className="font-bold text-slate-700">{f.label}:</span> {f.detail}
                    </p>
                  </div>
                ))}
                <p className="text-[9.5px] text-slate-400 leading-relaxed pt-1">
                  Read live from this page's own 5-minute candles, option chain and trade log — no extra data is fetched for this. Time decay is the chain's current theta applied to how long you have
                  held, so it is a close estimate rather than an exact debit.
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
