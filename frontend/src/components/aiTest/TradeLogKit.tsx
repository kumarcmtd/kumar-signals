// One timeframe's call history on AI-Test V2: a line per call (running ones
// bright with the live premium, closed ones dulled) and a detail sheet.

import { ChevronRight, X } from "lucide-react";
import type { TradeLogEntry } from "../../store/appStore";
import { effectiveStopFor } from "../../hooks/useTradeLog";
import { exitPriceFor } from "../../utils/tradeLogPnl";
import { evaluateEntryTiming } from "../../utils/entryTiming";
import { EntryTimingBadge } from "../EntryTimingBadge";
import { DISPLAY_NAME, fmtWhen, STATUS_HEX, STATUS_LABEL, type TradableSymbol } from "./kit";

function TargetTick({ label, price, hit }: { label: string; price: number; hit: boolean }) {
  return <span className={hit ? "text-emerald-400 font-semibold" : ""}>{`${hit ? "✓" : "○"} ${label} ₹${price}`}</span>;
}

export function TradeLogLine({ entry, liveLtp, onOpen }: { entry: TradeLogEntry; liveLtp: number | null; onOpen: () => void }) {
  const dulled = entry.closed;
  const effStop = effectiveStopFor(entry);
  const nextTarget = entry.targetsHit[1] ? entry.targets[2] : entry.targetsHit[0] ? entry.targets[1] : entry.targets[0];
  const legFloor = entry.targetsHit[1] ? entry.targets[1] : entry.targetsHit[0] ? entry.targets[0] : entry.entry;
  const timing = !dulled && liveLtp !== null ? evaluateEntryTiming(legFloor, nextTarget, effStop, liveLtp) : null;
  return (
    <button onClick={onOpen} className={`w-full text-left rounded-xl border px-2.5 py-2 ${dulled ? "opacity-50 bg-white/[0.02] border-white/5" : "bg-white/5 border-white/10"}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold">{`${entry.strike} ${entry.optSide} · Entry ₹${entry.entry}`}</span>
        <span className="flex items-center gap-1 shrink-0">
          <span className="text-[10px] font-bold" style={{ color: STATUS_HEX[entry.status] }}>
            {STATUS_LABEL[entry.status]}
          </span>
          <ChevronRight size={12} className="text-white/30" />
        </span>
      </div>
      <p className="text-[9.5px] text-white/40 mt-0.5">{`Called ${fmtWhen(entry.openedAt)}${entry.closedAt !== null ? ` · Closed ${fmtWhen(entry.closedAt)}` : ""}`}</p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-[10px] text-white/50">
        <TargetTick label="T1" price={entry.targets[0]} hit={entry.targetsHit[0]} />
        <TargetTick label="T2" price={entry.targets[1]} hit={entry.targetsHit[1]} />
        <TargetTick label="T3" price={entry.targets[2]} hit={entry.targetsHit[2]} />
        <span>{`SL ₹${effStop}`}{effStop !== entry.stop && <span className="text-white/30">{` (was ₹${entry.stop})`}</span>}</span>
      </div>
      {timing && <EntryTimingBadge verdict={timing} theme="dark" className="mt-1.5" />}
    </button>
  );
}

function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-white/10 last:border-0">
      <span className="text-sm text-white/50">{label}</span>
      <span className="text-[15px] font-bold" style={{ color }}>
        {value}
      </span>
    </div>
  );
}

export function TradeLogDetailModal({ symbol, entry, onClose }: { symbol: TradableSymbol; entry: TradeLogEntry; onClose: () => void }) {
  const effStop = effectiveStopFor(entry);
  const exit = entry.closed ? exitPriceFor(entry) : null;
  const pts = exit !== null ? Number((exit - entry.entry).toFixed(2)) : null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div className="relative w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl p-5 max-h-[85vh] overflow-y-auto bg-[#0D0A17] border border-white/10 text-white" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <p className="text-xl font-black">{`${DISPLAY_NAME[symbol]} ${entry.strike} ${entry.optSide}`}</p>
          <button onClick={onClose} className="p-2 rounded-full bg-white/10 shrink-0" aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="rounded-2xl p-3.5 mb-3 bg-white/5 border border-white/10">
          <p className="text-lg font-black" style={{ color: STATUS_HEX[entry.status] }}>
            {STATUS_LABEL[entry.status]}
          </p>
          {pts !== null && <p className="text-sm font-bold text-white/50">{`${pts >= 0 ? "+" : ""}${pts} points`}</p>}
        </div>
        <Row label="Called" value={`${fmtWhen(entry.openedAt)} at ₹${entry.entry}`} />
        {entry.closed && entry.closedAt !== null && <Row label="Closed" value={`${fmtWhen(entry.closedAt)} at ₹${exit}`} />}
        <Row label="Target 1" value={`₹${entry.targets[0]}  ${entry.targetsHit[0] ? "✓" : "○"}`} color={entry.targetsHit[0] ? "#22C55E" : undefined} />
        <Row label="Target 2" value={`₹${entry.targets[1]}  ${entry.targetsHit[1] ? "✓" : "○"}`} color={entry.targetsHit[1] ? "#22C55E" : undefined} />
        <Row label="Target 3" value={`₹${entry.targets[2]}  ${entry.targetsHit[2] ? "✓" : "○"}`} color={entry.targetsHit[2] ? "#22C55E" : undefined} />
        <Row label="Stop Loss" value={effStop !== entry.stop ? `₹${effStop} (was ₹${entry.stop})` : `₹${entry.stop}`} color="#F43F5E" />
      </div>
    </div>
  );
}
