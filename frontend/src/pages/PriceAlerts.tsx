// Price-Alerts -- which times of day actually move, and whether the timing
// rules going round actually hold up.
//
// A NEW page. It adds a route and one nav entry; nothing existing is touched.
// All the statistics live in utils/timeProfileEngine.ts, which the WORKER
// imports too -- so the numbers shown here are computed by the same code that
// produced them, never re-derived differently on the client.
//
// Upstream load: the underlying 30-minute candles are the very same KV-cached
// request the 9-11 AM gap study already makes, and the computed profile is
// cached 6 hours on the server. Opening this page costs nothing extra at
// Upstox.
//
// The design rule for this page, which matters more than any feature on it:
// a pattern found in twenty sessions is usually luck. Every figure is shown
// with the number of sessions behind it, anything that is a coin flip is
// called a coin flip, and the multiple-comparisons problem is stated plainly
// rather than buried. A page that made these timings look more certain than
// they are would lose money, not make it.

import { useMemo, useState, useEffect } from "react";
import {
  AlarmClock, TrendingUp, TrendingDown, Minus, ChevronDown, CircleHelp, CalendarClock,
  Activity, Moon, CheckCircle2, XCircle, AlertTriangle, Info, Flame, Fuel,
} from "lucide-react";
import { useTimeProfile, useMarketStatus } from "../api/hooks";
import { OvernightFollowThroughCard } from "../components/OvernightFollowThroughCard";
import {
  liveWindow, bestWindows, quietWindows, slotLabel, istMinutesNow,
  plainDirection, plainBusyness, plainMultiple,
  SESSION_START_MIN, MIN_SESSIONS_FOR_CONFIDENCE,
  type SlotStat, type ClaimResult, type ClaimVerdict, type TimeProfile,
  type ScheduledEvent, type EventProfile, type PrevCandleLink,
} from "../utils/timeProfileEngine";
import type { InstrumentSymbol } from "../types";

const C = {
  up: "#16A34A",
  down: "#DC2626",
  flat: "#94A3B8",
  warn: "#D97706",
  accent: "#4F46E5",
  hot: "#EA580C",
};

const SYMBOLS: { key: InstrumentSymbol; label: string; short: string; Icon: typeof Fuel }[] = [
  { key: "CRUDEOIL", label: "Crude Oil", short: "Crude", Icon: Fuel },
  { key: "NATURALGAS", label: "Natural Gas", short: "Gas", Icon: Flame },
];

const VERDICT_STYLE: Record<ClaimVerdict, { color: string; Icon: typeof CheckCircle2; word: string }> = {
  supported: { color: C.up, Icon: CheckCircle2, word: "TRUE" },
  mixed: { color: C.warn, Icon: AlertTriangle, word: "SOMETIMES" },
  not_supported: { color: C.down, Icon: XCircle, word: "NOT TRUE" },
  insufficient: { color: C.flat, Icon: CircleHelp, word: "NOT ENOUGH DAYS" },
};

function Card({ children, className, tone }: { children: React.ReactNode; className?: string; tone?: string }) {
  return (
    <div
      className={`rounded-2xl bg-white shadow-sm ${className ?? ""}`}
      style={{ border: `1px solid ${tone ?? "var(--color-border)"}` }}
    >
      {children}
    </div>
  );
}

function SectionHead({ icon, title, note }: { icon: React.ReactNode; title: string; note?: string }) {
  return (
    <div className="mb-2">
      <h2 className="text-[13px] font-black flex items-center gap-1.5 text-slate-800">{icon}{title}</h2>
      {note && <p className="text-[10px] text-slate-500 leading-snug mt-0.5">{note}</p>}
    </div>
  );
}

