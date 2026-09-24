import { useMemo } from "react";
import { Globe, TrendingUp, TrendingDown, Minus, Ruler, Clock, AlertTriangle, Fuel, Flame, Radio } from "lucide-react";
import { useOvernightTracker, useSessionCandles, useHistory30m, useMarketStatus } from "../api/hooks";
import { readLiveSessionTrend, istToday, fmtPrice } from "../utils/liveSessionTrend";
import { readSessionRoom } from "../utils/sessionRoomLeft";
import { readAnchorFreshness } from "../utils/overnightAnchor";
import { buildFollowThroughStudy, bandFor, BAND_LABEL } from "../utils/overnightFollowThrough";
import type { InstrumentSymbol, OvernightMove } from "../types";

const UP = "#16A34A";
const DOWN = "#DC2626";
const FLAT = "#64748B";

function inkFor(pct: number | null | undefined): string {
  if (pct === null || pct === undefined) return FLAT;
  if (pct > 0.05) return UP;
  if (pct < -0.05) return DOWN;
  return FLAT;
}

/**
 * Icon + sentence.
 *
 * Deliberately a flex DIV wrapping a plain <p>, never a <p> that is itself
 * `display:flex`. Flexing the paragraph turns every inline child -- each bare
 * text node and every <b> -- into its own flex item, so a sentence with bold
 * words in it gets chopped into narrow columns instead of wrapping. That is
 * what mangled the amber note on this card.
 */
function Note({ icon, children, className }: { icon: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className="flex items-start gap-1.5">
      <span className="shrink-0 mt-[2px] leading-none">{icon}</span>
      <p className={className}>{children}</p>
    </div>
  );
}

function Pct({ value, size = 15 }: { value: number | null; size?: number }) {
  if (value === null) {
    return <span className="font-black text-slate-300" style={{ fontSize: size }}>—</span>;
  }
  const ink = inkFor(value);
  const Icon = value > 0.05 ? TrendingUp : value < -0.05 ? TrendingDown : Minus;
  return (
    <span
      className="font-black inline-flex items-center gap-1 rounded-lg px-2 py-1 tabular-nums"
      style={{ color: ink, background: `${ink}14`, fontSize: size }}
    >
      <Icon size={size - 3} strokeWidth={2.6} />
      {value > 0 ? "+" : ""}{value.toFixed(2)}%
    </span>
  );
}

/** A numbered step on a vertical rail, so the three readings read as a sequence. */
function Step({
  n, title, sub, tone, children, last,
}: { n: number; title: string; sub?: string; tone: string; children: React.ReactNode; last?: boolean }) {
  return (
    <div className="relative pl-9">
      {/* The rail. Stops at the last step rather than trailing into nothing. */}
      {!last && <span className="absolute left-[13px] top-7 bottom-0 w-[2px] rounded-full" style={{ background: `${tone}26` }} />}
      <span
        className="absolute left-0 top-0 w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-black text-white shadow-sm"
        style={{ background: `linear-gradient(140deg, ${tone}, ${tone}C0)` }}
      >
        {n}
      </span>
      <div className="pb-4">
        <p className="text-[12.5px] font-black text-slate-800 leading-tight">{title}</p>
        {sub && <p className="text-[9.5px] text-slate-500 leading-snug mt-0.5">{sub}</p>}
        <div className="mt-2">{children}</div>
      </div>
    </div>
  );
}

const TRACK_META: Record<string, { label: string; Icon: typeof Fuel; ink: string }> = {
  CRUDEOIL: { label: "Crude", Icon: Fuel, ink: "#EA580C" },
  NATURALGAS: { label: "Gas", Icon: Flame, ink: "#0891B2" },
};

/**
 * One global benchmark.
 *
 * `selected` only changes emphasis, never visibility: the page has a Crude /
 * Gas toggle, but overnight both matter -- Gas can be up 11% while Crude is
 * down 6%, and hiding the one you are not currently looking at is how you miss
 * that. The chip says which MCX contract each row tracks.
 */
