import { useMemo, useState, useEffect } from "react";
import { Moon, TrendingUp, TrendingDown, Minus, ChevronDown, Clock, Maximize2, Minimize2 } from "lucide-react";
import { useGapStudy, useCandles } from "../api/hooks";
import {
  sessionsFromRecords, studyBucket, bucketForGap, analyzeSessionWindows, compareGlobalToMcx, BUCKET_LABEL,
  type GapVerdict, type GapBucket, type ReactionVerdict,
} from "../utils/overnightGapEngine";
import type { InstrumentSymbol } from "../types";

// AI-Shoot is a light page, so these are the darker, print-safe variants of
// the app's signal palette -- the neon greens/ambers used on the dark pages
// are unreadable as text on white.
const VERDICT_STYLE: Record<GapVerdict, { color: string; headline: string }> = {
  follow: { color: "#15803D", headline: "Usually STILL GOING at 11 AM" },
  fade: { color: "#DC2626", headline: "Usually FADED BACK by 11 AM" },
  mixed: { color: "#B45309", headline: "No reliable edge — wait" },
  insufficient: { color: "#64748B", headline: "Not enough history to call" },
};

const GAP_COLOR = (bucket: GapBucket) =>
  bucket === "strong_up" || bucket === "up" ? "#16A34A" : bucket === "strong_down" || bucket === "down" ? "#DC2626" : "#64748B";

const REACTION_TONE: Record<ReactionVerdict, { color: string; soft: string; ring: string }> = {
  priced_in: { color: "#475569", soft: "#F1F5F9", ring: "#CBD5E1" },
  under: { color: "#0369A1", soft: "#E0F2FE", ring: "#BAE6FD" },
  over: { color: "#B45309", soft: "#FEF3C7", ring: "#FDE68A" },
  against: { color: "#B91C1C", soft: "#FEE2E2", ring: "#FECACA" },
  unknown: { color: "#64748B", soft: "#F1F5F9", ring: "#CBD5E1" },
};

