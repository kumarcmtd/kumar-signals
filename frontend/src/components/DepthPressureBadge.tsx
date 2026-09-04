import { useMarketDepth } from "../api/hooks";
import { computeDepthPressure, type DepthTone } from "../utils/depthPressure";
import { Users, AlertTriangle, Scale } from "lucide-react";

const TONE: Record<DepthTone, { color: string; bg: string }> = {
  good: { color: "#16A34A", bg: "#16A34A14" },
  care: { color: "#DC2626", bg: "#DC262614" },
  neutral: { color: "#64748B", bg: "#64748B14" },
};

// A small buy/sell-pressure read from the underlying future's Level-2 book,
// phrased relative to the open call ("Care — Buyers are more" against a Put,
// "Good — Sellers are more" with it). Shown next to the price scale.
export function DepthPressureBadge({ symbol, optSide }: { symbol: "CRUDEOIL" | "NATURALGAS"; optSide: "CE" | "PE" }) {
  const { data } = useMarketDepth(symbol);
  if (!data || data.error) return null;
  const p = computeDepthPressure(data.totalBuyQuantity, data.totalSellQuantity, optSide);
  if (!p) return null;
  const t = TONE[p.tone];
  const Icon = p.tone === "care" ? AlertTriangle : p.tone === "neutral" ? Scale : Users;

  return (
    <div className="rounded-xl px-3 py-2" style={{ background: t.bg, border: `1px solid ${t.color}33` }}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12px] font-black flex items-center gap-1.5" style={{ color: t.color }}>
          <Icon size={14} className="shrink-0" />
          {p.tone === "care" ? "Care — " : p.tone === "good" ? "Good — " : ""}
          {p.headline}
        </p>
        {/* mini buy/sell split bar */}
        <div className="flex items-center gap-1 shrink-0">
          <span className="text-[10px] font-bold text-emerald-600 tabular-nums">{p.buyPct}%</span>
          <span className="inline-flex h-1.5 w-16 rounded-full overflow-hidden" style={{ background: "#DC2626" }}>
            <span style={{ width: `${p.buyPct}%`, background: "#16A34A" }} />
          </span>
          <span className="text-[10px] font-bold text-rose-500 tabular-nums">{p.sellPct}%</span>
        </div>
      </div>
      <p className="text-[10px] text-[var(--color-muted)] mt-1 leading-snug">{p.detail}</p>
    </div>
  );
}
