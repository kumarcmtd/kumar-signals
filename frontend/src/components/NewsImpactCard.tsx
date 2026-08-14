import { Newspaper } from "lucide-react";
import { useNewsTradeAI } from "../hooks/useNewsTradeAI";
import type { NewsTradeSymbol, TradeConfirmation } from "../utils/newsTradeEngine";
import type { ExpectedMove } from "../utils/newsScoring";

// A compact, light-themed cross-link to the News Based Trade AI page's own
// weighted decision (Technicals 35% / Options 20% / Momentum 15% / News
// 20% / Liquidity 10%) -- built so someone looking at a Best Call/Ai20-20/
// Level Cross card doesn't have to tab over to a separate dark-themed page
// just to sanity-check whether the news backs or fights this specific
// call. Self-contained: calls useNewsTradeAI(symbol) itself (the same
// engine the News page uses), so every number here is identical to what
// that page would show for the same symbol at the same moment -- never a
// second, drifting copy of the calculation.

const MOVE_VISUAL: Record<ExpectedMove, { label: string; color: string; emoji: string }> = {
  very_strong_bullish: { label: "Very Strong Bullish", color: "#16A34A", emoji: "🟢🟢" },
  bullish: { label: "Bullish", color: "#16A34A", emoji: "🟢" },
  neutral: { label: "Neutral", color: "#CA8A04", emoji: "🟡" },
  bearish: { label: "Bearish", color: "#DC2626", emoji: "🔴" },
  very_strong_bearish: { label: "Very Strong Bearish", color: "#DC2626", emoji: "🔴🔴" },
};

const CONFIRM_COLOR: Record<TradeConfirmation, string> = {
  STRONG_CONFIRM: "#16A34A",
  CONFIRM: "#16A34A",
  WAIT_CONFLICT: "#DC2626",
  NEWS_SUPPORT_ONLY: "#CA8A04",
  NEUTRAL: "#94A3B8",
};

export function NewsImpactCard({ symbol }: { symbol: NewsTradeSymbol }) {
  const { result } = useNewsTradeAI(symbol);

  if (!result || (!result.news.available && !result.technical.available && !result.options.available)) {
    return (
      <div className="rounded-2xl p-3 bg-slate-50 border border-slate-100 text-center">
        <p className="text-[10px] text-slate-400">Gathering news + market data for a combined score…</p>
      </div>
    );
  }

  const visual = MOVE_VISUAL[result.expectedMove];
  const confirmColor = CONFIRM_COLOR[result.tradeConfirmation];
  const newsDir = result.newsSignal.newsDirection;
  const newsColor = newsDir === "bullish" ? "#16A34A" : newsDir === "bearish" ? "#DC2626" : "#CA8A04";
  const newsEmoji = newsDir === "bullish" ? "🟢" : newsDir === "bearish" ? "🔴" : "🟡";

  return (
    <div className="rounded-2xl p-3.5" style={{ background: `${visual.color}0D`, border: `1px solid ${visual.color}33` }}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-bold uppercase text-slate-500 flex items-center gap-1.5">
          <Newspaper size={12} /> News + Market Score
        </p>
        <span className="text-[11px] font-black whitespace-nowrap" style={{ color: visual.color }}>
          {visual.emoji} {visual.label}
        </span>
      </div>

      <div className="flex items-baseline gap-1.5 mt-1">
        <span className="text-2xl font-black leading-none" style={{ color: visual.color }}>
          {result.finalNet > 0 ? "+" : ""}
          {result.finalNet}
        </span>
        <span className="text-[10px] text-slate-400">net score</span>
      </div>

      <p className="text-[11px] font-bold mt-1.5 leading-snug" style={{ color: confirmColor }}>
        {result.tradeConfirmationLabel}
      </p>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-2 text-[10px]">
        <span className="font-bold whitespace-nowrap" style={{ color: newsColor }}>
          News {newsEmoji} {result.newsSignal.newsScore > 0 ? "+" : ""}
          {result.newsSignal.newsScore}
        </span>
        <span className="text-slate-400">
          · {result.weightsUsed.news}% weight · {result.newsSignal.newsConfidence}% confidence
        </span>
      </div>
    </div>
  );
}
