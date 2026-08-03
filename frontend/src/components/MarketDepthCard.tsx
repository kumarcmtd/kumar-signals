import { BarChart3, CheckCircle2, AlertTriangle } from "lucide-react";
import type { MarketDepthResult, DepthTier } from "../utils/marketDepthAnalysis";
import type { MarketDepthSnapshot } from "../types";

const TIER_VISUAL: Record<DepthTier, { emoji: string; color: string; bg: string; label: string }> = {
  bullish: { emoji: "🟢", color: "#15803D", bg: "linear-gradient(135deg,#DCFCE7,#F0FDF4)", label: "Bullish" },
  neutral: { emoji: "🟡", color: "#B45309", bg: "linear-gradient(135deg,#FEF3C7,#FFFBEB)", label: "Neutral" },
  bearish: { emoji: "🔴", color: "#B91C1C", bg: "linear-gradient(135deg,#FEE2E2,#FEF2F2)", label: "Bearish" },
};

function PressureBar({ buyPct, sellPct }: { buyPct: number; sellPct: number }) {
  return (
    <div>
      <div className="flex justify-between text-[10px] font-bold mb-1">
        <span style={{ color: "#15803D" }}>Buy {buyPct}%</span>
        <span style={{ color: "#B91C1C" }}>Sell {sellPct}%</span>
      </div>
      <div className="h-2.5 rounded-full overflow-hidden flex" style={{ background: "rgba(0,0,0,.06)" }}>
        <div className="h-full transition-all duration-700" style={{ width: `${buyPct}%`, background: "linear-gradient(90deg,#16A34A,#4ADE80)" }} />
        <div className="h-full transition-all duration-700" style={{ width: `${sellPct}%`, background: "linear-gradient(90deg,#F87171,#DC2626)" }} />
      </div>
    </div>
  );
}

function ImbalanceGauge({ imbalance }: { imbalance: number }) {
  const pct = ((imbalance + 1) / 2) * 100;
  const label = imbalance >= 0.5 ? "Strong Bullish" : imbalance >= 0.15 ? "Bullish" : imbalance > -0.15 ? "Neutral" : imbalance > -0.5 ? "Bearish" : "Strong Bearish";
  const color = imbalance >= 0.15 ? "#15803D" : imbalance <= -0.15 ? "#B91C1C" : "#B45309";
  return (
    <div>
      <div className="flex justify-between text-[10px] font-bold mb-1">
        <span className="text-[var(--color-muted)]">Order Book Imbalance</span>
        <span style={{ color }}>
          {imbalance >= 0 ? "+" : ""}
          {imbalance} · {label}
        </span>
      </div>
      <div className="relative h-2.5 rounded-full overflow-hidden" style={{ background: "linear-gradient(90deg,#FEE2E2,#FEF3C7,#DCFCE7)" }}>
        <div className="absolute top-0 h-full w-1 bg-black/60 rounded-full" style={{ left: `${pct}%`, transform: "translateX(-50%)", transition: "left 700ms ease-out" }} />
      </div>
    </div>
  );
}

