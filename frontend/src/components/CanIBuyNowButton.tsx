import { useState } from "react";
import { ShieldQuestion, CheckCircle2, XCircle, AlertTriangle, X } from "lucide-react";
import { canIBuyNow, type BuyCheckInput, type BuyVerdict } from "../utils/canIBuyNow";

const VERDICT: Record<BuyVerdict, { ink: string; bg: string; border: string; chip: string }> = {
  yes: { ink: "#15803D", bg: "linear-gradient(135deg,#DCFCE7,#F0FDF4)", border: "#86EFAC", chip: "#16A34A" },
  wait: { ink: "#B45309", bg: "linear-gradient(135deg,#FEF3C7,#FFFBEB)", border: "#FCD34D", chip: "#D97706" },
  no: { ink: "#B91C1C", bg: "linear-gradient(135deg,#FEE2E2,#FEF2F2)", border: "#FCA5A5", chip: "#DC2626" },
};

/**
 * One button, one answer.
 *
 * The cards already carried a green "Buy Now" badge next to a red conflict
 * warning, with nothing reconciling the two -- and the green badge was driven
 * mostly by how far through the leg price had moved, which on a fresh signal is
 * always "0%, most of the move is ahead". That is not a check, and it read as
 * permission.
 *
 * This asks every gate at once and is allowed to answer NO. When it answers
 * YES it prints the entry, target and stop AT THE LIVE PRICE, with the rupees
 * at risk per lot, and it never uses the word "safe".
 */
