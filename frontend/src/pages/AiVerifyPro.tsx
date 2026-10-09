import { useState } from "react";
import { ShieldCheck, RefreshCw, AlertTriangle, BadgeCheck, GitCompare } from "lucide-react";
import { useBuyDecision } from "../hooks/useBuyDecision";
import { VerdictHero } from "../components/decision/VerdictHero";
import { TimeframeStrip } from "../components/decision/TimeframeStrip";
import { TradePlanCard } from "../components/decision/TradePlanCard";
import { EvidenceCard } from "../components/decision/EvidenceCard";
import { DecisionTimeline } from "../components/decision/DecisionTimeline";
import { LiveNowCard } from "../components/decision/LiveNow";
import { sessionBucketStart } from "../utils/candleResample";
import type { DecisionResult } from "../utils/buyDecisionEngine";
import type { TradeLogEntry } from "../store/appStore";

type Sym = "CRUDEOIL" | "NATURALGAS";
const SYMBOLS: Sym[] = ["CRUDEOIL", "NATURALGAS"];
const NAME: Record<Sym, string> = { CRUDEOIL: "Crude Oil", NATURALGAS: "Natural Gas" };

function minutesToNextClose(marketOpen: boolean): number | null {
  if (!marketOpen) return null;
  const now = Date.now();
  const next = sessionBucketStart(now, 15) + 15 * 60_000;
  return Math.max(0, Math.ceil((next - now) / 60_000));
}

function Cautions({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="rounded-2xl p-3 space-y-1.5" style={{ background: "linear-gradient(160deg,#FFFBEB,#FEF3C7)" }}>
      <p className="text-[10.5px] font-black uppercase tracking-wide text-amber-700 flex items-center gap-1">
        <AlertTriangle size={13} /> Before you trade
      </p>
      {items.map((c) => (
        <p key={c} className="text-[11.5px] text-amber-900 leading-snug">• {c}</p>
      ))}
    </div>
  );
}

function RunningCall({ trade, result }: { trade: TradeLogEntry; result: DecisionResult }) {
  const agrees = result.side === trade.optSide && result.bull !== result.bear;
  const opposed = result.side !== null && result.side !== trade.optSide;
  const ink = agrees ? "#047857" : opposed ? "#BE123C" : "#64748B";
  return (
    <div className="card p-3.5 flex items-start gap-2.5">
      <span className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${ink}14`, color: ink }}>
        <GitCompare size={16} />
      </span>
      <div className="min-w-0">
        <p className="text-[12px] font-black text-slate-800">
          Your running Best Call: {trade.strike} {trade.optSide} @ ₹{trade.entry.toFixed(2)}
        </p>
        <p className="text-[11px] leading-snug mt-0.5" style={{ color: ink }}>
          {agrees
            ? "This read agrees with it."
            : opposed
              ? `This read leans the other way (${result.side}). Protect it with its stop.`
              : "This read has no clear view either way right now."}
        </p>
      </div>
    </div>
  );
}

function SymbolView({ symbol }: { symbol: Sym }) {
  const { result, pick, entry, live, running, marketOpen, loading, error, refetch, updatedAt } = useBuyDecision(symbol);
  const [spinning, setSpinning] = useState(false);

  if (error && !result) {
    return (
      <div className="card p-6 text-center">
        <p className="text-sm font-bold text-[var(--color-sell)]">Live data unavailable</p>
        <p className="text-xs text-[var(--color-muted)] mt-1">{error}</p>
      </div>
    );
  }
  if (!result) {
    return (
      <div className="card p-8 text-center space-y-2">
        <ShieldCheck size={30} className="mx-auto text-indigo-400 animate-pulse" />
        <p className="text-sm font-bold">{loading ? "Reading the 15-min, 1-hour and 4-hour charts…" : "Not enough finished candles yet to decide."}</p>
      </div>
    );
  }

  const refresh = async () => {
    setSpinning(true);
    await refetch().finally(() => setSpinning(false));
  };

  return (
    <div className="space-y-3.5">
      <VerdictHero result={result} name={NAME[symbol]} pick={pick} entry={entry} nextCloseIn={minutesToNextClose(marketOpen)} />
      <LiveNowCard read={live} updatedAt={updatedAt} onRefresh={refetch} />
      <Cautions items={result.cautions} />
      {running && <RunningCall trade={running} result={result} />}
      <TimeframeStrip result={result} />
      <TradePlanCard result={result} pick={pick} symbol={symbol} />
      <EvidenceCard result={result} />
      <DecisionTimeline result={result} />
      <button onClick={refresh} className="w-full text-[11px] font-bold text-indigo-600 flex items-center justify-center gap-1.5 py-1">
        <RefreshCw size={12} className={spinning ? "animate-spin" : ""} />
        Refresh data · updated {updatedAt ? new Date(updatedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "—"}
      </button>
    </div>
  );
}

export function AiVerifyPro() {
  const [symbol, setSymbol] = useState<Sym>("NATURALGAS");

  return (
    <div className="space-y-4 pb-4">
      <div className="rounded-3xl p-4 text-white relative overflow-hidden" style={{ background: "linear-gradient(135deg,#1E1B4B,#4338CA 55%,#7C3AED)", boxShadow: "0 10px 26px rgba(67,56,202,.35)" }}>
        <div className="absolute -right-6 -top-8 w-32 h-32 rounded-full" style={{ background: "rgba(255,255,255,.07)" }} />
        <p className="relative text-[20px] font-black flex items-center gap-2">
          <BadgeCheck size={21} /> AI Verify Pro
        </p>
        <p className="relative text-[12px] text-white/85 mt-0.5 leading-snug">
          Buy CE, buy PE, or wait — decided from finished candles on three timeframes, so it does not flip on every tick.
        </p>
      </div>

      <div className="flex gap-2 p-1 rounded-2xl bg-slate-100">
        {SYMBOLS.map((s) => (
          <button
            key={s}
            onClick={() => setSymbol(s)}
            className="flex-1 rounded-xl py-2.5 text-[13px] font-black transition-all"
            style={symbol === s ? { background: "#fff", color: "#4338CA", boxShadow: "0 2px 8px rgba(15,23,42,.12)" } : { color: "#64748B" }}
          >
            {NAME[s]}
          </button>
        ))}
      </div>

      <SymbolView key={symbol} symbol={symbol} />

      <p className="text-[10px] text-[var(--color-muted)] leading-relaxed text-center px-3">
        Educational reference, not financial advice. "Agree" is how much of the evidence points the same way, capped at 94 — it is not a chance of
        profit. Always use the stop loss.
      </p>
    </div>
  );
}