/** Movement bar. Length is the slot's range against the busiest slot of the day. */
function MovementBar({ slot, max }: { slot: SlotStat; max: number }) {
  const pct = max > 0 ? Math.max(2, Math.round((slot.avgRangePct / max) * 100)) : 0;
  const color = slot.movementIndex >= 1.4 ? C.hot : slot.movementIndex >= 1.15 ? C.warn : C.flat;
  const DirIcon = slot.bias === "up" ? TrendingUp : slot.bias === "down" ? TrendingDown : Minus;
  const unproven = slot.confidence !== "reliable";
  const dirColor = slot.confidence === "coin_flip" || slot.confidence === "insufficient" ? C.flat : slot.bias === "up" ? C.up : C.down;
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] font-bold text-slate-600 w-[62px] shrink-0 tabular-nums">{slot.key}</span>
      <div className="flex-1 h-3.5 rounded-full bg-slate-100 overflow-hidden min-w-0">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="text-[10px] font-bold tabular-nums w-[46px] text-right shrink-0" style={{ color }}>
        {slot.avgRangePct.toFixed(3)}%
      </span>
      {/* A faded arrow means the lean is real but not proven -- a solid one
          always means it cleared the bar, so the two can never be confused. */}
      <DirIcon size={12} className="shrink-0" style={{ color: dirColor, opacity: unproven ? 0.4 : 1 }} />
    </div>
  );
}

function SlotDetail({ slot, rank, link }: { slot: SlotStat; rank?: number; link?: PrevCandleLink }) {
  const proven = slot.confidence === "reliable";
  const dirColor = slot.confidence === "coin_flip" || slot.confidence === "insufficient" ? C.flat : slot.bias === "up" ? C.up : C.down;
  return (
    <div className="rounded-xl px-2.5 py-2.5 bg-slate-50 border border-slate-200">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12px] font-black text-slate-800">{slot.label}</p>
        {rank !== undefined && (
          <span className="text-[9px] font-black px-1.5 py-[2px] rounded-md shrink-0" style={{ background: `${C.hot}18`, color: C.hot }}>
            {rank === 1 ? "Biggest mover" : `${rank}th biggest`}
          </span>
        )}
      </div>

      {/* How far it goes each way -- the question actually being asked. */}
      <div className="flex items-stretch gap-1.5 mt-2">
        <div className="flex-1 rounded-lg bg-white px-2 py-1.5 border border-slate-200">
          <p className="text-[9px] font-bold text-slate-400">Price goes UP by</p>
          <p className="text-[15px] font-black leading-tight" style={{ color: C.up }}>+{slot.avgUpReachPct.toFixed(2)}%</p>
        </div>
        <div className="flex-1 rounded-lg bg-white px-2 py-1.5 border border-slate-200">
          <p className="text-[9px] font-bold text-slate-400">Price goes DOWN by</p>
          <p className="text-[15px] font-black leading-tight" style={{ color: C.down }}>−{slot.avgDownReachPct.toFixed(2)}%</p>
        </div>
      </div>
      <p className="text-[9px] text-slate-400 leading-snug mt-1">
        Average swing each way from the price at {slot.key}, over {slot.sessions} days. {plainBusyness(slot.movementIndex)} — {plainMultiple(slot.movementIndex)}.
      </p>

      {/* Which way it ends up */}
      <div className="mt-2 rounded-lg px-2 py-1.5" style={{ background: `${dirColor}10`, border: `1px solid ${dirColor}33` }}>
        <p className="text-[11px] font-black" style={{ color: dirColor }}>
          {plainDirection(slot.bias, slot.confidence)}
          {!proven && slot.confidence !== "coin_flip" && slot.confidence !== "insufficient" && (
            <span className="font-bold"> (not proven)</span>
          )}
        </p>
        <p className="text-[9.5px] text-slate-500 leading-snug mt-0.5">
          Closed higher on {slot.upDays} days, lower on {slot.downDays}. When it ends green it gains {slot.avgGainPct.toFixed(2)}%; when red it loses {slot.avgLossPct.toFixed(2)}%.
        </p>
      </div>

      {/* What the candle before it says */}
      {link && (
        <div className="mt-1.5 rounded-lg px-2 py-1.5 bg-white border border-slate-200">
          <p className="text-[9px] font-bold text-slate-400">The half hour before ({link.prevKey})</p>
          <p className="text-[10px] text-slate-600 leading-snug mt-0.5">{link.summary}</p>
        </div>
      )}
    </div>
  );
}

