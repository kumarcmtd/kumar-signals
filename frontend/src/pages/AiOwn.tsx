import { useMemo } from "react";
import { Sparkles, Clock, TrendingUp, TrendingDown, Zap, CalendarClock, Info } from "lucide-react";
import { useAiOwn, type AiOwnSymbol } from "../hooks/useAiOwn";
import { useAppStore, type TradeLogEntry } from "../store/appStore";
import { liveLtpFor, effectiveStopFor } from "../hooks/useTradeLog";
import { POWER_WINDOWS, type SessionWindow, type SessionState, type Impact } from "../utils/sessionStrategyEngine";
import { evaluateEntryTiming } from "../utils/entryTiming";
import { EntryTimingBadge } from "../components/EntryTimingBadge";
import { PriceScale, ProfitEstimate, DetailRow, tickMarks, fmtWhen } from "../components/CallCardKit";
import { GlobalMarketHours } from "../components/GlobalMarketHours";
import { WhyTodayCard } from "../components/WhyTodayCard";
import { CallStrengthButton } from "../components/CallStrengthButton";
import { ExpectedHoldBadge } from "../components/ExpectedHoldBadge";
import { VolatilityMeter } from "../components/VolatilityMeter";
import { flattenClosedTrades, computePerformanceStats, exitPriceFor } from "../utils/tradeLogPnl";

const SYMBOLS: AiOwnSymbol[] = ["CRUDEOIL", "NATURALGAS"];
const DISPLAY_NAME: Record<AiOwnSymbol, string> = { CRUDEOIL: "Crude Oil", NATURALGAS: "Natural Gas" };
const LOT_SIZE: Record<AiOwnSymbol, number> = { CRUDEOIL: 100, NATURALGAS: 1250 };

const IMPACT_STYLE: Record<Impact, { label: string; color: string }> = {
  "very-high": { label: "Very High", color: "#DC2626" },
  high: { label: "High", color: "#EA580C" },
  moderate: { label: "Moderate", color: "#CA8A04" },
};

