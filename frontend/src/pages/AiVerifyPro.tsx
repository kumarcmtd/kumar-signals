import { useState } from "react";
import { ChevronDown, ShieldCheck, TrendingUp, TrendingDown } from "lucide-react";
import type { TradableSymbol } from "../hooks/useBestCall";
import { useVerifyPro } from "../hooks/useVerifyPro";
import { VerifyProDecisionCard } from "../components/VerifyProDecisionCard";
import { VerifyProThinkingPanel } from "../components/VerifyProThinkingPanel";
import { VerifyProConfidenceBreakdown } from "../components/VerifyProConfidenceBreakdown";
import { VerifyProTrackRecordCard } from "../components/VerifyProTrackRecordCard";
import { StrategyCard } from "../components/StrategyCard";

const SYMBOLS: TradableSymbol[] = ["CRUDEOIL", "NATURALGAS"];
const DISPLAY_NAME: Record<TradableSymbol, string> = { CRUDEOIL: "Crude Oil", NATURALGAS: "Natural Gas" };

function SymbolBody({ symbol }: { symbol: TradableSymbol }) {
  const { latest, underlyingPrice, candlesLoading, candlesError, result, trackRecord } = useVerifyPro(symbol);
  const [showChecklist, setShowChecklist] = useState(false);

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
        <ShieldCheck size={28} className="mx-auto text-[var(--color-muted)]" />
        <p className="text-sm font-bold">No active Best Call to approve right now</p>
        <p className="text-xs text-[var(--color-muted)] px-2">
          AI Verify Pro only ever reviews a call Best Call already generated for {DISPLAY_NAME[symbol]} -- it never creates its own signal. Nothing is running right now.
        </p>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="card p-6 text-center">
        <p className="text-sm font-bold">{candlesLoading ? "Loading market data…" : "Gathering enough candles to run final approval…"}</p>
      </div>
    );
  }

  const Bias = latest.optSide === "CE" ? TrendingUp : TrendingDown;
  const biasColor = latest.optSide === "CE" ? "var(--color-buy)" : "var(--color-sell)";

  return (
    <div className="space-y-4 pb-6">
      <div className="card p-3.5 flex items-center justify-between">
        <p className="text-sm font-black flex items-center gap-1.5">
          <Bias size={16} style={{ color: biasColor }} />
          {DISPLAY_NAME[symbol]} {latest.strike} {latest.optSide}
        </p>
        {underlyingPrice !== null && (
          <p className="text-xs font-bold text-[var(--color-muted)]">
            Underlying ₹{underlyingPrice.toFixed(2)}
          </p>
        )}
      </div>

      <VerifyProDecisionCard result={result} label={`${DISPLAY_NAME[symbol]} ${latest.strike} ${latest.optSide}`} entry={latest.entry} />

      <VerifyProThinkingPanel steps={result.thinkingSteps} />

      <button onClick={() => setShowChecklist((v) => !v)} className="card p-4 w-full flex items-center justify-between">
        <p className="text-xs font-black uppercase text-[var(--color-muted)]">View Full Analysis ({result.checks.length} checks)</p>
        <ChevronDown size={16} className={`text-[var(--color-muted)] transition-transform ${showChecklist ? "rotate-180" : ""}`} />
      </button>

      {showChecklist && (
        <div className="space-y-4">
          <VerifyProConfidenceBreakdown categories={result.categoryScores} />
          <div className="space-y-2.5">
            {result.checks.map((s) => (
              <StrategyCard key={s.key} strategy={s} />
            ))}
          </div>
          <p className="text-[10px] text-[var(--color-muted)] px-1">{result.newsRiskNote}</p>
        </div>
      )}

      <VerifyProTrackRecordCard track={trackRecord} />
    </div>
  );
}

export function AiVerifyPro() {
  const [symbol, setSymbol] = useState<TradableSymbol>("NATURALGAS");

  return (
    <div className="space-y-4">
      <div
        className="rounded-2xl p-4 text-white"
        style={{ background: "linear-gradient(135deg,#0F172A,#1E3A5F 55%,#0F172A)", boxShadow: "0 8px 24px rgba(15,23,42,.35)" }}
      >
        <p className="text-xl font-black flex items-center gap-2">
          <ShieldCheck size={20} />
          AI Verify Pro
        </p>
        <p className="text-xs text-white/70 mt-0.5">Final approval engine -- reviews every Best Call before it's tradeable. One decision, in under 5 seconds.</p>
      </div>

      <div className="flex gap-2">
        {SYMBOLS.map((s) => (
          <button
            key={s}
            onClick={() => setSymbol(s)}
            className="flex-1 rounded-xl py-2.5 text-sm font-bold border transition-colors"
            style={
              symbol === s
                ? { background: "linear-gradient(135deg,#0F172A,#1E3A5F)", color: "#fff", borderColor: "transparent" }
                : { background: "var(--color-surface)", borderColor: "var(--color-border)", color: "var(--color-muted)" }
            }
          >
            {DISPLAY_NAME[s]}
          </button>
        ))}
      </div>

      <SymbolBody symbol={symbol} />

      <p className="text-[10px] text-[var(--color-muted)] leading-relaxed text-center px-4 pb-2">
        Educational reference only, not financial advice. AI Verify Pro re-checks Best Call's own live pick against ~20 independently-weighted institutional
        checks plus hard rejection rules -- always confirm on the live chart before acting.
      </p>
    </div>
  );
}
