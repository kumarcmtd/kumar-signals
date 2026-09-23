import { useMemo } from "react";
import {
  Activity, TrendingUp, TrendingDown, CheckCircle2, XCircle, AlertTriangle,
  Radio, Minus, Info, ArrowRight,
} from "lucide-react";
import { useSessionCandles, useMarketStatus } from "../api/hooks";
import { readLiveSessionTrend, istToday, fmtPrice, type LiveSessionTrend, type LiveTrendState } from "../utils/liveSessionTrend";
import type { InstrumentSymbol } from "../types";

/**
 * Colour is doing real work here, not decoration: green / amber / red is the
 * whole message read at arm's length from a phone at work, which is when this
 * card actually gets looked at.
 */
const TONE: Record<LiveTrendState, { ink: string; bg: string; border: string; Icon: typeof Activity; word: string }> = {
  extending: { ink: "#15803D", bg: "#F0FDF4", border: "#BBF7D0", Icon: TrendingUp, word: "STILL RUNNING" },
  weakening: { ink: "#B45309", bg: "#FFFBEB", border: "#FDE68A", Icon: AlertTriangle, word: "LOSING STEAM" },
  turned: { ink: "#B91C1C", bg: "#FEF2F2", border: "#FECACA", Icon: TrendingDown, word: "TURNED BACK" },
  no_direction: { ink: "#64748B", bg: "#F8FAFC", border: "#E2E8F0", Icon: Minus, word: "FLAT" },
  too_early: { ink: "#64748B", bg: "#F8FAFC", border: "#E2E8F0", Icon: Activity, word: "TOO EARLY" },
  no_session: { ink: "#64748B", bg: "#F8FAFC", border: "#E2E8F0", Icon: Activity, word: "NO DATA" },
};

function Stat({ label, value, ink }: { label: string; value: string; ink?: string }) {
  return (
    <div className="rounded-lg bg-white/70 px-2 py-1.5 text-center">
      <p className="text-[8px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="text-[12px] font-black leading-tight" style={{ color: ink ?? "#334155" }}>{value}</p>
    </div>
  );
}

/**
 * How much of the run has been handed back, drawn.
 *
 * Left edge is the opening price, right edge is the furthest the session got.
 * The marker is where price is NOW, so a move that is quietly round-tripping
 * is visible before the numbers are read.
 */
function GiveBackBar({ t }: { t: LiveSessionTrend }) {
  if (t.givebackPct === null || t.extremePrice === null || t.openPrice === null) return null;
  const held = Math.max(0, Math.min(100, 100 - t.givebackPct));
  const tone = TONE[t.state];
  return (
    <div className="mt-2">
      <div className="flex items-center justify-between text-[9px] font-bold text-slate-500 mb-1">
        <span>Open {fmtPrice(t.openPrice)}</span>
        <span>{t.direction > 0 ? "High" : "Low"} {fmtPrice(t.extremePrice)}{t.extremeTime ? ` · ${t.extremeTime}` : ""}</span>
      </div>
      <div className="relative h-2.5 rounded-full bg-slate-200 overflow-hidden">
        <div className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-500" style={{ width: `${held}%`, background: tone.ink }} />
      </div>
      <p className="text-[9.5px] text-slate-500 mt-1">
        {t.givebackPct <= 0
          ? `Holding the full move — price is at the session ${t.direction > 0 ? "high" : "low"}.`
          : `Held ${held}% of the move, gave back ${Math.min(100, t.givebackPct)}%${t.givebackPct > 100 ? " and more" : ""}.`}
      </p>
    </div>
  );
}

