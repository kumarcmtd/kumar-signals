// A running AI-Test V2 call: the option, entry vs live premium, rupees per
// lot now, a stop-to-target scale with the live price on it, the entry-timing
// verdict ("can I still buy?") and the copy / journal buttons.

import { ChevronDown, Copy, NotebookPen } from "lucide-react";
import type { TradeLogEntry } from "../../store/appStore";
import { effectiveStopFor } from "../../hooks/useTradeLog";
import { evaluateEntryTiming } from "../../utils/entryTiming";
import { DECISION_LABEL } from "../../utils/timeframeEngine";
import { EntryTimingBadge } from "../EntryTimingBadge";
import { fmtWhen, LOT_SIZE, rupees, SHORT_NAME, TF_SHORT, type TradableSymbol } from "./kit";

const GREEN = "#059669";
const RED = "#E11D48";
const SIDE_GRAD = { CE: "linear-gradient(135deg,#10B981,#0D9488)", PE: "linear-gradient(135deg,#F43F5E,#DB2777)" };

function Scale({ e, live }: { e: TradeLogEntry; live: number | null }) {
  const stop = effectiveStopFor(e);
  const lo = Math.min(stop, e.entry, live ?? stop);
  const hi = Math.max(e.targets[2], live ?? e.targets[2]);
  const pos = (x: number) => `${Math.min(100, Math.max(0, ((x - lo) / (hi - lo || 1)) * 100))}%`;
  const marks: [string, number, string, boolean][] = [
    ["SL", stop, "#E11D48", false],
    ["B", e.entry, "#2563EB", false],
    ["T1", e.targets[0], "#059669", e.targetsHit[0]],
    ["T2", e.targets[1], "#059669", e.targetsHit[1]],
    ["T3", e.targets[2], "#059669", e.targetsHit[2]],
  ];
  return (
    <div className="relative h-10 mt-1.5" aria-label="Price scale from stop to target 3">
      <div className="absolute left-0 right-0 top-[15px] h-2 rounded-full" style={{ background: "linear-gradient(90deg,#F43F5E,#F59E0B 35%,#22C55E)" }} />
      {marks.map(([t, x, c, hit]) => (
        <div key={t} className="absolute -translate-x-1/2 flex flex-col items-center" style={{ left: pos(x) }}>
          <span className="text-[8.5px] font-black" style={{ color: hit ? GREEN : "#64748B" }}>
            {hit ? `${t}✓` : t}
          </span>
          <span className="w-3 h-3 rounded-full border-2 border-white shadow mt-[2px]" style={{ background: c }} />
        </div>
      ))}
      {live !== null && (
        <div className="absolute -translate-x-1/2 top-[25px] flex flex-col items-center" style={{ left: pos(live) }}>
          <span className="w-0 h-0 border-x-[5px] border-x-transparent border-b-[6px] border-b-slate-800" />
          <span className="text-[9px] font-black text-white bg-slate-800 rounded px-1 leading-tight">₹{live}</span>
        </div>
      )}
    </div>
  );
}

/** One line per running call; tap to open its full card. */
export function CallRow({ sym, tf, e, live, onTap }: { sym: TradableSymbol; tf: string; e: TradeLogEntry; live: number | null; onTap: () => void }) {
  const pnl = live !== null ? (live - e.entry) * LOT_SIZE[sym] : null;
  const ce = e.optSide === "CE";
  return (
    <button onClick={onTap} className="w-full flex items-center gap-2.5 rounded-2xl bg-white shadow-sm border border-slate-100 px-3 py-2.5 text-left">
      <span className="w-1.5 self-stretch rounded-full" style={{ background: SIDE_GRAD[e.optSide] }} />
      <span className="flex-1 min-w-0">
        <span className="block text-[13px] font-black text-slate-800">
          {`${SHORT_NAME[sym]} ${e.strike} `}
          <span style={{ color: ce ? GREEN : RED }}>{e.optSide}</span>
          <span className="ml-1.5 text-[9.5px] font-black px-1.5 py-0.5 rounded-md bg-violet-100 text-violet-700 align-middle">{TF_SHORT[tf] ?? tf}</span>
          {e.targetsHit[0] && <span className="ml-1 text-[9.5px] font-black px-1.5 py-0.5 rounded-md bg-emerald-100 text-emerald-700 align-middle">{e.targetsHit[1] ? "T2✓" : "T1✓"}</span>}
        </span>
        <span className="block text-[11px] text-slate-500">{`₹${e.entry}${live !== null ? ` → ₹${live}` : ""}`}</span>
      </span>
      {pnl !== null && (
        <span className="text-[14px] font-black whitespace-nowrap" style={{ color: pnl >= 0 ? GREEN : RED }}>
          {rupees(pnl)}
          <span className="text-[9px] font-bold text-slate-400"> /lot</span>
        </span>
      )}
      <ChevronDown size={15} className="text-slate-400 shrink-0" />
    </button>
  );
}

