// The full read for one market + timeframe: AI score ring, signal, hit
// probability and confidence, the six factor scores as bars, why (reasons and
// any rule that held it back), the running call and this timeframe's history.

import { useState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, ChevronDown } from "lucide-react";
import type { TradeLogEntry } from "../../store/appStore";
import { decisionLabelWithScore, type TimeframeAnalysis } from "../../utils/timeframeEngine";
import { DECISION_HEX, DISPLAY_NAME, MARGINAL, type TradableSymbol } from "./kit";
import { TradeLogLine } from "./TradeLogKit";

const FACTORS: [keyof NonNullable<TimeframeAnalysis["categories"]>, string][] = [
  ["trend", "Trend"],
  ["momentum", "Momentum"],
  ["priceAction", "Price action"],
  ["volume", "Volume"],
  ["supportResistance", "Support / resistance"],
  ["volatility", "Volatility"],
];

function Ring({ score, hex }: { score: number; hex: string }) {
  const r = 30;
  const c = 2 * Math.PI * r;
  return (
    <svg width="76" height="76" viewBox="0 0 76 76" className="shrink-0" aria-label={`AI score ${score} of 100`}>
      <circle cx="38" cy="38" r={r} stroke="rgba(255,255,255,.1)" strokeWidth="7" fill="none" />
      <circle cx="38" cy="38" r={r} stroke={hex} strokeWidth="7" fill="none" strokeLinecap="round" strokeDasharray={`${(score / 100) * c} ${c}`} transform="rotate(-90 38 38)" />
      <text x="38" y="40" textAnchor="middle" fontSize="20" fontWeight="900" fill="#fff">
        {score}
      </text>
      <text x="38" y="53" textAnchor="middle" fontSize="7.5" fontWeight="700" fill="rgba(255,255,255,.5)">
        AI SCORE
      </text>
    </svg>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white/5 border border-white/10 px-2 py-1.5 min-w-0">
      <p className="text-[9px] text-white/45">{label}</p>
      <p className="text-[12px] font-bold leading-tight line-clamp-2">{value}</p>
    </div>
  );
}

export function TfDetail({ sym, a, log, liveFor, running, onOpenEntry }: { sym: TradableSymbol; a: TimeframeAnalysis; log: TradeLogEntry[]; liveFor: (e: TradeLogEntry) => number | null; running: React.ReactNode; onOpenEntry: (e: TradeLogEntry) => void }) {
  const [allWhy, setAllWhy] = useState(false);
  const [history, setHistory] = useState(false);
  const hex = a.insufficient || a.overallScore === null ? "#64748B" : DECISION_HEX[a.decision];
  const reasons = allWhy ? a.reasons : a.reasons.slice(0, 3);
  return (
    <motion.section key={`${sym}-${a.tf}`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="rounded-3xl border border-white/10 overflow-hidden" style={{ background: `linear-gradient(160deg,${hex}22,rgba(255,255,255,.03) 45%)` }}>
      <div className="px-3.5 pt-3.5 flex items-center justify-between gap-2">
        <p className="text-[14px] font-black">{`${DISPLAY_NAME[sym]} · ${a.label}`}</p>
        {!a.insufficient && (
          <span className={`text-[10.5px] font-black px-2 py-1 rounded-full ${MARGINAL.has(a.decision) ? "border" : "text-black"}`} style={MARGINAL.has(a.decision) ? { color: hex, borderColor: hex } : { background: hex }}>
            {decisionLabelWithScore(a.decision)}
          </span>
        )}
      </div>
      {a.insufficient ? (
        <p className="text-[12px] text-white/50 p-3.5">{a.insufficient}</p>
      ) : (
        <div className="p-3.5 space-y-3">
          <div className="flex items-center gap-3">
            <Ring score={Math.round(a.overallScore ?? 0)} hex={hex} />
            <div className="grid grid-cols-2 gap-1.5 flex-1 min-w-0">
              <Cell label="Hit probability" value={a.hitProbability !== null ? `${a.hitProbability}%` : "—"} />
              <Cell label="Signal strength" value={a.signalStrength} />
              <Cell label="Confidence" value={a.confidenceLabel} />
              <Cell label="Holding time" value={a.holdingTime} />
            </div>
          </div>
          {MARGINAL.has(a.decision) && <p className="text-[10.5px] text-amber-300/90">Weak tier — only a few points off Wait. Smaller size, or wait for a stronger read.</p>}
          {a.categories && (
            <div className="space-y-1.5">
              {FACTORS.map(([k, name]) => {
                const s = Math.round(a.categories![k].score);
                const c = s >= 60 ? "#34D399" : s <= 40 ? "#FB7185" : "#FBBF24";
                return (
                  <div key={k} className="flex items-center gap-2">
                    <span className="w-[118px] text-[10.5px] text-white/60 shrink-0">{name}</span>
                    <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
                      <motion.div initial={{ width: 0 }} animate={{ width: `${s}%` }} transition={{ duration: 0.5 }} className="h-full rounded-full" style={{ background: c }} />
                    </div>
                    <span className="w-6 text-right text-[10.5px] font-bold" style={{ color: c }}>
                      {s}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
          {a.vetoes.length > 0 && (
            <div className="rounded-xl bg-amber-400/10 border border-amber-400/25 p-2.5 space-y-0.5">
              <p className="text-[10.5px] font-black text-amber-300 flex items-center gap-1">
                <AlertTriangle size={12} /> Held back to Wait by the trading rules
              </p>
              {a.vetoes.map((v) => (
                <p key={v} className="text-[11px] text-amber-100/80">{`• ${v}`}</p>
              ))}
            </div>
          )}
          {a.reasons.length > 0 && (
            <div className="space-y-1">
              {reasons.map((r) => (
                <p key={r} className="text-[11.5px] text-white/70 flex items-start gap-1.5">
                  <CheckCircle2 size={12} className="text-emerald-400 shrink-0 mt-0.5" /> {r}
                </p>
              ))}
              {a.reasons.length > 3 && (
                <button onClick={() => setAllWhy((o) => !o)} className="text-[11px] font-bold text-indigo-300">
                  {allWhy ? "Show less" : `All ${a.reasons.length} reasons`}
                </button>
              )}
            </div>
          )}
          {running}
          {log.length > 0 && (
            <div>
              <button onClick={() => setHistory((o) => !o)} className="w-full flex items-center justify-between text-[11.5px] font-bold text-white/70 py-1">
                {`Calls on this timeframe (${log.length})`}
                <ChevronDown size={14} className={`transition-transform ${history ? "rotate-180" : ""}`} />
              </button>
              {history && (
                <div className="space-y-1.5 mt-1">
                  {[...log].reverse().map((e) => (
                    <TradeLogLine key={e.id} entry={e} liveLtp={e.closed ? null : liveFor(e)} onOpen={() => onOpenEntry(e)} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </motion.section>
  );
}
