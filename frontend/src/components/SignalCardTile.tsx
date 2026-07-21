import { motion } from "framer-motion";
import type { SignalCard } from "../types";

function confidenceLevel(confidence?: string): "high" | "medium" | "low" {
  if (!confidence) return "medium";
  if (confidence.startsWith("High")) return "high";
  if (confidence.startsWith("Low")) return "low";
  return "medium";
}

const confChipClass: Record<string, string> = {
  high: "bg-[var(--color-buy)] text-white",
  medium: "bg-[var(--color-warn)] text-white",
  low: "bg-[var(--color-sell)] text-white",
};

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
  const kind = !tradeIsLive ? "none" : trade.optSide === "CE" ? "buy" : "sell";

  const kindStyles: Record<string, { bg: string; text: string }> = {
    buy: { bg: "bg-gradient-to-br from-[var(--color-buy-soft)] to-emerald-100", text: "text-emerald-700" },
    sell: { bg: "bg-gradient-to-br from-[var(--color-sell-soft)] to-rose-100", text: "text-rose-700" },
    none: { bg: "bg-gradient-to-br from-[var(--color-warn-soft)] to-amber-100", text: "text-amber-800" },
  };
  const style = kindStyles[kind];

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="card p-4 space-y-3"
    >
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-[var(--color-muted)]">{signal.symbol}</p>
        <p className="text-xs text-[var(--color-muted)]">{signal.expiry}</p>
      </div>

      <div className={`rounded-2xl p-4 ${style.bg}`}>
        <div className="flex items-start justify-between gap-2 flex-wrap mb-2">
          <p className={`text-xl font-black ${style.text}`}>{tradeIsLive ? `🎯 ${trade.action}` : "⏸ NO TRADE"}</p>
          {tradeIsLive && trade.confidence && (
            <span className={`text-[11px] font-bold px-3 py-1 rounded-full ${confChipClass[confidenceLevel(trade.confidence)]}`}>
              {trade.confidence}
            </span>
          )}
        </div>
        {tradeIsLive && (
          <div className="grid grid-cols-2 gap-2 mb-2">
            <MiniStat label="Premium Entry" value={`₹${trade.premiumEntry}`} />
            <MiniStat label="Premium Target" value={`₹${trade.premiumTarget}`} />
            <MiniStat label="Premium SL" value={`₹${trade.premiumStop}`} />
            <MiniStat label="PCR" value={trade.pcr ?? "-"} />
          </div>
        )}
        <p className="text-xs text-black/60 leading-relaxed">{trade.note}</p>
      </div>

      <div className="rounded-xl bg-blue-50 border-l-4 border-blue-600 p-3">
        <p className="text-[11px] font-bold text-blue-700 mb-2">📊 TECHNICAL BASIS</p>
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-bold">{pattern.pattern}</p>
          <span
            className={`text-[11px] font-bold px-2.5 py-1 rounded-full text-white ${
              pattern.direction === "bullish" ? "bg-[var(--color-buy)]" : pattern.direction === "bearish" ? "bg-[var(--color-sell)]" : "bg-slate-400"
            }`}
          >
            {pattern.direction.toUpperCase()}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <MiniStat label="Entry" value={pattern.entry} light />
          <MiniStat label="Stop" value={pattern.stop} light />
          <MiniStat label="Target" value={pattern.target} light />
          <MiniStat label="Price" value={`₹${signal.currentPrice}`} light />
        </div>
      </div>
    </motion.div>
  );
}

function MiniStat({ label, value, light }: { label: string; value: string | number; light?: boolean }) {
  return (
    <div className={`rounded-lg px-2.5 py-2 ${light ? "bg-white" : "bg-white/70"}`}>
      <p className="text-[10px] text-black/50">{label}</p>
      <p className="text-sm font-bold">{value}</p>
    </div>
  );
}
