import { useEffect, useState } from "react";
import { TrendingUp, TrendingDown, Minus, Zap, ExternalLink, Radio, CheckCircle2, XCircle } from "lucide-react";
import type { FlashItem, FlashPulse, FlashBias, FlashHeat, FlashDirection } from "../utils/aiFlashEngine";

export const BIAS_COLOR: Record<FlashBias, string> = {
  strong_bullish: "#00E676",
  bullish: "#4ADE80",
  neutral: "#FFC107",
  bearish: "#FB7185",
  strong_bearish: "#FF4D4F",
};

const HEAT_STYLE: Record<FlashHeat, { bg: string; label: string; pulse: boolean }> = {
  flash: { bg: "#FF2D55", label: "FLASH", pulse: true },
  hot: { bg: "#FF9500", label: "HOT", pulse: false },
  recent: { bg: "#FFC107", label: "RECENT", pulse: false },
  today: { bg: "#64748B", label: "TODAY", pulse: false },
  stale: { bg: "#475569", label: "OLD", pulse: false },
};

const DIR_STYLE: Record<FlashDirection, { color: string; Icon: typeof TrendingUp; label: string }> = {
  bullish: { color: "#00E676", Icon: TrendingUp, label: "Bullish" },
  bearish: { color: "#FF4D4F", Icon: TrendingDown, label: "Bearish" },
  neutral: { color: "#8B96A5", Icon: Minus, label: "Neutral" },
};

