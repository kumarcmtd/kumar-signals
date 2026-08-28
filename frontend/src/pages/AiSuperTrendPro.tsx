import { useMemo, useState } from "react";
import { Activity, AlertTriangle, Layers, Sparkles, TrendingDown, TrendingUp, Wallet, Zap } from "lucide-react";
import { useAppStore } from "../store/appStore";
import { useMarketStatus, useOptionsAnalytics } from "../api/hooks";
import { useSuperTrendPro } from "../hooks/useSuperTrendPro";
import { projectPremiumFromUnderlying } from "../utils/optionProjection";
import type { OptionsAnalytics } from "../types";
import { CircularGauge } from "../components/CircularGauge";
import { TradeChart } from "../components/TradeChart";
import { TradingViewWidget } from "../components/TradingViewWidget";
import type { TradableSymbol } from "../hooks/useBestCall";
import { TIMEFRAME_OPTIONS, effectiveStopForSetup, type MarketStatusLabel, type RiskLevel, type VolatilityLevel } from "../utils/superTrendProEngine";
import { flattenClosedSuperTrend, computeSuperTrendPerformance, exitPriceForSuperTrend } from "../utils/superTrendProStats";
import { evaluateEntryTiming } from "../utils/entryTiming";
import { EntryTimingBadge } from "../components/EntryTimingBadge";

const SYMBOLS: TradableSymbol[] = ["CRUDEOIL", "NATURALGAS"];
const DISPLAY_NAME: Record<TradableSymbol, string> = { CRUDEOIL: "Crude Oil", NATURALGAS: "Natural Gas" };
const TV_SYMBOL: Record<TradableSymbol, string> = { CRUDEOIL: "MCX:CRUDEOIL1!", NATURALGAS: "MCX:NATURALGAS1!" };
const TV_INTERVAL: Record<string, string> = { "1D": "D" };
// Same MCX contract lot sizes used everywhere else in this app that quotes a
// per-lot investment (Best Call's option premium calculator) -- futures and
// options on the same underlying share one exchange-standardized lot size.
const LOT_SIZE: Record<TradableSymbol, number> = { CRUDEOIL: 100, NATURALGAS: 1250 };
const ALLOWED_TFS = new Set(TIMEFRAME_OPTIONS.map((tf) => tf.value));
const INR = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
const PRESET_AMOUNTS = [50000, 100000, 200000, 500000];

const STATUS_COLOR: Record<MarketStatusLabel, string> = {
  "Strong Buy": "#16A34A",
  Buy: "#16A34A",
  Bullish: "#4ADE80",
  Wait: "#D97706",
  Range: "#64748B",
  Neutral: "#64748B",
  "Weak Sell": "#FB923C",
  Sell: "#DC2626",
  "Strong Sell": "#DC2626",
};

const RISK_SCORE: Record<RiskLevel, number> = { "Very Low": 12, Low: 30, Medium: 55, High: 78, "Very High": 95 };
const VOL_SCORE: Record<VolatilityLevel, number> = { Low: 20, Medium: 45, High: 72, Extreme: 95 };

function fmt(n: number | null, digits = 2): string {
  return n === null || Number.isNaN(n) ? "—" : n.toFixed(digits);
}

