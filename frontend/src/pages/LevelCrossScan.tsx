import { useMemo, useState } from "react";
import { Waypoints, TrendingUp, TrendingDown, Info, Eye, Target, ChevronDown, ChevronRight, CandlestickChart, X, ShieldCheck, Lock } from "lucide-react";
import { useLevelCrossScanner } from "../hooks/useLevelCrossScanner";
import { useCandles } from "../api/hooks";
import { liveLtpFor, effectiveStopFor } from "../hooks/useTradeLog";
import { evaluateEntryTiming } from "../utils/entryTiming";
import { EntryTimingBadge } from "../components/EntryTimingBadge";
import { PriceScale, ProfitEstimate, DetailRow, CallChart, tickMarks, fmtWhen } from "../components/CallCardKit";
import { NewsImpactCard } from "../components/NewsImpactCard";
import { TradeChart, type ChartMarkerSpec } from "../components/TradeChart";
import { detectSignificantLevels, type LevelCrossSignal, type SrLevel } from "../utils/levelCrossEngine";
import { summarizeTradeLogsByDay } from "../utils/tradeLogStats";
import { flattenClosedTrades, computePerformanceStats, exitPriceFor } from "../utils/tradeLogPnl";
import { useAppStore, type TradeLogEntry } from "../store/appStore";
import type { Candle } from "../types";

type TradableSymbol = "CRUDEOIL" | "NATURALGAS";
const SYMBOLS: TradableSymbol[] = ["CRUDEOIL", "NATURALGAS"];
const DISPLAY_NAME: Record<TradableSymbol, string> = { CRUDEOIL: "Crude Oil", NATURALGAS: "Natural Gas" };
const LOT_SIZE: Record<TradableSymbol, number> = { CRUDEOIL: 100, NATURALGAS: 1250 };
// A soft accidental-tap guard, not real security -- same purpose and value
// as Best Call's own Force Stop password (this is a public client bundle,
// so anyone in devtools can read it). Stops a stray tap from silently
// ending a live trade.
const FORCE_STOP_PASSWORD = "SHANVI";

const RESISTANCE_COLOR = "#DC2626";
const SUPPORT_COLOR = "#16A34A";
const TARGET_COLOR = "#2563EB";
const CONTEXT_COLOR = "#94A3B8";

// The whole point of this page is a claim someone should be able to check
// with their own eyes -- "this level was tested N times, then broke" isn't
// trustworthy as a bare number alone. This draws the exact level that
// broke, the next level used as the real target, and a couple of other
// significant levels nearby for context, directly on the same candle
// series (same timeframe) the engine itself scanned -- never a mismatched
// fixed interval.
function LevelCrossChart({ candles, signal, entry }: { candles: Candle[]; signal: LevelCrossSignal | null; entry: TradeLogEntry | undefined }) {
  if (!candles.length) {
    return <p className="text-xs text-[var(--color-muted)] text-center py-6 px-2">No chart data available yet.</p>;
  }

  const allLevels = detectSignificantLevels(candles);
  const drawn = new Set<number>();
  const priceLines: { price: number; color: string; title: string }[] = [];

  if (signal?.level) {
    priceLines.push({
      price: signal.level.price,
      color: signal.level.type === "resistance" ? RESISTANCE_COLOR : SUPPORT_COLOR,
      title: `${signal.level.type === "resistance" ? "Resistance" : "Support"} · ${signal.level.touches}x tested`,
    });
    drawn.add(signal.level.price);
  }
  if (signal?.nextLevel) {
    priceLines.push({ price: signal.nextLevel.price, color: TARGET_COLOR, title: `Target level · ${signal.nextLevel.touches}x tested` });
    drawn.add(signal.nextLevel.price);
  }
  const context = allLevels.filter((l: SrLevel) => !drawn.has(l.price)).slice(0, 3);
  for (const l of context) priceLines.push({ price: l.price, color: CONTEXT_COLOR, title: `${l.touches}x tested` });

  const markers: ChartMarkerSpec[] = entry
    ? [
        {
          timeMs: entry.openedAt,
          color: signal?.direction === "bullish" ? "#16a34a" : "#dc2626",
          shape: signal?.direction === "bullish" ? "arrowUp" : "arrowDown",
          text: "LEVEL BREAK",
          position: signal?.direction === "bullish" ? "belowBar" : "aboveBar",
        },
      ]
    : [];

  return (
    <div>
      <TradeChart candles={candles} priceLines={priceLines} markers={markers} height={240} theme="light" />
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-[9px] text-[var(--color-muted)]">
        {signal?.level && (
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: signal.level.type === "resistance" ? RESISTANCE_COLOR : SUPPORT_COLOR }} /> Level that broke
          </span>
        )}
        {signal?.nextLevel && (
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: TARGET_COLOR }} /> Target level
          </span>
        )}
        {context.length > 0 && (
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: CONTEXT_COLOR }} /> Other tested levels nearby
          </span>
        )}
      </div>
      <p className="text-[9px] text-[var(--color-muted)] mt-1.5">
        Underlying price on {signal?.label ?? "the"} chart -- the same candles and levels the scanner itself read. Entry/stop/target above are option-premium levels, not shown on this price scale.
      </p>
    </div>
  );
}

