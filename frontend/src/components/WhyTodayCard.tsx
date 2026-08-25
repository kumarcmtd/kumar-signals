import { Newspaper, Clock, ExternalLink, Sparkles } from "lucide-react";
import { useWhyToday } from "../api/hooks";
import type { WhyCommodity, WhyLean } from "../utils/whyTodaySummary";

const LEAN_VISUAL: Record<WhyLean, { label: string; color: string; emoji: string }> = {
  bullish: { label: "Bullish", color: "#16A34A", emoji: "🟢" },
  bearish: { label: "Bearish", color: "#DC2626", emoji: "🔴" },
  neutral: { label: "Neutral", color: "#CA8A04", emoji: "🟡" },
};

function CommodityBlock({ title, data }: { title: string; data: WhyCommodity }) {
  const vis = LEAN_VISUAL[data.lean];

  return (
    <div className="rounded-xl p-3" style={{ background: `${vis.color}0A`, border: `1px solid ${vis.color}26` }}>
      <div className="flex items-center justify-between">
        <p className="text-xs font-black">{title}</p>
        <span className="text-[11px] font-black" style={{ color: vis.color }}>
          {vis.emoji} {vis.label}
        </span>
      </div>

      {data.aiSummary ? (
        <p className="text-[12px] text-slate-600 leading-snug mt-1.5">{data.aiSummary}</p>
      ) : data.available ? (
        <p className="text-[12px] text-slate-600 leading-snug mt-1.5">Driven by the headlines below.</p>
      ) : (
        <p className="text-[12px] text-slate-500 leading-snug mt-1.5">No major news catalyst in the feed right now — today's move looks driven by technicals and positioning.</p>
      )}

      {data.available && (
        <div className="mt-2 rounded-lg px-2.5 py-1.5 flex items-start gap-1.5" style={{ background: "var(--color-surface-soft)" }}>
          <Clock size={12} className="text-slate-400 shrink-0 mt-0.5" />
          <p className="text-[11px]">
            <b style={{ color: vis.color }}>{data.durationRead}</b>
            <span className="text-slate-500"> — {data.durationWhy}</span>
          </p>
        </div>
      )}

      {data.drivers.length > 0 && (
        <div className="mt-2 space-y-1">
          {data.drivers.slice(0, 3).map((d, i) => {
            const dv = LEAN_VISUAL[d.impact];
            const row = (
              <div className="flex items-start gap-1.5">
                <span className="shrink-0 mt-0.5 text-[10px]" style={{ color: dv.color }}>
                  {dv.emoji}
                </span>
                <span className="text-[11px] text-slate-600 leading-snug">
                  {d.headline}
                  <span className="text-slate-400"> · {d.source}</span>
                  {d.url ? <ExternalLink size={9} className="inline ml-0.5 mb-0.5 text-slate-400" /> : null}
                </span>
              </div>
            );
            return d.url ? (
              <a key={i} href={d.url} target="_blank" rel="noreferrer" className="block">
                {row}
              </a>
            ) : (
              <div key={i}>{row}</div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// The plain-language "why is it moving today" read, grounded entirely in the
// app's real news feed. The direction and headlines are deterministic; the
// one-line summary is AI-written strictly from those same headlines.
export function WhyTodayCard() {
  const { data } = useWhyToday();

  return (
    <div className="rounded-2xl bg-white border border-slate-100 shadow-sm overflow-hidden">
      <div className="px-4 pt-3.5 pb-2 flex items-center justify-between">
        <p className="text-xs font-black uppercase tracking-wide text-slate-500 flex items-center gap-1.5">
          <Newspaper size={13} className="text-violet-600" /> Why Today — Crude &amp; Gas
        </p>
        <span className="text-[9px] text-slate-400 flex items-center gap-1">
          <Sparkles size={10} /> AI + real news
        </span>
      </div>

      {!data ? (
        <p className="px-4 pb-4 text-[11px] text-slate-400">Reading the news feed for today's drivers…</p>
      ) : (
        <div className="px-3 pb-3 space-y-2">
          <CommodityBlock title="Crude Oil" data={data.crude} />
          <CommodityBlock title="Natural Gas" data={data.naturalGas} />
          <p className="text-[9px] text-slate-400 px-1">Summarized only from the real headlines shown — never invented. Tap a headline to read the source.</p>
        </div>
      )}
    </div>
  );
}
