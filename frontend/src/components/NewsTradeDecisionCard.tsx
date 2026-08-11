import { Newspaper, LineChart, BarChart3, Droplets, Zap, TriangleAlert, CircleCheck } from "lucide-react";
import { CircularGauge } from "./CircularGauge";
import type { NewsTradeResult, CategoryReading, TradeConfirmation } from "../utils/newsTradeEngine";
import type { ExpectedMove } from "../utils/newsScoring";

const MOVE_VISUAL: Record<ExpectedMove, { label: string; color: string; emoji: string }> = {
  very_strong_bullish: { label: "Very Strong Bullish", color: "#00E676", emoji: "🟢🟢" },
  bullish: { label: "Bullish", color: "#00E676", emoji: "🟢" },
  neutral: { label: "Neutral", color: "#FFC107", emoji: "🟡" },
  bearish: { label: "Bearish", color: "#FF4D4F", emoji: "🔴" },
  very_strong_bearish: { label: "Very Strong Bearish", color: "#FF4D4F", emoji: "🔴🔴" },
};

function CategoryRow({ icon: Icon, name, reading, weightPct }: { icon: typeof Newspaper; name: string; reading: CategoryReading; weightPct: number }) {
  if (!reading.available) {
    return (
      <div className="rounded-xl p-3" style={{ background: "#12131C", border: "1px solid rgba(255,255,255,.06)" }}>
        <div className="flex items-center gap-1.5 text-[11px] font-bold text-white/40">
          <Icon size={13} /> {name} -- not available
        </div>
      </div>
    );
  }
  const pct = ((reading.net + 100) / 2).toFixed(0);
  const color = reading.net > 15 ? "#00E676" : reading.net < -15 ? "#FF4D4F" : "#FFC107";
  return (
    <div className="rounded-xl p-3" style={{ background: "#12131C", border: "1px solid rgba(255,255,255,.06)" }}>
      <div className="flex items-center justify-between mb-1.5">
        <span className="flex items-center gap-1.5 text-[11px] font-bold text-white/80">
          <Icon size={13} style={{ color }} /> {name}
        </span>
        <span className="text-[10px] font-black" style={{ color }}>
          {reading.net > 0 ? "+" : ""}
          {Math.round(reading.net)} · {weightPct}% weight
        </span>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden relative" style={{ background: "rgba(255,255,255,.08)" }}>
        <div className="absolute top-0 bottom-0 left-1/2 w-px bg-white/20" />
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${Math.abs(Number(pct) - 50) * 2}%`, marginLeft: reading.net < 0 ? `${Number(pct)}%` : "50%", background: color }}
        />
      </div>
      {reading.reasons[0] && <p className="text-[10px] text-white/40 mt-1.5 truncate">{reading.reasons[0]}</p>}
    </div>
  );
}

const CONFIRMATION_VISUAL: Record<TradeConfirmation, { color: string; bg: string; icon: typeof CircleCheck }> = {
  STRONG_CONFIRM: { color: "#00E676", bg: "rgba(0,230,118,.12)", icon: CircleCheck },
  CONFIRM: { color: "#00E676", bg: "rgba(0,230,118,.08)", icon: CircleCheck },
  WAIT_CONFLICT: { color: "#FF4D4F", bg: "rgba(255,77,79,.12)", icon: TriangleAlert },
  NEWS_SUPPORT_ONLY: { color: "#FFC107", bg: "rgba(255,193,7,.12)", icon: TriangleAlert },
  NEUTRAL: { color: "#9AA4B2", bg: "rgba(154,164,178,.1)", icon: TriangleAlert },
};

export function NewsTradeDecisionCard({ result, label }: { result: NewsTradeResult; label: string }) {
  const visual = MOVE_VISUAL[result.expectedMove];
  const gaugeValue = (result.finalNet + 100) / 2;
  const confirmVisual = CONFIRMATION_VISUAL[result.tradeConfirmation];
  const ConfirmIcon = confirmVisual.icon;

  return (
    <div className="rounded-3xl p-4" style={{ background: "#181A24", border: `1px solid ${visual.color}33`, boxShadow: `0 8px 28px ${visual.color}15` }}>
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-black text-white/90">{label}</p>
        <span className="text-[10px] font-black px-2.5 py-1 rounded-full" style={{ background: `${visual.color}22`, color: visual.color }}>
          {visual.emoji} {visual.label}
        </span>
      </div>

      <div className="flex justify-center mb-3">
        <CircularGauge value={gaugeValue} size={110} label="Net Score" sublabel={`${result.finalNet > 0 ? "+" : ""}${result.finalNet}`} trackColor="rgba(255,255,255,.08)" labelColor="#9AA4B2" />
      </div>

      <div className="rounded-xl p-3 mb-3 flex items-start gap-2" style={{ background: confirmVisual.bg, border: `1px solid ${confirmVisual.color}44` }}>
        <ConfirmIcon size={15} className="shrink-0 mt-0.5" style={{ color: confirmVisual.color }} />
        <p className="text-[11px] font-bold leading-snug" style={{ color: confirmVisual.color }}>
          {result.tradeConfirmationLabel}
        </p>
      </div>

      <div className="space-y-2">
        <CategoryRow icon={Newspaper} name="News" reading={result.news} weightPct={result.weightsUsed.news} />
        <CategoryRow icon={LineChart} name="Technical" reading={result.technical} weightPct={result.weightsUsed.technical} />
        <CategoryRow icon={Zap} name="Price Momentum" reading={result.momentum} weightPct={result.weightsUsed.momentum} />
        <CategoryRow icon={BarChart3} name="Options" reading={result.options} weightPct={result.weightsUsed.options} />
        <CategoryRow icon={Droplets} name="Liquidity" reading={result.liquidity} weightPct={result.weightsUsed.liquidity} />
      </div>
    </div>
  );
}
