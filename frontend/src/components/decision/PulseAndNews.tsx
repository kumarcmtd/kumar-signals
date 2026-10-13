// Trend Pulse (steady vs choppy 5-minute candles, and "already ran far") and
// the news line, shown on the quick-look rows and on AI Verify Pro.
//   STEADY UP / DOWN -> vivid green / red, the six candles as a bar of blocks
//   CHOPPY           -> yellow: up-down candles, doubt
//   BUILDING         -> light green / light red
//   STRETCHED        -> an amber "don't chase" line

import { Flame, Newspaper, TriangleAlert, Waves } from "lucide-react";
import type { TrendPulse } from "../../utils/trendPulse";
import type { NewsPulse } from "../../utils/newsPulse";

const PULSE_LOOK: Record<TrendPulse["state"], { bg: string; ink: string; vivid: boolean }> = {
  STEADY_UP: { bg: "linear-gradient(90deg,#047857,#16A34A 45%,#84CC16)", ink: "#FFFFFF", vivid: true },
  STEADY_DOWN: { bg: "linear-gradient(90deg,#9F1239,#E11D48 45%,#F97316)", ink: "#FFFFFF", vivid: true },
  BUILDING_UP: { bg: "#DCFCE7", ink: "#166534", vivid: false },
  BUILDING_DOWN: { bg: "#FFE4E6", ink: "#9F1239", vivid: false },
  CHOPPY: { bg: "#FEF08A", ink: "#713F12", vivid: false },
  FLAT: { bg: "#F1F5F9", ink: "#475569", vivid: false },
};

function Blocks({ bars, vivid }: { bars: TrendPulse["bars"]; vivid: boolean }) {
  return (
    <span className="inline-flex gap-[3px]">
      {bars.map((b, i) => (
        <i
          key={i}
          className="w-2.5 h-2.5 rounded-[3px] inline-block"
          style={{
            background: b === "up" ? (vivid ? "#BBF7D0" : "#16A34A") : b === "down" ? (vivid ? "#FECDD3" : "#E11D48") : "#94A3B8",
            boxShadow: vivid ? "0 0 0 1px rgba(255,255,255,.5)" : undefined,
          }}
        />
      ))}
    </span>
  );
}

export function PulseStrip({ pulse, compact = false }: { pulse: TrendPulse; compact?: boolean }) {
  const L = PULSE_LOOK[pulse.state];
  const Icon = pulse.state === "CHOPPY" ? Waves : Flame;
  return (
    <div className="space-y-1">
      <div className="rounded-lg px-2 py-1.5 flex items-center gap-2" style={{ background: L.bg, color: L.ink }}>
        <Icon size={compact ? 12 : 14} className="shrink-0" />
        <div className="min-w-0 flex-1">
          <p className={`${compact ? "text-[10.5px]" : "text-[12px]"} font-black leading-tight`}>
            5-MIN TREND: {pulse.title}
            {L.vivid && " — continuing"}
          </p>
          {!compact && <p className="text-[10.5px] leading-snug opacity-90 mt-0.5">{pulse.detail}</p>}
        </div>
        <Blocks bars={pulse.bars} vivid={L.vivid} />
      </div>
      {pulse.stretched && (
        <p className="rounded-lg px-2 py-1 text-[10px] font-bold flex items-start gap-1 bg-amber-50 text-amber-800 border border-amber-200">
          <TriangleAlert size={11} className="shrink-0 mt-[1px]" />
          <span>
            Already ran far {pulse.stretched.side} ({pulse.stretched.atrs}× ATR from its 5-min average) — don't chase. Better entry near {pulse.stretched.pullbackTo}.
          </span>
        </p>
      )}
    </div>
  );
}

export function NewsLine({ news, side, compact = false }: { news: NewsPulse; side: "CE" | "PE" | null; compact?: boolean }) {
  const forSide = side === "PE" ? -news.net : news.net;
  const ink = !side || Math.abs(news.net) <= 10 ? "#475569" : forSide > 0 ? "#047857" : "#B91C1C";
  const word = news.direction === "bullish" ? "bullish" : news.direction === "bearish" ? "bearish" : "neutral";
  return (
    <div className="rounded-lg px-2 py-1.5 bg-white/90 border border-slate-200">
      <p className="text-[10.5px] font-black flex items-center gap-1" style={{ color: ink }}>
        <Newspaper size={11} />
        NEWS: {news.net > 0 ? "+" : ""}
        {news.net} {word}
        {side && Math.abs(news.net) > 10 && <span className="font-bold">· {forSide > 0 ? `supports ${side}` : `against ${side}`}</span>}
        <span className="ml-auto font-bold text-slate-400">{news.feedAgeMin !== null ? `${news.feedAgeMin} min ago` : ""}</span>
      </p>
      {!compact && news.top && (
        <p className="text-[10px] text-slate-600 leading-snug mt-0.5">
          {news.highImpactFresh > 0 && <b className="text-rose-600">{news.highImpactFresh} high-impact in 2h · </b>}
          {news.top.headline} <span className="text-slate-400">({news.top.source}, {news.top.ageMin} min)</span>
        </p>
      )}
    </div>
  );
}