export function CanIBuyNowButton(props: BuyCheckInput & { lots?: number }) {
  const [open, setOpen] = useState(false);
  const answer = canIBuyNow(props);
  const v = VERDICT[answer.verdict];
  const lots = props.lots ?? 1;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded-xl py-2.5 px-3 flex items-center justify-center gap-2 text-[12.5px] font-black active:opacity-80"
        style={{ background: v.chip, color: "#fff", boxShadow: `0 4px 14px ${v.chip}44` }}
      >
        <ShieldQuestion size={15} className="shrink-0" />
        Can I Buy Now?
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end" role="dialog" aria-modal="true" aria-label="Can I buy now">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <div className="relative w-full max-w-lg mx-auto max-h-[88vh] overflow-y-auto rounded-t-2xl bg-white motion-safe:animate-[slideUp_.2s_cubic-bezier(.34,1.4,.64,1)]">
            <div className="sticky top-0 bg-white px-4 py-3 border-b border-slate-100 flex items-center justify-between">
              <p className="text-[13px] font-black text-slate-800">Can I Buy Now?</p>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="p-1 rounded-lg text-slate-400">
                <X size={18} />
              </button>
            </div>

            <div className="p-3 space-y-3 pb-[max(16px,env(safe-area-inset-bottom))]">
              <div className="rounded-2xl p-3.5 border" style={{ background: v.bg, borderColor: v.border }}>
                <p className="text-[15px] font-black leading-tight" style={{ color: v.ink }}>{answer.headline}</p>
                <p className="text-[11px] text-slate-700 leading-snug mt-1.5">{answer.reason}</p>
              </div>

              {/* The numbers, recalculated at the live price rather than the
                  price the signal was created at. */}
              {answer.plan && (
                <div>
                  <p className="text-[10px] font-black uppercase text-slate-400 mb-1">
                    {answer.verdict === "yes" ? "Your entry, at this price" : "If you took it anyway"}
                  </p>

                  {/* The late-entry story. The usual case for someone who was
                      at work when the call fired: part of the move is gone,
                      and what matters is what is left, not the original trade. */}
                  {answer.plan.late && (
                    <div className="rounded-xl px-2.5 py-2 mb-1.5" style={{ background: "#F1F5F9", border: "1px solid #E2E8F0" }}>
                      <p className="text-[10px] text-slate-600 leading-snug">
                        You are entering late. ₹{(answer.plan.missedPerLot * lots).toLocaleString("en-IN")} of this move already happened before you looked — that part is gone and is not
                        counted below. These numbers are only for what is still ahead, aiming at <b>Target {answer.plan.targetNumber}</b>.
                      </p>
                      {answer.plan.stopMovedUp && (
                        <p className="text-[9.5px] text-slate-500 leading-snug mt-1">
                          The stop shown is <b>not</b> the original one. Entering here with the original stop would mean risking the whole move that already happened to chase what is
                          left, so it has been moved up to sit just under today's price.
                        </p>
                      )}
                    </div>
                  )}
                  <div className="grid grid-cols-3 gap-1.5">
                    {[
                      { label: "Buy at", value: `₹${answer.plan.entry.toFixed(2)}`, ink: "#334155" },
                      { label: "Target", value: `₹${answer.plan.target.toFixed(2)}`, ink: "#15803D" },
                      { label: "Stop loss", value: `₹${answer.plan.stop.toFixed(2)}`, ink: "#B91C1C" },
                    ].map((c) => (
                      <div key={c.label} className="rounded-xl bg-white border border-[var(--color-border)] px-2 py-2 text-center">
                        <p className="text-[8.5px] font-bold uppercase text-slate-400">{c.label}</p>
                        <p className="text-[13px] font-black leading-tight" style={{ color: c.ink }}>{c.value}</p>
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-3 gap-1.5 mt-1.5">
                    <div className="rounded-xl bg-rose-50 border border-rose-100 px-2 py-2 text-center">
                      <p className="text-[8.5px] font-bold uppercase text-rose-400">You risk</p>
                      <p className="text-[13px] font-black text-rose-700">₹{(answer.plan.riskPerLot * lots).toLocaleString("en-IN")}</p>
                    </div>
                    <div className="rounded-xl bg-emerald-50 border border-emerald-100 px-2 py-2 text-center">
                      <p className="text-[8.5px] font-bold uppercase text-emerald-500">You make</p>
                      <p className="text-[13px] font-black text-emerald-700">₹{(answer.plan.rewardPerLot * lots).toLocaleString("en-IN")}</p>
                    </div>
                    <div className="rounded-xl bg-slate-50 border border-slate-100 px-2 py-2 text-center">
                      <p className="text-[8.5px] font-bold uppercase text-slate-400">Ratio</p>
                      <p className="text-[13px] font-black text-slate-700">{answer.plan.riskReward}:1</p>
                    </div>
                  </div>
                  <p className="text-[9px] text-slate-400 mt-1">
                    Figures are for {lots} lot{lots > 1 ? "s" : ""} and assume you actually use the stop.
                  </p>
                </div>
              )}

              {answer.blockers.length > 0 && (
                <div className="rounded-2xl px-3 py-2.5" style={{ background: "#FFFBEB", border: "1px solid #FDE68A" }}>
                  <p className="text-[10.5px] font-black text-amber-800 mb-1">What's against it</p>
                  {answer.blockers.map((b) => (
                    <p key={b} className="text-[10px] text-slate-700 leading-snug flex gap-1.5 mt-1">
                      <AlertTriangle size={10} className="shrink-0 mt-[2px] text-amber-600" />
                      {b}
                    </p>
                  ))}
                </div>
              )}

              {/* Every check, so the answer can be argued with rather than
                  just trusted. */}
              <div>
                <p className="text-[10px] font-black uppercase text-slate-400 mb-1">Every check</p>
                <div className="rounded-2xl bg-white border border-[var(--color-border)] overflow-hidden">
                  {answer.gates.map((g) => (
                    <div key={g.name} className="px-3 py-2 border-b last:border-b-0 border-slate-100 flex items-start gap-1.5">
                      {g.passed ? (
                        <CheckCircle2 size={12} className="shrink-0 mt-[2px] text-emerald-600" />
                      ) : (
                        <XCircle size={12} className="shrink-0 mt-[2px]" style={{ color: g.blocking ? "#DC2626" : "#D97706" }} />
                      )}
                      <div className="min-w-0">
                        <p className="text-[10.5px] font-bold text-slate-700">
                          {g.name}
                          {!g.passed && !g.blocking && <span className="text-[8.5px] font-normal text-amber-600"> · warning only</span>}
                        </p>
                        <p className="text-[9.5px] text-slate-500 leading-snug">{g.detail}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {answer.riskNote && (
                <p className="text-[10px] leading-snug px-1 font-bold" style={{ color: "#B45309" }}>{answer.riskNote}</p>
              )}

              <p className="text-[9px] text-slate-400 leading-relaxed px-1">
                This checks whether the entry is still valid right now. It cannot tell you the trade will work — no tool can. Options can lose their whole value, and this app's
                own backtest currently rates these signals close to a coin flip, so treat every answer as one input to your decision rather than the decision.
              </p>
            </div>
          </div>
          <style>{`@keyframes slideUp{from{transform:translateY(100%)}to{transform:translateY(0)}}`}</style>
        </div>
      )}
    </>
  );
}