function CheckRow({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  const Icon = ok ? CheckCircle2 : XCircle;
  return (
    <div className="flex items-start gap-2 px-3 py-2 border-b last:border-b-0 border-slate-100">
      <Icon size={13} className="shrink-0 mt-[1px]" style={{ color: ok ? "#16A34A" : "#DC2626" }} />
      <div className="min-w-0">
        <p className="text-[11px] font-black" style={{ color: ok ? "#15803D" : "#B91C1C" }}>{label}</p>
        <p className="text-[10px] text-slate-600 leading-snug">{detail}</p>
      </div>
    </div>
  );
}

/**
 * Live intraday trend -- the candles forming right now.
 *
 * The overnight card below this one answers "given the gap, what usually
 * happens". This answers the question that replaces it the moment the bell
 * goes: the move is already underway, is it still pushing, is it tiring, or
 * has it turned back through the open.
 *
 * Everything is computed in the browser from the same 15-minute series the
 * rest of the app already pulls, so it adds no Worker CPU and no extra Upstox
 * call. It polls only while MCX is open.
 */
export function LiveSessionTrendCard({ symbol }: { symbol: InstrumentSymbol }) {
  const status = useMarketStatus();
  const open = status.data?.isOpen ?? false;
  const candlesQ = useSessionCandles(symbol, open);
  const candles = candlesQ.data && "candles" in candlesQ.data ? candlesQ.data.candles : undefined;
  const dataError = candlesQ.data && "error" in candlesQ.data ? (candlesQ.data as { error: string }).error : null;

  const trend = useMemo(
    () => (candles && candles.length ? readLiveSessionTrend(candles, { marketOpen: open, today: istToday() }) : null),
    [candles, open]
  );

  if (candlesQ.isLoading) return <div className="h-40 rounded-2xl bg-slate-100 motion-safe:animate-pulse" />;

  if (dataError || candlesQ.error || !trend) {
    return (
      <section className="space-y-2">
        <Header live={false} />
        <div className="rounded-2xl px-3 py-3" style={{ background: "#FFFBEB", border: "1px solid #FDE68A" }}>
          <p className="text-[11.5px] font-black text-amber-800">Live candles not available right now</p>
          <p className="text-[10px] text-slate-600 leading-snug mt-0.5">
            {dataError ?? (candlesQ.error as Error | undefined)?.message ?? "No intraday candles have arrived yet."} Nothing is shown rather than a stale reading dressed up as live.
          </p>
        </div>
      </section>
    );
  }

  const tone = TONE[trend.state];
  const moving = trend.state === "extending" || trend.state === "weakening" || trend.state === "turned";

  return (
    <section className="space-y-2">
      <Header live={open && !trend.stale} />

      <div className="rounded-2xl px-3 py-3" style={{ background: tone.bg, border: `1px solid ${tone.border}` }}>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[9px] font-black px-2 py-[2px] rounded-full text-white" style={{ background: tone.ink }}>{tone.word}</span>
          {trend.stale && <span className="text-[8.5px] font-black px-1.5 py-[1px] rounded-md bg-slate-200 text-slate-600">LAST SESSION</span>}
          {trend.forming && <span className="text-[8.5px] font-bold text-slate-500">bar still forming</span>}
          <span className="text-[9px] text-slate-400 ml-auto">{trend.bars} bars · {trend.barMinutes}m</span>
        </div>

        <p className="text-[14px] font-black mt-1.5 leading-tight flex items-start gap-1.5" style={{ color: tone.ink }}>
          <tone.Icon size={16} className="shrink-0 mt-[2px]" />
          {trend.headline}
        </p>

        {trend.story && <p className="text-[11px] text-slate-700 leading-snug mt-1">{trend.story}</p>}

        {moving && (
          <div className="grid grid-cols-4 gap-1.5 mt-2">
            <Stat label="Open" value={trend.openPrice === null ? "—" : fmtPrice(trend.openPrice)} />
            <Stat label="Now" value={trend.lastPrice === null ? "—" : fmtPrice(trend.lastPrice)} ink={tone.ink} />
            <Stat
              label="Since open"
              value={trend.movePct === null ? "—" : `${trend.movePct > 0 ? "+" : ""}${trend.movePct}%`}
              ink={(trend.movePct ?? 0) >= 0 ? "#15803D" : "#B91C1C"}
            />
            <Stat label="Day range" value={trend.rangePct === null ? "—" : `${trend.rangePct}%`} />
          </div>
        )}

        {moving && <GiveBackBar t={trend} />}

        <p className="text-[10.5px] text-slate-700 leading-snug mt-2">{trend.advice}</p>
      </div>

      {/* Why it says what it says. Each line is a fact about bars that have
          already printed, so the reader can disagree with the conclusion
          without having to trust the label on top. */}
      {trend.checks.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-[12px] font-black text-slate-800">What the forming candles show</h3>
            <span className="text-[9.5px] font-bold ml-auto" style={{ color: trend.healthy === trend.checks.length ? "#15803D" : trend.healthy <= 1 ? "#B91C1C" : "#B45309" }}>
              {trend.healthy} of {trend.checks.length} still healthy
            </span>
          </div>
          <div className="rounded-2xl bg-white border border-[var(--color-border)] overflow-hidden">
            {trend.checks.map((c) => <CheckRow key={c.id} ok={c.ok} label={c.label} detail={c.detail} />)}
          </div>
        </div>
      )}

      {trend.gapPct !== null && trend.prevClose !== null && (
        <p className="text-[9.5px] text-slate-500 leading-snug px-0.5 flex items-start gap-1">
          <ArrowRight size={10} className="shrink-0 mt-[2px] text-indigo-500" />
          It opened {trend.gapPct > 0 ? "+" : ""}{trend.gapPct}% against yesterday's {fmtPrice(trend.prevClose)} close. The card below shows what a gap that size usually did next.
        </p>
      )}

      <p className="text-[9.5px] text-slate-400 leading-relaxed px-0.5">
        Every line above describes candles that have <b>already printed</b>. A move that has stopped making new highs has, as a matter of record, stopped making new highs — but
        whether it resumes or reverses next is not knowable, and nothing here claims to know it. The newest bar is still being built and can change before it closes.
        {!open && " MCX is shut, so this is the last completed session rather than a live reading."}
      </p>
    </section>
  );
}

function Header({ live }: { live: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <Activity size={16} className="text-indigo-600 shrink-0" />
      <div className="min-w-0">
        <h2 className="text-[13.5px] font-black text-slate-800">Live: how today's move is going</h2>
        <p className="text-[9.5px] text-slate-500">Read off the candles forming since the 9:00 AM open</p>
      </div>
      <span
        className="ml-auto shrink-0 text-[8.5px] font-black px-2 py-[2px] rounded-full flex items-center gap-1"
        style={live ? { background: "#DCFCE7", color: "#15803D" } : { background: "#F1F5F9", color: "#64748B" }}
      >
        {live ? <Radio size={9} className="motion-safe:animate-pulse" /> : <Info size={9} />}
        {live ? "LIVE" : "CLOSED"}
      </span>
    </div>
  );
}