const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(2)}%`;

// Collapsed state is per-symbol and remembered, so a trader who only wants the
// one-line version doesn't have to re-collapse it on every visit. localStorage
// can throw outright in a private window, so every access is guarded.
function useRemembered(key: string, initial: boolean): [boolean, (v: boolean) => void] {
  const [value, setValue] = useState(initial);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw !== null) setValue(raw === "1");
    } catch {
      // Storage unavailable -- fall back to the default, don't crash the page.
    }
  }, [key]);
  const set = (v: boolean) => {
    setValue(v);
    try {
      localStorage.setItem(key, v ? "1" : "0");
    } catch {
      /* not persisting is fine */
    }
  };
  return [value, set];
}

// What global did while MCX was shut, and what happened over the FIRST TWO
// HOURS on the sessions that started the same way -- not where the session
// eventually closed 14 hours later, which is a different question entirely.
export function OvernightImpactCard({ symbol, displayName }: { symbol: InstrumentSymbol; displayName: string }) {
  const { data, isLoading } = useGapStudy(symbol);
  const intraday = useCandles(symbol, "15");
  const [collapsed, setCollapsed] = useRemembered(`overnight-collapsed:${symbol}`, false);
  const [open, setOpen] = useState(false);

  const sessions = useMemo(() => sessionsFromRecords(data?.sessions ?? []), [data?.sessions]);
  const latest = data?.latest ?? null;
  const study = useMemo(() => (latest ? studyBucket(sessions, bucketForGap(latest.gapPct)) : null), [sessions, latest]);
  const windows = useMemo(() => (intraday.data?.candles ? analyzeSessionWindows(intraday.data.candles) : null), [intraday.data?.candles]);

  if (isLoading) return <div className="h-16 rounded-2xl bg-white/60 shadow-sm motion-safe:animate-pulse" />;
  if (!latest || !study) return null;

  const bucket = bucketForGap(latest.gapPct);
  const gapColor = GAP_COLOR(bucket);
  const v = VERDICT_STYLE[study.verdict];
  const Arrow = latest.gapPct > 0 ? TrendingUp : latest.gapPct < 0 ? TrendingDown : Minus;
  const morning = windows?.shares.find((s) => s.id === "morning");
  const vsGlobal = compareGlobalToMcx(data?.global?.changePct, latest.gapPct);
  const sessionDate = new Date(latest.date).toLocaleDateString("en-US", { day: "numeric", month: "short" });

  // Collapsed: one line carrying the gap and the verdict, nothing else.
  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        className="w-full rounded-2xl px-3 py-2 flex items-center gap-2 bg-white shadow-sm"
        style={{ border: `1.5px solid ${gapColor}66` }}
        aria-label={`Expand overnight impact for ${displayName}`}
      >
        <Moon size={12} style={{ color: gapColor }} className="shrink-0" />
        <span className="text-[11px] font-bold text-slate-600 shrink-0">{displayName}</span>
        <Arrow size={13} style={{ color: gapColor }} className="shrink-0" />
        <span className="text-[12px] font-black shrink-0" style={{ color: gapColor }}>
          {signed(latest.gapPct)}
        </span>
        <span className="text-[10px] font-bold truncate" style={{ color: v.color }}>
          {study.verdict === "insufficient" ? "too few to call" : v.headline.replace("Usually ", "")}
        </span>
        <Maximize2 size={12} className="text-slate-300 ml-auto shrink-0" />
      </button>
    );
  }

  return (
    <div className="rounded-2xl overflow-hidden shadow-md" style={{ border: `2px solid ${gapColor}` }}>
      <div className="px-3.5 pt-2.5 pb-2.5 text-white" style={{ background: `linear-gradient(135deg, ${gapColor}, ${gapColor}CC)` }}>
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 min-w-0">
            <Moon size={13} />
            <span className="text-[10px] font-black uppercase tracking-wide truncate">Overnight global · {displayName}</span>
          </span>
          <span className="flex items-center gap-2 shrink-0">
            <span className="text-[9px] text-white/70">{sessionDate} open{latest.live ? " · live" : ""}</span>
            <button type="button" onClick={() => setCollapsed(true)} aria-label={`Minimise overnight impact for ${displayName}`} className="p-0.5 -m-0.5 text-white/80">
              <Minimize2 size={13} />
            </button>
          </span>
        </div>

        <div className="flex items-baseline gap-2 mt-1">
          <Arrow size={17} />
          <span className="text-xl font-black">{signed(latest.gapPct)}</span>
          <span className="text-[11px] font-bold">{BUCKET_LABEL[bucket]}</span>
        </div>
        <p className="text-[10px] text-white/80 mt-0.5">
          Reopened at ₹{latest.open.toFixed(2)} against ₹{latest.prevClose.toFixed(2)} — global repriced it while MCX was shut.
        </p>
      </div>

      <div className="px-3.5 py-2.5 bg-white">
        <p className="text-[9px] font-black uppercase tracking-wide text-slate-400">First 2 hours · 9:00–11:00 AM</p>
        <p className="text-[12.5px] font-black mt-0.5" style={{ color: v.color }}>
          {v.headline}
        </p>
        <p className="text-[10.5px] text-slate-500 mt-0.5 leading-snug">{study.verdictReason}</p>

        {vsGlobal && (
          <div className="mt-2 rounded-xl px-2.5 py-2" style={{ background: REACTION_TONE[vsGlobal.verdict].soft, border: `1px solid ${REACTION_TONE[vsGlobal.verdict].ring}` }}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-black" style={{ color: REACTION_TONE[vsGlobal.verdict].color }}>
                {vsGlobal.headline}
              </span>
              <span className="text-[10px] font-bold text-slate-500 shrink-0">
                {signed(vsGlobal.globalPct)} vs {signed(vsGlobal.mcxPct)}
              </span>
            </div>
            <p className="text-[10px] text-slate-500 leading-snug mt-0.5">{vsGlobal.detail}</p>
            <p className="text-[9px] text-slate-400 mt-1">
              {data?.global?.name} against its own previous close — a near but not identical window to "since MCX shut", and no USD/INR move is applied, so part of any difference is simply currency.
            </p>
          </div>
        )}

        {study.sessions > 0 && (
          <div className="flex gap-1.5 mt-2">
            <Stat label="Continued" value={`${study.continuedPct}%`} color="#15803D" />
            <Stat label="Faded" value={`${study.fadedPct}%`} color="#DC2626" />
            <Stat label="Flat" value={`${study.flatPct}%`} color="#64748B" />
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
              Counted from <span className="font-bold text-slate-700">{sessions.length} past sessions</span> of this contract's own 30-minute bars, of which{" "}
              <span className="font-bold text-slate-700">{study.sessions}</span> opened with a similar {BUCKET_LABEL[bucket].toLowerCase()} gap. MCX futures roll monthly, so a contract only has as
              much history as it has existed.
            </p>
            {study.avgFollowThroughPct !== null && (
              <p>
                Between 9 and 11 those mornings moved a further <span className="font-bold text-slate-700">{signed(study.avgFollowThroughPct)}</span> on average in the gap's direction (median{" "}
                {signed(study.medianFollowThroughPct ?? 0)}), with a typical best run of {study.avgFavourablePct?.toFixed(2)}% and a typical pullback against it of{" "}
                {study.avgAdversePct?.toFixed(2)}%.
              </p>
            )}
            {morning && windows?.available && (
              <p className="flex items-start gap-1">
                <Clock size={11} className="text-[#0284C7] shrink-0 mt-0.5" />
                <span>
                  For context, this 9:00–12:30 stretch is Asia-only and carries just <span className="font-bold text-slate-700">{morning.volumeSharePct}%</span> of the day's volume — the bigger move
                  often waits for Europe (12:30 PM) and the US (6:00 PM). Measured over {windows.sessions} full sessions.
                </span>
              </p>
            )}
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