function SymbolCard({ symbol, scanner }: { symbol: TradableSymbol; scanner: ReturnType<typeof useLevelCrossScanner> }) {
  const [chartOpen, setChartOpen] = useState(false);
  const signal = scanner.best[symbol];
  const log = scanner.tradeLogs[symbol];
  const latest = log[log.length - 1];
  const openTrade = latest && !latest.closed ? latest : undefined;
  const options = scanner.options[symbol];
  const liveLtp = openTrade ? liveLtpFor(options, openTrade.strike, openTrade.optSide) : null;

  const nextTarget = latest ? (latest.targetsHit[1] ? latest.targets[2] : latest.targetsHit[0] ? latest.targets[1] : latest.targets[0]) : null;
  const legFloor = latest ? (latest.targetsHit[1] ? latest.targets[1] : latest.targetsHit[0] ? latest.targets[0] : latest.entry) : null;
  const entryTiming = liveLtp !== null && nextTarget !== null && legFloor !== null && latest ? evaluateEntryTiming(legFloor, nextTarget, effectiveStopFor(latest), liveLtp) : null;

  // A call must keep showing (and stay force-stoppable) for as long as it's
  // still RUNNING, even if this particular poll's fresh re-scan doesn't
  // currently re-detect the exact same qualifying condition -- a level
  // break is momentary by nature, but the trade it opened is still open
  // and tracked against live premium regardless. Only fall through to the
  // empty/near-miss state once the latest tracked call has actually closed
  // with nothing new currently live to replace it (same guard Best Call
  // uses for its own three source engines).
  const hasVisibleCall = !!latest && (!latest.closed || !!signal);
  if (!hasVisibleCall) {
    const nearMiss = scanner.misses[symbol][0];
    return (
      <section className="rounded-3xl bg-white shadow-md p-5 space-y-2.5">
        <div className="text-center space-y-1.5">
          <p className="text-sm font-black text-slate-700">{DISPLAY_NAME[symbol]} -- No Qualifying Break Right Now</p>
          {nearMiss?.level ? (
            <p className="text-xs text-slate-500 px-2">
              Watching {nearMiss.level.type} at ₹{nearMiss.level.price} ({nearMiss.level.touches}x tested) on {nearMiss.label} -- {nearMiss.reasons[nearMiss.reasons.length - 1]}
            </p>
          ) : (
            <p className="text-xs text-slate-500 px-2">No significant, well-tested level has broken with real conviction yet on any timeframe.</p>
          )}
        </div>
        <NewsImpactCard symbol={symbol} />
        <button onClick={() => setChartOpen((o) => !o)} className="w-full flex items-center justify-center gap-1.5 text-xs font-bold text-teal-700">
          <CandlestickChart size={14} /> {nearMiss ? "View Watched Level" : "View Chart"}
          <ChevronDown size={14} className={`transition-transform ${chartOpen ? "rotate-180" : ""}`} />
        </button>
        {chartOpen && <LevelCrossChart candles={scanner.chartCandles[symbol] ?? []} signal={nearMiss ?? null} entry={undefined} />}
      </section>
    );
  }

  // `signal` is only ever THIS poll's fresh re-scan -- it can legitimately
  // be null here while `latest` (the actually-open trade) keeps running, so
  // every display value below prefers the live signal when it's genuinely
  // current and falls back to what was captured in the trade's own meta at
  // the moment it opened, rather than assuming signal is always present.
  const bullish = latest.optSide === "CE";
  const accent = bullish ? "#0D9488" : "#DC2626";
  const displayReasons = signal?.reasons ?? latest.meta?.reasons ?? [];
  const displayLabel = signal?.label ?? latest.meta?.label?.match(/\(([^)]+)\)/)?.[1] ?? "";

  const handleForceStop = () => {
    const pw = window.prompt("Enter password to force-stop this trade:");
    if (pw === null) return;
    if (pw !== FORCE_STOP_PASSWORD) {
      window.alert("Incorrect password.");
      return;
    }
    if (window.confirm("Mark this trade as completed now? This can't be undone.")) {
      scanner.forceCloseTradeLog(scanner.trackingKey[symbol]);
    }
  };

  return (
    <section className="rounded-3xl bg-white shadow-md overflow-hidden border-l-8" style={{ borderColor: accent }}>
      <div className="p-4 flex items-start justify-between gap-3" style={{ background: bullish ? "linear-gradient(135deg,#ECFEFF,#FFFFFF)" : "linear-gradient(135deg,#FEF2F2,#FFFFFF)" }}>
        <div>
          <p className="text-[10px] font-bold uppercase text-slate-400">
            {DISPLAY_NAME[symbol]} {displayLabel && `· ${displayLabel}`}
          </p>
          <p className="text-lg font-black flex items-center gap-1.5" style={{ color: accent }}>
            {bullish ? <TrendingUp size={18} /> : <TrendingDown size={18} />}
            {latest.optSide} Buy Call
          </p>
          <p className="text-sm font-bold text-slate-700 mt-0.5">
            {latest.strike} {latest.optSide} · Entry ₹{latest.entry}
          </p>
        </div>
        <div className="text-center shrink-0">
          {signal ? (
            <>
              <div className="w-14 h-14 rounded-full flex items-center justify-center text-white font-black text-lg shadow" style={{ background: accent }}>
                {signal.confidence}
              </div>
              <p className="text-[9px] font-bold text-slate-400 mt-1">Confidence</p>
            </>
          ) : (
            !latest.closed && (
              <span className="text-[10px] px-2 py-1 rounded-full font-bold animate-pulse" style={{ background: "#FEE2E2", color: "#B91C1C" }}>
                LIVE
              </span>
            )
          )}
        </div>
      </div>

      <div className="p-4 space-y-3">
        <NewsImpactCard symbol={symbol} />
        {signal?.level && (
          <div className="rounded-2xl p-3" style={{ background: "#F0FDFA", border: "1px solid #99F6E4" }}>
            <p className="text-[10px] font-bold uppercase text-teal-700 flex items-center gap-1.5">
              <Waypoints size={12} /> Level That Broke
            </p>
            <p className="text-sm font-black text-teal-900 mt-0.5">
              {signal.level.type === "resistance" ? "Resistance" : "Support"} at ₹{signal.level.price} -- tested {signal.level.touches}x before breaking
            </p>
            {signal.nextLevel && (
              <p className="text-[11px] text-teal-700 mt-1">
                Target set at the next significant level (₹{signal.nextLevel.price}, tested {signal.nextLevel.touches}x) -- a real level, not a projection.
              </p>
            )}
          </div>
        )}

        <div className="grid grid-cols-3 gap-2">
          <DetailRow label="Stop Loss" value={`₹${effectiveStopFor(latest)}`} valueColor="#DC2626" />
          <DetailRow label="Target 1" value={`₹${latest.targets[0]}`} valueColor="#0D9488" />
          <DetailRow label="Live Premium" value={liveLtp !== null ? `₹${liveLtp}` : "—"} valueColor="#0EA5E9" />
        </div>
        {entryTiming && <EntryTimingBadge verdict={entryTiming} theme="light" />}

        <PriceScale entry={latest} current={liveLtp} />
        <ProfitEstimate trade={latest} current={liveLtp} lotSize={LOT_SIZE[symbol]} />

        {displayReasons.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[10px] font-bold uppercase text-slate-400">Why This Cleared The Bar</p>
            {displayReasons.map((r, i) => (
              <p key={i} className="text-[11px] text-slate-500 flex items-start gap-1.5">
                <span className="mt-0.5 text-teal-500">•</span> {r}
              </p>
            ))}
          </div>
        )}

        {!latest.closed && (
          <div className="flex items-center justify-between gap-2 pt-1">
            <p className="text-[10px] text-slate-400">Next target ₹{nextTarget}</p>
            <button onClick={handleForceStop} className="flex items-center gap-1 text-[10px] font-bold text-slate-400 underline underline-offset-2 shrink-0">
              <Lock size={10} />
              Force Stop
            </button>
          </div>
        )}
        {latest.closed && (
          <p className="text-[11px] font-bold" style={{ color: exitPriceFor(latest) - latest.entry >= 0 ? "#0D9488" : "#DC2626" }}>
            Closed: {latest.status.replace(/_/g, " ")}
          </p>
        )}

        <button onClick={() => setChartOpen((o) => !o)} className="w-full flex items-center justify-center gap-1.5 text-xs font-bold text-teal-700 pt-1">
          <CandlestickChart size={14} /> View Chart
          <ChevronDown size={14} className={`transition-transform ${chartOpen ? "rotate-180" : ""}`} />
        </button>
        {chartOpen && <LevelCrossChart candles={scanner.chartCandles[symbol] ?? []} signal={signal} entry={latest} />}
      </div>
    </section>
  );
}

