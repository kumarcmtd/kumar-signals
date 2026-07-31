import { useMemo, useState } from "react";
import { TrendingUp, TrendingDown, ShieldCheck, Info } from "lucide-react";
import { useMarketStatus } from "../api/hooks";
import { useTradeLog, liveLtpFor, effectiveStopFor } from "../hooks/useTradeLog";
import { useDirectionalGateSuite, type GateTimeframeResult } from "../hooks/useDirectionalGateSuite";
import { projectGatePremium, type GateDirection, type GatePremiumProjection } from "../utils/directionalGateEngine";
import { summarizeTradeLogsByDay } from "../utils/tradeLogStats";
import { evaluateEntryTiming } from "../utils/entryTiming";
import { EntryTimingBadge } from "../components/EntryTimingBadge";
import type { TradeLogEntry, TradeLogStatus } from "../store/appStore";
import type { Decision6 } from "../utils/timeframeEngine";

type TradableSymbol = "CRUDEOIL" | "NATURALGAS";
const SYMBOLS: TradableSymbol[] = ["CRUDEOIL", "NATURALGAS"];
const DISPLAY_NAME: Record<TradableSymbol, string> = { CRUDEOIL: "Crude Oil", NATURALGAS: "Natural Gas" };

const STATUS_LABEL: Record<TradeLogStatus, string> = {
  running: "Running",
  sl_hit: "SL Hit",
  stopped_breakeven: "Closed at Breakeven (T1)",
  stopped_after_t1: "Closed after T1 (T2 hit)",
  target3_hit: "Target 3 Hit",
  closed_manual: "Closed Manually",
};
const STATUS_COLOR: Record<TradeLogStatus, string> = {
  running: "text-white/60",
  sl_hit: "text-[#f43f5e]",
  stopped_breakeven: "text-[#a3e635]",
  stopped_after_t1: "text-[#22c55e]",
  target3_hit: "text-[#22c55e]",
  closed_manual: "text-white/40",
};

