import { useMemo, useState } from "react";
import { Activity, AlertTriangle, Layers, Sparkles, TrendingDown, TrendingUp, Zap } from "lucide-react";
import { useAppStore } from "../store/appStore";
import { useMarketStatus } from "../api/hooks";
import { useSuperTrendPro } from "../hooks/useSuperTrendPro";
import { CircularGauge } from "../components/CircularGauge";
import { TradeChart } from "../components/TradeChart";
import { TradingViewWidget } from "../components/TradingViewWidget";
import type { TradableSymbol } from "../hooks/useBestCall";
import { TIMEFRAME_OPTIONS, effectiveStopForSetup, type MarketStatusLabel, type RiskLevel, type VolatilityLevel } from "../utils/superTrendProEngine";
import { flattenClosedSuperTrend, computeSuperTrendPerformance, exitPriceForSuperTrend } from "../utils/superTrendProStats";

const SYMBOLS: TradableSymbol[] = ["CRUDEOIL", "NATURALGAS"];
const DISPLAY_NAME: Record<TradableSymbol, string> = { CRUDEOIL: "Crude Oil", NATURALGAS: "Natural Gas" };
const TV_SYMBOL: Record<TradableSymbol, string> = { CRUDEOIL: "MCX:CRUDEOIL1!", NATURALGAS: "MCX:NATURALGAS1!" };
const TV_INTERVAL: Record<string, string> = { "1D": "D" };

