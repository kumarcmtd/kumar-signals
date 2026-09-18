import { useMarketDepth, useDepthContextCandles } from "../api/hooks";
import { computeDepthPressure, type DepthTone } from "../utils/depthPressure";
import { Users, AlertTriangle, Scale, TrendingDown, TrendingUp, Minus } from "lucide-react";

const TONE: Record<DepthTone, { color: string; bg: string }> = {
  good: { color: "#16A34A", bg: "#16A34A14" },
  care: { color: "#DC2626", bg: "#DC262614" },
  neutral: { color: "#64748B", bg: "#64748B14" },
};

// A small buy/sell-pressure read from the underlying future's Level-2 book.
//
// The percentages are RESTING quantity -- orders waiting, not trades done. On
// their own they mislead: a book showing 80% buy while price falls is those
// bids being eaten by sellers, which looks like demand and is the opposite.
// So the split is always shown next to what price actually did, and when the
// two disagree the badge says so instead of showing a green "Buyers are more".
export function DepthPressureBadge({ symbol, optSide }: { symbol: "CRUDEOIL" | "NATURALGAS"; optSide: "CE" | "PE" }) {
  const { data } = useMarketDepth(symbol);
  const { data: context } = useDepthContextCandles(symbol);
  if (!data || data.error) return null;
  const p = computeDepthPressure(data.totalBuyQuantity, data.totalSellQuantity, optSide, context?.candles);
  if (!p) return null;
  const t = TONE[p.tone];
  const Icon = p.conflict ? AlertTriangle : p.tone === "care" ? AlertTriangle : p.tone === "neutral" ? Scale : Users;

  const price = p.pressure?.price;
  const priceKnown = price && price.pressure !== "unknown";
  const PriceIcon = price?.pressure === "selling" ? TrendingDown : price?.pressure === "buying" ? TrendingUp : Minus;
  const priceColor = price?.pressure === "selling" ? "#DC2626" : price?.pressure === "buying" ? "#16A34A" : "#64748B";

  return (
    <div className="rounded-xl px-3 py-2" style={{ background: t.bg, border: `1px solid ${t.color}33` }}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12px] font-black flex items-center gap-1.5 min-w-0" style={{ color: t.color }}>
          <Icon size={14} className="shrink-0" />
          <span className="truncate">
            {p.conflict ? "" : p.tone === "care" ? "Care — " : p.tone === "good" ? "Good — " : ""}
            {p.headline}
          </span>
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

      {/* What price ACTUALLY did -- the half the order book cannot show you. */}
      {priceKnown && (
        <div className="flex items-center gap-1.5 mt-1.5">
          <span
            className="text-[9.5px] font-black px-1.5 py-[2px] rounded-md inline-flex items-center gap-1"
            style={{ background: `${priceColor}18`, color: priceColor }}
          >
            <PriceIcon size={10} className="shrink-0" />
            {price!.label}
            {price!.changePct !== null && (
              <span className="tabular-nums font-bold">
                {price!.changePct >= 0 ? "+" : ""}
                {price!.changePct.toFixed(2)}%
              </span>
            )}
          </span>
          <span className="text-[9px] text-[var(--color-muted)]">last {price!.barsUsed} × 15m</span>
        </div>
      )}

      <p className="text-[10px] text-[var(--color-muted)] mt-1 leading-snug">{p.detail}</p>

      {/* The sentence that would have saved the trade. Always present. */}
      <p className="text-[9px] text-[var(--color-muted)] mt-1 leading-snug opacity-80">
        These percentages are waiting orders, not completed trades. They can be cancelled instantly and are not a buy or sell signal by themselves.
      </p>
    </div>
  );
}
