import { useMemo } from "react";
import { Globe, ArrowDown, TrendingUp, TrendingDown, Minus, Ruler, Clock, AlertTriangle } from "lucide-react";
import { useOvernightTracker, useSessionCandles, useHistory30m, useMarketStatus } from "../api/hooks";
import { readLiveSessionTrend, istToday, fmtPrice } from "../utils/liveSessionTrend";
import { readSessionRoom } from "../utils/sessionRoomLeft";
import { buildFollowThroughStudy, bandFor, BAND_LABEL } from "../utils/overnightFollowThrough";
import type { InstrumentSymbol, OvernightMove } from "../types";

const UP = "#15803D";
const DOWN = "#B91C1C";
const FLAT = "#64748B";

function inkFor(pct: number | null | undefined): string {
  if (pct === null || pct === undefined) return FLAT;
  if (pct > 0.05) return UP;
  if (pct < -0.05) return DOWN;
  return FLAT;
}

function Pct({ value, size = 13 }: { value: number | null; size?: number }) {
  if (value === null) return <span className="font-black text-slate-400" style={{ fontSize: size }}>—</span>;
  const Icon = value > 0.05 ? TrendingUp : value < -0.05 ? TrendingDown : Minus;
  return (
    <span className="font-black inline-flex items-center gap-0.5" style={{ color: inkFor(value), fontSize: size }}>
      <Icon size={size - 2} />
      {value > 0 ? "+" : ""}{value}%
    </span>
  );
}

/** One numbered step, so the three readings are obviously a sequence. */
function Step({ n, title, sub, children, tone }: { n: number; title: string; sub?: string; children: React.ReactNode; tone: string }) {
  return (
    <div className="rounded-2xl bg-white border border-[var(--color-border)] overflow-hidden">
      <div className="px-3 py-2 flex items-center gap-2" style={{ background: `${tone}12`, borderBottom: `1px solid ${tone}30` }}>
        <span className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black text-white" style={{ background: tone }}>{n}</span>
        <div className="min-w-0">
          <p className="text-[11.5px] font-black text-slate-800 leading-tight">{title}</p>
          {sub && <p className="text-[9px] text-slate-500 leading-tight">{sub}</p>}
        </div>
      </div>
      <div className="px-3 py-2.5">{children}</div>
    </div>
  );
}

function MoveRow({ m, hasAnchor }: { m: OvernightMove; hasAnchor: boolean }) {
  return (
    <div className="flex items-center gap-2 py-1.5 border-b last:border-b-0 border-slate-100">
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-bold text-slate-700 truncate">{m.name}</p>
        <p className="text-[9px] text-slate-400">
          {m.error
            ? m.error
            : hasAnchor && m.anchorPrice !== null
              ? `${m.anchorPrice} at MCX close → ${m.price ?? "—"} now`
              : `Now ${m.price ?? "—"}`}
        </p>
      </div>
      {hasAnchor ? <Pct value={m.changePct} /> : <Pct value={m.dayChangePct} />}
    </div>
  );
}

/**
 * The overnight-to-now chain, in three steps.
 *
 * Step 1: how far the world moved since MCX shut.
 * Step 2: what MCX did with that at 9:00 AM -- the gap, or "not open yet".
 * Step 3: where it has gone since the open, and how much of a typical day's
 *         range is left.
 *
 * Step 1 needs a recorded price, not a calculation: the app holds only the
 * CURRENT global quote, so the Worker's cron snapshots WTI/Brent/Henry Hub just
 * after MCX closes and this measures against that. Until the first snapshot
 * exists there is nothing honest to measure, so the card shows Yahoo's own day
 * change instead and says plainly that it covers a different window.
 *
 * Steps 2 and 3 reuse candle queries the page already holds, so they add no
 * Upstox call and no Worker CPU.
 */