function ClaimCard({ claim }: { claim: ClaimResult }) {
  const [open, setOpen] = useState(false);
  const v = VERDICT_STYLE[claim.verdict];
  const { Icon } = v;
  return (
    <Card tone={`${v.color}55`}>
      <div className="px-3 py-2.5">
        <div className="flex items-start gap-2">
          <Icon size={15} className="shrink-0 mt-0.5" style={{ color: v.color }} />
          <div className="min-w-0 flex-1">
            <p className="text-[9px] font-black uppercase tracking-wide" style={{ color: v.color }}>
              {v.word} · checked on {claim.sessions} days
            </p>
            <p className="text-[11.5px] font-bold text-slate-800 leading-snug mt-0.5">“{claim.claim}”</p>
          </div>
        </div>
        <p className="text-[10.5px] text-slate-600 leading-snug mt-1.5">{claim.finding}</p>
        {claim.caveat && (
          <p className="text-[9.5px] leading-snug mt-1.5 px-2 py-1.5 rounded-lg" style={{ background: `${C.warn}14`, color: C.warn }}>
            {claim.caveat}
          </p>
        )}
        <button type="button" onClick={() => setOpen((o) => !o)} className="mt-1 flex items-center gap-1 text-[9.5px] font-bold text-slate-400">
          {open ? "Hide" : "What exactly was measured"}
          <ChevronDown size={10} className={open ? "rotate-180 transition-transform" : "transition-transform"} />
        </button>
        {open && <p className="text-[9.5px] text-slate-500 leading-snug mt-1">{claim.measured}</p>}
      </div>
    </Card>
  );
}

function EventCard({ event, profile }: { event: ScheduledEvent; profile: EventProfile | undefined }) {
  const away = event.minutesAway;
  const awayLabel =
    away < 60 ? `in ${away} min` : away < 1440 ? `in ${Math.floor(away / 60)}h ${away % 60}m` : `in ${Math.round(away / 1440)} days`;
  return (
    <Card tone={`${C.accent}44`}>
      <div className="px-3 py-2.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[11.5px] font-black text-slate-800">{event.name}</p>
            <p className="text-[9.5px] text-slate-500 mt-0.5">
              Next: {event.istLabel} · {awayLabel}
            </p>
          </div>
          <span className="text-[9px] font-black px-1.5 py-[2px] rounded-md shrink-0" style={{ background: `${C.accent}18`, color: C.accent }}>
            {event.affects === "CRUDEOIL" ? "CRUDE" : "GAS"}
          </span>
        </div>
        {profile ? (
          <>
            <div className="mt-2 rounded-xl bg-slate-50 border border-slate-200 px-2.5 py-2">
              <p className="text-[9px] font-bold uppercase text-slate-400">The {profile.slotLabel} half hour, on release days</p>
              {profile.verdict === "insufficient" ? (
                <p className="text-[10.5px] leading-snug mt-1" style={{ color: C.warn }}>{profile.note}</p>
              ) : (
                <>
                  <p className="text-[16px] font-black leading-none mt-1" style={{ color: profile.multiple >= 1.3 ? C.hot : "#334155" }}>
                    {profile.multiple.toFixed(2)}× normal
                  </p>
                  <p className="text-[9.5px] text-slate-500 leading-snug mt-1">
                    {profile.releaseDayAvgRangePct.toFixed(3)}% on release days vs {profile.otherDayAvgRangePct.toFixed(3)}% the rest of the week,
                    over {profile.releaseDaySessions} releases.
                  </p>
                </>
              )}
            </div>
            {profile.verdict !== "insufficient" && (
              <p className="text-[9.5px] text-slate-500 leading-snug mt-1.5">
                Direction split {profile.upDays} up / {profile.downDays} down. <span className="font-bold text-slate-700">Size is predictable here; direction is not.</span> A release tells
                you to expect a move, never which way it goes.
              </p>
            )}
          </>
        ) : (
          <p className="text-[9.5px] text-slate-500 mt-1.5">No measured profile for this release yet.</p>
        )}
        <p className="text-[9px] text-slate-400 leading-snug mt-1.5">{event.source}. Shifts by an hour in IST with US daylight saving, and moves on US public holidays.</p>
      </div>
    </Card>
  );
}

