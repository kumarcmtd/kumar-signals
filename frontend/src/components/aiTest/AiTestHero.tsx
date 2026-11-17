// AI-Test V2 header: the name, whether MCX is open (or when it opens), how
// fresh the data is, and one refresh button -- in one bright block.

import { useEffect, useState } from "react";
import { FlaskConical, RefreshCw } from "lucide-react";
import { nextMcxOpen } from "../../utils/mcxSession";

const age = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ago` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ago`;
};
const inTime = (ms: number) => {
  const m = Math.max(0, Math.round(ms / 60_000));
  if (m >= 24 * 60) return `${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h`;
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
};

export function AiTestHero({ open, timeLabel, updatedAt, fetching, onRefresh }: { open: boolean | null; timeLabel?: string; updatedAt: number; fetching: boolean; onRefresh: () => void }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const now = Date.now();
  const next = open === false ? nextMcxOpen(now) : null;
  return (
    <section className="relative overflow-hidden rounded-3xl p-4 text-white shadow-lg shadow-fuchsia-300/40" style={{ background: "linear-gradient(135deg,#7C3AED 0%,#DB2777 55%,#F97316 100%)" }}>
      {/* soft light blobs for depth */}
      <span className="pointer-events-none absolute -top-10 -right-8 w-36 h-36 rounded-full bg-white/20 blur-2xl" />
      <span className="pointer-events-none absolute -bottom-12 -left-10 w-40 h-40 rounded-full bg-cyan-300/30 blur-2xl" />
      <div className="relative flex items-center gap-3">
        <div className="w-12 h-12 rounded-2xl flex items-center justify-center bg-white/20 ring-1 ring-white/40 shrink-0">
          <FlaskConical size={24} className="text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-[24px] font-black leading-tight drop-shadow-sm">AI-Test V2</h1>
          <p className="text-[11.5px] text-white/90 leading-snug">4 timeframes · Crude &amp; Natural Gas options</p>
        </div>
      </div>
      <div className="relative mt-3 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-black bg-white/20 ring-1 ring-white/30">
          <span className="relative flex w-2 h-2">
            {open && <span className="absolute inset-0 rounded-full bg-lime-300 animate-ping opacity-80" />}
            <span className={`relative w-2 h-2 rounded-full ${open ? "bg-lime-300" : "bg-rose-200"}`} />
          </span>
          {open === null ? "…" : open ? `LIVE · MCX open${timeLabel ? ` · ${timeLabel}` : ""}` : `Closed · opens ${next!.label.replace(" IST", "").replace("today ", "")} (${inTime(next!.at - now)})`}
        </span>
        <button onClick={onRefresh} disabled={fetching} className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-black bg-white text-fuchsia-700 shadow disabled:opacity-70 shrink-0" aria-label="Refresh">
          <RefreshCw size={12} className={fetching ? "animate-spin" : ""} />
          {updatedAt > 0 ? age(now - updatedAt) : "Load"}
        </button>
      </div>
    </section>
  );
}
