import { useMemo } from "react";
import { Moon, TrendingUp, TrendingDown, Info, Clock } from "lucide-react";
import { useHistory30m } from "../api/hooks";
import { buildFollowThroughStudy, type BandStudy, type FollowThroughSession } from "../utils/overnightFollowThrough";
import type { InstrumentSymbol } from "../types";

function bandInk(band: BandStudy["band"]): string {
  if (band.includes("up")) return "#15803D";
  if (band.includes("down")) return "#B91C1C";
  return "#64748B";
}

function BandRow({ b }: { b: BandStudy }) {
  const ink = bandInk(b.band);
  return (
    <div className="px-3 py-2.5 border-b last:border-b-0 border-slate-100">
      <div className="flex items-center gap-2">
        <span className="text-[11.5px] font-black" style={{ color: ink }}>{b.label}</span>
        <span className="text-[9px] text-slate-400 ml-auto">{b.sessions} {b.sessions === 1 ? "day" : "days"}</span>
        {b.thin && <span className="text-[8.5px] font-black px-1.5 py-[1px] rounded-md bg-amber-100 text-amber-700">Too few</span>}
      </div>

      {b.sessions > 0 && (
        <div className="grid grid-cols-3 gap-1.5 mt-1.5">
          <div className="rounded-lg bg-slate-50 px-2 py-1.5 text-center">
            <p className="text-[8px] font-bold uppercase text-slate-400">Kept going</p>
            <p className="text-[12px] font-black" style={{ color: ink }}>{b.continuedPct === null ? "—" : `${b.continuedPct}%`}</p>
          </div>
          <div className="rounded-lg bg-slate-50 px-2 py-1.5 text-center">
            <p className="text-[8px] font-bold uppercase text-slate-400">Came back</p>
            <p className="text-[12px] font-black text-slate-600">{b.filledPct === null ? "—" : `${b.filledPct}%`}</p>
          </div>
          <div className="rounded-lg bg-slate-50 px-2 py-1.5 text-center">
            <p className="text-[8px] font-bold uppercase text-slate-400">Extra move</p>
            <p className="text-[12px] font-black text-slate-600">{b.medianExtensionPct === null ? "—" : `${b.medianExtensionPct}%`}</p>
          </div>
        </div>
      )}

      {b.usualPeakWindow && !b.thin && (
        <div className="flex items-start gap-1 mt-1.5">
          <Clock size={10} className="shrink-0 mt-[2px] text-indigo-500" />
          <p className="text-[10px] text-slate-600 leading-snug">
            Ran furthest during <b>{b.usualPeakWindow}</b> on {b.usualPeakCount} of {b.sessions} days.
          </p>
        </div>
      )}

      <p className="text-[10px] text-slate-500 leading-snug mt-1">{b.verdict}</p>
    </div>
  );
}

function SessionRow({ s }: { s: FollowThroughSession }) {
  const up = s.gapPct >= 0;
  const ink = up ? "#15803D" : "#B91C1C";
  return (
    <div className="px-3 py-2 border-b last:border-b-0 border-slate-100">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10.5px] font-bold text-slate-700">{s.date}</span>
        <span className="text-[10px] font-black flex items-center gap-0.5" style={{ color: ink }}>
          {up ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
          {s.gapPct > 0 ? "+" : ""}{s.gapPct}% overnight
        </span>
        <span className="text-[9.5px] text-slate-500 ml-auto">
          {s.continued ? `then ran ${s.extensionPct}% further` : "then stalled"}
        </span>
      </div>
      <p className="text-[9.5px] text-slate-500 leading-snug mt-0.5">
        {s.peakWindowLabel ? `Furthest point during ${s.peakWindowLabel}. ` : ""}
        {s.filled ? "Came back through the opening price. " : "Never came back to the open. "}
        Closed {s.closeVsOpenPct > 0 ? "+" : ""}{s.closeVsOpenPct}% {s.closeVsOpenPct >= 0 ? "with" : "against"} the gap.
      </p>
    </div>
  );
}

/**
 * Overnight move -> next-day follow-through.
 *
 * Answers the question the gap study left open: not just whether MCX gaps, but
 * whether the move KEEPS GOING and roughly how far into the day it runs.
 *
 * Runs in the browser over the same 30-minute history the Backtest Lab uses --
 * no Worker CPU, no extra upstream call.
 */
export function OvernightFollowThroughCard({ symbol }: { symbol: InstrumentSymbol }) {
  const history = useHistory30m(symbol, true);
  const candles = history.data?.candles;

  const study = useMemo(() => (candles && candles.length ? buildFollowThroughStudy(candles) : null), [candles]);

  if (history.isLoading) return <div className="h-32 rounded-2xl bg-slate-100 motion-safe:animate-pulse" />;

  if (history.error || history.data?.error || !study || study.sessions.length === 0) {
    return (
      <div className="rounded-2xl px-3 py-3" style={{ background: "#FFFBEB", border: "1px solid #FDE68A" }}>
        <p className="text-[11.5px] font-black text-amber-800">Overnight study not available yet</p>
        <p className="text-[10px] text-slate-600 leading-snug mt-0.5">
          {history.data?.error ?? (history.error as Error | undefined)?.message ?? "Not enough completed sessions to measure follow-through."} Nothing is shown here rather than
          filling the gap with estimates.
        </p>
      </div>
    );
  }

  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <Moon size={16} className="text-indigo-600 shrink-0" />
        <div className="min-w-0">
          <h2 className="text-[13.5px] font-black text-slate-800">Overnight move, and what happened next</h2>
          <p className="text-[9.5px] text-slate-500">
            {study.sessions.length} sessions · {study.firstDate} to {study.lastDate}
          </p>
        </div>
      </div>

      <div className="rounded-xl px-3 py-2.5 flex items-start gap-2" style={{ background: "#EEF2FF", border: "1px solid #C7D2FE" }}>
        <Info size={12} className="shrink-0 mt-0.5 text-indigo-500" />
        <p className="text-[10px] text-slate-600 leading-snug">
          The overnight move is the gap between <b>yesterday's 11:30 PM close and today's 9:00 AM open</b>. That gap IS the overnight move in WTI or Henry Hub, already converted
          to rupees and already including the dollar-rupee move — so it is measured from real MCX candles rather than estimated from a US chart.
        </p>
      </div>

      <div className="rounded-2xl bg-white border border-[var(--color-border)] overflow-hidden">
        {study.bands.map((b) => <BandRow key={b.band} b={b} />)}
      </div>

      <p className="text-[9.5px] text-slate-500 leading-snug px-0.5">
        <b>Kept going</b> = moved at least another 0.3% past the open, in the gap's direction. <b>Came back</b> = traded back through the opening price at some point.
        <b> Extra move</b> is the typical (median) distance past the open, not the best day.
      </p>

      <div>
        <h3 className="text-[12px] font-black text-slate-800 mb-1">Recent sessions, one by one</h3>
        <div className="rounded-2xl bg-white border border-[var(--color-border)] overflow-hidden">
          {study.recent.map((s) => <SessionRow key={s.date} s={s} />)}
        </div>
      </div>

      <p className="text-[9.5px] text-slate-400 leading-relaxed px-0.5">
        Two honest limits. There is no historical news archive in this app, so a day that trended because of a 10 AM headline cannot be separated from one that simply followed
        through — some of what looks mechanical is news arriving after the open. And MCX futures roll monthly, so this covers weeks, not years: a pattern here is a hint worth
        watching, not a rule to trade blindly.
      </p>
    </section>
  );
}