function fmtWhen(ms: number): string {
  return new Date(ms).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function AiSuperTrendPro() {
  const [symbol, setSymbol] = useState<TradableSymbol>("NATURALGAS");
  const [timeframe, setTimeframe] = useState("15");
  const { data: market } = useMarketStatus();
  const { data: options } = useOptionsAnalytics(symbol);
  const { snapshot, candles, candlesLoading, candlesError, log } = useSuperTrendPro(symbol, timeframe);

  const superTrendLogs = useAppStore((s) => s.superTrendLogs);
  const symbolLogs = useMemo(() => {
    const out: Record<string, typeof log> = {};
    for (const [k, v] of Object.entries(superTrendLogs)) {
      if (!k.startsWith(`${symbol}-`)) continue;
      const tf = k.slice(symbol.length + 1);
      if (ALLOWED_TFS.has(tf)) out[k] = v;
    }
    return out;
  }, [superTrendLogs, symbol]);
  const realized = useMemo(() => flattenClosedSuperTrend(symbolLogs), [symbolLogs]);
  const perf = useMemo(() => computeSuperTrendPerformance(realized), [realized]);
  const allEntries = useMemo(
    () => Object.values(symbolLogs).flat().sort((a, b) => b.openedAt - a.openedAt),
    [symbolLogs]
  );
  const openEntry = log.length && !log[log.length - 1].closed ? log[log.length - 1] : null;

  const priceLines = useMemo(() => {
    if (!openEntry) return [];
    return [
      { price: openEntry.entry, color: "#2563EB", title: "Entry" },
      { price: openEntry.stop, color: "#DC2626", title: "SL" },
      ...openEntry.targets.map((t, i) => ({ price: t, color: "#16A34A", title: `T${i + 1}` })),
    ];
  }, [openEntry]);

  return (
    <div className="space-y-4">
      <div
        className="rounded-2xl p-4 text-white"
        style={{ background: "linear-gradient(135deg,#7C3AED,#2563EB 55%,#0EA5E9)", boxShadow: "0 8px 24px rgba(37,99,235,.25)" }}
      >
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xl font-black flex items-center gap-2">
              <Zap size={20} />
              AI SuperTrend Pro
            </p>
            <p className="text-xs text-white/80 mt-0.5">Institutional-style multi-indicator analysis for MCX Natural Gas &amp; Crude Oil</p>
          </div>
          <span className="flex items-center gap-1.5 text-[9px] font-bold px-2 py-1 rounded-full bg-white/15 shrink-0">
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: market?.isOpen ? "#4ADE80" : "#FCA5A5" }} />
            {market ? (market.isOpen ? "Market Open" : "Market Closed") : "…"}
          </span>
        </div>
      </div>

      <div className="flex gap-2">
        {SYMBOLS.map((s) => (
          <button
            key={s}
            onClick={() => setSymbol(s)}
            className="flex-1 rounded-xl py-2.5 text-sm font-bold transition-colors border"
            style={
              symbol === s
                ? { background: "linear-gradient(135deg,#7C3AED,#2563EB)", color: "#fff", borderColor: "transparent" }
                : { background: "var(--color-surface)", borderColor: "var(--color-border)", color: "var(--color-muted)" }
            }
          >
            {DISPLAY_NAME[s]}
          </button>
        ))}
      </div>

      <div className="flex gap-1.5">
        {TIMEFRAME_OPTIONS.map((tf) => (
          <button
            key={tf.value}
            onClick={() => setTimeframe(tf.value)}
            className="flex-1 rounded-lg px-2 py-1.5 text-[11px] font-bold border"
            style={
              timeframe === tf.value
                ? { background: "#EFF6FF", borderColor: "#2563EB", color: "#2563EB" }
                : { background: "var(--color-surface)", borderColor: "var(--color-border)", color: "var(--color-muted)" }
            }
          >
            {tf.label}
          </button>
        ))}
      </div>

      {candlesError && (
        <div className="card p-4">
          <div className="flex items-start gap-2">
            <AlertTriangle size={16} className="shrink-0 mt-0.5" style={{ color: "#D97706" }} />
            <p className="text-sm text-[var(--color-muted)]">{candlesError}. This is a normal gap right after market open or on a very new timeframe -- check back shortly.</p>
          </div>
        </div>
      )}

      {!candlesError && !snapshot && (
        <div className="card p-4">
          <p className="text-sm text-[var(--color-muted)] text-center py-4">{candlesLoading ? "Loading market data…" : `Not enough bars yet on this timeframe (have ${candles.length}, need 60+).`}</p>
        </div>
      )}

      {snapshot && (
        <>
          <div className="card p-4" style={{ border: `1px solid ${STATUS_COLOR[snapshot.marketStatus]}55` }}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-black" style={{ color: STATUS_COLOR[snapshot.marketStatus] }}>
                  {snapshot.marketStatus.toUpperCase()}
                </p>
                <p className="text-xs text-[var(--color-muted)] mt-0.5">
                  Trend strength (ADX) {fmt(snapshot.trendStrength, 1)} · As of {snapshot.asOf} IST
                </p>
              </div>
              {snapshot.trend === "bullish" ? <TrendingUp size={28} style={{ color: STATUS_COLOR[snapshot.marketStatus] }} /> : snapshot.trend === "bearish" ? <TrendingDown size={28} style={{ color: STATUS_COLOR[snapshot.marketStatus] }} /> : <Activity size={28} style={{ color: "var(--color-muted)" }} />}
            </div>
            <p className="text-lg font-bold mt-2">₹{snapshot.lastPrice.toFixed(2)}</p>
          </div>

          <SectionCard title="AI Confidence Engine">
            <div className="grid grid-cols-3 gap-2 mb-3">
              <ProbBar label="BUY" pct={snapshot.confidence.buyPct} color="#16A34A" />
              <ProbBar label="WAIT" pct={snapshot.confidence.waitPct} color="#D97706" />
              <ProbBar label="SELL" pct={snapshot.confidence.sellPct} color="#DC2626" />
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-[var(--color-muted)]">Trade Quality (factor agreement)</span>
              <span className="font-bold">{snapshot.confidence.tradeQuality}%</span>
            </div>
            <details className="mt-2">
              <summary className="text-[11px] text-[var(--color-muted)] cursor-pointer">Weighted breakdown ({snapshot.confidence.votes.length} factors)</summary>
              <div className="mt-2 space-y-1.5">
                {snapshot.confidence.votes.map((v) => (
                  <div key={v.label} className="flex items-center justify-between text-[11px]">
                    <span className="flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: v.vote > 0 ? "#16A34A" : v.vote < 0 ? "#DC2626" : "var(--color-muted)" }} />
                      {v.label} <span className="text-[var(--color-muted)]">({v.weight}%)</span>
                    </span>
                    <span className="text-[var(--color-muted)] text-right ml-2">{v.note}</span>
                  </div>
                ))}
              </div>
            </details>
          </SectionCard>

          {snapshot.tradeSetup && (
            <div className="card overflow-hidden" style={{ border: `2px solid ${snapshot.tradeSetup.direction === "bullish" ? "#16A34A" : "#DC2626"}` }}>
              <div className="p-4">
                <p className="text-xs font-bold uppercase text-[var(--color-muted)] mb-3 flex items-center gap-1.5">
                  <Layers size={12} />
                  {openEntry ? "Trade Setup -- Tracked" : "Trade Setup -- Live Projection"}
                </p>
                <TradeSetupBody snapshot={snapshot} openEntry={openEntry} symbol={symbol} options={options} />
              </div>
            </div>
          )}

          <SectionCard title="AI Explanation Panel">
            <p className="text-sm font-bold mb-2">
              Why {snapshot.marketStatus}: Risk {snapshot.riskLevel}, Trade Quality {snapshot.confidence.tradeQuality}%
            </p>
            {snapshot.supportingReasons.length > 0 && (
              <div className="mb-2">
                <p className="text-[10px] font-bold uppercase text-[#16A34A] mb-1">Supporting</p>
                {snapshot.supportingReasons.map((r, i) => (
                  <p key={i} className="text-[11px] text-[var(--color-muted)] flex items-start gap-1.5">
                    <span style={{ color: "#16A34A" }}>+</span> {r}
                  </p>
                ))}
              </div>
            )}
            {snapshot.opposingReasons.length > 0 && (
              <div>
                <p className="text-[10px] font-bold uppercase text-[#DC2626] mb-1">Opposing</p>
                {snapshot.opposingReasons.map((r, i) => (
                  <p key={i} className="text-[11px] text-[var(--color-muted)] flex items-start gap-1.5">
                    <span style={{ color: "#DC2626" }}>−</span> {r}
                  </p>
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard title="Professional Dashboard">
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Trend" value={snapshot.trend} color={snapshot.trend === "bullish" ? "#16A34A" : snapshot.trend === "bearish" ? "#DC2626" : "var(--color-muted)"} />
              <Stat label="SuperTrend" value={snapshot.superTrend ? `${snapshot.superTrend.direction} ₹${snapshot.superTrend.value.toFixed(2)}` : "—"} />
              <Stat label="EMA Status" value={snapshot.emaStack.stacked === "neutral" ? "Mixed" : snapshot.emaStack.stacked} />
              <Stat label="VWAP" value={snapshot.vwap !== null ? `₹${snapshot.vwap.toFixed(2)}` : "—"} />
              <Stat label="RSI (14)" value={fmt(snapshot.rsi14, 1)} />
              <Stat label="MACD Hist" value={snapshot.macd ? snapshot.macd.histogram.toFixed(3) : "—"} />
              <Stat label="ADX" value={snapshot.dmi ? fmt(snapshot.dmi.adx, 1) : "—"} />
              <Stat label="+DI / -DI" value={snapshot.dmi ? `${fmt(snapshot.dmi.plusDI, 1)} / ${fmt(snapshot.dmi.minusDI, 1)}` : "—"} />
              <Stat label="ATR (14)" value={snapshot.atr14 !== null ? snapshot.atr14.toFixed(3) : "—"} />
              <Stat label="Volume" value={snapshot.volumeSma !== null ? Math.round(snapshot.volumeSma).toString() : "—"} />
              <Stat label="Relative Volume" value={snapshot.volumeRatio !== null ? `${snapshot.volumeRatio}x` : "—"} />
              <Stat label="Momentum" value={snapshot.momentum !== null ? snapshot.momentum.toFixed(3) : "—"} />
              <Stat label="ROC" value={snapshot.roc !== null ? `${snapshot.roc}%` : "—"} />
              <Stat label="CPR" value={snapshot.pivots ? `₹${snapshot.pivots.pivot.toFixed(2)}` : "—"} />
              <Stat label="Pivot (Classic)" value={snapshot.pivots ? `R1 ${snapshot.pivots.r1.toFixed(2)} / S1 ${snapshot.pivots.s1.toFixed(2)}` : "—"} />
              <Stat label="Support" value={snapshot.sr.support !== null ? `₹${snapshot.sr.support.toFixed(2)}` : "—"} />
              <Stat label="Resistance" value={snapshot.sr.resistance !== null ? `₹${snapshot.sr.resistance.toFixed(2)}` : "—"} />
              <Stat label="Fibonacci 50%" value={snapshot.fibonacci ? `₹${snapshot.fibonacci.levels["50"].toFixed(2)}` : "—"} />
              <Stat label="Higher Timeframe Trend" value={snapshot.higherTfTrend ?? "—"} color={snapshot.higherTfTrend === "bullish" ? "#16A34A" : snapshot.higherTfTrend === "bearish" ? "#DC2626" : undefined} />
              <Stat label="Market Structure" value={snapshot.structure.label ?? "—"} />
              <Stat label="Volatility" value={snapshot.volatilityLevel} />
              <Stat label="Confidence Score" value={`${Math.max(snapshot.confidence.buyPct, snapshot.confidence.sellPct)}%`} />
              <Stat label="Signal Quality" value={`${snapshot.confidence.tradeQuality}%`} />
            </div>
          </SectionCard>

          <SectionCard title="Chart">
            <TradingViewWidget key={`${symbol}-tv`} symbol={TV_SYMBOL[symbol]} interval={TV_INTERVAL[timeframe] ?? timeframe} height={240} theme="light" />
            <p className="text-[10px] text-[var(--color-muted)] mt-3 mb-1.5">Annotated (entry/SL/targets from the tracked trade, if one is open):</p>
            <TradeChart candles={candles} priceLines={priceLines} height={220} theme="light" />
          </SectionCard>

          <SectionCard title="Risk &amp; Volatility">
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col items-center">
                <CircularGauge value={RISK_SCORE[snapshot.riskLevel]} size={92} label="Risk" sublabel={snapshot.riskLevel} trackColor="var(--color-border)" labelColor="var(--color-muted)" />
              </div>
              <div className="flex flex-col items-center">
                <CircularGauge value={VOL_SCORE[snapshot.volatilityLevel]} size={92} label="Volatility" sublabel={snapshot.volatilityLevel} trackColor="var(--color-border)" labelColor="var(--color-muted)" />
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Smart Suggestions">
            <div className="space-y-1.5">
              {snapshot.smartSuggestions.map((s, i) => (
                <p key={i} className="text-xs text-[var(--color-muted)] flex items-start gap-1.5">
                  <Sparkles size={12} className="shrink-0 mt-0.5" style={{ color: "#7C3AED" }} />
                  {s}
                </p>
              ))}
            </div>
          </SectionCard>
        </>
      )}

      <SectionCard title="Performance Analytics">
        <div className="grid grid-cols-3 gap-2">
          <Stat label="Today's Trades" value={String(perf.todayTotal)} />
          <Stat label="Winning" value={String(perf.todayWins)} color="#16A34A" />
          <Stat label="Losing" value={String(perf.todayLosses)} color="#DC2626" />
          <Stat label="Accuracy" value={perf.winRatePct !== null ? `${perf.winRatePct}%` : "—"} />
          <Stat label="Avg RR" value={perf.avgRR !== null ? `1:${perf.avgRR}` : "—"} />
          <Stat label="Avg Confidence" value={perf.avgConfidence !== null ? `${perf.avgConfidence}%` : "—"} />
          <Stat label="Profit Factor" value={perf.profitFactor !== null ? String(perf.profitFactor) : "—"} />
          <Stat label="Target Hit %" value={perf.targetHitPct !== null ? `${perf.targetHitPct}%` : "—"} />
          <Stat label="Stop Loss %" value={perf.stopLossPct !== null ? `${perf.stopLossPct}%` : "—"} />
        </div>
        <p className="text-[10px] text-[var(--color-muted)] mt-3">
          Only Strong Buy/Strong Sell signals (lower + higher timeframe agreeing) are tracked as real trades -- Buy/Bullish/Sell/Weak
          Sell/Wait/Range stay live on the dashboard but never count toward these numbers. Tracked only in this browser for now.
        </p>
      </SectionCard>

      {allEntries.length > 0 && (
        <SectionCard title="Trade History">
          <div className="space-y-2">
            {allEntries.slice(0, 15).map((e) => {
              const exit = e.closed ? exitPriceForSuperTrend(e) : null;
              const pnl = exit !== null ? Number(((e.direction === "bullish" ? 1 : -1) * (exit - e.entry)).toFixed(3)) : null;
              const statusColor = !e.closed ? "#D97706" : pnl !== null && pnl > 0 ? "#16A34A" : pnl !== null && pnl < 0 ? "#DC2626" : "var(--color-muted)";
              const effStop = effectiveStopForSetup({ entry: e.entry, targets: e.targets, stopLoss: e.stop }, e.targetsHit);
              return (
                <div
                  key={e.id}
                  className="rounded-xl p-3"
                  style={{ background: "var(--color-surface-soft)", border: "1px solid var(--color-border)", borderLeft: `3px solid ${e.direction === "bullish" ? "#16A34A" : "#DC2626"}` }}
                >
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-bold">
                      {DISPLAY_NAME[e.symbol as TradableSymbol] ?? e.symbol} · {e.timeframe === "1D" ? "Daily" : `${e.timeframe}m`} · {e.direction === "bullish" ? "BUY" : "SELL"}
                    </p>
                    <p className="text-xs font-bold" style={{ color: statusColor }}>
                      {e.closed ? e.status.replace(/_/g, " ") : "Running"}
                    </p>
                  </div>
                  <p className="text-[10px] text-[var(--color-muted)] mt-1">
                    {fmtWhen(e.openedAt)} at ₹{e.entry.toFixed(2)} · Confidence {e.confidence}%{e.closed && exit !== null && <> · Closed at ₹{exit.toFixed(2)} ({pnl! >= 0 ? "+" : ""}{pnl})</>}
                  </p>
                  <div className="flex flex-wrap gap-x-2 gap-y-0.5 mt-1.5 text-[10px] text-[var(--color-muted)]">
                    {e.targets.map((t, i) => (
                      <span key={i} className={e.targetsHit[i] ? "font-bold" : ""} style={{ color: e.targetsHit[i] ? "#16A34A" : undefined }}>
                        T{i + 1} ₹{t.toFixed(2)}
                      </span>
                    ))}
                    <span className="font-semibold" style={{ color: "#DC2626" }}>
                      SL ₹{effStop.toFixed(2)}
                      {Math.abs(effStop - e.stop) > 0.001 && <span className="opacity-70 font-normal"> (was ₹{e.stop.toFixed(2)})</span>}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </SectionCard>
      )}

      <p className="text-[10px] text-[var(--color-muted)] leading-relaxed text-center px-4 pb-2">
        Signals are generated using multiple technical indicators and rule-based AI scoring. They are designed to assist
        decision-making and do not guarantee profits. Always use proper risk management.
      </p>
    </div>
  );
}

function TradeSetupBody({
  snapshot,
  openEntry,
  symbol,
  options,
}: {
  snapshot: NonNullable<ReturnType<typeof useSuperTrendPro>["snapshot"]>;
  openEntry: ReturnType<typeof useSuperTrendPro>["log"][number] | null;
  symbol: TradableSymbol;
  options: OptionsAnalytics | undefined;
}) {
  const setup = snapshot.tradeSetup!;
  const entry = openEntry?.entry ?? setup.entry;
  const stop = openEntry?.stop ?? setup.stopLoss;
  const targets = openEntry?.targets ?? setup.targets;
  const targetsHit = openEntry?.targetsHit ?? setup.targetsHit;
  const trailingStop = openEntry ? effectiveStopForSetup({ entry, targets, stopLoss: stop }, targetsHit) : setup.trailingStop;
  const rr = Math.abs(targets[0] - entry) / Math.abs(entry - stop);

  // TradeSetupBody only ever renders when snapshot.tradeSetup exists, and a
  // tradeSetup is only ever created for a "bullish"/"bearish" tradeDirection
  // (never "neutral") -- see computeSuperTrendPro's `if (tradeDirection...)`
  // gate -- so this narrowing is always safe despite the wider Direction type.
  const direction = (openEntry?.direction ?? setup.direction) as "bullish" | "bearish";
  const dirSign = direction === "bullish" ? 1 : -1;
  const legIdx = targetsHit.findIndex((hit) => !hit);
  const nextTargetIdx = legIdx === -1 ? targets.length - 1 : legIdx;
  const nextTarget = targets[nextTargetIdx];
  const legFloor = nextTargetIdx === 0 ? entry : targets[nextTargetIdx - 1];
  const entryTiming = evaluateEntryTiming(dirSign * legFloor, dirSign * nextTarget, dirSign * trailingStop, dirSign * snapshot.lastPrice);

  // The options translation of this futures setup: a bullish trend is played
  // with the ATM Call, a bearish one with the ATM Put. Uses the same shared,
  // honest premium projection (real per-strike delta + theta haircut) every
  // other options card in the app uses -- never a flat guess.
  const optSide: "CE" | "PE" = direction === "bullish" ? "CE" : "PE";
  const optionProj = projectPremiumFromUnderlying(optSide, entry, stop, [targets[0], targets[1], targets[2]], options);

  return (
    <div>
      <div className="grid grid-cols-2 gap-2 mb-3">
        <Stat label="Entry" value={`₹${entry.toFixed(2)}`} />
        <Stat label="Current Price" value={`₹${snapshot.lastPrice.toFixed(2)}`} />
        <Stat label="Stop Loss" value={`₹${stop.toFixed(2)}`} color="#DC2626" />
        <Stat label="ATR Stop" value={`₹${setup.atrStop.toFixed(2)}`} />
        <Stat label="Trailing Stop" value={`₹${trailingStop.toFixed(2)}`} color="#D97706" />
        <Stat label="Risk : Reward" value={`1:${rr.toFixed(2)}`} />
        <Stat label="Expected Profit" value={`+${Math.abs(targets[0] - entry).toFixed(2)}`} color="#16A34A" />
        <Stat label="Expected Loss" value={`-${Math.abs(entry - stop).toFixed(2)}`} color="#DC2626" />
      </div>
      <div className="flex flex-wrap gap-2">
        {targets.map((t, i) => (
          <span
            key={i}
            className="text-[11px] px-2.5 py-1 rounded-full font-bold"
            style={{ background: targetsHit[i] ? "#DCFCE7" : "var(--color-surface-soft)", color: targetsHit[i] ? "#15803D" : "var(--color-muted)", border: "1px solid var(--color-border)" }}
          >
            T{i + 1} ₹{t.toFixed(2)} {targetsHit[i] ? "✓" : ""}
          </span>
        ))}
      </div>
      <EntryTimingBadge verdict={entryTiming} theme="light" className="mt-2.5" />

      <OptionsTradeCard symbol={symbol} optSide={optSide} proj={optionProj} />

      {openEntry ? (
        <FuturesProfitEstimate
          entry={entry}
          current={openEntry.closed ? exitPriceForSuperTrend(openEntry) : snapshot.lastPrice}
          lotSize={LOT_SIZE[symbol]}
          direction={direction}
          closed={openEntry.closed}
        />
      ) : (
        <p className="text-[10px] text-[var(--color-muted)] mt-2">
          This is a live projection recomputed every poll -- it becomes a tracked trade the moment this reading holds as Strong
          Buy/Strong Sell.
        </p>
      )}
    </div>
  );
}

// The options version of the futures setup above -- ATM Call for a bullish
// trend, ATM Put for a bearish one, with premium entry/SL/targets projected
// the same honest way (real delta + theta) as every other options card.
function OptionsTradeCard({ symbol, optSide, proj }: { symbol: TradableSymbol; optSide: "CE" | "PE"; proj: ReturnType<typeof projectPremiumFromUnderlying> }) {
  const accent = optSide === "CE" ? "#16A34A" : "#DC2626";

  if (!proj) {
    return (
      <div className="mt-3 rounded-xl px-3.5 py-3" style={{ background: "var(--color-surface-soft)", border: "1px dashed var(--color-border)" }}>
        <p className="text-[10px] font-bold uppercase text-[var(--color-muted)] flex items-center gap-1.5">
          <Layers size={12} /> Options Trade (ATM {optSide})
        </p>
        <p className="text-[11px] text-[var(--color-muted)] mt-1.5">
          Live option chain unavailable right now — the futures levels above still stand. The ATM {optSide} entry/target/SL will fill in as soon as the chain is reachable.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-xl overflow-hidden" style={{ border: `1.5px solid ${accent}55` }}>
      <div className="px-3.5 py-2 flex items-center justify-between" style={{ background: `${accent}12` }}>
        <p className="text-[11px] font-black uppercase flex items-center gap-1.5" style={{ color: accent }}>
          <Layers size={12} /> Options Trade — Buy {DISPLAY_NAME[symbol]} {proj.strike} {optSide}
        </p>
        <span className="text-[10px] font-bold" style={{ color: accent }}>{proj.rr !== null ? `R:R 1:${proj.rr}` : ""}</span>
      </div>
      <div className="p-3">
        <div className="grid grid-cols-3 gap-2">
          <Stat label={`Buy ${optSide} @`} value={`₹${proj.entry.toFixed(2)}`} color={accent} />
          <Stat label="Stop Loss" value={`₹${proj.stop.toFixed(2)}`} color="#DC2626" />
          <Stat label="Strike" value={`${proj.strike}`} />
          <Stat label="Target 1" value={`₹${proj.targets[0].toFixed(2)}`} color="#16A34A" />
          <Stat label="Target 2" value={`₹${proj.targets[1].toFixed(2)}`} color="#16A34A" />
          <Stat label="Target 3" value={`₹${proj.targets[2].toFixed(2)}`} color="#16A34A" />
        </div>
        <p className="text-[9px] text-[var(--color-muted)] mt-2">
          ATM {optSide} premium projected from the futures move using the strike's real delta ({proj.delta.toFixed(2)}) and a theta decay haircut — buy at or below the entry, never chase.
        </p>
      </div>
    </div>
  );
}

// Same "what would this be worth" convention Best Call already uses for
// option premium (full notional, not real futures margin -- kept
// consistent with the rest of the app), generalized here for a direction
// that can go either way: a SELL/short profits when price falls, so the
// P&L sign flips on direction rather than always assuming a long.
function FuturesProfitEstimate({
  entry,
  current,
  lotSize,
  direction,
  closed,
}: {
  entry: number;
  current: number;
  lotSize: number;
  direction: "bullish" | "bearish";
  closed: boolean;
}) {
  const [amount, setAmount] = useState(100000);
  const costPerLot = entry * lotSize;
  const lots = Math.floor(amount / costPerLot);
  const dirSign = direction === "bullish" ? 1 : -1;
  const invested = lots * costPerLot;
  const worth = invested + lots * (current - entry) * dirSign * lotSize;
  const inProfit = worth >= invested;
  const pnlPct = invested > 0 ? Number((((worth - invested) / invested) * 100).toFixed(2)) : 0;

  return (
    <div className="mt-3 rounded-xl px-3.5 py-3" style={{ background: "var(--color-surface-soft)", border: "1px solid var(--color-border)" }}>
      <p className="text-[10px] font-bold uppercase text-[var(--color-muted)] mb-2.5 flex items-center gap-1.5">
        <Wallet size={12} />
        {closed ? "What that investment would have made" : "What that investment is worth right now"}
      </p>

      <div className="flex items-center gap-2 mb-2.5">
        <span className="text-xs text-[var(--color-muted)]">₹</span>
        <input
          type="number"
          value={amount}
          onChange={(ev) => setAmount(Math.max(0, Number(ev.target.value) || 0))}
          className="flex-1 min-w-0 rounded-lg px-2.5 py-1.5 text-sm font-bold border"
          style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}
        />
      </div>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {PRESET_AMOUNTS.map((p) => (
          <button
            key={p}
            onClick={() => setAmount(p)}
            className="text-[10px] px-2 py-1 rounded-full font-bold"
            style={amount === p ? { background: "#2563EB", color: "#fff" } : { background: "var(--color-surface)", border: "1px solid var(--color-border)", color: "var(--color-muted)" }}
          >
            ₹{INR(p)}
          </button>
        ))}
      </div>

      {lots < 1 ? (
        <p className="text-xs text-[var(--color-muted)]">
          ₹{INR(amount)} isn't enough for even 1 lot at this entry — 1 lot of this contract needs ₹{INR(costPerLot)} ({lotSize} qty × ₹{entry.toFixed(2)}).
        </p>
      ) : (
        <>
          <p className="text-[11px] text-[var(--color-muted)] mb-2">
            Buys {lots} lot{lots > 1 ? "s" : ""} ({lots * lotSize} qty) for ₹{INR(invested)} at the ₹{entry.toFixed(2)} entry.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg px-2.5 py-2" style={{ background: "var(--color-surface)" }}>
              <p className="text-[9px] text-[var(--color-muted)]">Invested</p>
              <p className="text-xs font-bold">₹{INR(invested)}</p>
            </div>
            <div className="rounded-lg px-2.5 py-2" style={{ background: "var(--color-surface)" }}>
              <p className="text-[9px] text-[var(--color-muted)]">{closed ? "Exit value" : "Worth now"}</p>
              <p className="text-xs font-bold">₹{INR(worth)}</p>
            </div>
          </div>
          <div className="mt-2 rounded-lg px-2.5 py-2 text-center" style={{ background: inProfit ? "#DCFCE7" : "#FEE2E2" }}>
            <p className="text-lg font-black" style={{ color: inProfit ? "#15803D" : "#B91C1C" }}>
              {inProfit ? "+" : ""}
              ₹{INR(worth - invested)}
            </p>
            <p className="text-[10px]" style={{ color: inProfit ? "#15803D" : "#B91C1C" }}>
              {pnlPct >= 0 ? "+" : ""}
              {pnlPct}% {closed ? "on that trade" : "right now"}
            </p>
          </div>
        </>
      )}
    </div>
  );
}

function SectionCard({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <section className="card p-4">
      {title && (
        <p className="text-xs font-bold uppercase text-[var(--color-muted)] mb-3 flex items-center gap-1.5">
          <Layers size={12} />
          {title}
        </p>
      )}
      {children}
    </section>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-xl px-2.5 py-2" style={{ background: "var(--color-surface-soft)", border: "1px solid var(--color-border)" }}>
      <p className="text-[9px] text-[var(--color-muted)] uppercase">{label}</p>
      <p className="text-xs font-bold mt-0.5" style={{ color: color ?? "var(--color-ink)" }}>
        {value}
      </p>
    </div>
  );
}

function ProbBar({ label, pct, color }: { label: string; pct: number; color: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="w-full h-16 rounded-lg overflow-hidden flex flex-col justify-end" style={{ background: "var(--color-surface-soft)", border: "1px solid var(--color-border)" }}>
        <div style={{ height: `${pct}%`, background: color }} />
      </div>
      <p className="text-[10px] font-bold" style={{ color }}>
        {label} {pct}%
      </p>
    </div>
  );
}