export function MarketDepthCard({ depth, snapshot }: { depth: MarketDepthResult | null; snapshot?: MarketDepthSnapshot }) {
  if (!depth) {
    return (
      <div className="rounded-2xl p-4 border" style={{ background: "rgba(255,255,255,.6)", backdropFilter: "blur(12px)", borderColor: "var(--color-border)" }}>
        <p className="text-xs font-bold uppercase text-[var(--color-muted)] mb-2 flex items-center gap-1.5">
          <BarChart3 size={12} />
          Market Depth &amp; Smart Money Analysis
        </p>
        <p className="text-xs text-[var(--color-muted)]">
          {snapshot?.error ?? "Order book depth isn't available for this instrument right now -- either this account doesn't have Level 2 entitlement for MCX, or there isn't enough data yet."}
        </p>
      </div>
    );
  }

  const visual = TIER_VISUAL[depth.tier];

  return (
    <div
      className="rounded-2xl p-4 border overflow-hidden"
      style={{ background: `${visual.bg}`, backdropFilter: "blur(12px)", borderColor: `${visual.color}33`, boxShadow: `0 8px 24px ${visual.color}22` }}
    >
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-black uppercase flex items-center gap-1.5" style={{ color: visual.color }}>
          <BarChart3 size={13} />
          Market Depth &amp; Smart Money
        </p>
        <span className="text-[11px] font-black px-2 py-0.5 rounded-full" style={{ background: visual.color, color: "#fff" }}>
          {visual.emoji} {visual.label}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-3">
        <div className="rounded-xl px-2 py-2 text-center" style={{ background: "rgba(255,255,255,.65)" }}>
          <p className="text-[8px] text-[var(--color-muted)] uppercase">Confidence</p>
          <p className="text-sm font-black" style={{ color: visual.color }}>
            {depth.confidencePct}%
          </p>
        </div>
        <div className="rounded-xl px-2 py-2 text-center" style={{ background: "rgba(255,255,255,.65)" }}>
          <p className="text-[8px] text-[var(--color-muted)] uppercase">Depth Score</p>
          <p className="text-sm font-black" style={{ color: visual.color }}>
            {depth.depthScore}/10
          </p>
        </div>
        <div className="rounded-xl px-2 py-2 text-center" style={{ background: "rgba(255,255,255,.65)" }}>
          <p className="text-[8px] text-[var(--color-muted)] uppercase">Updated</p>
          <p className="text-sm font-black" style={{ color: visual.color }}>
            Live
          </p>
        </div>
      </div>

      {depth.bestBid !== null && depth.bestAsk !== null && (
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div className="rounded-xl px-2.5 py-2" style={{ background: "rgba(255,255,255,.65)" }}>
            <p className="text-[8px] text-[var(--color-muted)] uppercase">Best Bid</p>
            <p className="text-xs font-bold" style={{ color: "#15803D" }}>
              ₹{depth.bestBid.toFixed(2)}
            </p>
          </div>
          <div className="rounded-xl px-2.5 py-2" style={{ background: "rgba(255,255,255,.65)" }}>
            <p className="text-[8px] text-[var(--color-muted)] uppercase">Best Ask</p>
            <p className="text-xs font-bold" style={{ color: "#B91C1C" }}>
              ₹{depth.bestAsk.toFixed(2)}
            </p>
          </div>
        </div>
      )}

      <div className="space-y-2.5 rounded-xl p-3 mb-3" style={{ background: "rgba(255,255,255,.5)" }}>
        <PressureBar buyPct={depth.buyPct} sellPct={depth.sellPct} />
        <ImbalanceGauge imbalance={depth.imbalance} />
        {depth.spreadPct !== null && (
          <div className="flex justify-between text-[10px]">
            <span className="text-[var(--color-muted)]">Spread</span>
            <span className="font-bold">{depth.spreadPct.toFixed(2)}%</span>
          </div>
        )}
        <div className="flex justify-between text-[10px]">
          <span className="text-[var(--color-muted)]">Liquidity Score</span>
          <span className="font-bold">{depth.liquidityScore}/10</span>
        </div>
        {depth.volumeRatio !== null && (
          <div className="flex justify-between text-[10px]">
            <span className="text-[var(--color-muted)]">Volume Ratio</span>
            <span className="font-bold">{depth.volumeRatio.toFixed(2)}x average</span>
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        <p className="text-[9px] font-bold uppercase text-[var(--color-muted)]">Smart Money Detection</p>
        {depth.smartMoney.map((flag) => (
          <div key={flag.key} className="flex items-start gap-1.5 text-[10.5px]" style={{ color: flag.kind === "positive" ? "#15803D" : "#B45309" }}>
            {flag.kind === "positive" ? <CheckCircle2 size={12} className="shrink-0 mt-0.5" /> : <AlertTriangle size={12} className="shrink-0 mt-0.5" />}
            <span>{flag.label}</span>
          </div>
        ))}
        <p className="text-[9px] text-[var(--color-muted)] pt-1 opacity-80">
          Wall/spoofing/order-pulling reads are heuristic (based on a snapshot comparison), not confirmed detection.
        </p>
      </div>
    </div>
  );
}
