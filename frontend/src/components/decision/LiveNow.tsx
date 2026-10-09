// The "right now" read between 15-minute closes (see utils/liveMomentum.ts),
// in two sizes: a pill inside the quick-look rows and a full card under the
// AI Verify Pro verdict, with a refresh button.

import { useState } from "react";
import { Activity, RefreshCw, ArrowUp, ArrowDown, Minus } from "lucide-react";
import type { LiveRead } from "../../utils/liveMomentum";

const TONE: Record<LiveRead["tone"], { bg: string; ink: string; dot: string }> = {
  good: { bg: "#ECFDF5", ink: "#047857", dot: "#10B981" },
  bull: { bg: "#ECFDF5", ink: "#047857", dot: "#10B981" },
  warn: { bg: "#FFFBEB", ink: "#B45309", dot: "#F59E0B" },
  bad: { bg: "#FEF2F2", ink: "#B91C1C", dot: "#EF4444" },
  bear: { bg: "#FEF2F2", ink: "#B91C1C", dot: "#EF4444" },
  neutral: { bg: "#F1F5F9", ink: "#334155", dot: "#94A3B8" },
};

function FiveMin({ bars }: { bars: LiveRead["fiveMin"] }) {
  if (!bars.length) return null;
  return (
    <span className="inline-flex items-center gap-0.5">
      {bars.map((b, i) =>
        b === "up" ? <ArrowUp key={i} size={11} className="text-emerald-600" /> : b === "down" ? <ArrowDown key={i} size={11} className="text-rose-600" /> : <Minus key={i} size={11} className="text-slate-400" />,
      )}
    </span>
  );
}

/** Compact: sits inside a coloured quick-look row. */
export function LiveNowPill({ read }: { read: LiveRead }) {
  const t = TONE[read.tone];
  return (
    <div className="relative mt-1.5 rounded-lg px-2 py-1.5" style={{ background: "rgba(255,255,255,.94)" }}>
      <p className="text-[10.5px] font-black leading-snug flex items-center gap-1" style={{ color: t.ink }}>
        <span className="w-1.5 h-1.5 rounded-full shrink-0 animate-pulse" style={{ background: t.dot }} />
        RIGHT NOW: {read.headline}
      </p>
      <p className="text-[9.5px] text-slate-600 leading-snug mt-0.5 flex items-center gap-1 flex-wrap">
        {read.detail}
        {read.fiveMin.length > 0 && (
          <>
            <span>· 5-min</span> <FiveMin bars={read.fiveMin} />
          </>
        )}
      </p>
    </div>
  );
}

/** Full: under the AI Verify Pro verdict, with a refresh button. */
export function LiveNowCard({ read, updatedAt, onRefresh }: { read: LiveRead | null; updatedAt: number; onRefresh: () => Promise<unknown> }) {
  const [spinning, setSpinning] = useState(false);
  const refresh = async () => {
    setSpinning(true);
    await onRefresh().finally(() => setSpinning(false));
  };
  const t = read ? TONE[read.tone] : TONE.neutral;
  const time = updatedAt ? new Date(updatedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—";

  return (
    <div className="rounded-2xl p-3 space-y-1" style={{ background: t.bg, border: `1px solid ${t.dot}55` }}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10.5px] font-black uppercase tracking-wide flex items-center gap-1" style={{ color: t.ink }}>
          <Activity size={13} /> Right now · live
        </p>
        <button onClick={refresh} className="text-[10.5px] font-black text-indigo-700 bg-white rounded-lg px-2 py-1 flex items-center gap-1 shadow-sm">
          <RefreshCw size={11} className={spinning ? "animate-spin" : ""} /> Refresh
        </button>
      </div>
      {read ? (
        <>
          <p className="text-[13px] font-black leading-snug" style={{ color: t.ink }}>{read.headline}</p>
          <p className="text-[11px] text-slate-700 leading-snug">
            ₹{read.live.toFixed(2)} · {read.detail}
          </p>
          {read.fiveMin.length > 0 && (
            <p className="text-[10.5px] text-slate-600 flex items-center gap-1">
              5-minute candles since {read.sinceAt}: <FiveMin bars={read.fiveMin} />
            </p>
          )}
          <p className="text-[9.5px] text-slate-500 leading-snug">
            Live candle — this can change before it closes at {read.closesAt}. The decision above only changes on a close. Updated {time}, refreshes every ~15 s.
          </p>
        </>
      ) : (
        <p className="text-[11px] text-slate-600">No live read — the market is closed or the latest candles are not in yet. Updated {time}.</p>
      )}
    </div>
  );
}
