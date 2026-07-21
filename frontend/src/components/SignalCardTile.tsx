import { motion } from "framer-motion";
import { ChevronsUp } from "lucide-react";
import type { SignalCard } from "../types";

export function SignalCardTile({ signal }: { signal: SignalCard }) {
  if (signal.error) {
    return (
      <div className="card p-4 text-sm text-[var(--color-sell)]">
        {signal.symbol}: {signal.error}
      </div>
    );
  }

  const { trade, pattern } = signal;
  const tradeIsLive = trade.action !== "NO TRADE";

  if (!tradeIsLive) {
    return (
      <div className="card p-4 space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-sm font-bold">{signal.symbol}</p>
          <p className="text-xs text-[var(--color-muted)]">{signal.expiry}</p>
        </div>
        <div className="rounded-xl bg-[var(--color-warn-soft)] px-3 py-2.5 text-xs text-amber-800">
          ⏸ No live call right now — {trade.note}
        </div>
      </div>
    );
  }

  const isCall = trade.optSide === "CE";
  const accent = isCall
    ? { text: "text-emerald-700", pill: "bg-emerald-600", soft: "bg-emerald-50" }
    : { text: "text-rose-700", pill: "bg-rose-600", soft: "bg-rose-50" };

  const potentialPercent =
    trade.premiumEntry && trade.premiumTarget && trade.premiumEntry > 0
      ? ((trade.premiumTarget - trade.premiumEntry) / trade.premiumEntry) * 100
      : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="card overflow-hidden"
    >
      <div className="flex items-center justify-between px-4 pt-3 text-[11px] text-[var(--color-muted)]">
        <span>Live · updated {signal.lastDate}</span>
        <span className="font-semibold text-[var(--color-primary)]">Kumar AI</span>
      </div>

      <div className="px-4 pt-2 pb-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-lg font-black leading-tight">
              {signal.symbol} {trade.strike} {trade.optSide}
            </p>
            <p className="text-xs text-[var(--color-muted)] mt-0.5">{signal.expiry}</p>
          </div>
          <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full text-white ${accent.pill}`}>
            {isCall ? "BULLISH" : "BEARISH"}
          </span>
        </div>

        <div className={`mt-3 rounded-xl px-3 py-2 ${accent.soft}`}>
          <p className="text-[10px] text-black/50">Premium (LTP)</p>
          <p className={`text-2xl font-black ${accent.text}`}>₹{trade.premiumEntry}</p>
        </div>

        <div className="grid grid-cols-3 gap-2 mt-3">
          <MiniStat label="Stop-loss" value={`₹${trade.premiumStop}`} />
          <MiniStat label="Entry price" value={`₹${trade.premiumEntry}`} />
          <MiniStat label="Target" value={`₹${trade.premiumTarget}`} />
        </div>

        <div className="flex items-center justify-between mt-3 gap-3">
          {potentialPercent !== null && (
            <div className={`flex items-center gap-1.5 rounded-lg px-3 py-2 ${accent.soft}`}>
              <ChevronsUp size={16} className={accent.text} strokeWidth={2.5} />
              <div>
                <p className={`text-sm font-black leading-none ${accent.text}`}>{potentialPercent.toFixed(2)}%</p>
                <p className="text-[10px] text-black/50 leading-tight mt-0.5">Potential left</p>
              </div>
            </div>
          )}
          <button
            type="button"
            className={`ml-auto px-6 py-2.5 rounded-xl text-sm font-bold text-white ${accent.pill}`}
          >
            Buy {trade.optSide}
          </button>
        </div>

        {trade.confidence && <p className="text-[11px] text-[var(--color-muted)] mt-2">{trade.confidence}</p>}
      </div>

      <div className="border-t border-[var(--color-border)] bg-blue-50/60 px-4 py-3">
        <p className="text-[11px] font-bold text-blue-700 mb-1.5">📊 Technical basis</p>
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-sm font-bold">{pattern.pattern}</p>
          <span
            className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full text-white ${
              pattern.direction === "bullish" ? "bg-[var(--color-buy)]" : pattern.direction === "bearish" ? "bg-[var(--color-sell)]" : "bg-slate-400"
            }`}
          >
            {pattern.direction.toUpperCase()}
          </span>
        </div>
        <p className="text-xs text-black/60 leading-relaxed">{trade.note}</p>
      </div>
    </motion.div>
  );
}

function MiniStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg bg-white border border-[var(--color-border)] px-2.5 py-2 text-center">
      <p className="text-[10px] text-black/50">{label}</p>
      <p className="text-sm font-bold">{value}</p>
    </div>
  );
}