function fmtLogTime(ms: number): string {
  return new Date(ms).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

// Converts one timeframe's strict gate result into the minimal shape
// useTradeLog() needs (tf/decision/insufficient/optSide). "qualified" maps
// to STRONG BUY/STRONG SELL -- the highest-conviction Decision6 tier -- since
// this gate IS that same "everything agrees, zero doubt" standard, just
// computed by a different (multi-timeframe + ADX + volume) engine than
// analyzeTimeframe()'s score. Anything that doesn't qualify is WAIT, whether
// that's because data is thin (insufficient) or the setup simply isn't there
// yet (still trackable as "no trade," just not insufficient).
function pseudoAnalysisFor(r: GateTimeframeResult, optSide: "CE" | "PE", direction: GateDirection): { tf: string; decision: Decision6; insufficient: string | null; optSide: "CE" | "PE" } {
  if (r.evaluation.status === "insufficient") {
    return { tf: r.tf, decision: "WAIT", insufficient: r.evaluation.reason, optSide };
  }
  if (r.evaluation.status === "wait") {
    return { tf: r.tf, decision: "WAIT", insufficient: null, optSide };
  }
  return { tf: r.tf, decision: direction === "bullish" ? "STRONG BUY" : "STRONG SELL", insufficient: null, optSide };
}

function TradeLogLine({ entry, liveLtp }: { entry: TradeLogEntry; liveLtp: number | null }) {
  const dulled = entry.closed;
  const effStop = effectiveStopFor(entry);
  const nextTarget = entry.targetsHit[1] ? entry.targets[2] : entry.targetsHit[0] ? entry.targets[1] : entry.targets[0];
  const legFloor = entry.targetsHit[1] ? entry.targets[1] : entry.targetsHit[0] ? entry.targets[0] : entry.entry;
  const entryTiming = !dulled && liveLtp !== null ? evaluateEntryTiming(legFloor, nextTarget, effStop, liveLtp) : null;
  return (
    <div className={`rounded-lg border px-2.5 py-2 transition-opacity ${dulled ? "opacity-40 bg-white/[0.02] border-white/5" : "bg-white/5 border-white/10"}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold">
          {entry.strike} {entry.optSide} · Entry ₹{entry.entry}
        </span>
        <span className={`text-[10px] font-bold shrink-0 ${STATUS_COLOR[entry.status]}`}>{STATUS_LABEL[entry.status]}</span>
      </div>
      <p className="text-[9px] text-white/40 mt-1">
        Called {fmtLogTime(entry.openedAt)}
        {entry.closedAt !== null ? ` · Closed ${fmtLogTime(entry.closedAt)}` : ""}
      </p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-[10px] text-white/50">
        <TargetTick label="T1" price={entry.targets[0]} hit={entry.targetsHit[0]} />
        <TargetTick label="T2" price={entry.targets[1]} hit={entry.targetsHit[1]} />
        <TargetTick label="T3" price={entry.targets[2]} hit={entry.targetsHit[2]} />
        <span>
          SL ₹{effStop}
          {effStop !== entry.stop && <span className="text-white/30"> (was ₹{entry.stop})</span>}
        </span>
      </div>
      {!dulled && liveLtp !== null && <p className="text-[10px] text-white/40 mt-1">Current premium: ₹{liveLtp}</p>}
      {entryTiming && <EntryTimingBadge verdict={entryTiming} theme="dark" className="mt-1.5" />}
    </div>
  );
}

function TargetTick({ label, price, hit }: { label: string; price: number; hit: boolean }) {
  return (
    <span className={hit ? "text-[#22c55e] font-semibold" : ""}>
      {hit ? "✓" : "○"} {label} ₹{price}
    </span>
  );
}

interface DirectionalSignalsPageProps {
  direction: GateDirection;
  optSide: "CE" | "PE";
  title: string;
  accent: string;
  icon: typeof TrendingUp;
}

function DirectionalSignalsPage({ direction, optSide, title, accent, icon: Icon }: DirectionalSignalsPageProps) {
  const { data: market } = useMarketStatus();
  const [symbol, setSymbol] = useState<TradableSymbol>("CRUDEOIL");

  const crudeOil = useDirectionalGateSuite("CRUDEOIL", direction);
  const naturalGas = useDirectionalGateSuite("NATURALGAS", direction);
  const board: Record<TradableSymbol, ReturnType<typeof useDirectionalGateSuite>> = { CRUDEOIL: crudeOil, NATURALGAS: naturalGas };
  const current = board[symbol];

  const keyPrefix = optSide === "CE" ? "GATECE" : "GATEPE";

  const crudeOilAnalyses = useMemo(() => crudeOil.results.map((r) => pseudoAnalysisFor(r, optSide, direction)), [crudeOil.results, optSide, direction]);
  const naturalGasAnalyses = useMemo(() => naturalGas.results.map((r) => pseudoAnalysisFor(r, optSide, direction)), [naturalGas.results, optSide, direction]);
  const crudeOilProjections = useMemo<(GatePremiumProjection | null)[]>(
    () => crudeOil.results.map((r) => (r.evaluation.status === "qualified" ? projectGatePremium(r.evaluation, optSide, crudeOil.options) : null)),
    [crudeOil.results, crudeOil.options, optSide]
  );
  const naturalGasProjections = useMemo<(GatePremiumProjection | null)[]>(
    () => naturalGas.results.map((r) => (r.evaluation.status === "qualified" ? projectGatePremium(r.evaluation, optSide, naturalGas.options) : null)),
    [naturalGas.results, naturalGas.options, optSide]
  );

  // Both symbols tick every render regardless of which tab is selected --
  // same reason every other multi-symbol page here does this: switching
  // tabs must not stall the other symbol's log or day-wise stats.
  useTradeLog("CRUDEOIL", crudeOilAnalyses, crudeOilProjections, crudeOil.options, `${keyPrefix}-CRUDEOIL`);
  const tradeLogs = useTradeLog("NATURALGAS", naturalGasAnalyses, naturalGasProjections, naturalGas.options, `${keyPrefix}-NATURALGAS`);

  // tradeLogs is the WHOLE shared store (every page's keys), not just this
  // page's own -- must filter to only this page's own keyPrefix before
  // summarizing, or the day-wise log/stats would silently include every
  // other page's historical trades too.
  const ownTradeLogsOnly = useMemo(() => {
    const out: Record<string, TradeLogEntry[]> = {};
    for (const [k, v] of Object.entries(tradeLogs)) if (k.startsWith(`${keyPrefix}-`)) out[k] = v;
    return out;
  }, [tradeLogs, keyPrefix]);
  const dayStats = useMemo(() => summarizeTradeLogsByDay(ownTradeLogsOnly), [ownTradeLogsOnly]);
  const allClosed = useMemo(() => Object.values(ownTradeLogsOnly).flatMap((v) => v.filter((e) => e.closed)), [ownTradeLogsOnly]);
  const targetHitCount = allClosed.filter((e) => e.status === "target3_hit" || e.status === "stopped_after_t1").length;
  const slHitCount = allClosed.filter((e) => e.status === "sl_hit").length;
  const decidedCount = targetHitCount + slHitCount;
  const winRate = decidedCount > 0 ? Math.round((targetHitCount / decidedCount) * 100) : null;

  return (
    <div className="-mx-4 -mt-4 px-4 pt-4 pb-6 bg-gradient-to-b from-[#07050C] via-[#0D0A17] to-[#0D0A17] text-white min-h-screen space-y-5">
      <section className="text-center pt-2 space-y-2">
        <div className="flex items-center justify-center gap-2">
          <Icon size={22} style={{ color: accent }} />
          <h1 className="text-xl font-black tracking-tight" style={{ color: accent }}>
            {title}
          </h1>
        </div>
        <p className="text-[11px] text-white/50 px-4">
          A deliberately much stricter engine than the other pages: fires only when the higher-timeframe trend AND this timeframe's own trend both confirm {direction === "bullish" ? "bullish" : "bearish"},
          trend strength (ADX ≥ 20) and volume (≥1.2x average) both back it up, with a 1:1.5+ reward-to-risk stop/target built from real ATR. Expect WAIT most of the time on most timeframes -- that's the design
          goal (one or two genuinely confirmed calls beats twenty noisy ones), not a bug.
        </p>
        <p className="text-[10px] text-white/30 flex items-center justify-center gap-1">
          <span className={`w-1.5 h-1.5 rounded-full ${market?.isOpen ? "bg-emerald-500" : "bg-rose-500"}`} />
          {market ? (market.isOpen ? "Market Open" : "Market Closed") : "…"}
        </p>
      </section>

      <div className="grid grid-cols-4 gap-2">
        <MiniStat label="Closed Today" value={String(allClosed.length)} />
        <MiniStat label="Target Hit" value={String(targetHitCount)} tone="up" />
        <MiniStat label="SL Hit" value={String(slHitCount)} tone="down" />
        <MiniStat label="Win Rate" value={winRate !== null ? `${winRate}%` : "—"} tone={winRate !== null && winRate >= 50 ? "up" : winRate !== null ? "down" : undefined} />
      </div>

      <div className="flex gap-2">
        {SYMBOLS.map((sym) => (
          <button
            key={sym}
            onClick={() => setSymbol(sym)}
            className={`flex-1 rounded-2xl py-2.5 text-sm font-bold border transition-all ${symbol === sym ? "text-black" : "bg-white/5 border-white/10 text-white/60"}`}
            style={symbol === sym ? { background: accent, borderColor: accent } : undefined}
          >
            {DISPLAY_NAME[sym]}
          </button>
        ))}
      </div>

      {current.liveDataUnavailable && (
        <div className="rounded-2xl bg-rose-500/10 border border-rose-500/20 p-4 text-center">
          <p className="text-sm font-bold text-rose-300">Live data unavailable</p>
          <p className="text-xs text-white/50 mt-1">{current.errorMessage ?? "Option chain unreachable"} — no entry, target, stop loss, or confidence is fabricated while this is down.</p>
        </div>
      )}

      {/* TIMEFRAME OVERVIEW */}
      <section className="rounded-2xl bg-white/[0.05] backdrop-blur-xl border border-white/10 p-4 overflow-x-auto">
        <p className="text-xs font-bold uppercase text-white/70 mb-3">Timeframe Overview — {DISPLAY_NAME[symbol]}</p>
        <table className="w-full text-[11px] min-w-[640px]">
          <thead>
            <tr className="text-white/40 text-left">
              <th className="font-semibold pb-2">Timeframe</th>
              <th className="font-semibold pb-2">Signal</th>
              <th className="font-semibold pb-2">Strike</th>
              <th className="font-semibold pb-2">Entry</th>
              <th className="font-semibold pb-2">Live Price</th>
              <th className="font-semibold pb-2">Target 1</th>
              <th className="font-semibold pb-2">Stop Loss</th>
              <th className="font-semibold pb-2">Confidence</th>
              <th className="font-semibold pb-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {current.results.map((r) => {
              const log = tradeLogs[`${keyPrefix}-${symbol}-${r.tf}`] ?? [];
              const latest = log[log.length - 1];
              const liveLtp = latest && !latest.closed ? liveLtpFor(current.options, latest.strike, latest.optSide) : null;
              const qualified = r.evaluation.status === "qualified";
              return (
                <tr key={r.tf} className="border-t border-white/10">
                  <td className="py-2 font-semibold">{r.label}</td>
                  <td className={`py-2 font-bold ${qualified ? (direction === "bullish" ? "text-[#22c55e]" : "text-[#f43f5e]") : "text-white/30"}`}>
                    {qualified ? `${optSide} Buy Call` : r.evaluation.status === "insufficient" ? "NO DATA" : "Wait"}
                  </td>
                  <td className="py-2">{latest ? `${latest.strike} ${latest.optSide}` : "—"}</td>
                  <td className="py-2">{latest ? `₹${latest.entry}` : "—"}</td>
                  <td className="py-2 font-bold">{liveLtp !== null ? `₹${liveLtp}` : "—"}</td>
                  <td className="py-2">{latest ? `₹${latest.targets[0]}` : "—"}</td>
                  <td className="py-2">{latest ? `₹${effectiveStopFor(latest)}` : "—"}</td>
                  <td className="py-2">{qualified ? `${(r.evaluation as { confidence: number }).confidence}%` : "—"}</td>
                  <td className={`py-2 font-bold ${latest ? STATUS_COLOR[latest.status] : "text-white/30"}`}>{latest ? STATUS_LABEL[latest.status] : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {/* DAY-WISE TRADE LOG SUMMARY */}
      <section className="rounded-2xl bg-white/[0.05] backdrop-blur-xl border border-white/10 p-4 overflow-x-auto">
        <p className="text-xs font-bold uppercase text-white/70 mb-1">Day-wise Trade Log — Both Symbols</p>
        <p className="text-[10px] text-white/40 mb-3">One MCX session = 9:00am – 11:55pm IST. Counts every closed trade across all timeframes for Natural Gas and Crude Oil.</p>
        {dayStats.length === 0 ? (
          <p className="text-xs text-white/40 text-center py-3">No trades have closed yet — this fills in as signals run their course.</p>
        ) : (
          <table className="w-full text-[11px] min-w-[420px]">
            <thead>
              <tr className="text-white/40 text-left">
                <th className="font-semibold pb-2">Date</th>
                <th className="font-semibold pb-2">Target Hit</th>
                <th className="font-semibold pb-2">Breakeven</th>
                <th className="font-semibold pb-2">SL Hit</th>
                <th className="font-semibold pb-2">Total</th>
              </tr>
            </thead>
            <tbody>
              {dayStats.map((d) => (
                <tr key={d.dateKey} className="border-t border-white/10">
                  <td className="py-2 font-semibold">{d.label}</td>
                  <td className="py-2 font-bold text-[#22c55e]">{d.targetHit}</td>
                  <td className="py-2 font-bold text-[#a3e635]">{d.breakeven}</td>
                  <td className="py-2 font-bold text-[#f43f5e]">{d.slHit}</td>
                  <td className="py-2 text-white/60">{d.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* PER-TIMEFRAME CARDS */}
      <div className="space-y-3">
        {current.results.map((r) => {
          const log = tradeLogs[`${keyPrefix}-${symbol}-${r.tf}`] ?? [];
          const latest = log[log.length - 1];
          const openTrade = latest && !latest.closed ? latest : undefined;
          const liveLtp = openTrade ? liveLtpFor(current.options, openTrade.strike, openTrade.optSide) : null;
          const qualified = r.evaluation.status === "qualified";
          return (
            <section key={r.tf} className="rounded-2xl bg-white/[0.05] backdrop-blur-xl border border-white/10 overflow-hidden">
              <div className="px-4 py-3 flex items-center justify-between border-b border-white/10">
                <p className="text-sm font-bold">{r.label}</p>
                {r.evaluation.status === "insufficient" ? (
                  <span className="text-[10px] font-bold text-white/40">NO DATA</span>
                ) : qualified ? (
                  <span className="text-[11px] font-bold px-2.5 py-1 rounded-full text-black flex items-center gap-1" style={{ background: accent }}>
                    {optSide} Buy Call {latest ? `${latest.strike} ${latest.optSide}` : ""}
                  </span>
                ) : (
                  <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-amber-400/15 text-amber-300 border border-amber-400/30">Wait</span>
                )}
              </div>
              <div className="p-4 space-y-3">
                {r.evaluation.status === "insufficient" ? (
                  <p className="text-xs text-white/40 text-center py-2">{r.evaluation.reason}</p>
                ) : r.evaluation.status === "wait" ? (
                  <p className="text-xs text-white/50">{r.evaluation.reason}</p>
                ) : (
                  <>
                    <div className="grid grid-cols-3 gap-2">
                      <MiniStat label="Confidence" value={`${r.evaluation.confidence}%`} tone="up" />
                      <MiniStat label="Reward:Risk" value={`1:${r.evaluation.rr}`} />
                      <MiniStat label="Underlying Entry" value={`₹${r.evaluation.entry}`} />
                    </div>
                    <div className="space-y-1">
                      {r.evaluation.reasons.map((reason, i) => (
                        <p key={i} className="text-[11px] text-white/50 flex items-start gap-1.5">
                          <ShieldCheck size={12} className="shrink-0 mt-0.5" style={{ color: accent }} /> {reason}
                        </p>
                      ))}
                    </div>
                  </>
                )}

                {log.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-[10px] font-bold text-white/50 uppercase">Trade Log (newest first)</p>
                    {[...log].reverse().map((entry) => (
                      <TradeLogLine key={entry.id} entry={entry} liveLtp={entry.id === openTrade?.id ? liveLtp : null} />
                    ))}
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </div>

      <p className="text-[10px] text-white/30 leading-relaxed text-center px-4 pb-2 flex items-start gap-1.5 justify-center">
        <Info size={12} className="shrink-0 mt-0.5" /> Educational reference only, not financial advice. Entry/stop/target/confidence numbers are always computed deterministically from real live
        data. A strict filter means fewer signals, not a guarantee — always confirm on the live chart before acting.
      </p>
    </div>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" }) {
  const color = tone === "up" ? "text-[#22c55e]" : tone === "down" ? "text-[#f43f5e]" : "text-white";
  return (
    <div className="rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-center">
      <p className="text-[9px] text-white/40">{label}</p>
      <p className={`text-sm font-bold ${color}`}>{value}</p>
    </div>
  );
}

export function CEBuySignals() {
  return <DirectionalSignalsPage direction="bullish" optSide="CE" title="NG & Crude Oil — CE Buy Signals" accent="#22c55e" icon={TrendingUp} />;
}

export function PEBuySignals() {
  return <DirectionalSignalsPage direction="bearish" optSide="PE" title="NG & Crude Oil — PE Buy Signals" accent="#f43f5e" icon={TrendingDown} />;
}
