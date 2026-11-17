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

function Scale({ e, live }: { e: TradeLogEntry; live: number | null }) {
  const stop = effectiveStopFor(e);
  const lo = Math.min(stop, e.entry, live ?? stop);
  const hi = Math.max(e.targets[2], live ?? e.targets[2]);
  const pos = (x: number) => `${Math.min(100, Math.max(0, ((x - lo) / (hi - lo || 1)) * 100))}%`;
  const marks: [string, number, string, boolean][] = [
    ["SL", stop, "#F43F5E", false],
    ["B", e.entry, "#60A5FA", false],
    ["T1", e.targets[0], "#34D399", e.targetsHit[0]],
    ["T2", e.targets[1], "#34D399", e.targetsHit[1]],
    ["T3", e.targets[2], "#34D399", e.targetsHit[2]],
  ];
  return (
    <div className="relative h-9 mt-1" aria-label="Price scale from stop to target 3">
      <div className="absolute left-0 right-0 top-[15px] h-1.5 rounded-full" style={{ background: "linear-gradient(90deg,#F43F5E,#F59E0B 35%,#34D399)" }} />
      {marks.map(([t, x, c, hit]) => (
        <div key={t} className="absolute -translate-x-1/2 flex flex-col items-center" style={{ left: pos(x) }}>
          <span className="text-[8.5px] font-black" style={{ color: hit ? "#34D399" : "rgba(255,255,255,.55)" }}>
            {hit ? `${t}✓` : t}
          </span>
          <span className="w-2.5 h-2.5 rounded-full border-2 border-[#0D0A17] mt-[3px]" style={{ background: c }} />
        </div>
      ))}
      {live !== null && (
        <div className="absolute -translate-x-1/2 top-[21px] flex flex-col items-center" style={{ left: pos(live) }}>
          <span className="w-0 h-0 border-x-[5px] border-x-transparent border-b-[6px] border-b-white" />
          <span className="text-[9px] font-black text-white leading-none">₹{live}</span>
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
    <button onClick={onTap} className="w-full flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-left">
      <span className="w-1.5 self-stretch rounded-full" style={{ background: ce ? "#34D399" : "#FB7185" }} />
      <span className="flex-1 min-w-0">
        <span className="block text-[13px] font-black">
          {`${SHORT_NAME[sym]} ${e.strike} `}
          <span style={{ color: ce ? "#34D399" : "#FB7185" }}>{e.optSide}</span>
          <span className="ml-1.5 text-[9.5px] font-black px-1.5 py-0.5 rounded-md bg-white/10 text-white/70 align-middle">{TF_SHORT[tf] ?? tf}</span>
          {e.targetsHit[0] && <span className="ml-1 text-[9.5px] font-black text-emerald-300 align-middle">{e.targetsHit[1] ? "T2✓" : "T1✓"}</span>}
        </span>
        <span className="block text-[11px] text-white/55">{`₹${e.entry}${live !== null ? ` → ₹${live}` : ""}`}</span>
      </span>
      {pnl !== null && (
        <span className="text-[14px] font-black whitespace-nowrap" style={{ color: pnl >= 0 ? "#34D399" : "#FB7185" }}>
          {rupees(pnl)}
          <span className="text-[9px] font-bold text-white/45"> /lot</span>
        </span>
      )}
      <ChevronDown size={15} className="text-white/40 shrink-0" />
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
  const ce = e.optSide === "CE";
  return (
    <div className="rounded-2xl border p-3 space-y-2" style={{ borderColor: ce ? "rgba(52,211,153,.35)" : "rgba(251,113,133,.35)", background: ce ? "linear-gradient(135deg,rgba(16,185,129,.14),rgba(255,255,255,.03))" : "linear-gradient(135deg,rgba(244,63,94,.14),rgba(255,255,255,.03))" }}>
      <button onClick={onOpen} className="w-full text-left" disabled={!onOpen}>
        <div className="flex items-center justify-between gap-2">
          <p className="text-[15px] font-black">
            {`${SHORT_NAME[sym]} ${e.strike} `}
            <span style={{ color: ce ? "#34D399" : "#FB7185" }}>{e.optSide}</span>
            <span className="ml-1.5 text-[10px] font-black px-1.5 py-0.5 rounded-md bg-white/10 text-white/70 align-middle">{TF_SHORT[tf] ?? tf}</span>
          </p>
          <span className="text-[10px] text-white/45 shrink-0">{fmtWhen(e.openedAt)}</span>
        </div>
        <div className="flex items-end justify-between gap-2 mt-1">
          <p className="text-[12px] text-white/65">
            {`Entry ₹${e.entry}`}
            {live !== null && (
              <>
                {" → "}
                <b className="text-white">₹{live}</b> <span style={{ color: (pct ?? 0) >= 0 ? "#34D399" : "#FB7185" }}>{`(${(pct ?? 0) >= 0 ? "+" : ""}${(pct ?? 0).toFixed(1)}%)`}</span>
              </>
            )}
          </p>
          {pnl !== null && (
            <p className="text-[16px] font-black leading-none" style={{ color: pnl >= 0 ? "#34D399" : "#FB7185" }}>
              {rupees(pnl)}
              <span className="text-[9px] font-bold text-white/45"> /lot</span>
            </p>
          )}
        </div>
        {e.decision && <p className="text-[10px] text-white/45 mt-0.5">{`Called as ${DECISION_LABEL[e.decision]} · SL ₹${stop}${stop !== e.stop ? ` (moved from ₹${e.stop})` : ""}`}</p>}
        <Scale e={e} live={live} />
      </button>
      {timing && <EntryTimingBadge verdict={timing} theme="dark" />}
      <div className="grid grid-cols-2 gap-2">
        <button onClick={onCopy} className="flex items-center justify-center gap-1.5 py-2 rounded-xl text-[12px] font-bold bg-white/10 border border-white/15">
          <Copy size={13} /> {copied ? "Copied ✓" : "Copy tip"}
        </button>
        <button onClick={onLog} disabled={logged} className="flex items-center justify-center gap-1.5 py-2 rounded-xl text-[12px] font-bold text-white disabled:opacity-60" style={{ background: "linear-gradient(135deg,#6366F1,#A855F7)" }}>
          <NotebookPen size={13} /> {logged ? "Logged ✓" : "Log to journal"}
        </button>
      </div>
    </div>
  );
}
