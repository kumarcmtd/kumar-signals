import { useMemo, useState } from "react";
import { Moon, TrendingUp, TrendingDown, Minus, ChevronDown, Clock } from "lucide-react";
import { useCandles } from "../api/hooks";
import {
  buildGapSessions, studyBucket, latestGap, analyzeSessionWindows, BUCKET_LABEL,
  type GapVerdict, type GapBucket,
} from "../utils/overnightGapEngine";
import type { InstrumentSymbol } from "../types";

// AI-Shoot is a light page, so these are the darker, print-safe variants of
// the app's signal palette -- the neon greens/ambers used on the dark pages
// are unreadable as text on white.
const VERDICT_STYLE: Record<GapVerdict, { color: string; headline: string }> = {
  follow: { color: "#15803D", headline: "Move usually CONTINUED" },
  fade: { color: "#DC2626", headline: "Move usually FADED BACK" },
  mixed: { color: "#B45309", headline: "No reliable edge — wait" },
  insufficient: { color: "#64748B", headline: "Not enough history to call" },
};

const GAP_COLOR = (bucket: GapBucket) =>
  bucket === "strong_up" || bucket === "up" ? "#16A34A" : bucket === "strong_down" || bucket === "down" ? "#DC2626" : "#64748B";

const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(2)}%`;

// Answers the question the gap itself cannot: MCX reopens on Asian hours
// alone, so "global moved overnight" and "the move is tradable at 9 AM" are
// not the same statement. Everything here is counted from real candles --
// where there isn't enough history, it says so rather than guessing.
export function OvernightImpactCard({ symbol, displayName }: { symbol: InstrumentSymbol; displayName: string }) {
  const daily = useCandles(symbol, "1D");
  const intraday = useCandles(symbol, "15");
  const [open, setOpen] = useState(false);

  const dailyCandles = daily.data?.candles;
  const intradayCandles = intraday.data?.candles;

  const gap = useMemo(() => (dailyCandles ? latestGap(dailyCandles) : null), [dailyCandles]);
  const sessions = useMemo(() => (dailyCandles ? buildGapSessions(dailyCandles) : []), [dailyCandles]);
  const study = useMemo(() => (gap ? studyBucket(sessions, gap.bucket) : null), [sessions, gap]);
  const windows = useMemo(() => (intradayCandles ? analyzeSessionWindows(intradayCandles) : null), [intradayCandles]);

  if (daily.isLoading) return <div className="h-24 rounded-2xl bg-white/60 shadow-sm motion-safe:animate-pulse" />;
  if (!gap || !study) return null;

  const gapColor = GAP_COLOR(gap.bucket);
  const v = VERDICT_STYLE[study.verdict];
  const Arrow = gap.gapPct > 0 ? TrendingUp : gap.gapPct < 0 ? TrendingDown : Minus;
  const morning = windows?.shares.find((s) => s.id === "morning");
  const sessionDate = new Date(gap.date).toLocaleDateString("en-US", { day: "numeric", month: "short" });

  return (
    <div className="rounded-2xl overflow-hidden shadow-md" style={{ border: `2px solid ${gapColor}` }}>
      <div className="px-3.5 pt-2.5 pb-2.5 text-white" style={{ background: `linear-gradient(135deg, ${gapColor}, ${gapColor}CC)` }}>
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 min-w-0">
            <Moon size={13} />
            <span className="text-[10px] font-black uppercase tracking-wide truncate">Overnight global · {displayName}</span>
          </span>
          <span className="text-[9px] text-white/70 shrink-0">{sessionDate} open</span>
        </div>

        <div className="flex items-baseline gap-2 mt-1">
          <Arrow size={17} />
          <span className="text-xl font-black">{signed(gap.gapPct)}</span>
          <span className="text-[11px] font-bold">{BUCKET_LABEL[gap.bucket]}</span>
        </div>
        <p className="text-[10px] text-white/80 mt-0.5">
          Global markets repriced while MCX was shut — it reopened at ₹{gap.open.toFixed(2)} against ₹{gap.prevClose.toFixed(2)}.
        </p>
      </div>

      <div className="px-3.5 py-2.5 bg-white">
        <p className="text-[12.5px] font-black" style={{ color: v.color }}>
          {v.headline}
        </p>
        <p className="text-[10.5px] text-slate-500 mt-0.5 leading-snug">{study.verdictReason}</p>

        {study.sessions > 0 && (
          <div className="flex gap-1.5 mt-2">
            <Stat label="Continued" value={`${study.continuedPct}%`} color="#15803D" />
            <Stat label="Faded" value={`${study.fadedPct}%`} color="#DC2626" />
            <Stat label="Flat" value={`${study.flatPct}%`} color="#64748B" />
          </div>
        )}

        {/* The "should I wait for Europe / US?" answer, measured not asserted. */}
        {morning && windows?.available && (
          <div className="mt-2.5 rounded-xl px-2.5 py-2 flex items-start gap-1.5" style={{ background: "#F0F9FF", border: "1px solid #BAE6FD" }}>
            <Clock size={12} className="text-[#0284C7] shrink-0 mt-0.5" />
            <p className="text-[10px] text-slate-600 leading-snug">
              The 9:00 AM–12:30 PM window is Asia-only and carries just <span className="font-black text-[#0284C7]">{morning.volumeSharePct}%</span> of the day's volume. The real move usually
              lands after Europe (12:30 PM) and the US (6:00 PM) arrive.
            </p>
          </div>
        )}

        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="w-full mt-2 flex items-center justify-center gap-1 text-[10px] font-bold text-slate-400 py-1"
        >
          {open ? "Hide" : "How this was measured"}
          <ChevronDown size={11} className={open ? "rotate-180 transition-transform" : "transition-transform"} />
        </button>

        {open && (
          <div className="text-[10px] text-slate-500 leading-relaxed space-y-1.5 pb-1">
            <p>
              Counted from <span className="font-bold text-slate-700">{sessions.length} past sessions</span> of this symbol's own daily candles, of which{" "}
              <span className="font-bold text-slate-700">{study.sessions}</span> opened with a similar {BUCKET_LABEL[gap.bucket].toLowerCase()} gap.
            </p>
            {study.avgFollowThroughPct !== null && (
              <p>
                After the open those days moved a further <span className="font-bold text-slate-700">{signed(study.avgFollowThroughPct)}</span> on average in the gap's direction (median{" "}
                {signed(study.medianFollowThroughPct ?? 0)}), with a typical best run of {study.avgFavourablePct?.toFixed(2)}% and a typical pullback against it of{" "}
                {study.avgAdversePct?.toFixed(2)}%.
              </p>
            )}
            {windows?.available && <p>Session split measured over {windows.sessions} full intraday sessions.</p>}
            <p className="text-slate-400">
              The overnight global move is read as the gap itself — MCX's open against its own previous close is the market repricing everything that happened while it was shut. Base rates describe
              the past only; they are not a forecast.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex-1 rounded-lg px-2 py-1.5" style={{ background: `${color}14` }}>
      <p className="text-[9px] text-slate-400">{label}</p>
      <p className="text-[13px] font-black" style={{ color }}>
        {value}
      </p>
    </div>
  );
}