export function LiveCallCard({ sym, tf, e, live, logged, onLog, onCopy, copied, onOpen }: { sym: TradableSymbol; tf: string; e: TradeLogEntry; live: number | null; logged: boolean; onLog: () => void; onCopy: () => void; copied: boolean; onOpen?: () => void }) {
  const stop = effectiveStopFor(e);
  const next = e.targetsHit[1] ? e.targets[2] : e.targetsHit[0] ? e.targets[1] : e.targets[0];
  const floor = e.targetsHit[1] ? e.targets[1] : e.targetsHit[0] ? e.targets[0] : e.entry;
  const timing = live !== null ? evaluateEntryTiming(floor, next, stop, live) : null;
  const pnl = live !== null ? (live - e.entry) * LOT_SIZE[sym] : null;
  const pct = live !== null ? ((live - e.entry) / e.entry) * 100 : null;
  return (
    <div className="rounded-3xl bg-white shadow-md overflow-hidden">
      <button onClick={onOpen} className="w-full text-left" disabled={!onOpen}>
        {/* colour band: green for a CE call, rose for a PE call */}
        <div className="px-3.5 py-2.5 text-white flex items-center justify-between gap-2" style={{ background: SIDE_GRAD[e.optSide] }}>
          <p className="text-[16px] font-black drop-shadow-sm">
            {`${SHORT_NAME[sym]} ${e.strike} ${e.optSide}`}
            <span className="ml-1.5 text-[10px] font-black px-1.5 py-0.5 rounded-md bg-white/25 align-middle">{TF_SHORT[tf] ?? tf}</span>
          </p>
          <span className="text-[10px] font-bold text-white/90 shrink-0">{fmtWhen(e.openedAt)}</span>
        </div>
        <div className="px-3.5 pt-2.5">
          <div className="flex items-end justify-between gap-2">
            <p className="text-[12.5px] text-slate-600">
              {`Entry ₹${e.entry}`}
              {live !== null && (
                <>
                  {" → "}
                  <b className="text-slate-900">₹{live}</b> <span className="font-bold" style={{ color: (pct ?? 0) >= 0 ? GREEN : RED }}>{`(${(pct ?? 0) >= 0 ? "+" : ""}${(pct ?? 0).toFixed(1)}%)`}</span>
                </>
              )}
            </p>
            {pnl !== null && (
              <p className="text-[18px] font-black leading-none whitespace-nowrap" style={{ color: pnl >= 0 ? GREEN : RED }}>
                {rupees(pnl)}
                <span className="text-[9px] font-bold text-slate-400"> /lot</span>
              </p>
            )}
          </div>
          {e.decision && <p className="text-[10.5px] text-slate-400 mt-0.5">{`Called as ${DECISION_LABEL[e.decision]} · SL ₹${stop}${stop !== e.stop ? ` (moved from ₹${e.stop})` : ""}`}</p>}
          <Scale e={e} live={live} />
        </div>
      </button>
      <div className="px-3.5 pb-3.5 pt-1 space-y-2">
        {timing && <EntryTimingBadge verdict={timing} theme="light" />}
        <div className="grid grid-cols-2 gap-2">
          <button onClick={onCopy} className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[12px] font-black bg-slate-100 text-slate-700">
            <Copy size={13} /> {copied ? "Copied ✓" : "Copy tip"}
          </button>
          <button onClick={onLog} disabled={logged} className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[12px] font-black text-white shadow disabled:opacity-60" style={{ background: "linear-gradient(135deg,#7C3AED,#DB2777)" }}>
            <NotebookPen size={13} /> {logged ? "Logged ✓" : "Log to journal"}
          </button>
        </div>
      </div>
    </div>
  );
}
