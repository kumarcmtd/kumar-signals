// The full read for one market + timeframe: its latest call's levels first
// (entry, stop loss, targets 1-3), then the AI score ring, signal, hit
// probability and confidence, the six factor scores as bars, why (reasons and
// any rule that held it back) and this timeframe's call history.

import { useState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, ChevronDown } from "lucide-react";
import type { TradeLogEntry } from "../../store/appStore";
import { decisionLabelWithScore, type TimeframeAnalysis } from "../../utils/timeframeEngine";
import { DECISION_GRAD, DECISION_HEX, DISPLAY_NAME, MARGINAL, NO_DATA_GRAD, type TradableSymbol } from "./kit";
import { TradeLogLine } from "./TradeLogKit";

const FACTORS: [keyof NonNullable<TimeframeAnalysis["categories"]>, string][] = [
  ["trend", "Trend"],
  ["momentum", "Momentum"],
  ["priceAction", "Price action"],
  ["volume", "Volume"],
  ["supportResistance", "Support / resistance"],
  ["volatility", "Volatility"],
];
const STAT_TINT = ["from-violet-50 to-fuchsia-50 text-violet-700", "from-sky-50 to-cyan-50 text-sky-700", "from-amber-50 to-orange-50 text-orange-700", "from-emerald-50 to-teal-50 text-emerald-700"];

function Ring({ score, hex }: { score: number; hex: string }) {
  const r = 30;
  const c = 2 * Math.PI * r;
  return (
    <svg width="78" height="78" viewBox="0 0 78 78" className="shrink-0" aria-label={`AI score ${score} of 100`}>
      <circle cx="39" cy="39" r={r} stroke="#F1F5F9" strokeWidth="8" fill="none" />
      <circle cx="39" cy="39" r={r} stroke={hex} strokeWidth="8" fill="none" strokeLinecap="round" strokeDasharray={`${(score / 100) * c} ${c}`} transform="rotate(-90 39 39)" />
      <text x="39" y="42" textAnchor="middle" fontSize="21" fontWeight="900" fill="#0F172A">
        {score}
      </text>
      <text x="39" y="55" textAnchor="middle" fontSize="7.5" fontWeight="800" fill="#94A3B8">
        AI SCORE
      </text>
    </svg>
  );
}

function Cell({ label, value, tint }: { label: string; value: string; tint: string }) {
  return (
    <div className={`rounded-xl bg-gradient-to-br ${tint} px-2 py-1.5 min-w-0`}>
      <p className="text-[9px] font-bold text-slate-500">{label}</p>
      <p className="text-[12px] font-black leading-tight line-clamp-2">{value}</p>
    </div>
  );
}

/**
 * levels: the latest call's level tiles (or a note when this timeframe has none) -- shown even without live data.
 * noDataWhy: why there is no read (e.g. the Upstox login expired), said instead of the engine's generic "not enough bars".
 */