export function OvernightToNowCard({ symbol }: { symbol: InstrumentSymbol }) {
  const tracker = useOvernightTracker();
  const status = useMarketStatus();
  const open = status.data?.isOpen ?? false;
  const candlesQ = useSessionCandles(symbol, open);
  const history = useHistory30m(symbol, true);

  const candles = candlesQ.data && "candles" in candlesQ.data ? candlesQ.data.candles : undefined;
  const today = istToday();

  const trend = useMemo(
    () => (candles && candles.length ? readLiveSessionTrend(candles, { marketOpen: open, today }) : null),
    [candles, open, today]
  );
  const room = useMemo(() => (candles && candles.length ? readSessionRoom(candles, today) : null), [candles, today]);

  // The gap band's own history, from the study already rendered below this card.
  const bandStudy = useMemo(() => {
    const hist = history.data?.candles;
    if (!hist || !hist.length || !trend || trend.gapPct === null) return null;
    const band = bandFor(trend.gapPct);
    return buildFollowThroughStudy(hist).bands.find((b) => b.band === band) ?? null;
  }, [history.data, trend]);

  const moves = tracker.data?.moves ?? [];
  const relevant = moves.filter((m) => m.tracksMCX === symbol);
  const hasAnchor = Boolean(tracker.data?.anchor);
  const sessionStarted = Boolean(trend && trend.openPrice !== null);

  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <Globe size={16} className="text-indigo-600 shrink-0" />
        <div className="min-w-0">
          <h2 className="text-[13.5px] font-black text-slate-800">Overnight → open → now</h2>
          <p className="text-[9.5px] text-slate-500">World moved, MCX gapped, and where it has gone since</p>
        </div>
      </div>

      {/* ---- 1. Since MCX shut ---- */}
      <Step
        n={1}
        title="Since MCX closed last night"
        sub={hasAnchor ? `Measured from a price recorded at 11:30 PM${tracker.data?.anchor ? ` on ${tracker.data.anchor.istDate}` : ""}` : "No close-time snapshot recorded yet"}
        tone="#4F46E5"
      >
        {tracker.isLoading ? (
          <div className="h-12 rounded-lg bg-slate-100 motion-safe:animate-pulse" />
        ) : relevant.length === 0 ? (
          <p className="text-[10px] text-slate-500">Global quotes unavailable right now.</p>
        ) : (
          <>
            {relevant.map((m) => <MoveRow key={m.symbol} m={m} hasAnchor={hasAnchor} />)}
            {!hasAnchor && (
              <p className="text-[9.5px] text-amber-700 leading-snug mt-1.5 flex items-start gap-1">
                <AlertTriangle size={10} className="shrink-0 mt-[2px]" />
                These are <b className="mx-0.5">Yahoo's own day figures</b>, measured from the previous US session close — a longer window that partly covers ground MCX had already
                priced in before it shut. The first true 11:30 PM snapshot is taken tonight, after which this row switches to a real since-MCX-closed figure.
              </p>
            )}
          </>
        )}
      </Step>

      <div className="flex justify-center"><ArrowDown size={14} className="text-slate-300" /></div>

      {/* ---- 2. The gap ---- */}
      <Step
        n={2}
        title="What MCX did at 9:00 AM"
        sub={sessionStarted ? "Yesterday's close against today's open" : "Today's session has not started"}
        tone="#0891B2"
      >
        {!sessionStarted || !trend ? (
          <p className="text-[10.5px] text-slate-600 leading-snug">
            MCX has not opened yet, so there is no gap to report. Whatever step 1 shows above is the pressure the open will have to absorb — but the size of the gap is not
            knowable until it prints.
          </p>
        ) : trend.gapPct === null ? (
          <p className="text-[10.5px] text-slate-600 leading-snug">Yesterday's closing bar isn't in the data, so the gap can't be measured from real candles. Nothing is estimated here.</p>
        ) : (
          <>
            <div className="flex items-center gap-2 flex-wrap">
              <Pct value={trend.gapPct} size={17} />
              <span className="text-[10px] font-bold px-2 py-[2px] rounded-full" style={{ background: `${inkFor(trend.gapPct)}15`, color: inkFor(trend.gapPct) }}>
                {BAND_LABEL[bandFor(trend.gapPct)]}
              </span>
            </div>
            <p className="text-[10px] text-slate-500 leading-snug mt-1">
              Closed {fmtPrice(trend.prevClose!)} → opened {fmtPrice(trend.openPrice!)}.
            </p>
            {bandStudy && !bandStudy.thin && (
              <p className="text-[10px] text-slate-600 leading-snug mt-1.5 flex items-start gap-1">
                <Clock size={10} className="shrink-0 mt-[2px] text-indigo-500" />
                {bandStudy.verdict}
              </p>
            )}
            {bandStudy?.thin && (
              <p className="text-[9.5px] text-amber-700 leading-snug mt-1.5">Only {bandStudy.sessions} past days gapped like this — too few to read a pattern into.</p>
            )}
          </>
        )}
      </Step>

      <div className="flex justify-center"><ArrowDown size={14} className="text-slate-300" /></div>

      {/* ---- 3. Since the open, and room left ---- */}
      <Step
        n={3}
        title="Since the open, up to now"
        sub={open ? "Live, from the candles forming today" : "MCX is shut — this is the last completed session"}
        tone="#7C3AED"
      >
        {!sessionStarted || !trend ? (
          <p className="text-[10.5px] text-slate-600 leading-snug">Nothing has traded yet today.</p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-1.5">
              <div className="rounded-lg bg-slate-50 px-2 py-1.5 text-center">
                <p className="text-[8px] font-bold uppercase text-slate-400">Since open</p>
                <p className="text-[12.5px] font-black" style={{ color: inkFor(trend.movePct) }}>
                  {trend.movePct === null ? "—" : `${trend.movePct > 0 ? "+" : ""}${trend.movePct}%`}
                </p>
              </div>
              <div className="rounded-lg bg-slate-50 px-2 py-1.5 text-center">
                <p className="text-[8px] font-bold uppercase text-slate-400">Day range</p>
                <p className="text-[12.5px] font-black text-slate-600">{room?.usedPct === null || room?.usedPct === undefined ? "—" : `${room.usedPct}%`}</p>
              </div>
              <div className="rounded-lg bg-slate-50 px-2 py-1.5 text-center">
                <p className="text-[8px] font-bold uppercase text-slate-400">Typical day</p>
                <p className="text-[12.5px] font-black text-slate-600">{room?.typicalRangePct === null || room?.typicalRangePct === undefined ? "—" : `${room.typicalRangePct}%`}</p>
              </div>
            </div>

            {/* How much of an ordinary day's travel is already used. */}
            {room && room.usedShare !== null && !room.thin && (
              <div className="mt-2">
                <div className="relative h-2.5 rounded-full bg-slate-200 overflow-hidden">
                  <div
                    className="absolute inset-y-0 left-0 rounded-full"
                    style={{ width: `${Math.min(100, room.usedShare)}%`, background: room.usedShare >= 100 ? DOWN : room.usedShare >= 70 ? "#D97706" : "#4F46E5" }}
                  />
                </div>
                <p className="text-[9px] text-slate-500 mt-1">{Math.min(100, room.usedShare)}% of a typical day's range used</p>
              </div>
            )}

            {room && <p className="text-[10.5px] text-slate-700 leading-snug mt-2 flex items-start gap-1"><Ruler size={11} className="shrink-0 mt-[2px] text-violet-500" />{room.verdict}</p>}

            {bandStudy && !bandStudy.thin && bandStudy.medianExtensionPct !== null && (
              <p className="text-[10px] text-slate-600 leading-snug mt-1.5">
                Separately: on the {bandStudy.sessions} past days that gapped like today, the <b>median</b> extra move past the open was <b>{bandStudy.medianExtensionPct}%</b>. That
                and the range figure above answer slightly different questions and will sometimes disagree — both are shown rather than one being picked for you.
              </p>
            )}

            <p className="text-[9.5px] text-slate-400 leading-relaxed mt-2">
              <b>What "room left" is not.</b> It is the middle of a wide spread, measured over past sessions — a trending day goes straight through it and a dead day never
              reaches it. It says nothing about which direction the rest of the move goes, and no price target is implied. The live card at the top of this page is what tells you
              whether the move you are in is still working.
            </p>
          </>
        )}
      </Step>
    </section>
  );
}
