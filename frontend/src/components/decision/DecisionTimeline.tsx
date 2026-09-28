import { History } from "lucide-react";
import type { DecisionResult } from "../../utils/buyDecisionEngine";

const INK = { BULL: "#10B981", BEAR: "#E11D48", WAIT: "#CBD5E1" } as const;
const WORD = { BULL: "BUY CE", BEAR: "BUY PE", WAIT: "WAIT" } as const;

export function DecisionTimeline({ result }: { result: DecisionResult }) {
  const h = result.history;
  if (h.length < 2) return null;
  const changes = h.slice(1).filter((s, i) => s.state !== h[i].state).length;
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[12.5px] font-black text-slate-800 flex items-center gap-1.5">
          <History size={15} className="text-indigo-500" /> Last {h.length} closed candles
        </p>
        <span className="text-[10px] font-bold text-slate-500">
          {changes === 0 ? "No change — steady" : `${changes} change${changes > 1 ? "s" : ""}`}
        </span>
      </div>
      <div className="flex items-end gap-1 h-16">
        {h.map((s) => {
          const lead = Math.max(s.bull, s.bear);
          return (
            <div key={s.at} className="flex-1 flex flex-col items-center justify-end h-full">
              <div
                className="w-full rounded-md"
                title={`${s.at}: ${WORD[s.state]} (buyers ${s.bull} / sellers ${s.bear})`}
                style={{ height: `${Math.max(18, lead)}%`, background: INK[s.state], opacity: s.state === "WAIT" ? 1 : 0.55 + (lead / 100) * 0.45 }}
              />
            </div>
          );
        })}
      </div>
      <div className="flex gap-1 mt-1">
        {h.map((s, i) => (
          <span key={s.at} className="flex-1 text-center text-[8.5px] font-bold text-slate-400">
            {(h.length - 1 - i) % 2 === 0 ? s.at : ""}
          </span>
        ))}
      </div>
      <div className="flex gap-3 mt-2 text-[10px] font-bold">
        <span className="flex items-center gap-1"><i className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: INK.BULL }} /> Buy CE</span>
        <span className="flex items-center gap-1"><i className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: INK.BEAR }} /> Buy PE</span>
        <span className="flex items-center gap-1"><i className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: INK.WAIT }} /> Wait</span>
      </div>
      <p className="text-[10px] text-slate-500 mt-1.5 leading-snug">
        The verdict can only change when a 15-minute candle closes — never on a price spike in between. A buy needs two qualifying closes in a row.
      </p>
    </div>
  );
}
