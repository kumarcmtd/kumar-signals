import { useState } from "react";
import { ClipboardCheck, TrendingUp, TrendingDown, RefreshCcw } from "lucide-react";
import type { TradableSymbol } from "../hooks/useBestCall";
import { useStrategyVerification } from "../hooks/useStrategyVerification";
import { StrategyCard } from "../components/StrategyCard";
import type { OverallTier } from "../utils/strategyVerification";

const SYMBOLS: TradableSymbol[] = ["CRUDEOIL", "NATURALGAS"];
const DISPLAY_NAME: Record<TradableSymbol, string> = { CRUDEOIL: "Crude Oil", NATURALGAS: "Natural Gas" };

const TIER_VISUAL: Record<OverallTier, { ring: string; label: string; emoji: string; recBg: string; recText: string; recLabel: string }> = {
  strong: { ring: "#16A34A", label: "VERIFIED", emoji: "🟢", recBg: "#DCFCE7", recText: "#15803D", recLabel: "BUY NOW" },
  good: { ring: "#16A34A", label: "VERIFIED", emoji: "🟢", recBg: "#DCFCE7", recText: "#15803D", recLabel: "BUY NOW" },
  wait: { ring: "#D97706", label: "WAIT", emoji: "🟡", recBg: "#FEF3C7", recText: "#B45309", recLabel: "WAIT FOR CONFIRMATION" },
  avoid: { ring: "#DC2626", label: "REJECTED", emoji: "🔴", recBg: "#FEE2E2", recText: "#B91C1C", recLabel: "AVOID TRADE" },
};

const DECISION_LABEL: Record<OverallTier, string> = {
  strong: "STRONG",
  good: "GOOD",
  wait: "WAIT",
  avoid: "AVOID TRADE",
};

function VerificationRing({ scorePct, tier }: { scorePct: number; tier: OverallTier }) {
  const size = 176;
  const stroke = 14;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - scorePct / 100);
  const visual = TIER_VISUAL[tier];

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={radius} stroke="var(--color-border)" strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={visual.ring}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: "stroke-dashoffset 700ms ease-out", filter: `drop-shadow(0 0 10px ${visual.ring}66)` }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl leading-none">{visual.emoji}</span>
        <span className="text-sm font-black mt-1" style={{ color: visual.ring }}>
          {visual.label}
        </span>
        <span className="text-2xl font-black mt-1">{scorePct}%</span>
        <span className="text-[9px] text-[var(--color-muted)] uppercase tracking-wide">Institutional Score</span>
      </div>
    </div>
  );
}

