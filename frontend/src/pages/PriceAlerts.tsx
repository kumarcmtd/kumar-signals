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
import {
  liveWindow, bestWindows, quietWindows, slotLabel, istMinutesNow,
  SESSION_START_MIN, MIN_SESSIONS_FOR_CONFIDENCE,
  type SlotStat, type ClaimResult, type ClaimVerdict, type TimeProfile,
  type ScheduledEvent, type EventProfile, type Confidence,
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
  supported: { color: C.up, Icon: CheckCircle2, word: "HOLDS UP" },
  mixed: { color: C.warn, Icon: AlertTriangle, word: "PARTLY" },
  not_supported: { color: C.down, Icon: XCircle, word: "DOESN'T HOLD" },
  insufficient: { color: C.flat, Icon: CircleHelp, word: "CAN'T TELL" },
};

const CONFIDENCE_WORD: Record<Confidence, string> = {
  reliable: "Strong enough to act on",
  leaning: "Leans this way, not proven",
  coin_flip: "Coin flip — no edge",
  insufficient: "Too few sessions",
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
      <DirIcon size={12} className="shrink-0" style={{ color: dirColor }} />
    </div>
  );
}

function SlotDetail({ slot }: { slot: SlotStat }) {
  const dirColor = slot.confidence === "coin_flip" || slot.confidence === "insufficient" ? C.flat : slot.bias === "up" ? C.up : C.down;
  return (
    <div className="rounded-xl px-2.5 py-2 bg-slate-50 border border-slate-200">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11.5px] font-black text-slate-800">{slot.label}</p>
        <span className="text-[9px] font-black px-1.5 py-[2px] rounded-md" style={{ background: `${C.hot}18`, color: C.hot }}>
          #{slot.rangeRank} mover
        </span>
      </div>
      <div className="grid grid-cols-3 gap-1.5 mt-1.5">
        {[
          ["Avg range", `${slot.avgRangePct.toFixed(3)}%`, slot.movementIndex >= 1.25 ? C.hot : "#334155"],
          ["vs typical", `${slot.movementIndex.toFixed(2)}×`, slot.movementIndex >= 1.25 ? C.hot : "#334155"],
          ["Closed up", `${slot.upRatePct}%`, dirColor],
        ].map(([k, v, col]) => (
          <div key={k} className="rounded-lg bg-white px-2 py-1 border border-slate-200">
            <p className="text-[8.5px] font-bold uppercase text-slate-400">{k}</p>
            <p className="text-[12px] font-black leading-tight" style={{ color: col }}>{v}</p>
          </div>
        ))}
      </div>
      <p className="text-[9.5px] mt-1.5 leading-snug" style={{ color: dirColor }}>
        <span className="font-bold">{CONFIDENCE_WORD[slot.confidence]}</span>
        {" · "}
        <span className="text-slate-500">
          {slot.upDays} up / {slot.downDays} down across {slot.sessions} sessions, average move {slot.avgMovePct >= 0 ? "+" : "−"}
          {Math.abs(slot.avgMovePct).toFixed(3)}%
        </span>
      </p>
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
              {v.word} · {claim.sessions} sessions
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
            <p className="text-[12px] font-black text-slate-700">MCX energy is closed</p>
            <p className="text-[10px] text-slate-500 mt-0.5">
              Session runs 9:00 AM – 11:30 PM IST. Opens in about {Math.floor(toOpen / 60)}h {toOpen % 60}m.
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
          <p className="text-[11px] text-slate-600 leading-snug mt-1.5">
            This half hour has averaged <span className="font-black" style={{ color: hot ? C.hot : "#334155" }}>{cur.avgRangePct.toFixed(3)}%</span> of movement
            ({cur.movementIndex.toFixed(2)}× a typical half hour) across {cur.sessions} sessions.{" "}
            {cur.confidence === "coin_flip" || cur.confidence === "insufficient"
              ? "Direction has been a coin flip — the size is the only usable part."
              : `It closed ${cur.bias} ${cur.bias === "up" ? cur.upRatePct : 100 - cur.upRatePct}% of the time, though that is ${cur.confidence === "reliable" ? "a real lean" : "not proven"}.`}
          </p>
        ) : (
          <p className="text-[11px] text-slate-500 leading-snug mt-1.5">Not enough history for this half hour to say anything about it.</p>
        )}

        {live.nextBigMover && live.minutesToBigMover !== null && (
          <div className="mt-2 rounded-xl px-2.5 py-2 flex items-start gap-1.5" style={{ background: `${C.hot}12`, border: `1px solid ${C.hot}33` }}>
            <AlarmClock size={12} className="shrink-0 mt-0.5" style={{ color: C.hot }} />
            <p className="text-[10.5px] leading-snug text-slate-700">
              Next active window: <span className="font-black" style={{ color: C.hot }}>{live.nextBigMover.label}</span> in{" "}
              {live.minutesToBigMover < 60 ? `${live.minutesToBigMover} min` : `${Math.floor(live.minutesToBigMover / 60)}h ${live.minutesToBigMover % 60}m`} —{" "}
              {live.nextBigMover.movementIndex.toFixed(2)}× typical movement.
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
            <p className="text-[9.5px] text-slate-500 mt-0.5">Which times of day actually move — measured, not repeated</p>
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
              {thinSample ? `Only ${data.sessionsAnalyzed} sessions — too thin to trust yet` : "Read this before you trust any number here"}
            </p>
            <p className="text-[10px] text-slate-600 leading-snug mt-0.5">
              {data.contractNote} This page checks 29 half-hour slots at once — with that many tests, one or two will look like a pattern by pure chance every time. That is why anything short of
              a strong result is labelled a coin flip here instead of an edge.
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
              note={`The half hours that moved most, across ${data.sessionsAnalyzed} sessions. For an option buyer, movement in either direction is what pays — so this ranks by size of move, not direction.`}
            />
            <div className="space-y-2">
              {best.map((s) => <SlotDetail key={s.key} slot={s} />)}
            </div>
          </section>

          {/* Quiet windows */}
          {quiet.length > 0 && (
            <section>
              <SectionHead
                icon={<Moon size={13} className="text-slate-400" />}
                title="Quietest times"
                note="The opposite list, and just as useful: these are the half hours where an option buyer pays time decay and gets little movement back."
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
              title="The timing rules, checked"
              note="Each of these was measured against this contract's own sessions. Where the answer is no, it is said plainly — that is the point of checking."
            />
            <div className="space-y-2">
              {data.claims.map((c) => <ClaimCard key={c.id} claim={c} />)}
            </div>
          </section>

          {/* Scheduled events */}
          <section>
            <SectionHead
              icon={<CalendarClock size={13} style={{ color: C.accent }} />}
              title="Scheduled movement"
              note="Unlike a time-of-day pattern, these are genuinely scheduled — the release happens at a known minute whether anyone believes in it or not."
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
              title="The whole session"
              note="Average half-hour range through the day. The arrow is the direction lean — grey means it was a coin flip."
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
            Built from {data.sessionsAnalyzed} completed sessions of {data.tradingSymbol}
            {data.firstDate && data.lastDate ? `, ${data.firstDate} to ${data.lastDate}` : ""}, using the same 30-minute candles the gap study already downloads — this page adds no extra load.
            Percentages are of the price at the start of each half hour. Educational reference only, not financial advice. A time-of-day tendency is not a signal: it says nothing about today's
            news, today's chart, or your strike. Past sessions do not have to repeat, and a sample this small can be luck.
          </p>
        </>
      )}
    </div>
  );
}
