import { motion } from "framer-motion";
import { ArrowUpRight, ArrowDownRight } from "lucide-react";
import type { PriceCard } from "../types";

const THEME: Record<string, string> = {
  CRUDEOIL: "from-orange-500 to-pink-600",
  NATURALGAS: "from-sky-400 to-blue-600",
  GOLD: "from-amber-400 to-yellow-600",
  SILVER: "from-slate-400 to-slate-600",
  COPPER: "from-orange-700 to-amber-800",
  ALUMINIUM: "from-zinc-400 to-zinc-600",
};

export function PriceCardTile({ card }: { card: PriceCard }) {
  const up = card.change >= 0;
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="card overflow-hidden"
    >
      <div className={`bg-gradient-to-br ${THEME[card.symbol] ?? "from-slate-500 to-slate-700"} px-4 py-3 text-white`}>
        <p className="text-xs opacity-90 font-medium">{card.tradingSymbol || card.symbol}</p>
        <div className="flex items-end justify-between mt-1">
          <p className="text-2xl font-bold">₹{card.ltp?.toLocaleString("en-IN") ?? "-"}</p>
          <div className={`flex items-center gap-0.5 text-xs font-semibold ${up ? "" : ""}`}>
            {up ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
            {card.change?.toFixed(1)} ({card.changePercent?.toFixed(2)}%)
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 p-3">
        <Stat label="High" value={card.high} />
        <Stat label="Low" value={card.low} />
        <Stat label="Volume" value={card.volume} />
        <Stat label="OI" value={card.oi} />
      </div>
      <p className="px-3 pb-3 text-[11px] text-[var(--color-muted)]">Updated {card.lastUpdated}</p>
    </motion.div>
  );
}

function Stat({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-xl bg-[var(--color-surface-soft)] px-3 py-2">
      <p className="text-[11px] text-[var(--color-muted)]">{label}</p>
      <p className="text-sm font-semibold">{value?.toLocaleString("en-IN") ?? "-"}</p>
    </div>
  );
}
