// A call's full detail: result, why it was called, levels, price scale,
// rupee estimate and the chart around it. Opened from the journal.

import { TrendingUp, TrendingDown, X, CandlestickChart } from "lucide-react";
import { effectiveStopFor } from "../../hooks/useTradeLog";
import { exitPriceFor } from "../../utils/tradeLogPnl";
import { fmtWhen, DetailRow, CallChart, PriceScale, ProfitEstimate, tickMarks } from "../CallCardKit";
import { LAB_LOT, type LabSym } from "../../utils/twentyLab";
import type { TradeLogEntry } from "../../store/appStore";
import type { Candle } from "../../types";

const DISPLAY_NAME: Record<LabSym, string> = { CRUDEOIL: "Crude Oil", NATURALGAS: "Natural Gas" };
const rs = (n: number) => `${n >= 0 ? "+" : "−"}₹${Math.abs(Math.round(n)).toLocaleString("en-IN")}`;

export function CallDetailModal({ symbol, entry, candles, candlesLoading, onClose }: { symbol: LabSym; entry: TradeLogEntry; candles: Candle[]; candlesLoading: boolean; onClose: () => void }) {
  const exit = entry.closed ? exitPriceFor(entry) : null;
  const lot = LAB_LOT[symbol];
  const pnl = exit !== null ? (exit - entry.entry) * lot : null;
  const effStop = effectiveStopFor(entry);
  const Bias = entry.optSide === "CE" ? TrendingUp : TrendingDown;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div className="relative w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-3xl p-5 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <p className="text-xl font-black flex items-center gap-2 text-slate-800">
            <Bias size={20} style={{ color: entry.optSide === "CE" ? "#059669" : "#E11D48" }} />
            {DISPLAY_NAME[symbol]} {entry.strike} {entry.optSide}
          </p>
          <button onClick={onClose} className="p-2 rounded-full bg-slate-100 shrink-0">
            <X size={18} />
          </button>
        </div>
        <div className="rounded-2xl p-3.5 my-3 bg-slate-50">
          <p className="text-lg font-black" style={{ color: pnl === null ? "#B45309" : pnl > 0 ? "#059669" : pnl < 0 ? "#E11D48" : "#B45309" }}>
            {entry.closed ? entry.status.replace(/_/g, " ") : "Running"}
          </p>
          {pnl !== null && <p className="text-sm font-bold text-slate-500">{rs(pnl)} per lot</p>}
        </div>
        {entry.meta?.reasons?.length ? (
          <div className="mb-3 space-y-1">
            <p className="text-[10px] font-black uppercase text-slate-400">Why it was called</p>
            {entry.meta.reasons.map((r) => (
              <p key={r} className="text-[11px] text-slate-600">
                ✓ {r}
              </p>
            ))}
          </div>
        ) : null}
        <DetailRow label="Called" value={`${fmtWhen(entry.openedAt)} at ₹${entry.entry}`} />
        {entry.closed && entry.closedAt !== null && <DetailRow label="Closed" value={`${fmtWhen(entry.closedAt)} at ₹${exit}`} />}
        {entry.targets.map((t, i) => (
          <DetailRow key={i} label={`Target ${i + 1}`} value={`₹${t}  ${tickMarks(entry.targetTouches?.[i] ?? (entry.targetsHit[i] ? 1 : 0))}`} valueColor={entry.targetsHit[i] ? "#059669" : undefined} />
        ))}
        <DetailRow label="Stop Loss" value={effStop !== entry.stop ? `₹${effStop} (was ₹${entry.stop})` : `₹${entry.stop}`} valueColor="#E11D48" />
        <div className="mt-4 -mx-5">
          <PriceScale entry={entry} current={entry.closed ? exit : null} />
          <ProfitEstimate trade={entry} current={entry.closed ? exit : null} lotSize={lot} />
        </div>
        <div className="mt-4">
          <p className="text-xs font-bold uppercase text-slate-400 mb-2 flex items-center gap-1.5">
            <CandlestickChart size={13} /> Chart
          </p>
          <CallChart candles={candles} entry={entry} loading={candlesLoading} errorReason={null} />
        </div>
      </div>
    </div>
  );
}