function fmtIst(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m.toString().padStart(2, "0")} ${ampm}`;
}

function impactForRow(w: SessionWindow, weekday: number): Impact {
  if (w.eiaWeekday != null) return w.eiaWeekday === weekday ? "very-high" : "moderate";
  return w.impact;
}

function SessionClock({ session }: { session: SessionState }) {
  const nowStr = fmtIst(session.istMinutes);
  const rows = POWER_WINDOWS.filter((w) => w.eiaWeekday == null || w.eiaWeekday === session.istWeekday);

  return (
    <div className="rounded-2xl overflow-hidden shadow-sm border border-slate-100 bg-white">
      <div className="px-4 pt-3.5 pb-3 text-white" style={{ background: "linear-gradient(135deg,#4F46E5,#7C3AED 55%,#DB2777)" }}>
        <div className="flex items-center justify-between">
          <p className="text-xs font-black uppercase tracking-wide flex items-center gap-1.5">
            <Clock size={13} /> Session Clock · {nowStr} IST
          </p>
          {session.eiaTodayFor && (
            <span className="text-[10px] font-bold bg-white/20 rounded-full px-2 py-0.5 flex items-center gap-1">
              <CalendarClock size={11} /> EIA {DISPLAY_NAME[session.eiaTodayFor]} today
            </span>
          )}
        </div>
        {session.closedReason ? (
          <p className="text-sm font-black mt-1.5">🔴 Market Closed</p>
        ) : session.active ? (
          <p className="text-sm font-black mt-1.5">🟢 LIVE NOW: {session.active.label}</p>
        ) : session.next ? (
          <p className="text-sm font-bold mt-1.5">
            Next window: {session.next.label} in ~{session.minutesToNext} min
          </p>
        ) : (
          <p className="text-sm font-bold mt-1.5">Market quiet — no high-movement window until tomorrow</p>
        )}
      </div>

      {session.closedReason && (
        <p className="px-4 pt-3 text-xs text-slate-500">{session.closedReason} The windows below are the daily schedule for when it reopens.</p>
      )}

      <div className={`p-3 space-y-1.5 ${session.closedReason ? "opacity-60" : ""}`}>
        {rows.map((w) => {
          const impact = impactForRow(w, session.istWeekday);
          const isActive = session.active?.id === w.id;
          const st = IMPACT_STYLE[impact];
          return (
            <div
              key={w.id}
              className="rounded-xl px-3 py-2 border"
              style={isActive ? { background: `${st.color}12`, borderColor: `${st.color}55` } : { background: "var(--color-surface-soft)", borderColor: "transparent" }}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  {isActive && <span className="w-1.5 h-1.5 rounded-full animate-pulse shrink-0" style={{ background: st.color }} />}
                  <span className="text-xs font-bold truncate">{w.label}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[10px] font-semibold text-slate-500 tabular-nums">
                    {fmtIst(w.startMin)}–{fmtIst(w.endMin)}
                  </span>
                  <span className="text-[9px] font-black uppercase rounded px-1.5 py-0.5" style={{ color: st.color, background: `${st.color}18` }}>
                    {st.label}
                  </span>
                </div>
              </div>
              <p className="text-[10px] text-slate-500 mt-1 leading-snug">{w.driver}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatTile({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-xl bg-white border border-slate-100 p-3 text-center shadow-sm">
      <p className="text-lg font-black tabular-nums" style={{ color: color ?? "var(--color-ink)" }}>
        {value}
      </p>
      <p className="text-[10px] text-slate-400 mt-0.5">{label}</p>
    </div>
  );
}

function SymbolStrategyCard({ symbol }: { symbol: AiOwnSymbol }) {
  const scanner = useAiOwn(symbol);
  const { session, setup, options, tradeLog } = scanner;
  const latest = tradeLog[tradeLog.length - 1] as TradeLogEntry | undefined;
  const hasLiveCall = !!latest && !latest.closed && setup.decision !== "WAIT";

  const bull = setup.direction === "bullish";
  const accent = setup.decision === "WAIT" ? "#94A3B8" : bull ? "#16A34A" : "#DC2626";
  const Bias = bull ? TrendingUp : TrendingDown;

  const liveLtp = latest && !latest.closed && options ? liveLtpFor(options, latest.strike, latest.optSide) : null;
  const effStop = latest ? effectiveStopFor(latest) : 0;
  const nextTarget = latest ? (latest.targetsHit[1] ? latest.targets[2] : latest.targetsHit[0] ? latest.targets[1] : latest.targets[0]) : 0;
  const legFloor = latest ? (latest.targetsHit[1] ? latest.targets[1] : latest.targetsHit[0] ? latest.targets[0] : latest.entry) : 0;
  const entryTiming = hasLiveCall && liveLtp !== null ? evaluateEntryTiming(legFloor, nextTarget, effStop, liveLtp) : null;

  return (
    <div className="rounded-2xl overflow-hidden shadow-sm border-2 bg-white" style={{ borderColor: `${accent}44` }}>
      <div className="px-4 pt-3.5 flex items-center justify-between">
        <p className="text-base font-black">{DISPLAY_NAME[symbol]}</p>
        <span className="text-[11px] font-bold px-2 py-1 rounded-full" style={{ color: accent, background: `${accent}14` }}>
          {session.closedReason ? "Market closed" : session.active ? `In ${session.active.label}` : "Between windows"}
        </span>
      </div>

      {hasLiveCall && latest ? (
        <div className="p-4 pt-3 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-lg font-black flex items-center gap-1.5">
                <Bias size={16} style={{ color: accent }} />
                {DISPLAY_NAME[symbol].toUpperCase()} {latest.strike} {latest.optSide}
              </p>
              <p className="text-[11px] text-slate-500">Created {fmtWhen(latest.openedAt)} at ₹{latest.entry}</p>
            </div>
            <div className="text-right">
              <p className="text-lg font-black" style={{ color: accent }}>
                ₹{liveLtp ?? latest.entry}
              </p>
              <p className="text-[10px] text-slate-400">Current premium</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {setup.confidence !== null && (
              <span className="text-[11px] font-bold px-2 py-1 rounded-full" style={{ color: accent, background: `${accent}14` }}>
                {setup.decision} · {setup.confidence}% confidence
              </span>
            )}
            {entryTiming && <EntryTimingBadge verdict={entryTiming} className="max-w-[170px]" />}
          </div>

          <PriceScale entry={latest} current={liveLtp} />
          <ProfitEstimate trade={latest} current={liveLtp} lotSize={LOT_SIZE[symbol]} />

          <CallStrengthButton
            candles={scanner.candles}
            direction={latest.optSide === "CE" ? "bullish" : "bearish"}
            ctx={{ entry: latest.entry, stop: effStop, targets: latest.targets, targetsHit: latest.targetsHit, current: liveLtp, openedAt: latest.openedAt }}
          />

          <ExpectedHoldBadge entries={tradeLog} open={{ entry: latest.entry, current: liveLtp, openedAt: latest.openedAt, nextTarget }} />

          <div className="rounded-xl px-3.5 py-3" style={{ background: "var(--color-surface-soft)" }}>
            <DetailRow label="Entry" value={`₹${latest.entry}`} />
            <DetailRow label="Targets" value={latest.targets.map((t, i) => `T${i + 1} ₹${t} ${tickMarks(latest.targetTouches?.[i] ?? 0)}`).join("  ")} />
            <DetailRow label="Stop (effective)" value={`₹${effStop}`} valueColor="#DC2626" />
          </div>

          <div className="rounded-xl px-3.5 py-3 bg-slate-50 border border-slate-100">
            <p className="text-[10px] font-bold uppercase text-slate-400 mb-1.5">Why this call, now</p>
            <ul className="space-y-1">
              {setup.reasons.map((r, i) => (
                <li key={i} className="text-[11px] text-slate-600 flex gap-1.5">
                  <span style={{ color: accent }}>•</span>
                  {r}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : (
        <div className="p-4 pt-3 space-y-3">
          <div className="rounded-xl px-3.5 py-3 bg-slate-50 border border-slate-100 flex items-start gap-2">
            <Info size={15} className="text-slate-400 shrink-0 mt-0.5" />
            <p className="text-xs text-slate-600 leading-snug">{setup.waitingReason ?? "Waiting for a high-movement window and a clean directional break."}</p>
          </div>
        </div>
      )}

      <div className="px-4 pb-4">
        <VolatilityMeter symbol={symbol} />
      </div>
    </div>
  );
}

export function AiOwn() {
  const session = useAiOwn("CRUDEOIL").session; // one clock for the whole page
  const tradeLogs = useAppStore((s) => s.tradeLogs);

  const ownLogsOnly = useMemo(() => {
    const out: Record<string, TradeLogEntry[]> = {};
    for (const [k, v] of Object.entries(tradeLogs)) if (k.startsWith("AIOWN-")) out[k] = v;
    return out;
  }, [tradeLogs]);

  const realized = useMemo(() => flattenClosedTrades(ownLogsOnly), [ownLogsOnly]);
  const perf = useMemo(() => computePerformanceStats(realized), [realized]);

  const allCalls = useMemo(() => {
    const out: { symbol: string; entry: TradeLogEntry }[] = [];
    for (const [k, v] of Object.entries(ownLogsOnly)) {
      const symbol = k.replace("AIOWN-", "");
      for (const e of v) out.push({ symbol, entry: e });
    }
    return out.sort((a, b) => b.entry.openedAt - a.entry.openedAt).slice(0, 12);
  }, [ownLogsOnly]);

  return (
    <div className="-mx-4 -mt-4 px-4 pt-4 pb-6 min-h-screen space-y-4" style={{ background: "linear-gradient(180deg,#EEF2FF,#FAF5FF 40%,#FFF1F7)" }}>
      <section className="text-center pt-2 space-y-2">
        <div className="flex items-center justify-center gap-2">
          <Sparkles size={22} className="text-violet-500" />
          <h1 className="text-2xl font-black bg-gradient-to-r from-indigo-500 via-violet-500 to-pink-500 bg-clip-text text-transparent">AI Own</h1>
        </div>
        <p className="text-[11px] text-slate-500 px-3">
          A session-timing strategy built on how MCX energy actually moves: it clusters around global events, not evenly through the day. AI Own only looks for a trade during the day's
          high-movement windows — the European session, the US open, and especially the weekly EIA reports — and even then takes only a genuine, moving, directional breakout. Some windows
          give nothing; that's the discipline.
        </p>
      </section>

      <SessionClock session={session} />

      <GlobalMarketHours mcxOpen={!session.closedReason} />

      <WhyTodayCard />

      {SYMBOLS.map((s) => (
        <SymbolStrategyCard key={s} symbol={s} />
      ))}

      <div className="rounded-2xl bg-white border border-slate-100 p-4 shadow-sm">
        <p className="text-xs font-bold mb-3 flex items-center gap-1.5">
          <Zap size={14} className="text-violet-500" /> AI Own Track Record
        </p>
        <div className="grid grid-cols-3 gap-2">
          <StatTile label="Closed" value={String(perf.totalClosed)} />
          <StatTile label="Accuracy" value={perf.accuracyPct !== null ? `${perf.accuracyPct}%` : "—"} />
          <StatTile label="Net Points" value={`${perf.netPoints >= 0 ? "+" : ""}${perf.netPoints}`} color={perf.netPoints >= 0 ? "#16A34A" : "#DC2626"} />
        </div>
        <p className="text-[10px] text-slate-400 mt-2">Tracked under its own AIOWN line, advanced and closed server-side even when the app is shut. Starts from zero the day this page shipped.</p>
      </div>

      {allCalls.length > 0 && (
        <div className="rounded-2xl bg-white border border-slate-100 p-4 shadow-sm">
          <p className="text-xs font-bold mb-3">Recent AI Own Calls</p>
          <div className="space-y-1.5">
            {allCalls.map(({ symbol, entry }) => {
              const closed = entry.closed;
              const exit = closed ? exitPriceFor(entry) : null;
              const pnl = exit !== null ? Number((exit - entry.entry).toFixed(2)) : null;
              const win = pnl !== null && pnl > 0;
              return (
                <div key={entry.id} className="flex items-center justify-between text-[11px] rounded-lg px-3 py-2" style={{ background: "var(--color-surface-soft)" }}>
                  <span className="font-semibold">
                    {DISPLAY_NAME[symbol as AiOwnSymbol] ?? symbol} {entry.strike} {entry.optSide}
                  </span>
                  <span className="text-slate-400">{fmtWhen(entry.openedAt)}</span>
                  <span className="font-bold" style={{ color: !closed ? "#2563EB" : win ? "#16A34A" : pnl === 0 ? "#94A3B8" : "#DC2626" }}>
                    {!closed ? "Running" : pnl !== null ? `${pnl >= 0 ? "+" : ""}${pnl}` : "—"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="rounded-2xl bg-white border border-slate-100 p-4 shadow-sm">
        <p className="text-[10px] font-bold uppercase text-slate-400 mb-2">Method &amp; sources</p>
        <p className="text-[10px] text-slate-500 leading-relaxed">
          Windows are set from documented market structure, not tips: MCX energy trades 9am–11:30pm IST but the real volatility is the European session (~2–6:30pm) and the US session
          (~7–11:30pm), peaking on the weekly EIA reports at ~8pm IST — Crude on Wednesday, Natural Gas on Thursday. Within a window, the trade is a standard momentum/VWAP breakout on the
          15-minute read — never "it's 8pm, buy." Educational reference only, not financial advice; always confirm on the live chart.
        </p>
      </div>
    </div>
  );
}