function CallHistoryRow({ symbol, entry, onOpen }: { symbol: TradableSymbol; entry: TradeLogEntry; onOpen: () => void }) {
  const exit = entry.closed ? exitPriceFor(entry) : null;
  const pnl = exit !== null ? Number((exit - entry.entry).toFixed(2)) : null;
  const statusLabel = entry.closed ? entry.status.replace(/_/g, " ") : "Running";
  const statusColor = !entry.closed ? "#B45309" : pnl !== null && pnl > 0 ? "#0D9488" : pnl !== null && pnl < 0 ? "#DC2626" : "#B45309";
  const effStop = effectiveStopFor(entry);

  return (
    <button onClick={onOpen} className="w-full text-left rounded-xl border px-3 py-2.5 border-slate-200 active:bg-slate-50">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-bold truncate">
            {DISPLAY_NAME[symbol]} · {entry.strike} {entry.optSide}
            {entry.meta?.label ? ` · ${entry.meta.label}` : ""}
          </p>
          <p className="text-[10px] text-slate-400">
            Called {fmtWhen(entry.openedAt)} at ₹{entry.entry}
            {entry.closed && entry.closedAt !== null && (
              <>
                {" "}
                · Closed {fmtWhen(entry.closedAt)} at ₹{exit}
              </>
            )}
          </p>
        </div>
        <div className="text-right shrink-0 flex items-center gap-1">
          <div>
            <p className="text-xs font-bold" style={{ color: statusColor }}>
              {statusLabel}
            </p>
            {pnl !== null && (
              <p className="text-[10px] text-slate-400">
                {pnl >= 0 ? "+" : ""}
                {pnl} pts
              </p>
            )}
          </div>
          <ChevronRight size={14} className="text-slate-400 shrink-0" />
        </div>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5 text-[10px] text-slate-400">
        <span className={entry.targetsHit[0] ? "text-teal-600 font-semibold" : ""}>
          {tickMarks(entry.targetTouches?.[0] ?? (entry.targetsHit[0] ? 1 : 0))} T1 ₹{entry.targets[0]}
        </span>
        <span className={entry.targetsHit[1] ? "text-teal-600 font-semibold" : ""}>
          {tickMarks(entry.targetTouches?.[1] ?? (entry.targetsHit[1] ? 1 : 0))} T2 ₹{entry.targets[1]}
        </span>
        <span className={entry.targetsHit[2] ? "text-teal-600 font-semibold" : ""}>
          {tickMarks(entry.targetTouches?.[2] ?? (entry.targetsHit[2] ? 1 : 0))} T3 ₹{entry.targets[2]}
        </span>
        <span>
          SL ₹{effStop}
          {effStop !== entry.stop && <span className="opacity-60"> (was ₹{entry.stop})</span>}
        </span>
      </div>
    </button>
  );
}