export function TfDetail({ sym, a, log, liveFor, levels, noDataWhy, onOpenEntry }: { sym: TradableSymbol; a: TimeframeAnalysis; log: TradeLogEntry[]; liveFor: (e: TradeLogEntry) => number | null; levels: React.ReactNode; noDataWhy?: string; onOpenEntry: (e: TradeLogEntry) => void }) {
  const [allWhy, setAllWhy] = useState(false);
  const [history, setHistory] = useState(false);
  const none = !!a.insufficient || a.overallScore === null;
  const hex = none ? "#94A3B8" : DECISION_HEX[a.decision];
  const reasons = allWhy ? a.reasons : a.reasons.slice(0, 3);
  return (
    <motion.section key={`${sym}-${a.tf}`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="rounded-3xl bg-white shadow-md overflow-hidden">
      {/* header in the signal's own colour */}
      <div className="px-3.5 py-3 flex items-center justify-between gap-2 text-white" style={{ background: none ? NO_DATA_GRAD : DECISION_GRAD[a.decision] }}>
        <p className={`text-[15px] font-black drop-shadow-sm ${none ? "text-slate-600" : ""}`}>{`${DISPLAY_NAME[sym]} · ${a.label}`}</p>
        {!a.insufficient && (
          <span className="text-[10.5px] font-black px-2 py-1 rounded-full bg-white shadow-sm" style={{ color: hex }}>
            {decisionLabelWithScore(a.decision)}
          </span>
        )}
      </div>
      <div className="p-3.5 space-y-3">
        {levels}
        {a.insufficient ? (
          <p className="text-[12px] text-slate-500">{noDataWhy ?? a.insufficient}</p>
        ) : (
          <>
          <div className="flex items-center gap-3">
            <Ring score={Math.round(a.overallScore ?? 0)} hex={hex} />
            <div className="grid grid-cols-2 gap-1.5 flex-1 min-w-0">
              <Cell label="Hit probability" value={a.hitProbability !== null ? `${a.hitProbability}%` : "—"} tint={STAT_TINT[0]} />
              <Cell label="Signal strength" value={a.signalStrength} tint={STAT_TINT[1]} />
              <Cell label="Confidence" value={a.confidenceLabel} tint={STAT_TINT[2]} />
              <Cell label="Holding time" value={a.holdingTime} tint={STAT_TINT[3]} />
            </div>
          </div>
          {MARGINAL.has(a.decision) && <p className="text-[11px] font-semibold rounded-xl bg-amber-50 text-amber-800 px-2.5 py-1.5">Weak tier — only a few points off Wait. Smaller size, or wait for a stronger read.</p>}
          {a.categories && (
            <div className="space-y-1.5">
              {FACTORS.map(([k, name]) => {
                const s = Math.round(a.categories![k].score);
                const fill = s >= 60 ? "linear-gradient(90deg,#34D399,#059669)" : s <= 40 ? "linear-gradient(90deg,#FB7185,#E11D48)" : "linear-gradient(90deg,#FCD34D,#F59E0B)";
                const txt = s >= 60 ? "#059669" : s <= 40 ? "#E11D48" : "#D97706";
                return (
                  <div key={k} className="flex items-center gap-2">
                    <span className="w-[118px] text-[11px] font-semibold text-slate-600 shrink-0">{name}</span>
                    <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                      <motion.div initial={{ width: 0 }} animate={{ width: `${s}%` }} transition={{ duration: 0.5 }} className="h-full rounded-full" style={{ background: fill }} />
                    </div>
                    <span className="w-6 text-right text-[11px] font-black" style={{ color: txt }}>
                      {s}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
          {a.vetoes.length > 0 && (
            <div className="rounded-xl bg-amber-50 border border-amber-200 p-2.5 space-y-0.5">
              <p className="text-[11px] font-black text-amber-800 flex items-center gap-1">
                <AlertTriangle size={12} /> Held back to Wait by the trading rules
              </p>
              {a.vetoes.map((v) => (
                <p key={v} className="text-[11px] text-amber-900">{`• ${v}`}</p>
              ))}
            </div>
          )}
          {a.reasons.length > 0 && (
            <div className="space-y-1">
              {reasons.map((r) => (
                <p key={r} className="text-[12px] text-slate-700 flex items-start gap-1.5">
                  <CheckCircle2 size={13} className="text-emerald-500 shrink-0 mt-0.5" /> {r}
                </p>
              ))}
              {a.reasons.length > 3 && (
                <button onClick={() => setAllWhy((o) => !o)} className="text-[11.5px] font-black text-violet-600">
                  {allWhy ? "Show less" : `All ${a.reasons.length} reasons`}
                </button>
              )}
            </div>
          )}
          </>
        )}
          {log.length > 0 && (
            <div className="rounded-2xl bg-slate-50 px-2.5 py-1.5">
              <button onClick={() => setHistory((o) => !o)} className="w-full flex items-center justify-between text-[12px] font-black text-slate-700 py-1">
                {`Calls on this timeframe (${log.length})`}
                <ChevronDown size={15} className={`text-violet-500 transition-transform ${history ? "rotate-180" : ""}`} />
              </button>
              {history && (
                <div className="space-y-1.5 mt-1 pb-1">
                  {[...log].reverse().map((e) => (
                    <TradeLogLine key={e.id} entry={e} liveLtp={e.closed ? null : liveFor(e)} onOpen={() => onOpenEntry(e)} />
                  ))}
                </div>
              )}
            </div>
          )}
      </div>
    </motion.section>
  );
}
