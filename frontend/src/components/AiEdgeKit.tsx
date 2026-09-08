import { CheckCircle2, AlertTriangle, XCircle, HelpCircle, TrendingUp, TrendingDown } from "lucide-react";
import { Link } from "react-router-dom";
import type { EngineEdge, EdgeVerdict, EdgeTotals } from "../utils/aiEdgeEngine";

export const VERDICT_STYLE: Record<EdgeVerdict, { color: string; label: string; Icon: typeof CheckCircle2 }> = {
  trust: { color: "#00E676", label: "TRUST", Icon: CheckCircle2 },
  watch: { color: "#FFC107", label: "WATCH", Icon: AlertTriangle },
  drop: { color: "#FF4D4F", label: "DROP", Icon: XCircle },
  insufficient: { color: "#64748B", label: "TOO FEW", Icon: HelpCircle },
};

export const rs = (n: number) => `${n < 0 ? "−" : ""}₹${Math.abs(Math.round(n)).toLocaleString("en-IN")}`;

export function EdgeSummaryCard({ totals, periodLabel }: { totals: EdgeTotals; periodLabel: string }) {
  const positive = totals.netRs >= 0;
  const color = positive ? "#00E676" : "#FF4D4F";

  return (
    <div className="rounded-2xl p-4" style={{ background: `linear-gradient(150deg, ${color}1A, #14161F 65%)`, border: `1.5px solid ${color}44` }}>
      <p className="text-[10px] font-black uppercase tracking-wide text-white/45">All engines · {periodLabel}</p>
      <div className="flex items-baseline gap-2 mt-1">
        <span className="text-3xl font-black" style={{ color }}>
          {rs(totals.netRs)}
        </span>
        {positive ? <TrendingUp size={18} style={{ color }} /> : <TrendingDown size={18} style={{ color }} />}
      </div>
      <p className="text-[10px] text-white/40 mt-0.5">across {totals.trades} closed trades, at 1 lot each</p>

      <div className="grid grid-cols-3 gap-2 mt-3">
        <MiniStat label="Profit factor" value={totals.profitFactor === null ? "—" : totals.profitFactor.toFixed(2)} />
        <MiniStat label="Per trade" value={totals.expectancyRs === null ? "—" : rs(totals.expectancyRs)} />
        <MiniStat label="Won" value={totals.winRatePct === null ? "—" : `${totals.winRatePct}%`} />
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl px-2.5 py-2" style={{ background: "rgba(255,255,255,.05)" }}>
      <p className="text-[9px] text-white/40">{label}</p>
      <p className="text-[13px] font-black text-white/90">{value}</p>
    </div>
  );
}

// The single actionable number on the page: what the losing engines have
// cost, and what the total would have been without them.
export function DropTheseCard({ totals }: { totals: EdgeTotals }) {
  if (totals.droppedCount === 0 || totals.droppedCostRs >= 0) return null;
  return (
    <div className="rounded-2xl p-3.5" style={{ background: "linear-gradient(135deg,#FF4D4F1F,#14161F 65%)", border: "1px solid #FF4D4F55" }}>
      <div className="flex items-center gap-1.5">
        <XCircle size={14} className="text-[#FF4D4F]" />
        <p className="text-[11px] font-black uppercase tracking-wide text-[#FF4D4F]">
          {totals.droppedCount} engine{totals.droppedCount > 1 ? "s" : ""} losing money
        </p>
      </div>
      <p className="text-[12.5px] text-white/85 leading-snug mt-1.5">
        They have cost you <span className="font-black text-[#FF4D4F]">{rs(totals.droppedCostRs)}</span>. Without them your engines would be at{" "}
        <span className="font-black text-[#00E676]">{rs(totals.netWithoutDroppedRs)}</span> instead of {rs(totals.netRs)}.
      </p>
      <p className="text-[10px] text-white/35 mt-1.5">Same trades, same risk — just stop taking calls from the pages marked DROP below.</p>
    </div>
  );
}

// Avg win vs avg loss, drawn to scale against each other. This is the shape
// that win-rate ranking cannot show: an engine can win most of its trades and
// still lose money if this bar leans the wrong way.
function WinLossBar({ avgWin, avgLoss }: { avgWin: number | null; avgLoss: number | null }) {
  if (avgWin === null && avgLoss === null) return null;
  const w = avgWin ?? 0;
  const l = avgLoss ?? 0;
  const max = Math.max(w, l, 1);
  return (
    <div className="mt-2 space-y-1">
      <div className="flex items-center gap-2">
        <span className="text-[9px] text-white/35 w-14 shrink-0">Avg win</span>
        <div className="flex-1 h-2 rounded-full bg-white/6 overflow-hidden">
          <div className="h-full rounded-full bg-[#00E676]" style={{ width: `${(w / max) * 100}%` }} />
        </div>
        <span className="text-[10px] font-bold text-[#00E676] w-16 text-right shrink-0">{avgWin === null ? "—" : rs(w)}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[9px] text-white/35 w-14 shrink-0">Avg loss</span>
        <div className="flex-1 h-2 rounded-full bg-white/6 overflow-hidden">
          <div className="h-full rounded-full bg-[#FF4D4F]" style={{ width: `${(l / max) * 100}%` }} />
        </div>
        <span className="text-[10px] font-bold text-[#FF4D4F] w-16 text-right shrink-0">{avgLoss === null ? "—" : rs(l)}</span>
      </div>
    </div>
  );
}

export function EngineEdgeRow({ edge, rank }: { edge: EngineEdge; rank: number | null }) {
  const v = VERDICT_STYLE[edge.verdict];
  const { Icon } = v;
  const netColor = edge.netRs > 0 ? "#00E676" : edge.netRs < 0 ? "#FF4D4F" : "#94A3B8";
  const empty = edge.trades === 0;

  return (
    <Link
      to={edge.route}
      className="block rounded-2xl p-3.5 transition-transform active:scale-[.99]"
      style={{ background: "#14161F", border: `1px solid ${empty ? "rgba(255,255,255,.06)" : `${v.color}44`}`, opacity: empty ? 0.55 : 1 }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {rank !== null && <span className="text-[11px] font-black text-white/25 shrink-0">#{rank}</span>}
          <p className="text-[13px] font-black text-white/90 truncate">{edge.label}</p>
        </div>
        <span className="flex items-center gap-1 text-[9px] font-black px-1.5 py-0.5 rounded shrink-0" style={{ background: `${v.color}1F`, color: v.color }}>
          <Icon size={10} strokeWidth={2.8} />
          {v.label}
        </span>
      </div>

      {empty ? (
        <p className="text-[11px] text-white/35 mt-1.5">{edge.verdictReason}</p>
      ) : (
        <>
          <div className="flex items-baseline gap-2 mt-1">
            <span className="text-xl font-black" style={{ color: netColor }}>
              {rs(edge.netRs)}
            </span>
            <span className="text-[10px] text-white/35">
              {edge.trades} trades · {edge.winRatePct === null ? "—" : `${edge.winRatePct}% won`} · PF {edge.profitFactor === null ? "—" : edge.profitFactor.toFixed(2)}
            </span>
          </div>

          <WinLossBar avgWin={edge.avgWinRs} avgLoss={edge.avgLossRs} />

          <div className="flex items-center justify-between gap-2 mt-2">
            <p className="text-[10px] leading-snug" style={{ color: v.color }}>
              {edge.verdictReason}
            </p>
            {edge.expectancyRs !== null && (
              <span className="text-[10px] font-bold text-white/45 shrink-0">
                {rs(edge.expectancyRs)}/trade
              </span>
            )}
          </div>
        </>
      )}
    </Link>
  );
}