function CallDetailModal({ symbol, entry, onClose }: { symbol: TradableSymbol; entry: TradeLogEntry; onClose: () => void }) {
  const exit = entry.closed ? exitPriceFor(entry) : null;
  const pnl = exit !== null ? Number((exit - entry.entry).toFixed(2)) : null;
  const statusLabel = entry.closed ? entry.status.replace(/_/g, " ") : "Running";
  const statusColor = !entry.closed ? "#B45309" : pnl !== null && pnl > 0 ? "#0D9488" : pnl !== null && pnl < 0 ? "#DC2626" : "#B45309";
  const effStop = effectiveStopFor(entry);
  const direction = entry.optSide === "CE" ? "bullish" : "bearish";
  const Bias = direction === "bullish" ? TrendingUp : TrendingDown;
  const biasColor = direction === "bullish" ? "#0D9488" : "#DC2626";
  const { data: candleData, isLoading: candlesLoading } = useCandles(symbol, "15");

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div className="relative w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-3xl p-5 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <p className="text-xl font-black flex items-center gap-2">
            <Bias size={20} style={{ color: biasColor }} />
            {DISPLAY_NAME[symbol]} {entry.strike} {entry.optSide}
          </p>
          <button onClick={onClose} className="p-2 rounded-full bg-slate-100 shrink-0">
            <X size={18} />
          </button>
        </div>
        {entry.meta?.label && (
          <p className="text-sm font-bold mb-3" style={{ color: "#0D9488" }}>
            {entry.meta.label}
          </p>
        )}

        <div className="rounded-2xl p-3.5 mb-3 bg-slate-50">
          <p className="text-lg font-black" style={{ color: statusColor }}>
            {statusLabel}
          </p>
          {pnl !== null && (
            <p className="text-sm font-bold text-slate-500">
              {pnl >= 0 ? "+" : ""}
              {pnl} points
            </p>
          )}
        </div>

        <div>
          <DetailRow label="Called" value={`${fmtWhen(entry.openedAt)} at ₹${entry.entry}`} />
          {entry.closed && entry.closedAt !== null && <DetailRow label="Closed" value={`${fmtWhen(entry.closedAt)} at ₹${exit}`} />}
          <DetailRow label="Entry" value={`₹${entry.entry}`} />
          <DetailRow label="Target 1" value={`₹${entry.targets[0]}  ${tickMarks(entry.targetTouches?.[0] ?? (entry.targetsHit[0] ? 1 : 0))}`} valueColor={entry.targetsHit[0] ? "#0D9488" : undefined} />
          <DetailRow label="Target 2" value={`₹${entry.targets[1]}  ${tickMarks(entry.targetTouches?.[1] ?? (entry.targetsHit[1] ? 1 : 0))}`} valueColor={entry.targetsHit[1] ? "#0D9488" : undefined} />
          <DetailRow label="Target 3" value={`₹${entry.targets[2]}  ${tickMarks(entry.targetTouches?.[2] ?? (entry.targetsHit[2] ? 1 : 0))}`} valueColor={entry.targetsHit[2] ? "#0D9488" : undefined} />
          <DetailRow label="Stop Loss" value={effStop !== entry.stop ? `₹${effStop} (was ₹${entry.stop})` : `₹${entry.stop}`} valueColor="#DC2626" />
        </div>

        <div className="mt-4 -mx-5">
          <PriceScale entry={entry} current={entry.closed ? exit : null} />
          <ProfitEstimate trade={entry} current={entry.closed ? exit : null} lotSize={LOT_SIZE[symbol]} />
        </div>

        {entry.meta?.reasons && entry.meta.reasons.length > 0 && (
          <div className="mt-4">
            <p className="text-xs font-bold uppercase text-slate-400 mb-2">Why this call cleared the bar</p>
            <div className="space-y-1.5">
              {entry.meta.reasons.map((r, i) => (
                <p key={i} className="text-sm flex items-start gap-2">
                  <ShieldCheck size={14} className="shrink-0 mt-0.5 text-teal-600" />
                  {r}
                </p>
              ))}
            </div>
          </div>
        )}

        <div className="mt-4">
          <p className="text-xs font-bold uppercase text-slate-400 mb-2 flex items-center gap-1.5">
            <CandlestickChart size={13} />
            Chart
          </p>
          <CallChart candles={candleData?.candles ?? []} entry={entry} loading={candlesLoading} errorReason={(candleData as { error?: string } | undefined)?.error ?? null} />
        </div>
      </div>
    </div>
  );
}

