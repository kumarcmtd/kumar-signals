// A call's levels as colour tiles -- entry, stop loss and targets 1, 2, 3,
// with a tick on each target reached -- and the block that shows them for the
// latest call on a timeframe (running now, or how the last one ended).

import type { TradeLogEntry } from "../../store/appStore";
import { effectiveStopFor } from "../../hooks/useTradeLog";
import { exitPriceFor } from "../../utils/tradeLogPnl";
import { fmtWhen, LOT_SIZE, rupees, SHORT_NAME, STATUS_HEX, STATUS_LABEL, type TradableSymbol } from "./kit";

const GREEN = "#059669";
const RED = "#E11D48";

function Tile({ label, value, sub, grad, solid }: { label: string; value: number; sub?: string; grad: string; solid: boolean }) {
  return (
    <div className={`rounded-xl px-1 py-1.5 text-center min-w-0 ${solid ? "text-white shadow-sm" : ""}`} style={{ background: solid ? grad : undefined }}>
      <p className={`text-[9px] font-black uppercase ${solid ? "text-white/90" : "text-slate-500"}`}>{label}</p>
      <p className="text-[13px] font-black leading-tight whitespace-nowrap">₹{value}</p>
      {sub && <p className={`text-[8.5px] font-bold ${solid ? "text-white/85" : "text-slate-400"}`}>{sub}</p>}
    </div>
  );
}

/** Entry / SL / T1 / T2 / T3 in one row. A target turns solid green once reached. */
export function LevelTiles({ e }: { e: TradeLogEntry }) {
  const stop = effectiveStopFor(e);
  const target = (i: 0 | 1 | 2) => (
    <div key={i} className={`rounded-xl ${e.targetsHit[i] ? "" : "bg-emerald-50 text-emerald-700"}`}>
      <Tile label={e.targetsHit[i] ? `T${i + 1} ✓` : `Target ${i + 1}`} value={e.targets[i]} grad="linear-gradient(135deg,#10B981,#0D9488)" solid={e.targetsHit[i]} />
    </div>
  );
  return (
    <div className="grid grid-cols-5 gap-1">
      <div className="rounded-xl bg-sky-50 text-sky-700">
        <Tile label="Entry" value={e.entry} grad="" solid={false} />
      </div>
      <div className="rounded-xl bg-rose-50 text-rose-700">
        <Tile label="Stop loss" value={stop} sub={stop !== e.stop ? `was ₹${e.stop}` : undefined} grad="" solid={false} />
      </div>
      {target(0)}
      {target(1)}
      {target(2)}
    </div>
  );
}

/** The latest call on one timeframe: what it is, where it stands (or how it ended), and its levels. */
export function CallLevels({ sym, e, live }: { sym: TradableSymbol; e: TradeLogEntry; live: number | null }) {
  const exit = e.closed ? exitPriceFor(e) : null;
  const now = e.closed ? exit : live;
  const pnl = now !== null ? (now - e.entry) * LOT_SIZE[sym] : null;
  const ce = e.optSide === "CE";
  return (
    <div className={`rounded-2xl border p-2.5 space-y-2 ${e.closed ? "bg-slate-50 border-slate-200" : "bg-orange-50/60 border-orange-200"}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[13px] font-black text-slate-800">
          {`${SHORT_NAME[sym]} ${e.strike} `}
          <span style={{ color: ce ? GREEN : RED }}>{e.optSide}</span>
        </p>
        {e.closed ? (
          <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-white border" style={{ color: STATUS_HEX[e.status], borderColor: STATUS_HEX[e.status] }}>
            {`Last call · ${STATUS_LABEL[e.status]}`}
          </span>
        ) : (
          <span className="flex items-center gap-1 text-[10px] font-black px-2 py-0.5 rounded-full text-white" style={{ background: "linear-gradient(135deg,#F97316,#DB2777)" }}>
            <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" /> Running now
          </span>
        )}
      </div>
      <p className="text-[11px] text-slate-500 -mt-1">
        {`Called ${fmtWhen(e.openedAt)}`}
        {e.closed && e.closedAt !== null ? ` · closed ${fmtWhen(e.closedAt)}${exit !== null ? ` at ₹${exit}` : ""}` : live !== null ? ` · now ₹${live}` : ""}
        {pnl !== null && (
          <b className="ml-1 whitespace-nowrap" style={{ color: pnl >= 0 ? GREEN : RED }}>
            {`${rupees(pnl)} /lot`}
          </b>
        )}
      </p>
      <LevelTiles e={e} />
    </div>
  );
}