// Counts the displayed number up to the real score once, so a changing score
// is visibly a change rather than a silent swap. Purely presentational -- the
// value itself is never interpolated into anything but its own final number.
function useCountUp(value: number, ms = 550): number {
  const [shown, setShown] = useState(value);
  useEffect(() => {
    let raf = 0;
    const from = shown;
    const start = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / ms);
      setShown(Math.round(from + (value - from) * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return shown;
}

// The headline number. Unlike the app's CircularGauge (where high = good) this
// axis is directional: 100 is maximum BULLISH pressure and 0 is maximum
// BEARISH -- a low reading is not "bad", it is a PE signal. That different
// meaning is why this doesn't reuse CircularGauge's polarity.
export function FlashScoreCard({ title, pulse, active, onClick }: { title: string; pulse: FlashPulse; active: boolean; onClick: () => void }) {
  const color = BIAS_COLOR[pulse.bias];
  const shown = useCountUp(pulse.score);

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex-1 min-w-0 text-left rounded-2xl p-3 transition-all"
      style={{
        background: active ? `linear-gradient(160deg, ${color}22, #14161F 70%)` : "#14161F",
        border: `1.5px solid ${active ? color : "rgba(255,255,255,.08)"}`,
        boxShadow: active ? `0 0 18px ${color}33` : "none",
      }}
    >
      <div className="flex items-center justify-between gap-1">
        <p className="text-[11px] font-bold text-white/60 truncate">{title}</p>
        {pulse.freshCount > 0 && (
          <span className="shrink-0 text-[8px] font-black px-1.5 py-0.5 rounded-full" style={{ background: "#FF2D55", color: "#fff" }}>
            {pulse.freshCount} NEW
          </span>
        )}
      </div>

      <div className="flex items-baseline gap-1 mt-1">
        <span className="text-3xl font-black leading-none" style={{ color }}>
          {shown}
        </span>
        <span className="text-[11px] font-bold text-white/30">/100</span>
      </div>
      <p className="text-[11px] font-black mt-0.5" style={{ color }}>
        {pulse.biasLabel}
      </p>

      {/* Bear <-> Bull axis with the score marked on it. 50 is the neutral
          midpoint, drawn so the reading is legible at a glance. */}
      <div className="relative h-1.5 rounded-full mt-2" style={{ background: "linear-gradient(90deg,#FF4D4F,#FFC107 50%,#00E676)" }}>
        <div className="absolute top-1/2 w-0.5 h-2.5 -translate-y-1/2 bg-white/25" style={{ left: "50%" }} />
        <div
          className="absolute top-1/2 w-3 h-3 rounded-full -translate-y-1/2 -translate-x-1/2 border-2 border-[#14161F] transition-all duration-500"
          style={{ left: `${pulse.score}%`, background: color, boxShadow: `0 0 8px ${color}` }}
        />
      </div>
      <div className="flex justify-between text-[8px] font-bold text-white/25 mt-1">
        <span>BEARISH</span>
        <span>BULLISH</span>
      </div>

      <p className="text-[9px] text-white/40 mt-1.5">
        {pulse.quiet ? "No fresh news yet" : `${pulse.totalCount} stories · ${pulse.confidence}% conf`}
      </p>
    </button>
  );
}

export function FlashRow({ item }: { item: FlashItem }) {
  const heat = HEAT_STYLE[item.heat];
  const dir = DIR_STYLE[item.direction];
  const { Icon } = dir;

  return (
    <div className="rounded-xl p-3" style={{ background: "#14161F", border: `1px solid ${item.heat === "flash" ? "#FF2D5566" : "rgba(255,255,255,.07)"}` }}>
      <div className="flex items-center gap-1.5 flex-wrap">
        <span
          className={`text-[8px] font-black px-1.5 py-0.5 rounded ${heat.pulse ? "motion-safe:animate-pulse" : ""}`}
          style={{ background: heat.bg, color: "#fff" }}
        >
          {heat.label}
        </span>
        {/* Absolute stamp first, matching how a broker terminal prints it,
            then the relative age -- one answers "when exactly", the other
            answers "is this still fresh". */}
        <span className="text-[10px] font-bold text-white/70">{item.stamp}</span>
        <span className="text-[10px] text-white/20">·</span>
        <span className="text-[10px] font-bold text-white/45">{item.ageLabel}</span>
        <span className="text-[10px] text-white/20">·</span>
        <span className="text-[10px] text-white/40 truncate max-w-[45%]">{item.source}</span>
        {item.sourceTier === 1 && <span className="text-[8px] font-bold px-1 py-0.5 rounded bg-[#00C2FF22] text-[#00C2FF]">OFFICIAL</span>}
      </div>

      <p className="text-[12.5px] font-bold text-white/90 leading-snug mt-1.5">{item.headline}</p>

      <div className="flex items-center gap-2 mt-2">
        <span className="flex items-center gap-1 text-[10px] font-black px-2 py-1 rounded-lg" style={{ background: `${dir.color}1A`, color: dir.color }}>
          <Icon size={11} strokeWidth={2.6} />
          {dir.label}
        </span>
        {item.direction !== "neutral" && (
          <div className="flex-1 min-w-0">
            <div className="h-1.5 rounded-full bg-white/8 overflow-hidden">
              <div className="h-full rounded-full transition-all" style={{ width: `${item.strength}%`, background: dir.color }} />
            </div>
          </div>
        )}
        {item.url && (
          <a href={item.url} target="_blank" rel="noopener noreferrer" className="shrink-0 text-white/35 hover:text-white/70" aria-label="Open full story">
            <ExternalLink size={13} />
          </a>
        )}
      </div>
    </div>
  );
}

export function TopDriverCard({ pulse, symbolLabel }: { pulse: FlashPulse; symbolLabel: string }) {
  if (!pulse.topDriver) return null;
  const color = BIAS_COLOR[pulse.bias];
  const d = pulse.topDriver;
  return (
    <div className="rounded-2xl p-3.5" style={{ background: `linear-gradient(135deg, ${color}18, #14161F 65%)`, border: `1px solid ${color}44` }}>
      <div className="flex items-center gap-1.5">
        <Zap size={13} style={{ color }} />
        <p className="text-[10px] font-black uppercase tracking-wide" style={{ color }}>
          What's moving {symbolLabel} right now
        </p>
      </div>
      <p className="text-[12.5px] font-bold text-white/90 leading-snug mt-1.5">{d.headline}</p>
      <p className="text-[10px] text-white/40 mt-1.5">
        {d.source} · {d.ageLabel} · carries the most weight of any story on the feed right now.
      </p>
    </div>
  );
}

// Honest feed health. With this many sources some will always be down, and
// the trader deserves to know the feed is partial rather than assume silence
// means "no news" -- that assumption is exactly what loses money here.
export function FlashSourceHealth({ sourceStatus }: { sourceStatus: { source: string; ok: boolean; count: number; error?: string }[] }) {
  const [open, setOpen] = useState(false);
  if (sourceStatus.length === 0) return null;
  const live = sourceStatus.filter((s) => s.ok).length;
  const allGood = live === sourceStatus.length;

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: "#14161F", border: "1px solid rgba(255,255,255,.07)" }}>
      <button type="button" onClick={() => setOpen((v) => !v)} className="w-full flex items-center justify-between px-3.5 py-2.5">
        <span className="flex items-center gap-1.5 text-[11px] font-bold text-white/60">
          <Radio size={12} className={allGood ? "text-[#00E676]" : "text-[#FFC107]"} />
          {live} of {sourceStatus.length} news sources live
        </span>
        <span className="text-[10px] text-white/35">{open ? "Hide" : "Details"}</span>
      </button>
      {open && (
        <div className="px-3.5 pb-3 space-y-1">
          {sourceStatus.map((s) => (
            <div key={s.source} className="flex items-center justify-between gap-2 text-[10px]">
              <span className="flex items-center gap-1.5 min-w-0">
                {s.ok ? <CheckCircle2 size={11} className="text-[#00E676] shrink-0" /> : <XCircle size={11} className="text-[#FF4D4F] shrink-0" />}
                <span className="text-white/55 truncate">{s.source}</span>
              </span>
              <span className="text-white/30 shrink-0">{s.ok ? `${s.count} items` : (s.error ?? "unavailable")}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