function SymbolBody({ symbol }: { symbol: TradableSymbol }) {
  const { latest, livePremium, underlyingPrice, candlesLoading, candlesError, result } = useStrategyVerification(symbol);

  if (candlesError) {
    return (
      <div className="card p-6 text-center">
        <p className="text-sm font-bold text-[var(--color-sell)]">Live data unavailable</p>
        <p className="text-xs text-[var(--color-muted)] mt-1">{candlesError}</p>
      </div>
    );
  }

  if (!latest) {
    return (
      <div className="card p-6 text-center space-y-1.5">
        <ClipboardCheck size={28} className="mx-auto text-[var(--color-muted)]" />
        <p className="text-sm font-bold">No active Best Call to verify right now</p>
        <p className="text-xs text-[var(--color-muted)] px-2">
          This page automatically verifies whichever call is currently live on Best Call for {DISPLAY_NAME[symbol]}. Nothing is running right now -- check back once one fires.
        </p>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="card p-6 text-center">
        <p className="text-sm font-bold">{candlesLoading ? "Loading market data…" : "Gathering enough candles to verify this call…"}</p>
      </div>
    );
  }

  const Bias = latest.optSide === "CE" ? TrendingUp : TrendingDown;
  const biasColor = latest.optSide === "CE" ? "var(--color-buy)" : "var(--color-sell)";
  const visual = TIER_VISUAL[result.finalTier];

  return (
    <div className="space-y-4 pb-24">
      <div className="card p-4">
        <div className="flex items-center justify-between gap-2 mb-3">
          <p className="text-sm font-black flex items-center gap-1.5">
            <Bias size={16} style={{ color: biasColor }} />
            {DISPLAY_NAME[symbol]} {latest.strike} {latest.optSide}
          </p>
          {livePremium !== null && (
            <p className="text-sm font-black" style={{ color: biasColor }}>
              ₹{livePremium}
            </p>
          )}
        </div>
        <div className="grid grid-cols-3 gap-2 text-center mb-4">
          <MiniStat label="Underlying" value={underlyingPrice !== null ? `₹${underlyingPrice.toFixed(2)}` : "—"} />
          <MiniStat label="Entry" value={`₹${latest.entry}`} />
          <MiniStat label="Overall Confidence" value={`${result.weightedScorePct}%`} />
        </div>
        <div className="flex justify-center">
          <VerificationRing scorePct={result.weightedScorePct} tier={result.finalTier} />
        </div>
        {result.overrideReasons.length > 0 && (
          <div className="mt-3 rounded-xl px-3 py-2.5" style={{ background: "var(--color-surface-soft)", border: "1px solid var(--color-border)" }}>
            <p className="text-[10px] font-bold uppercase text-[var(--color-muted)] mb-1">Why the decision was capped</p>
            {result.overrideReasons.map((r, i) => (
              <p key={i} className="text-[11px] text-[var(--color-muted)]">
                • {r}
              </p>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-2.5">
        <p className="text-xs font-bold uppercase text-[var(--color-muted)] px-1 flex items-center gap-1.5">
          <ClipboardCheck size={12} />
          Strategy Checklist
        </p>
        {result.strategies.map((s) => (
          <StrategyCard key={s.key} strategy={s} />
        ))}
      </div>

      <div className="card p-4">
        <p className="text-xs font-bold mb-2">Overall AI Decision</p>
        <div className="flex items-center justify-between">
          <span className="text-sm font-black" style={{ color: visual.ring }}>
            {latest.optSide === "CE" ? "BUY" : "SELL"} · {DECISION_LABEL[result.finalTier]}
          </span>
          <span className="text-sm font-black" style={{ color: visual.ring }}>
            {result.weightedScorePct}/100
          </span>
        </div>
      </div>

      <div
        className="fixed bottom-16 left-0 right-0 z-20 px-4"
        style={{ maxWidth: "inherit" }}
      >
        <div className="max-w-lg mx-auto rounded-2xl px-4 py-3 flex items-center justify-between shadow-lg" style={{ background: visual.recBg, border: `1px solid ${visual.ring}55` }}>
          <div>
            <p className="text-[9px] font-bold uppercase tracking-wide" style={{ color: visual.recText, opacity: 0.75 }}>
              Overall Recommendation
            </p>
            <p className="text-sm font-black" style={{ color: visual.recText }}>
              {visual.emoji} {visual.recLabel}
            </p>
          </div>
          <span className="text-lg font-black" style={{ color: visual.recText }}>
            {result.weightedScorePct}%
          </span>
        </div>
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl px-2 py-2" style={{ background: "var(--color-surface-soft)", border: "1px solid var(--color-border)" }}>
      <p className="text-[8px] text-[var(--color-muted)] uppercase">{label}</p>
      <p className="text-[11px] font-bold mt-0.5">{value}</p>
    </div>
  );
}

export function AiStrategyVerification() {
  const [symbol, setSymbol] = useState<TradableSymbol>("NATURALGAS");

  return (
    <div className="space-y-4">
      <div
        className="rounded-2xl p-4 text-white"
        style={{ background: "linear-gradient(135deg,#4338CA,#7C3AED 55%,#DB2777)", boxShadow: "0 8px 24px rgba(124,58,237,.25)" }}
      >
        <p className="text-xl font-black flex items-center gap-2">
          <ClipboardCheck size={20} />
          AI Strategy Verification
        </p>
        <p className="text-xs text-white/80 mt-0.5 flex items-center gap-1.5">
          <RefreshCcw size={11} className="animate-spin" style={{ animationDuration: "3s" }} />
          Auto-verifies the live Best Call against 12 institutional-grade checks every 5 seconds
        </p>
      </div>

      <div className="flex gap-2">
        {SYMBOLS.map((s) => (
          <button
            key={s}
            onClick={() => setSymbol(s)}
            className="flex-1 rounded-xl py-2.5 text-sm font-bold border transition-colors"
            style={
              symbol === s
                ? { background: "linear-gradient(135deg,#4338CA,#7C3AED)", color: "#fff", borderColor: "transparent" }
                : { background: "var(--color-surface)", borderColor: "var(--color-border)", color: "var(--color-muted)" }
            }
          >
            {DISPLAY_NAME[s]}
          </button>
        ))}
      </div>

      <SymbolBody symbol={symbol} />

      <p className="text-[10px] text-[var(--color-muted)] leading-relaxed text-center px-4 pb-2">
        Educational reference only, not financial advice. This re-checks Best Call's own live pick against 12 independently-weighted
        technical strategies -- always confirm on the live chart before acting.
      </p>
    </div>
  );
}