export function LevelCrossScan() {
  const scanner = useLevelCrossScanner();
  const [detail, setDetail] = useState<{ symbol: TradableSymbol; entry: TradeLogEntry } | null>(null);

  const tradeLogs = useAppStore((s) => s.tradeLogs);
  const levelCrossLogsOnly = useMemo(() => {
    const out: Record<string, TradeLogEntry[]> = {};
    for (const [k, v] of Object.entries(tradeLogs)) if (k.startsWith("LEVELCROSS-")) out[k] = v;
    return out;
  }, [tradeLogs]);
  const realized = useMemo(() => flattenClosedTrades(levelCrossLogsOnly), [levelCrossLogsOnly]);
  const perf = useMemo(() => computePerformanceStats(realized), [realized]);
  const allCalls = useMemo(() => {
    const out: { symbol: TradableSymbol; entry: TradeLogEntry }[] = [];
    for (const [k, v] of Object.entries(levelCrossLogsOnly)) {
      const symbol = k.replace("LEVELCROSS-", "") as TradableSymbol;
      for (const entry of v) out.push({ symbol, entry });
    }
    return out.sort((a, b) => b.entry.openedAt - a.entry.openedAt);
  }, [levelCrossLogsOnly]);

  const dayStats = summarizeTradeLogsByDay(levelCrossLogsOnly);

  const anyMiss = SYMBOLS.some((s) => scanner.misses[s].length > 0);

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <div className="flex items-center gap-2">
          <Waypoints size={18} className="text-teal-600" />
          <p className="text-sm font-bold">Level Cross Scan</p>
        </div>
        <p className="text-xs text-[var(--color-muted)] mt-1.5">
          A horizontal level tested several times, then finally broken with real conviction, tends to move fast -- that's real supply/demand getting absorbed, not a random tick. Every market, every
          timeframe scanned continuously with no fixed candle interval; only the single highest-confidence genuine break per instrument shows here. A weak close, extended RSI, or volume running
          against the break disqualifies it outright -- some days that's zero calls, by design.
        </p>
      </div>

      {scanner.anyLiveDataUnavailable && (
        <div className="card p-4 text-center">
          <p className="text-sm font-bold text-rose-500">Live data unavailable</p>
          <p className="text-xs text-[var(--color-muted)] mt-1">Option chain unreachable for one or both markets -- no entry, target, or stop loss is fabricated while this is down.</p>
        </div>
      )}

      {SYMBOLS.map((symbol) => (
        <SymbolCard key={symbol} symbol={symbol} scanner={scanner} />
      ))}

      {anyMiss && (
        <section className="card p-4 space-y-2.5">
          <p className="text-xs font-bold uppercase text-[var(--color-muted)] flex items-center gap-1.5">
            <Eye size={13} className="text-indigo-500" /> Levels Being Watched
          </p>
          {SYMBOLS.flatMap((symbol) =>
            scanner.misses[symbol].map((m, i) => (
              <div key={`${symbol}-${i}`} className="rounded-2xl bg-slate-50 border border-slate-200 p-3">
                <p className="text-xs font-bold text-slate-600">
                  {DISPLAY_NAME[symbol]} · {m.label} · {m.level?.type === "resistance" ? "Resistance" : "Support"} ₹{m.level?.price} ({m.level?.touches}x tested)
                </p>
                <p className="text-[10px] text-slate-400 mt-1">{m.reasons[m.reasons.length - 1]}</p>
              </div>
            ))
          )}
        </section>
      )}

      <section className="card p-4">
        <p className="text-xs font-bold mb-3">Level Cross Track Record</p>
        <div className="grid grid-cols-3 gap-2">
          <StatTile label="Closed" value={String(perf.totalClosed)} />
          <StatTile label="Accuracy" value={perf.accuracyPct !== null ? `${perf.accuracyPct}%` : "—"} />
          <StatTile label="Net Points" value={`${perf.netPoints >= 0 ? "+" : ""}${perf.netPoints}`} color={perf.netPoints >= 0 ? "#0D9488" : "#DC2626"} />
        </div>
        <p className="text-[10px] text-[var(--color-muted)] mt-2">Tracked separately from every other page's own trade log, starting from zero the day this page shipped.</p>
      </section>

      {allCalls.length > 0 && (
        <section className="card p-4">
          <p className="text-xs font-bold mb-1">Call History</p>
          <p className="text-[10px] text-[var(--color-muted)] mb-3">
            Every Level Cross call ever made, newest first -- exact time and price it was called, and once closed, exact time and price of whichever target/breakeven/stop rule actually closed it.
          </p>
          <div className="space-y-2">
            {allCalls.map(({ symbol, entry }) => (
              <CallHistoryRow key={entry.id} symbol={symbol} entry={entry} onOpen={() => setDetail({ symbol, entry })} />
            ))}
          </div>
        </section>
      )}

      <section className="card p-4 overflow-x-auto">
        <p className="text-xs font-bold uppercase text-[var(--color-muted)] mb-1 flex items-center gap-1.5">
          <Target size={13} className="text-purple-500" /> Day-wise Trade Log
        </p>
        <p className="text-[10px] text-[var(--color-muted)] mb-3">One MCX session = 9:00am – 11:55pm IST.</p>
        {dayStats.length === 0 ? (
          <p className="text-xs text-[var(--color-muted)] text-center py-3">No trades have closed yet -- this fills in as calls run their course.</p>
        ) : (
          <table className="w-full text-[11px] min-w-[420px]">
            <thead>
              <tr className="text-[var(--color-muted)] text-left">
                <th className="font-semibold pb-2">Date</th>
                <th className="font-semibold pb-2">Target Hit</th>
                <th className="font-semibold pb-2">Breakeven</th>
                <th className="font-semibold pb-2">SL Hit</th>
                <th className="font-semibold pb-2">Total</th>
              </tr>
            </thead>
            <tbody>
              {dayStats.map((d) => (
                <tr key={d.dateKey} className="border-t border-[var(--color-border)]">
                  <td className="py-2 font-semibold">{d.label}</td>
                  <td className="py-2 font-bold text-emerald-600">{d.targetHit}</td>
                  <td className="py-2 font-bold text-lime-600">{d.breakeven}</td>
                  <td className="py-2 font-bold text-rose-500">{d.slHit}</td>
                  <td className="py-2 text-[var(--color-muted)]">{d.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <p className="text-[10px] text-[var(--color-muted)] leading-relaxed text-center px-4 pb-2 flex items-start justify-center gap-1.5">
        <Info size={12} className="shrink-0 mt-0.5" />
        Educational reference only, not financial advice. Levels and touch counts are computed deterministically from real candle history -- always confirm on the live chart before acting.
      </p>

      {detail && <CallDetailModal symbol={detail.symbol} entry={detail.entry} onClose={() => setDetail(null)} />}
    </div>
  );
}

function StatTile({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-xl px-2.5 py-2 bg-slate-50">
      <p className="text-[9px] text-slate-400">{label}</p>
      <p className="text-xs font-bold" style={{ color: color ?? "inherit" }}>
        {value}
      </p>
    </div>
  );
}

