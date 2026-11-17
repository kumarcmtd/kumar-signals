// AI-Test V2 header: the name, whether MCX is open (or when it opens), how
// fresh the data is, and one refresh button -- in one compact block.

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
    <section className="relative overflow-hidden rounded-3xl border border-white/10 p-4" style={{ background: "radial-gradient(120% 90% at 0% 0%,rgba(99,102,241,.35),transparent 60%),radial-gradient(90% 80% at 100% 0%,rgba(217,70,239,.28),transparent 55%),rgba(255,255,255,.03)" }}>
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-2xl flex items-center justify-center shadow-lg shrink-0" style={{ background: "linear-gradient(135deg,#6366F1,#D946EF)" }}>
          <FlaskConical size={22} className="text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-[22px] font-black leading-tight bg-gradient-to-r from-indigo-200 via-fuchsia-200 to-cyan-200 bg-clip-text text-transparent">AI-Test V2</h1>
          <p className="text-[11px] text-white/55 leading-snug">Multi-timeframe engine · MCX Crude &amp; Natural Gas options</p>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <span className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-black ${open ? "bg-emerald-400/15 text-emerald-300" : "bg-rose-400/15 text-rose-300"}`}>
          <span className="relative flex w-2 h-2">
            {open && <span className="absolute inset-0 rounded-full bg-emerald-400 animate-ping opacity-70" />}
            <span className={`relative w-2 h-2 rounded-full ${open ? "bg-emerald-400" : "bg-rose-400"}`} />
          </span>
          {open === null ? "…" : open ? `LIVE · MCX open${timeLabel ? ` · ${timeLabel}` : ""}` : `Closed · opens ${next!.label.replace(" IST", "").replace("today ", "")} (${inTime(next!.at - now)})`}
        </span>
        <button onClick={onRefresh} disabled={fetching} className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold bg-white/10 border border-white/15 text-white/85 disabled:opacity-60 shrink-0" aria-label="Refresh">
          <RefreshCw size={12} className={fetching ? "animate-spin" : ""} />
          {updatedAt > 0 ? age(now - updatedAt) : "Load"}
        </button>
      </div>
    </section>
  );
}