function MoveRow({ m, selected, scale }: { m: OvernightMove; selected: boolean; scale: number }) {
  const meta = TRACK_META[m.tracksMCX] ?? { label: m.tracksMCX, Icon: Fuel, ink: FLAT };
  // Per row, not per card. One leg's snapshot can be missing while the other
  // two are fine, and a global flag would either throw away two good figures
  // or silently relabel a Yahoo day figure as a since-MCX-close one.
  const anchored = m.anchorPrice !== null && m.changePct !== null;
  const shown = anchored ? m.changePct : m.dayChangePct;
  const ink = inkFor(shown);
  const width = shown === null || scale <= 0 ? 0 : Math.max(3, Math.min(100, (Math.abs(shown) / scale) * 100));

  return (
    <div
      className="rounded-xl px-2.5 py-2"
      style={
        selected
          ? { background: "#FFFFFF", border: `1px solid ${meta.ink}40`, boxShadow: `inset 3px 0 0 ${meta.ink}` }
          : { background: "#F8FAFC", border: "1px solid #E2E8F0" }
      }
    >
      <div className="flex items-center gap-2">
        <meta.Icon size={13} className="shrink-0" style={{ color: meta.ink }} />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-black text-slate-800 truncate leading-tight">{m.name}</p>
          <p className="text-[8.5px] font-bold uppercase tracking-wide" style={{ color: meta.ink }}>
            Tracks MCX {meta.label}
          </p>
        </div>
        <Pct value={shown} />
      </div>

      {/* Magnitude, drawn. Scaled to the biggest move on screen, so the three
          rows can be compared at a glance without reading the numbers. */}
      <div className="mt-1.5 h-1.5 rounded-full bg-slate-200/70 overflow-hidden">
        <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${width}%`, background: ink }} />
      </div>

      <p className="text-[9px] text-slate-400 mt-1 tabular-nums">
        {m.error ? m.error : anchored ? `${m.anchorPrice} at MCX close → ${m.price ?? "—"} now` : `Now ${m.price ?? "—"}`}
      </p>
      {!anchored && !m.error && (
        <p className="text-[8.5px] font-bold text-amber-600 mt-0.5">Yahoo day figure — no MCX-close snapshot for this one</p>
      )}
    </div>
  );
}

function Tile({ label, value, ink, tint }: { label: string; value: string; ink: string; tint: string }) {
  return (
    <div className="rounded-xl px-2 py-2 text-center" style={{ background: tint, border: `1px solid ${ink}22` }}>
      <p className="text-[8px] font-bold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="text-[14px] font-black leading-tight tabular-nums" style={{ color: ink }}>{value}</p>
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

  const bandStudy = useMemo(() => {
    const hist = history.data?.candles;
    if (!hist || !hist.length || !trend || trend.gapPct === null) return null;
    const band = bandFor(trend.gapPct);
    return buildFollowThroughStudy(hist).bands.find((b) => b.band === band) ?? null;
  }, [history.data, trend]);

  const anchorInfo = tracker.data?.anchor ?? null;
  const freshness = readAnchorFreshness(anchorInfo?.takenAt ?? null);
  // "Some rows are anchored" is the useful question, not "an anchor exists":
  // a snapshot that recorded two of three legs is genuinely useful for those
  // two, and the third row says for itself that it is falling back.
  const anchoredCount = (tracker.data?.moves ?? []).filter((m) => m.anchorPrice !== null && m.changePct !== null).length;
  const hasAnchor = anchoredCount > 0;

  // Every benchmark, always -- with the ones tracking the selected contract
  // first. Overnight, Gas moving 11% matters even on a Crude morning.
  const moves = useMemo(() => {
    const all = tracker.data?.moves ?? [];
    return [...all].sort((a, b) => Number(b.tracksMCX === symbol) - Number(a.tracksMCX === symbol));
  }, [tracker.data, symbol]);

  const scale = useMemo(() => {
    const vals = moves.map((m) => Math.abs((m.anchorPrice !== null && m.changePct !== null ? m.changePct : m.dayChangePct) ?? 0));
    return Math.max(0.5, ...vals);
  }, [moves]);

  const sessionStarted = Boolean(trend && trend.openPrice !== null);
  const gapInk = trend?.gapPct === null || trend?.gapPct === undefined ? FLAT : inkFor(trend.gapPct);

  return (
    <section className="space-y-2.5">
      {/* Hero. Dark on purpose -- it separates this block from the white cards
          above and below it, and the three arrows are the whole idea of the
          card stated in one line. */}
      <div
        className="rounded-2xl px-4 py-3.5 text-white shadow-sm"
        style={{ background: "linear-gradient(135deg,#0F172A 0%,#1E1B4B 55%,#312E81 100%)" }}
      >
        <div className="flex items-center gap-2">
          <span className="w-7 h-7 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
            <Globe size={15} className="text-indigo-200" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[14px] font-black leading-tight">Overnight → Open → Now</h2>
            <p className="text-[9.5px] text-white/55 leading-snug">World moved · MCX gapped · where it has gone since</p>
          </div>
          <span
            className="shrink-0 text-[8.5px] font-black px-2 py-[3px] rounded-full flex items-center gap-1"
            style={open ? { background: "#16A34A", color: "#fff" } : { background: "rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.7)" }}
          >
            {open && <Radio size={9} className="motion-safe:animate-pulse" />}
            {open ? "LIVE" : "CLOSED"}
          </span>
        </div>
      </div>

      <div className="rounded-2xl bg-white border border-[var(--color-border)] px-3 pt-3 shadow-sm">
        {/* ---- 1. Since MCX shut ---- */}
        <Step
          n={1}
          title="Since MCX closed last night"
          sub={anchorInfo ? `Snapshot taken 11:30 PM on ${anchorInfo.istDate}` : "No close-time snapshot recorded yet"}
          tone="#4F46E5"
        >
          {tracker.isLoading ? (
            <div className="h-24 rounded-xl bg-slate-100 motion-safe:animate-pulse" />
          ) : moves.length === 0 ? (
            <p className="text-[10px] text-slate-500">Global quotes are unavailable right now.</p>
          ) : (
            <>
              <div className="space-y-1.5">
                {moves.map((m) => (
                  <MoveRow key={m.symbol} m={m} selected={m.tracksMCX === symbol} scale={scale} />
                ))}
              </div>
              <p className="text-[8.5px] text-slate-400 mt-1.5">Bar length = size of the move, against the biggest of the three.</p>

              {/* The anchor exists but is not last night's. The percentages are
                  real; the heading above them would be wrong without this. */}
              {hasAnchor && freshness.warning && (
                <div className="rounded-xl px-2.5 py-2 mt-2" style={{ background: "#FFFBEB", border: "1px solid #FDE68A" }}>
                  <Note icon={<AlertTriangle size={11} style={{ color: "#B45309" }} />} className="text-[9.5px] text-amber-800 leading-snug">
                    {freshness.warning}
                  </Note>
                </div>
              )}

              {!hasAnchor && (
                <div className="rounded-xl px-2.5 py-2 mt-2" style={{ background: "#FFFBEB", border: "1px solid #FDE68A" }}>
                  <Note icon={<AlertTriangle size={11} style={{ color: "#B45309" }} />} className="text-[9.5px] text-amber-800 leading-snug">
                    These are <b>Yahoo's own day figures</b>, measured from the previous US session close — a longer window that partly covers ground MCX had already priced in
                    before it shut. The first true 11:30 PM snapshot is taken tonight, after which this switches to a real since-MCX-closed figure.
                  </Note>
                </div>
              )}
            </>
          )}
        </Step>

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
            <p className="text-[10.5px] text-slate-600 leading-snug">
              Yesterday's closing bar isn't in the data, so the gap can't be measured from real candles. Nothing is estimated here.
            </p>
          ) : (
            <div className="rounded-xl px-3 py-2.5" style={{ background: `${gapInk}0D`, border: `1px solid ${gapInk}33` }}>
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="text-[26px] font-black leading-none tabular-nums" style={{ color: gapInk }}>
                  {trend.gapPct > 0 ? "+" : ""}{trend.gapPct}%
                </span>
                <span className="text-[9.5px] font-black px-2 py-[2px] rounded-full" style={{ background: gapInk, color: "#fff" }}>
                  {BAND_LABEL[bandFor(trend.gapPct)]}
                </span>
              </div>
              <p className="text-[10px] text-slate-600 mt-1.5 tabular-nums">
                Closed <b>{fmtPrice(trend.prevClose!)}</b> → opened <b>{fmtPrice(trend.openPrice!)}</b>
              </p>
              {bandStudy && !bandStudy.thin && (
                <Note icon={<Clock size={10} className="text-indigo-500" />} className="text-[10px] text-slate-600 leading-snug mt-1.5">
                  {bandStudy.verdict}
                </Note>
              )}
              {bandStudy?.thin && (
                <p className="text-[9.5px] text-amber-700 leading-snug mt-1.5">
                  Only {bandStudy.sessions} past days gapped like this — too few to read a pattern into.
                </p>
              )}
            </div>
          )}
        </Step>

        {/* ---- 3. Since the open, and room left ---- */}
        <Step
          n={3}
          title="Since the open, up to now"
          sub={open ? "Live, from the candles forming today" : "MCX is shut — this is the last completed session"}
          tone="#7C3AED"
          last
        >
          {!sessionStarted || !trend ? (
            <p className="text-[10.5px] text-slate-600 leading-snug">Nothing has traded yet today.</p>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-1.5">
                <Tile
                  label="Since open"
                  value={trend.movePct === null ? "—" : `${trend.movePct > 0 ? "+" : ""}${trend.movePct}%`}
                  ink={inkFor(trend.movePct)}
                  tint={`${inkFor(trend.movePct)}0D`}
                />
                <Tile label="Day range" value={room?.usedPct == null ? "—" : `${room.usedPct}%`} ink="#7C3AED" tint="#7C3AED0D" />
                <Tile label="Typical day" value={room?.typicalRangePct == null ? "—" : `${room.typicalRangePct}%`} ink="#475569" tint="#F1F5F9" />
              </div>

              {room && room.usedShare !== null && !room.thin && (
                <div className="mt-2.5">
                  <div className="flex items-center justify-between text-[9px] font-bold text-slate-500 mb-1">
                    <span>Range used today</span>
                    <span className="tabular-nums" style={{ color: room.usedShare >= 100 ? DOWN : room.usedShare >= 70 ? "#D97706" : "#4F46E5" }}>
                      {Math.min(100, room.usedShare)}% of a typical day
                    </span>
                  </div>
                  <div className="relative h-2.5 rounded-full bg-slate-200 overflow-hidden">
                    <div
                      className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-500"
                      style={{
                        width: `${Math.min(100, room.usedShare)}%`,
                        background:
                          room.usedShare >= 100
                            ? `linear-gradient(90deg,#F87171,${DOWN})`
                            : room.usedShare >= 70
                              ? "linear-gradient(90deg,#FBBF24,#D97706)"
                              : "linear-gradient(90deg,#818CF8,#4F46E5)",
                      }}
                    />
                  </div>
                </div>
              )}

              {room && (
                <Note icon={<Ruler size={11} className="text-violet-500" />} className="text-[10.5px] text-slate-700 leading-snug mt-2">
                  {room.verdict}
                </Note>
              )}

              {bandStudy && !bandStudy.thin && bandStudy.medianExtensionPct !== null && (
                <p className="text-[10px] text-slate-600 leading-snug mt-1.5">
                  Separately: on the {bandStudy.sessions} past days that gapped like today, the <b>median</b> extra move past the open was{" "}
                  <b>{bandStudy.medianExtensionPct}%</b>. That and the range figure answer slightly different questions and will sometimes disagree — both are shown rather than
                  one being picked for you.
                </p>
              )}

              <div className="rounded-xl px-2.5 py-2 mt-2.5" style={{ background: "#F8FAFC", border: "1px solid #E2E8F0" }}>
                <p className="text-[9.5px] text-slate-500 leading-relaxed">
                  <b className="text-slate-600">What "room left" is not.</b> It is the middle of a wide spread, measured over past sessions — a trending day goes straight through
                  it and a dead day never reaches it. It says nothing about which direction the rest of the move goes, and no price target is implied. The live card at the top of
                  this page is what tells you whether the move you are in is still working.
                </p>
              </div>
            </>
          )}
        </Step>
      </div>
    </section>
  );
}