const STATUS_COLOR: Record<MarketStatusLabel, string> = {
  "Strong Buy": "#00E676",
  Buy: "#00E676",
  Bullish: "#7BE0A8",
  Wait: "#FFC107",
  Range: "#9AA4B2",
  Neutral: "#9AA4B2",
  "Weak Sell": "#FF9A8B",
  Sell: "#FF4D4F",
  "Strong Sell": "#FF4D4F",
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
  const { snapshot, candles, candlesLoading, candlesError, log } = useSuperTrendPro(symbol, timeframe);

  const superTrendLogs = useAppStore((s) => s.superTrendLogs);
  const symbolLogs = useMemo(() => {
    const out: Record<string, typeof log> = {};
    for (const [k, v] of Object.entries(superTrendLogs)) if (k.startsWith(`${symbol}-`)) out[k] = v;
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
      { price: openEntry.entry, color: "#00C2FF", title: "Entry" },
      { price: openEntry.stop, color: "#FF4D4F", title: "SL" },
      ...openEntry.targets.map((t, i) => ({ price: t, color: "#00E676", title: `T${i + 1}` })),
    ];
  }, [openEntry]);

  return (
    <div className="-mx-4 -mt-4 px-4 pt-4 pb-24 min-h-screen text-white space-y-4" style={{ background: "linear-gradient(180deg,#09090F,#0D0E16 40%,#09090F)" }}>
      <GlassCard glow="#7C4DFF">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xl font-black flex items-center gap-2">
              <Zap size={20} style={{ color: "#7C4DFF" }} />
              AI SuperTrend Pro
            </p>
            <p className="text-xs text-[#9AA4B2] mt-0.5">Institutional-style multi-indicator analysis for MCX Natural Gas &amp; Crude Oil</p>
          </div>
          <Badge dot color={market?.isOpen ? "#00E676" : "#FF4D4F"} label={market ? (market.isOpen ? "Market Open" : "Market Closed") : "…"} />
        </div>
      </GlassCard>

      <div className="flex gap-2">
        {SYMBOLS.map((s) => (
          <button
            key={s}
            onClick={() => setSymbol(s)}
            className="flex-1 rounded-xl py-2.5 text-sm font-bold transition-colors"
            style={symbol === s ? { background: "linear-gradient(135deg,#7C4DFF,#00C2FF)", color: "#fff" } : { background: "#181A24", border: "1px solid rgba(255,255,255,.08)", color: "#9AA4B2" }}
          >
            {DISPLAY_NAME[s]}
          </button>
        ))}
      </div>

      <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-1">
        {TIMEFRAME_OPTIONS.map((tf) => (
          <button
            key={tf.value}
            onClick={() => setTimeframe(tf.value)}
            className="shrink-0 rounded-lg px-3 py-1.5 text-[11px] font-bold border"
            style={timeframe === tf.value ? { background: "#181A24", borderColor: "#00C2FF66", color: "#00C2FF" } : { background: "#12131C", borderColor: "rgba(255,255,255,.08)", color: "#9AA4B2" }}
          >
            {tf.label}
          </button>
        ))}
      </div>

      {candlesError && (
        <GlassCard>
          <div className="flex items-start gap-2">
            <AlertTriangle size={16} className="shrink-0 mt-0.5" style={{ color: "#FFC107" }} />
            <p className="text-sm text-[#9AA4B2]">{candlesError}. This is a normal gap right after market open or on a very new timeframe -- check back shortly.</p>
          </div>
        </GlassCard>
      )}

      {!candlesError && !snapshot && (
        <GlassCard>
          <p className="text-sm text-[#9AA4B2] text-center py-4">{candlesLoading ? "Loading market data…" : `Not enough bars yet on this timeframe (have ${candles.length}, need 60+).`}</p>
        </GlassCard>
      )}

      {snapshot && (
        <>
          <GlassCard glow={STATUS_COLOR[snapshot.marketStatus]}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-black" style={{ color: STATUS_COLOR[snapshot.marketStatus] }}>
                  {snapshot.marketStatus.toUpperCase()}
                </p>
                <p className="text-xs text-[#9AA4B2] mt-0.5">
                  Trend strength (ADX) {fmt(snapshot.trendStrength, 1)} · As of {snapshot.asOf} IST
                </p>
              </div>
              {snapshot.trend === "bullish" ? <TrendingUp size={28} style={{ color: STATUS_COLOR[snapshot.marketStatus] }} /> : snapshot.trend === "bearish" ? <TrendingDown size={28} style={{ color: STATUS_COLOR[snapshot.marketStatus] }} /> : <Activity size={28} style={{ color: "#9AA4B2" }} />}
            </div>
            <p className="text-lg font-bold mt-2">₹{snapshot.lastPrice.toFixed(2)}</p>
          </GlassCard>

          <GlassCard title="AI Confidence Engine">
            <div className="grid grid-cols-3 gap-2 mb-3">
              <ProbBar label="BUY" pct={snapshot.confidence.buyPct} color="#00E676" />
              <ProbBar label="WAIT" pct={snapshot.confidence.waitPct} color="#FFC107" />
              <ProbBar label="SELL" pct={snapshot.confidence.sellPct} color="#FF4D4F" />
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-[#9AA4B2]">Trade Quality (factor agreement)</span>
              <span className="font-bold">{snapshot.confidence.tradeQuality}%</span>
            </div>
            <details className="mt-2">
              <summary className="text-[11px] text-[#9AA4B2] cursor-pointer">Weighted breakdown ({snapshot.confidence.votes.length} factors)</summary>
              <div className="mt-2 space-y-1.5">
                {snapshot.confidence.votes.map((v) => (
                  <div key={v.label} className="flex items-center justify-between text-[11px]">
                    <span className="flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: v.vote > 0 ? "#00E676" : v.vote < 0 ? "#FF4D4F" : "#9AA4B2" }} />
                      {v.label} <span className="text-[#9AA4B2]">({v.weight}%)</span>
                    </span>
                    <span className="text-[#9AA4B2] text-right ml-2">{v.note}</span>
                  </div>
                ))}
              </div>
            </details>
          </GlassCard>

          {snapshot.tradeSetup && (openEntry || snapshot.marketStatus === "Strong Buy" || snapshot.marketStatus === "Strong Sell") && (
            <GlassCard title={openEntry ? "Trade Setup -- Tracked" : "Trade Setup -- Live Projection"} glow={snapshot.tradeSetup.direction === "bullish" ? "#00E676" : "#FF4D4F"}>
              <TradeSetupBody snapshot={snapshot} openEntry={openEntry} />
            </GlassCard>
          )}

          <GlassCard title="AI Explanation Panel">
            <p className="text-sm font-bold mb-2">
              Why {snapshot.marketStatus}: Risk {snapshot.riskLevel}, Trade Quality {snapshot.confidence.tradeQuality}%
            </p>
            {snapshot.supportingReasons.length > 0 && (
              <div className="mb-2">
                <p className="text-[10px] font-bold uppercase text-[#00E676] mb-1">Supporting</p>
                {snapshot.supportingReasons.map((r, i) => (
                  <p key={i} className="text-[11px] text-[#9AA4B2] flex items-start gap-1.5">
                    <span style={{ color: "#00E676" }}>+</span> {r}
                  </p>
                ))}
              </div>
            )}
            {snapshot.opposingReasons.length > 0 && (
              <div>
                <p className="text-[10px] font-bold uppercase text-[#FF4D4F] mb-1">Opposing</p>
                {snapshot.opposingReasons.map((r, i) => (
                  <p key={i} className="text-[11px] text-[#9AA4B2] flex items-start gap-1.5">
                    <span style={{ color: "#FF4D4F" }}>−</span> {r}
                  </p>
                ))}
              </div>
            )}
          </GlassCard>

          <GlassCard title="Professional Dashboard">
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Trend" value={snapshot.trend} color={snapshot.trend === "bullish" ? "#00E676" : snapshot.trend === "bearish" ? "#FF4D4F" : "#9AA4B2"} />
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
              <Stat label="Higher Timeframe Trend" value={snapshot.higherTfTrend ?? "—"} color={snapshot.higherTfTrend === "bullish" ? "#00E676" : snapshot.higherTfTrend === "bearish" ? "#FF4D4F" : undefined} />
              <Stat label="Market Structure" value={snapshot.structure.label ?? "—"} />
              <Stat label="Volatility" value={snapshot.volatilityLevel} />
              <Stat label="Confidence Score" value={`${Math.max(snapshot.confidence.buyPct, snapshot.confidence.sellPct)}%`} />
              <Stat label="Signal Quality" value={`${snapshot.confidence.tradeQuality}%`} />
            </div>
          </GlassCard>

          <GlassCard title="Chart">
            <TradingViewWidget key={`${symbol}-tv`} symbol={TV_SYMBOL[symbol]} interval={TV_INTERVAL[timeframe] ?? timeframe} height={240} />
            <p className="text-[10px] text-[#9AA4B2] mt-3 mb-1.5">Annotated (entry/SL/targets from the tracked trade, if one is open):</p>
            <TradeChart candles={candles} priceLines={priceLines} height={220} />
          </GlassCard>

          <GlassCard title="Risk &amp; Volatility">
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col items-center">
                <CircularGauge value={RISK_SCORE[snapshot.riskLevel]} size={92} label="Risk" sublabel={snapshot.riskLevel} />
              </div>
              <div className="flex flex-col items-center">
                <CircularGauge value={VOL_SCORE[snapshot.volatilityLevel]} size={92} label="Volatility" sublabel={snapshot.volatilityLevel} />
              </div>
            </div>
          </GlassCard>

          <GlassCard title="Smart Suggestions">
            <div className="space-y-1.5">
              {snapshot.smartSuggestions.map((s, i) => (
                <p key={i} className="text-xs text-[#9AA4B2] flex items-start gap-1.5">
                  <Sparkles size={12} className="shrink-0 mt-0.5" style={{ color: "#7C4DFF" }} />
                  {s}
                </p>
              ))}
            </div>
          </GlassCard>
        </>
      )}

      <GlassCard title="Performance Analytics">
        <div className="grid grid-cols-3 gap-2">
          <Stat label="Today's Trades" value={String(perf.todayTotal)} />
          <Stat label="Winning" value={String(perf.todayWins)} color="#00E676" />
          <Stat label="Losing" value={String(perf.todayLosses)} color="#FF4D4F" />
          <Stat label="Accuracy" value={perf.winRatePct !== null ? `${perf.winRatePct}%` : "—"} />
          <Stat label="Avg RR" value={perf.avgRR !== null ? `1:${perf.avgRR}` : "—"} />
          <Stat label="Avg Confidence" value={perf.avgConfidence !== null ? `${perf.avgConfidence}%` : "—"} />
          <Stat label="Profit Factor" value={perf.profitFactor !== null ? String(perf.profitFactor) : "—"} />
          <Stat label="Target Hit %" value={perf.targetHitPct !== null ? `${perf.targetHitPct}%` : "—"} />
          <Stat label="Stop Loss %" value={perf.stopLossPct !== null ? `${perf.stopLossPct}%` : "—"} />
        </div>
        <p className="text-[10px] text-[#9AA4B2] mt-3">
          Only Strong Buy/Strong Sell signals (lower + higher timeframe agreeing) are tracked as real trades -- Buy/Bullish/Sell/Weak
          Sell/Wait/Range stay live on the dashboard but never count toward these numbers. Tracked only in this browser for now.
        </p>
      </GlassCard>

      {allEntries.length > 0 && (
        <GlassCard title="Trade History">
          <div className="space-y-2">
            {allEntries.slice(0, 15).map((e) => {
              const exit = e.closed ? exitPriceForSuperTrend(e) : null;
              const pnl = exit !== null ? Number(((e.direction === "bullish" ? 1 : -1) * (exit - e.entry)).toFixed(3)) : null;
              const statusColor = !e.closed ? "#FFC107" : pnl !== null && pnl > 0 ? "#00E676" : pnl !== null && pnl < 0 ? "#FF4D4F" : "#9AA4B2";
              return (
                <div key={e.id} className="rounded-xl p-3" style={{ background: "#12131C", border: "1px solid rgba(255,255,255,.06)" }}>
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-bold">
                      {DISPLAY_NAME[e.symbol as TradableSymbol] ?? e.symbol} · {e.timeframe === "1D" ? "Daily" : `${e.timeframe}m`} · {e.direction === "bullish" ? "BUY" : "SELL"}
                    </p>
                    <p className="text-xs font-bold" style={{ color: statusColor }}>
                      {e.closed ? e.status.replace(/_/g, " ") : "Running"}
                    </p>
                  </div>
                  <p className="text-[10px] text-[#9AA4B2] mt-1">
                    {fmtWhen(e.openedAt)} at ₹{e.entry.toFixed(2)} · Confidence {e.confidence}%{e.closed && exit !== null && <> · Closed at ₹{exit.toFixed(2)} ({pnl! >= 0 ? "+" : ""}{pnl})</>}
                  </p>
                  <div className="flex flex-wrap gap-x-2 gap-y-0.5 mt-1.5 text-[10px] text-[#9AA4B2]">
                    {e.targets.map((t, i) => (
                      <span key={i} className={e.targetsHit[i] ? "font-bold" : ""} style={{ color: e.targetsHit[i] ? "#00E676" : undefined }}>
                        T{i + 1} ₹{t.toFixed(2)}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </GlassCard>
      )}

      <p className="text-[10px] text-[#9AA4B2] leading-relaxed text-center px-4 pb-2">
        Signals are generated using multiple technical indicators and rule-based AI scoring. They are designed to assist
        decision-making and do not guarantee profits. Always use proper risk management.
      </p>
    </div>
  );
}

function TradeSetupBody({ snapshot, openEntry }: { snapshot: NonNullable<ReturnType<typeof useSuperTrendPro>["snapshot"]>; openEntry: ReturnType<typeof useSuperTrendPro>["log"][number] | null }) {
  const setup = snapshot.tradeSetup!;
  const entry = openEntry?.entry ?? setup.entry;
  const stop = openEntry?.stop ?? setup.stopLoss;
  const targets = openEntry?.targets ?? setup.targets;
  const targetsHit = openEntry?.targetsHit ?? setup.targetsHit;
  const trailingStop = openEntry ? effectiveStopForSetup({ entry, targets, stopLoss: stop }, targetsHit) : setup.trailingStop;
  const rr = Math.abs(targets[0] - entry) / Math.abs(entry - stop);

  return (
    <div>
      <div className="grid grid-cols-2 gap-2 mb-3">
        <Stat label="Entry" value={`₹${entry.toFixed(2)}`} />
        <Stat label="Current Price" value={`₹${snapshot.lastPrice.toFixed(2)}`} />
        <Stat label="Stop Loss" value={`₹${stop.toFixed(2)}`} color="#FF4D4F" />
        <Stat label="ATR Stop" value={`₹${setup.atrStop.toFixed(2)}`} />
        <Stat label="Trailing Stop" value={`₹${trailingStop.toFixed(2)}`} color="#FFC107" />
        <Stat label="Risk : Reward" value={`1:${rr.toFixed(2)}`} />
        <Stat label="Expected Profit" value={`+${Math.abs(targets[0] - entry).toFixed(2)}`} color="#00E676" />
        <Stat label="Expected Loss" value={`-${Math.abs(entry - stop).toFixed(2)}`} color="#FF4D4F" />
      </div>
      <div className="flex flex-wrap gap-2">
        {targets.map((t, i) => (
          <span
            key={i}
            className="text-[11px] px-2.5 py-1 rounded-full font-bold"
            style={{ background: targetsHit[i] ? "#00E67622" : "#181A24", color: targetsHit[i] ? "#00E676" : "#9AA4B2", border: "1px solid rgba(255,255,255,.08)" }}
          >
            T{i + 1} ₹{t.toFixed(2)} {targetsHit[i] ? "✓" : ""}
          </span>
        ))}
      </div>
      {!openEntry && (
        <p className="text-[10px] text-[#9AA4B2] mt-2">
          This is a live projection recomputed every poll -- it becomes a tracked trade the moment this reading holds as Strong
          Buy/Strong Sell.
        </p>
      )}
    </div>
  );
}

function GlassCard({ children, title, glow }: { children: React.ReactNode; title?: string; glow?: string }) {
  return (
    <section
      className="rounded-2xl p-4 backdrop-blur-xl"
      style={{ background: "#181A24", border: `1px solid ${glow ? `${glow}44` : "rgba(255,255,255,.08)"}`, boxShadow: glow ? `0 0 24px ${glow}22` : undefined }}
    >
      {title && (
        <p className="text-xs font-bold uppercase text-[#9AA4B2] mb-3 flex items-center gap-1.5">
          <Layers size={12} />
          {title}
        </p>
      )}
      {children}
    </section>
  );
}

function Badge({ dot, color, label }: { dot?: boolean; color?: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-[9px] font-semibold px-2 py-1 rounded-full" style={{ background: "#181A24", border: "1px solid rgba(255,255,255,.08)" }}>
      {dot && <span className="w-1.5 h-1.5 rounded-full" style={{ background: color ?? "#00C2FF" }} />}
      <span style={{ color: color ?? "#9AA4B2" }}>{label}</span>
    </span>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-xl px-2.5 py-2" style={{ background: "#12131C", border: "1px solid rgba(255,255,255,.06)" }}>
      <p className="text-[9px] text-[#9AA4B2] uppercase">{label}</p>
      <p className="text-xs font-bold mt-0.5" style={{ color: color ?? "#fff" }}>
        {value}
      </p>
    </div>
  );
}

function ProbBar({ label, pct, color }: { label: string; pct: number; color: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="w-full h-16 rounded-lg overflow-hidden flex flex-col justify-end" style={{ background: "#12131C" }}>
        <div style={{ height: `${pct}%`, background: color }} />
      </div>
      <p className="text-[10px] font-bold" style={{ color }}>
        {label} {pct}%
      </p>
    </div>
  );
}