function LiveNow({ profile }: { profile: TimeProfile }) {
  // Ticks so the countdown stays truthful between renders.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const live = useMemo(() => liveWindow(profile), [profile]);
  const mins = istMinutesNow();

  if (!live.inSession) {
    const toOpen = mins < SESSION_START_MIN ? SESSION_START_MIN - mins : 24 * 60 - mins + SESSION_START_MIN;
    return (
      <Card>
        <div className="px-3 py-3 flex items-center gap-2.5">
          <Moon size={18} className="text-slate-400 shrink-0" />
          <div>
            <p className="text-[12px] font-black text-slate-700">Market is closed</p>
            <p className="text-[10px] text-slate-500 mt-0.5">
              MCX Crude and Gas trade 9:00 AM to 11:30 PM. Opens again in about {Math.floor(toOpen / 60)} hours {toOpen % 60} minutes.
            </p>
          </div>
        </div>
      </Card>
    );
  }

  const cur = live.current;
  const hot = cur && cur.movementIndex >= 1.25;
  return (
    <Card tone={hot ? `${C.hot}66` : undefined}>
      <div className="px-3 py-3">
        <div className="flex items-center gap-2">
          <span className="relative flex w-2 h-2 shrink-0">
            <span className="absolute inline-flex w-full h-full rounded-full motion-safe:animate-ping" style={{ background: hot ? C.hot : C.up }} />
            <span className="relative inline-flex w-2 h-2 rounded-full" style={{ background: hot ? C.hot : C.up }} />
          </span>
          <p className="text-[12px] font-black text-slate-800">Right now · {cur ? cur.label : slotLabel(mins - (mins % 30))}</p>
        </div>

        {cur && cur.sessions >= 5 ? (
          <>
            <p className="text-[11px] text-slate-600 leading-snug mt-1.5">
              On a normal day this half hour swings about{" "}
              <span className="font-black" style={{ color: C.up }}>+{cur.avgUpReachPct.toFixed(2)}%</span> up and{" "}
              <span className="font-black" style={{ color: C.down }}>−{cur.avgDownReachPct.toFixed(2)}%</span> down. {plainBusyness(cur.movementIndex)} — {plainMultiple(cur.movementIndex)}.
            </p>
            <p className="text-[10.5px] font-bold leading-snug mt-1" style={{ color: cur.confidence === "reliable" ? (cur.bias === "up" ? C.up : C.down) : "#64748B" }}>
              {plainDirection(cur.bias, cur.confidence)} · checked on {cur.sessions} days
            </p>
          </>
        ) : (
          <p className="text-[11px] text-slate-500 leading-snug mt-1.5">Not enough past days for this half hour to say anything yet.</p>
        )}

        {live.nextBigMover && live.minutesToBigMover !== null && (
          <div className="mt-2 rounded-xl px-2.5 py-2 flex items-start gap-1.5" style={{ background: `${C.hot}12`, border: `1px solid ${C.hot}33` }}>
            <AlarmClock size={12} className="shrink-0 mt-0.5" style={{ color: C.hot }} />
            <p className="text-[10.5px] leading-snug text-slate-700">
              Next busy time: <span className="font-black" style={{ color: C.hot }}>{live.nextBigMover.label}</span>, in{" "}
              {live.minutesToBigMover < 60 ? `${live.minutesToBigMover} minutes` : `${Math.floor(live.minutesToBigMover / 60)}h ${live.minutesToBigMover % 60}m`} —{" "}
              {plainMultiple(live.nextBigMover.movementIndex)}.
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}

export function PriceAlerts() {
  const [symbol, setSymbol] = useState<InstrumentSymbol>("CRUDEOIL");
  const [showAllSlots, setShowAllSlots] = useState(false);
  const { data, isLoading, error } = useTimeProfile(symbol);
  const status = useMarketStatus();

  const profile = data?.profile ?? null;
  const best = useMemo(() => (profile ? bestWindows(profile, 5) : []), [profile]);
  const quiet = useMemo(() => (profile ? quietWindows(profile, 3) : []), [profile]);
  const maxRange = useMemo(() => (profile ? Math.max(0, ...profile.slots.map((s) => s.avgRangePct)) : 0), [profile]);
  const visibleSlots = useMemo(() => {
    if (!profile) return [];
    const all = profile.slots.filter((s) => s.sessions > 0);
    return showAllSlots ? all : all.filter((s) => s.startMin >= 16 * 60 || s.movementIndex >= 1.1);
  }, [profile, showAllSlots]);

  const thinSample = (data?.sessionsAnalyzed ?? 0) < MIN_SESSIONS_FOR_CONFIDENCE;
  const active = SYMBOLS.find((s) => s.key === symbol)!;

  return (
    <div className="space-y-4 pb-4">
      <header>
        <div className="flex items-center gap-2">
          <AlarmClock size={20} style={{ color: C.accent }} />
          <div>
            <h1 className="text-[17px] font-black leading-none text-slate-900">Price-Alerts</h1>
            <p className="text-[9.5px] text-slate-500 mt-0.5">Which times of day really move — checked against past days</p>
          </div>
          <span className="ml-auto text-[9.5px] font-bold text-slate-400 shrink-0">
            MCX {status.data?.isOpen ? "open" : "closed"}
          </span>
        </div>
      </header>

      <div className="flex gap-2">
        {SYMBOLS.map(({ key, label, Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setSymbol(key)}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-[11.5px] font-black transition-colors"
            style={symbol === key ? { background: C.accent, color: "#fff" } : { background: "var(--color-surface-soft)", color: "#64748B" }}
          >
            <Icon size={13} />
            {label}
          </button>
        ))}
      </div>

      {/* The caveat that governs everything below it. Deliberately first. */}
      {data?.available && (
        <div className="rounded-xl px-3 py-2.5 flex items-start gap-2" style={{ background: `${thinSample ? C.down : C.warn}12`, border: `1px solid ${thinSample ? C.down : C.warn}44` }}>
          <Info size={13} className="shrink-0 mt-0.5" style={{ color: thinSample ? C.down : C.warn }} />
          <div>
            <p className="text-[10.5px] font-bold" style={{ color: thinSample ? C.down : C.warn }}>
              {thinSample ? `Only ${data.sessionsAnalyzed} days of history — too few to trust yet` : "Please read this first"}
            </p>
            <p className="text-[10px] text-slate-600 leading-snug mt-0.5">
              {data.contractNote} This page looks at 29 different half hours at once. When you check that many, one or two will always look like a pattern just by luck — like tossing 29 coins and
              finding one that landed heads five times. So unless a result is really strong, this page tells you it is 50/50 rather than calling it a pattern.
            </p>
          </div>
        </div>
      )}

      {isLoading && (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => <div key={i} className="h-24 rounded-2xl bg-slate-100 motion-safe:animate-pulse" />)}
        </div>
      )}

      {error && (
        <Card tone={`${C.down}55`}>
          <div className="px-3 py-2.5">
            <p className="text-[11.5px] font-black" style={{ color: C.down }}>Couldn't load the history</p>
            <p className="text-[10px] text-slate-600 mt-0.5">{(error as Error).message}</p>
          </div>
        </Card>
      )}

      {/* Overnight move -> next-day follow-through. Rendered whatever the
          time-profile query did: it reads its own 30-minute history, so a
          missing time profile must not hide it. */}
      <OvernightFollowThroughCard symbol={symbol} />

      {data && !data.available && !isLoading && (
        <Card tone={`${C.warn}55`}>
          <div className="px-3 py-2.5">
            <p className="text-[11.5px] font-black" style={{ color: C.warn }}>Not enough history for {active.label} yet</p>
            <p className="text-[10px] text-slate-600 leading-snug mt-0.5">
              {data.error ?? "No completed sessions were returned for this contract."} MCX futures roll monthly, so a freshly-listed contract genuinely has very little history. Nothing is shown
              here rather than filling the gap with estimates.
            </p>
          </div>
        </Card>
      )}

      {profile && data?.available && (
        <>
          <LiveNow profile={profile} />

          {/* Best windows */}
          <section>
            <SectionHead
              icon={<Activity size={13} style={{ color: C.hot }} />}
              title="Best times to trade"
              note={`The half hours that moved the most, from ${data.sessionsAnalyzed} past days. When you buy an option, a move in EITHER direction is what pays you — so this list is ordered by how big the move is, not which way it goes.`}
            />
            <div className="space-y-2">
              {best.map((s, i) => <SlotDetail key={s.key} slot={s} rank={i + 1} link={profile.prevLinks.find((l) => l.key === s.key)} />)}
            </div>
          </section>

          {/* Quiet windows */}
          {quiet.length > 0 && (
            <section>
              <SectionHead
                icon={<Moon size={13} className="text-slate-400" />}
                title="Worst (quietest) times"
                note="Just as useful to know: in these half hours the price barely moves, so your option loses a little value for nothing. Sitting through these is what quietly eats a small account."
              />
              <Card>
                <div className="px-3 py-2.5 space-y-1.5">
                  {quiet.map((s) => (
                    <div key={s.key} className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-bold text-slate-700">{s.label}</span>
                      <span className="text-[10px] text-slate-500 tabular-nums">
                        {s.avgRangePct.toFixed(3)}% · {s.movementIndex.toFixed(2)}× typical
                      </span>
                    </div>
                  ))}
                </div>
              </Card>
            </section>
          )}

          {/* The claims */}
          <section>
            <SectionHead
              icon={<CircleHelp size={13} style={{ color: C.accent }} />}
              title="Your timing rules, checked"
              note="Each rule you were told, checked against real past days. Where the answer is no, it says no — that is the whole point of checking."
            />
            <div className="space-y-2">
              {data.claims.map((c) => <ClaimCard key={c.id} claim={c} />)}
            </div>
          </section>

          {/* Scheduled events */}
          <section>
            <SectionHead
              icon={<CalendarClock size={13} style={{ color: C.accent }} />}
              title="Fixed-time news"
              note="These are different from a time-of-day habit: the report comes out at a fixed minute whether anyone believes in it or not."
            />
            <div className="space-y-2">
              {data.events
                .filter((e) => e.affects === symbol)
                .map((e) => (
                  <EventCard key={e.id} event={e} profile={data.eventProfiles.find((p) => p.eventId === e.id)} />
                ))}
            </div>
          </section>

          {/* Full day profile */}
          <section>
            <SectionHead
              icon={<Activity size={13} className="text-slate-400" />}
              title="Every half hour of the day"
              note="How much the price moves in each half hour. A solid arrow means the direction is proven; a faded arrow means it leans that way but is not proven; grey means 50/50."
            />
            <Card>
              <div className="px-3 py-3 space-y-1.5">
                {visibleSlots.map((s) => <MovementBar key={s.key} slot={s} max={maxRange} />)}
              </div>
              <button
                type="button"
                onClick={() => setShowAllSlots((v) => !v)}
                className="w-full py-2.5 text-[10.5px] font-bold text-slate-500 border-t border-slate-100"
              >
                {showAllSlots ? "Show the active hours only" : "Show every half hour of the session"}
              </button>
            </Card>
          </section>

          <p className="text-[9.5px] text-slate-400 leading-relaxed px-1">
            Built from {data.sessionsAnalyzed} finished days of {data.tradingSymbol}
            {data.firstDate && data.lastDate ? `, ${data.firstDate} to ${data.lastDate}` : ""}. All percentages are measured from the price at the start of that half hour. For learning only, not
            advice. A habit at a certain time is not a buy or sell signal — it knows nothing about today's news, today's chart, or your strike. Yesterday does not have to repeat, and with this
            few days a pattern can simply be luck.
          </p>
        </>
      )}
    </div>
  );
}
