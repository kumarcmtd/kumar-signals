import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Copy, AlertTriangle, ChevronDown, Bot, X, Settings as SettingsIcon } from "lucide-react";
import { useMarketStatus, usePrices, usePortfolio, useCreateTrade, useSignal, useCandles } from "../api/hooks";
import { useAppStore } from "../store/appStore";
import { useTimeframeSuite } from "../hooks/useTimeframeSuite";
import { useTradeLog, liveLtpFor } from "../hooks/useTradeLog";
import { findEliteSignal } from "../utils/eliteSignal";
import { computePortfolioSummary } from "../utils/portfolioStats";
import { summarizeTradeLogsByDay, rankSignalsByWinRate } from "../utils/tradeLogStats";
import { flattenClosedTrades, computePerformanceStats } from "../utils/tradeLogPnl";
import { computeIndicatorSnapshot, cci } from "../utils/indicators";
import { formatTipCard } from "../utils/tipFormat";
import { CircularGauge } from "../components/CircularGauge";
import { TradeChart } from "../components/TradeChart";
import { TradingViewWidget } from "../components/TradingViewWidget";
import { Link } from "react-router-dom";
import { decisionLabelWithScore } from "../utils/timeframeEngine";
import type { TimeframeAnalysis, Decision6 } from "../utils/timeframeEngine";
import type { OptionsAnalytics, Candle } from "../types";

type TradableSymbol = "CRUDEOIL" | "NATURALGAS";
const SYMBOLS: TradableSymbol[] = ["CRUDEOIL", "NATURALGAS"];
const DISPLAY_NAME: Record<TradableSymbol, string> = { CRUDEOIL: "CRUDE OIL", NATURALGAS: "NATURAL GAS" };
const TV_SYMBOL: Record<TradableSymbol, string> = { CRUDEOIL: "MCX:CRUDEOIL1!", NATURALGAS: "MCX:NATURALGAS1!" };
const LOT_SIZE: Record<TradableSymbol, number> = { CRUDEOIL: 100, NATURALGAS: 1250 };
const SIGNAL_VALIDITY_MS = 20 * 60 * 1000;

const DECISION_COLOR: Record<Decision6, string> = {
  "STRONG BUY": "#00E676",
  BUY: "#4ade80",
  "WATCH BUY": "#a3e635",
  WAIT: "#FFC107",
  SELL: "#fb7185",
  "STRONG SELL": "#FF4D4F",
};

// WATCH BUY (65-79) and SELL (25-44) sit only a few points off WAIT's 45-64
// neutral band -- a real signal, but a much weaker one than STRONG BUY/BUY/
// STRONG SELL. This page shows every non-WAIT tier (unlike AI Elite's
// stricter gate), so instead of hiding these it flags them visually
// wherever they'd otherwise look identically confident to a strong tier.
const MARGINAL_DECISIONS = new Set<Decision6>(["WATCH BUY", "SELL"]);

interface PremiumProjection {
  strike: number;
  optSide: "CE" | "PE";
  entry: number;
  targets: [number, number, number];
  stop: number;
  rr: number | null;
}

function projectPremium(analysis: TimeframeAnalysis, options: OptionsAnalytics | undefined): PremiumProjection | null {
  if (!options || options.error || !analysis.optSide || analysis.underlyingEntry === null || analysis.underlyingStop === null || !analysis.underlyingTargets) {
    return null;
  }
  const row = options.rows.find((r) => r.strike === options.atmStrike) ?? options.rows[Math.floor(options.rows.length / 2)];
  if (!row) return null;
  const leg = analysis.optSide === "CE" ? row.call : row.put;
  if (leg.ltp === null || leg.ltp <= 0) return null;
  const DELTA = 0.5;
  const favMove = Math.abs(analysis.underlyingTargets[0] - analysis.underlyingEntry);
  const riskMove = Math.abs(analysis.underlyingEntry - analysis.underlyingStop);
  const entry = leg.ltp;
  const targets: [number, number, number] = [
    Number((entry + DELTA * favMove).toFixed(2)),
    Number((entry + DELTA * Math.abs(analysis.underlyingTargets[1] - analysis.underlyingEntry)).toFixed(2)),
    Number((entry + DELTA * Math.abs(analysis.underlyingTargets[2] - analysis.underlyingEntry)).toFixed(2)),
  ];
  const stop = Number(Math.max(entry * 0.35, entry - DELTA * riskMove).toFixed(2));
  const rr = entry - stop !== 0 ? Number(((targets[0] - entry) / (entry - stop)).toFixed(2)) : null;
  return { strike: row.strike, optSide: analysis.optSide, entry, targets, stop, rr };
}

function riskLabel(volatilityScore: number): { label: string; color: string } {
  if (volatilityScore >= 65) return { label: "High", color: "#FF4D4F" };
  if (volatilityScore >= 35) return { label: "Medium", color: "#FFC107" };
  return { label: "Low", color: "#00E676" };
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

function fmtCountdown(ms: number): string {
  if (ms <= 0) return "Expired";
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatExpiryTip(expiry: string): string {
  try {
    return new Date(expiry).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
  } catch {
    return expiry;
  }
}

export function AITestPro() {
  const [symbol, setSymbol] = useState<TradableSymbol>("NATURALGAS");
  const [now, setNow] = useState(Date.now());
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [explainKey, setExplainKey] = useState<string | null>(null);
  const [loggedKey, setLoggedKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [historyFilter, setHistoryFilter] = useState<"all" | TradableSymbol>("all");

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const { data: market } = useMarketStatus();
  const { data: prices } = usePrices();
  const { data: trades } = usePortfolio();
  const { risk } = useAppStore();
  const createTrade = useCreateTrade();

  const journalSummary = useMemo(() => computePortfolioSummary(trades ?? []), [trades]);
  const crudeOil = useTimeframeSuite("CRUDEOIL", journalSummary.winRate);
  const naturalGas = useTimeframeSuite("NATURALGAS", journalSummary.winRate);
  const board: Record<TradableSymbol, ReturnType<typeof useTimeframeSuite>> = { CRUDEOIL: crudeOil, NATURALGAS: naturalGas };
  const current = board[symbol];
  const { data: signal } = useSignal(symbol);

  const crudeOilProjections = useMemo(() => crudeOil.analyses.map((a) => projectPremium(a, crudeOil.options)), [crudeOil.analyses, crudeOil.options]);
  const naturalGasProjections = useMemo(() => naturalGas.analyses.map((a) => projectPremium(a, naturalGas.options)), [naturalGas.analyses, naturalGas.options]);
  useTradeLog("CRUDEOIL", crudeOil.analyses, crudeOilProjections, crudeOil.options);
  const tradeLogs = useTradeLog("NATURALGAS", naturalGas.analyses, naturalGasProjections, naturalGas.options);
  const projections = symbol === "CRUDEOIL" ? crudeOilProjections : naturalGasProjections;

  const dayStats = useMemo(() => summarizeTradeLogsByDay(tradeLogs), [tradeLogs]);
  const realizedTrades = useMemo(() => flattenClosedTrades(tradeLogs), [tradeLogs]);
  const perf = useMemo(() => computePerformanceStats(realizedTrades), [realizedTrades]);
  const signalRanking = useMemo(
    () =>
      rankSignalsByWinRate(
        Object.entries(tradeLogs)
          .filter(([k]) => /^(CRUDEOIL|NATURALGAS)-\d+$/.test(k))
          .flatMap(([, v]) => v)
      ),
    [tradeLogs]
  );

  const allEntries = useMemo(
    () =>
      SYMBOLS.flatMap((sym) => board[sym].analyses.map((a, i) => ({ symbol: sym, analysis: a, options: board[sym].options, proj: (sym === "CRUDEOIL" ? crudeOilProjections : naturalGasProjections)[i] }))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [crudeOil.analyses, naturalGas.analyses, crudeOilProjections, naturalGasProjections]
  );
  // The single flagship spotlight now uses the EXACT SAME gate as the AI
  // Elite page (findEliteSignal): STRONG BUY/SELL only, zero vetoes, another
  // timeframe on the same symbol confirming, genuine price-action +
  // support/resistance value-zone + volume confirmation, and a minimum
  // 1:1.5 reward-to-risk -- not just "highest hitProbability among non-WAIT
  // tiers" like before. findEliteSignal already compares across ALL
  // candidates (both symbols) and picks the single most extreme, so this
  // naturally produces one spotlight pick, same as passing one symbol at a
  // time would on the Elite page itself.
  const eliteHero = useMemo(() => findEliteSignal(allEntries), [allEntries]);
  const hero = eliteHero ? { symbol: eliteHero.symbol as TradableSymbol, analysis: eliteHero.analysis, options: eliteHero.options } : null;
  const heroKey = hero ? `${hero.symbol}-${hero.analysis.tf}` : null;
  const heroLog = heroKey ? tradeLogs[heroKey] ?? [] : [];
  const heroEntry = heroLog[heroLog.length - 1];
  const heroLive = heroEntry ? liveLtpFor(hero!.options, heroEntry.strike, heroEntry.optSide) : null;

  const priceCard = prices?.find((p) => p.symbol === symbol);
  const c15 = useCandles(symbol, "15");
  const c15Snap = useMemo(() => (c15.data?.candles && c15.data.candles.length >= 30 ? computeIndicatorSnapshot(c15.data.candles) : null), [c15.data]);
  const cciValue = useMemo(() => (c15.data?.candles && c15.data.candles.length >= 20 ? cci(c15.data.candles) : null), [c15.data]);

  const validEntries = allEntries.filter((e) => e.analysis.overallScore !== null);
  const avgVolatility = validEntries.length
    ? Math.round(validEntries.reduce((s, e) => s + (e.analysis.categories?.volatility.score ?? 50), 0) / validEntries.length)
    : 50;
  const rl = riskLabel(avgVolatility);

  const riskAmount = (risk.capital * risk.riskPercent) / 100;
  const perUnitRisk = heroEntry ? Math.abs(heroEntry.entry - heroEntry.stop) : null;
  const quantity = perUnitRisk && perUnitRisk > 0 ? Math.max(1, Math.floor(riskAmount / perUnitRisk / LOT_SIZE[hero?.symbol ?? "NATURALGAS"])) : null;
  const capitalRequired = quantity !== null && heroEntry ? heroEntry.entry * LOT_SIZE[hero?.symbol ?? "NATURALGAS"] * quantity : null;

  const validUntil = heroEntry ? heroEntry.openedAt + SIGNAL_VALIDITY_MS : null;
  const remainingMs = validUntil !== null ? validUntil - now : null;

  const heroCandles: Candle[] = hero?.symbol === symbol ? c15.data?.candles ?? [] : [];
  const priceLines = useMemo(() => {
    if (!heroEntry) return [];
    return [
      { price: heroEntry.entry, color: "#00C2FF", title: "Entry" },
      { price: heroEntry.stop, color: "#FF4D4F", title: "SL" },
      { price: heroEntry.targets[0], color: "#00E676", title: "T1" },
      { price: heroEntry.targets[1], color: "#00E676", title: "T2" },
      { price: heroEntry.targets[2], color: "#00E676", title: "T3" },
      ...(c15Snap?.vwap !== null && c15Snap?.vwap !== undefined ? [{ price: c15Snap.vwap, color: "#7C4DFF", title: "VWAP" }] : []),
    ];
  }, [heroEntry, c15Snap]);
  const ema20Series = useMemo(() => {
    if (!heroCandles.length) return undefined;
    const k = 2 / 21;
    const out: number[] = [heroCandles[0].close];
    for (let i = 1; i < heroCandles.length; i++) out.push(heroCandles[i].close * k + out[i - 1] * (1 - k));
    return out;
  }, [heroCandles]);

  const filteredHistory = useMemo(
    () => (historyFilter === "all" ? realizedTrades : realizedTrades.filter((r) => r.symbol === historyFilter)).slice().reverse().slice(0, 30),
    [realizedTrades, historyFilter]
  );

  return (
    <div className="-mx-4 -mt-4 px-4 pt-4 pb-24 min-h-screen text-white space-y-4" style={{ background: "linear-gradient(180deg,#09090F,#0D0E16 40%,#09090F)" }}>
      {/* HEADER */}
      <header className="sticky top-0 z-20 -mx-4 px-4 py-3 backdrop-blur-xl border-b" style={{ background: "rgba(9,9,15,.85)", borderColor: "rgba(255,255,255,.08)" }}>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-lg font-black tracking-tight bg-gradient-to-r from-[#00C2FF] via-[#7C4DFF] to-[#00C2FF] bg-clip-text text-transparent">AI-Test Pro</h1>
            <p className="text-[10px] text-[#9AA4B2]">Institutional Commodity Dashboard — flagship pick now Elite-gated</p>
          </div>
          <Link to="/settings" className="p-2 rounded-full" style={{ background: "#181A24" }}>
            <SettingsIcon size={16} className="text-[#9AA4B2]" />
          </Link>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 mt-2">
          <Badge dot color="#00E676" label="AI Engine Online" />
          <Badge dot color={market?.isOpen ? "#00E676" : "#FF4D4F"} label={market ? (market.isOpen ? "Market Connected" : "Market Closed") : "…"} />
          <Badge label="Live · Auto-refresh 15s" />
        </div>
      </header>

      {/* HERO SIGNAL CARD -- gated by findEliteSignal, same bar as the Elite page */}
      <GlassCard glow={hero ? DECISION_COLOR[hero.analysis.decision] : undefined}>
        <div className="flex items-center gap-1.5 mb-2">
          <span className="text-[9px] font-bold uppercase px-2 py-0.5 rounded-full" style={{ background: "#00E67622", color: "#00E676" }}>
            Elite-Gated Spotlight
          </span>
        </div>
        {!hero || !heroEntry ? (
          <div className="text-center py-6">
            <p className="text-sm font-bold text-[#9AA4B2]">No actionable signal right now</p>
            <p className="text-xs text-[#9AA4B2] mt-1">
              Neither instrument currently clears the same strict bar AI Elite uses: Strong Buy / Don't Buy Risky (strong sell), zero vetoes, another timeframe confirming, genuine price-action + value-zone + volume
              confirmation, and at least 1:1.5 reward-to-risk. Nothing is fabricated — check back shortly.
            </p>
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row gap-4 items-center">
            <CircularGauge value={hero.analysis.overallScore ?? 0} size={112} label="AI Confidence" />
            <div className="flex-1 w-full">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-bold uppercase text-[#9AA4B2]">{DISPLAY_NAME[hero.symbol]} · {hero.analysis.label}</span>
                <span className="text-[9px] px-2 py-0.5 rounded-full font-bold animate-pulse" style={{ background: "#FF4D4F22", color: "#FF4D4F" }}>
                  LIVE
                </span>
              </div>
              <p className="text-2xl font-black mt-0.5">
                {heroEntry.strike} {heroEntry.optSide}
              </p>
              <p className="text-sm font-bold mt-1" style={{ color: DECISION_COLOR[hero.analysis.decision] }}>
                {decisionLabelWithScore(hero.analysis.decision)} {heroEntry.optSide === "CE" ? "CALL" : "PUT"}
              </p>
              <p className="text-[10px] text-[#9AA4B2] mt-0.5">Confirmed by: {eliteHero?.confirmingTimeframes.join(", ")}</p>
              <div className="flex flex-wrap gap-1.5 mt-2">
                <ConfluenceChip label="Price Action" ok={!!eliteHero?.confluence.priceAction} />
                <ConfluenceChip label="Value Zone" ok={!!eliteHero?.confluence.valueZone} />
                <ConfluenceChip label="Volume" ok={!!eliteHero?.confluence.volume} />
                <ConfluenceChip label={`R:R 1:${eliteHero?.rr ?? "—"}`} ok={(eliteHero?.rr ?? 0) >= 1.5} />
              </div>
              <div className="grid grid-cols-3 gap-2 mt-3">
                <StatChip label="Entry" value={`₹${heroEntry.entry}`} />
                <StatChip label="Stop Loss" value={`₹${heroEntry.stop}`} color="#FF4D4F" />
                <StatChip label="Target 1" value={`₹${heroEntry.targets[0]}`} color="#00E676" />
                <StatChip label="Target 2" value={`₹${heroEntry.targets[1]}`} color="#00E676" />
                <StatChip label="Target 3" value={`₹${heroEntry.targets[2]}`} color="#00E676" />
                <StatChip label="Probability" value={hero.analysis.hitProbability !== null ? `${hero.analysis.hitProbability}%` : "—"} />
                <StatChip label="Risk:Reward" value={projections.find((p) => p?.strike === heroEntry.strike)?.rr ? `1:${projections.find((p) => p?.strike === heroEntry.strike)!.rr}` : "—"} />
                <StatChip label="Holding Time" value={hero.analysis.holdingTime} />
                <StatChip label="Signal Expires" value={remainingMs !== null ? fmtCountdown(remainingMs) : "—"} />
              </div>
              <div className="flex gap-2 mt-3">
                <button
                  disabled={loggedKey === heroKey}
                  onClick={() =>
                    createTrade.mutate(
                      {
                        symbol: hero.symbol,
                        optSide: heroEntry.optSide,
                        strike: heroEntry.strike,
                        entryPrice: heroEntry.entry,
                        stopLoss: heroEntry.stop,
                        target: heroEntry.targets[0],
                        quantity: 1,
                        lotSize: LOT_SIZE[hero.symbol],
                        source: "master-ai",
                        notes: `Logged from AI-Test Pro (${hero.analysis.label})`,
                      },
                      { onSuccess: () => setLoggedKey(heroKey) }
                    )
                  }
                  className="flex-1 py-2.5 rounded-xl text-xs font-bold text-black disabled:opacity-50"
                  style={{ background: "linear-gradient(135deg,#00E676,#00C2FF)" }}
                >
                  {loggedKey === heroKey ? "Logged ✓" : "Log to Journal"}
                </button>
                <button
                  onClick={() => {
                    formatTipCard({
                      symbolLabel: DISPLAY_NAME[hero.symbol],
                      strike: heroEntry.strike,
                      optSide: heroEntry.optSide,
                      expiryLabel: signal?.expiry ? formatExpiryTip(signal.expiry) : "—",
                      buyZoneLow: heroEntry.entry,
                      buyZoneHigh: Number((heroEntry.entry * 1.02).toFixed(2)),
                      targets: heroEntry.targets,
                      stopLoss: heroEntry.stop,
                    });
                    const tip = formatTipCard({
                      symbolLabel: DISPLAY_NAME[hero.symbol],
                      strike: heroEntry.strike,
                      optSide: heroEntry.optSide,
                      expiryLabel: signal?.expiry ? formatExpiryTip(signal.expiry) : "—",
                      buyZoneLow: heroEntry.entry,
                      buyZoneHigh: Number((heroEntry.entry * 1.02).toFixed(2)),
                      targets: heroEntry.targets,
                      stopLoss: heroEntry.stop,
                    });
                    navigator.clipboard.writeText(tip);
                    setCopiedKey(heroKey);
                    setTimeout(() => setCopiedKey(null), 2000);
                  }}
                  className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-bold border"
                  style={{ background: "#181A24", borderColor: "rgba(255,255,255,.08)" }}
                >
                  <Copy size={13} />
                  {copiedKey === heroKey ? "Copied ✓" : "Copy Trade"}
                </button>
              </div>
              {/* Progress tracker */}
              {heroLive !== null && (
                <div className="mt-3">
                  <div className="flex justify-between text-[9px] text-[#9AA4B2] mb-1">
                    <span>Entry ₹{heroEntry.entry}</span>
                    <span>Current ₹{heroLive}</span>
                    <span>T1 ₹{heroEntry.targets[0]}</span>
                  </div>
                  <ProgressTrack entry={heroEntry.entry} stop={heroEntry.stop} target={heroEntry.targets[0]} current={heroLive} />
                </div>
              )}
            </div>
          </div>
        )}
      </GlassCard>

      {/* SYMBOL SELECTOR */}
      <div className="flex gap-2">
        {SYMBOLS.map((sym) => (
          <button
            key={sym}
            onClick={() => setSymbol(sym)}
            className="flex-1 rounded-2xl py-2.5 text-sm font-bold border transition-all"
            style={symbol === sym ? { background: "#181A24", borderColor: "#00C2FF66" } : { background: "#12131C", borderColor: "rgba(255,255,255,.08)", color: "#9AA4B2" }}
          >
            {DISPLAY_NAME[sym]}
          </button>
        ))}
      </div>

      {current.liveDataUnavailable && (
        <GlassCard>
          <p className="text-sm font-bold text-[#FFC107] flex items-center justify-center gap-1.5">
            <AlertTriangle size={14} /> Live data unavailable
          </p>
          <p className="text-xs text-[#9AA4B2] mt-1 text-center">{current.errorMessage ?? "Option chain unreachable"} — no Entry, Target, Stop Loss, or Probability is fabricated.</p>
        </GlassCard>
      )}

      {/* LIVE PRICE CARD */}
      <GlassCard>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-bold uppercase text-[#9AA4B2]">Live Price — {DISPLAY_NAME[symbol]}</p>
          <span className="flex items-center gap-1 text-[9px] text-[#00E676] font-bold">
            <span className="w-1.5 h-1.5 rounded-full bg-[#00E676] animate-pulse" /> LIVE
          </span>
        </div>
        {priceCard ? (
          <div className="grid grid-cols-3 gap-2">
            <StatChip label="LTP" value={`₹${priceCard.ltp}`} />
            <StatChip label="Change" value={`${priceCard.change >= 0 ? "+" : ""}${priceCard.change} (${priceCard.changePercent}%)`} color={priceCard.change >= 0 ? "#00E676" : "#FF4D4F"} />
            <StatChip label="Volume" value={priceCard.volume !== null ? priceCard.volume.toLocaleString("en-IN") : "—"} />
            <StatChip label="High" value={priceCard.high !== null ? `₹${priceCard.high}` : "—"} />
            <StatChip label="Low" value={priceCard.low !== null ? `₹${priceCard.low}` : "—"} />
            <StatChip label="OI" value={priceCard.oi !== null ? priceCard.oi.toLocaleString("en-IN") : "—"} />
          </div>
        ) : (
          <p className="text-xs text-[#9AA4B2] text-center py-3">Live price unavailable</p>
        )}
      </GlassCard>

      {/* MARKET SENTIMENT (only real, computable fields) */}
      <GlassCard title="Market Sentiment">
        <div className="grid grid-cols-2 gap-2">
          <StatChip
            label="Trend"
            value={hero ? (hero.analysis.bias === "bullish" ? "Bullish" : hero.analysis.bias === "bearish" ? "Bearish" : "Neutral") : "—"}
            color={hero?.analysis.bias === "bullish" ? "#00E676" : hero?.analysis.bias === "bearish" ? "#FF4D4F" : undefined}
          />
          <StatChip label="Momentum" value={hero?.analysis.categories ? `${hero.analysis.categories.momentum.score}/100` : "—"} />
          <StatChip label="Volatility" value={`${avgVolatility}/100`} />
          <StatChip label="Market Strength" value={hero ? `${hero.analysis.overallScore}/100` : "—"} />
        </div>
        <p className="text-[9px] text-[#9AA4B2] mt-2">Fear &amp; Greed, institutional/retail bias, and news sentiment need data feeds this app doesn't have — omitted rather than faked.</p>
      </GlassCard>

      {/* AI SCORE BREAKDOWN */}
      {hero?.analysis.categories && (
        <GlassCard title="AI Score Breakdown">
          <div className="space-y-2.5">
            <ScoreBar label="Trend (EMA/HH-HL structure)" score={hero.analysis.categories.trend.score} />
            <ScoreBar label="Momentum (RSI/MACD/StochRSI)" score={hero.analysis.categories.momentum.score} />
            <ScoreBar label="Price Action (patterns/structure)" score={hero.analysis.categories.priceAction.score} />
            <ScoreBar label="Volume (OBV confirmation)" score={hero.analysis.categories.volume.score} />
            <ScoreBar label="Support / Resistance / VWAP" score={hero.analysis.categories.supportResistance.score} />
            <ScoreBar label="Volatility (ATR/Bollinger)" score={hero.analysis.categories.volatility.score} />
          </div>
          <div className="flex items-center justify-between mt-3 pt-3 border-t" style={{ borderColor: "rgba(255,255,255,.08)" }}>
            <span className="text-xs font-bold text-[#9AA4B2]">Overall AI Score</span>
            <span className="text-lg font-black" style={{ color: DECISION_COLOR[hero.analysis.decision] }}>
              {hero.analysis.overallScore}/100
            </span>
          </div>
        </GlassCard>
      )}

      {/* RISK ANALYSIS */}
      {hero && heroEntry && (
        <GlassCard title="Risk Analysis">
          <div className="grid grid-cols-2 gap-2">
            <StatChip label="Risk Level" value={rl.label} color={rl.color} />
            <StatChip label="Risk : Reward" value={projections.find((p) => p?.strike === heroEntry.strike)?.rr ? `1:${projections.find((p) => p?.strike === heroEntry.strike)!.rr}` : "—"} />
            <StatChip label="Holding Duration" value={hero.analysis.holdingTime} />
            <StatChip label="Signal Stop Basis" value="1.5× ATR" />
          </div>
        </GlassCard>
      )}

      {/* ENTRY STRATEGY */}
      {hero && heroEntry && (
        <GlassCard title="Entry Strategy">
          <div className="grid grid-cols-2 gap-2">
            <StatChip label="Entry" value={`₹${heroEntry.entry}`} />
            <StatChip label="Buffer Entry (+2%)" value={`₹${(heroEntry.entry * 1.02).toFixed(2)}`} />
            <StatChip label="Target 1" value={`₹${heroEntry.targets[0]}`} color="#00E676" />
            <StatChip label="Target 2" value={`₹${heroEntry.targets[1]}`} color="#00E676" />
            <StatChip label="Target 3" value={`₹${heroEntry.targets[2]}`} color="#00E676" />
            <StatChip label="Stop Loss" value={`₹${heroEntry.stop}`} color="#FF4D4F" />
            <StatChip
              label="Trailing Stop"
              value={heroEntry.targetsHit[1] ? `₹${heroEntry.targets[0]} (after T2)` : heroEntry.targetsHit[0] ? `₹${heroEntry.entry} (breakeven)` : "Not yet active"}
            />
            <StatChip label="Quantity (by Risk page)" value={quantity !== null ? `${quantity} lot(s)` : "—"} />
            <StatChip label="Capital Required" value={capitalRequired !== null ? `₹${capitalRequired.toFixed(0)}` : "—"} />
          </div>
        </GlassCard>
      )}

      {/* TRADE CHART */}
      {hero && heroEntry && (
        <GlassCard title={`${DISPLAY_NAME[hero.symbol]} · Annotated Chart (15m)`}>
          {heroCandles.length ? (
            <TradeChart candles={heroCandles} priceLines={priceLines} ema20={ema20Series} height={240} />
          ) : (
            <p className="text-xs text-[#9AA4B2] text-center py-6">Switch to {DISPLAY_NAME[hero.symbol]} above to see the annotated chart for this signal.</p>
          )}
        </GlassCard>
      )}
      <GlassCard title={`${DISPLAY_NAME[symbol]} · TradingView (context only)`}>
        <TradingViewWidget key={symbol} symbol={TV_SYMBOL[symbol]} interval="15" height={240} />
      </GlassCard>

      {/* OPTIONS CHAIN SUMMARY */}
      {current.options && !current.options.error && (
        <GlassCard title="Options Chain Summary">
          <div className="grid grid-cols-2 gap-2">
            <StatChip label="PCR" value={current.options.pcr !== null ? current.options.pcr.toFixed(2) : "—"} />
            <StatChip label="Max Pain" value={current.options.maxPain !== null ? `₹${current.options.maxPain}` : "—"} />
            <StatChip label="Support" value={current.options.support !== null ? `₹${current.options.support}` : "—"} />
            <StatChip label="Resistance" value={current.options.resistance !== null ? `₹${current.options.resistance}` : "—"} />
            <StatChip label="ATM Strike" value={current.options.atmStrike !== null ? `${current.options.atmStrike}` : "—"} />
            <StatChip
              label="Chain Bias"
              value={current.options.bias === "bullish" ? "Bullish" : current.options.bias === "bearish" ? "Bearish" : "Neutral"}
              color={current.options.bias === "bullish" ? "#00E676" : current.options.bias === "bearish" ? "#FF4D4F" : undefined}
            />
          </div>
          <p className="text-[9px] text-[#9AA4B2] mt-2">Call/Put writing and OI buildup need a snapshot of OI change over time, which isn't stored — omitted rather than guessed.</p>
        </GlassCard>
      )}

      {/* TECHNICAL INDICATOR DASHBOARD */}
      {c15Snap && (
        <GlassCard title="Technical Indicator Dashboard (15m)">
          <div className="overflow-x-auto">
            <table className="w-full text-[11px] min-w-[420px]">
              <thead>
                <tr className="text-left text-[#9AA4B2]">
                  <th className="font-semibold pb-2">Indicator</th>
                  <th className="font-semibold pb-2">Value</th>
                  <th className="font-semibold pb-2">Signal</th>
                </tr>
              </thead>
              <tbody>
                <IndicatorRow label="RSI (14)" value={c15Snap.rsi14?.toFixed(1)} bullish={c15Snap.rsi14 !== null && c15Snap.rsi14! > 55} bearish={c15Snap.rsi14 !== null && c15Snap.rsi14! < 45} />
                <IndicatorRow label="EMA 20" value={c15Snap.ema20?.toFixed(2)} />
                <IndicatorRow label="EMA 50" value={c15Snap.ema50?.toFixed(2)} />
                <IndicatorRow label="EMA 200" value={c15Snap.ema200?.toFixed(2)} />
                <IndicatorRow
                  label="MACD Histogram"
                  value={c15Snap.macd?.histogram.toFixed(3)}
                  bullish={!!c15Snap.macd && c15Snap.macd.histogram > 0}
                  bearish={!!c15Snap.macd && c15Snap.macd.histogram < 0}
                />
                <IndicatorRow label="VWAP" value={c15Snap.vwap?.toFixed(2)} />
                <IndicatorRow label="ADX (14)" value={c15Snap.adx14?.toFixed(1)} bullish={c15Snap.adx14 !== null && c15Snap.adx14! > 25} />
                <IndicatorRow label="ATR (14)" value={c15Snap.atr14?.toFixed(2)} />
                <IndicatorRow label="CCI (20)" value={cciValue?.toFixed(1)} bullish={cciValue !== null && cciValue! > 100} bearish={cciValue !== null && cciValue! < -100} />
                <IndicatorRow
                  label="SuperTrend"
                  value={c15Snap.superTrend?.value.toFixed(2)}
                  bullish={c15Snap.superTrend?.direction === "bullish"}
                  bearish={c15Snap.superTrend?.direction === "bearish"}
                />
                <IndicatorRow label="Bollinger Mid" value={c15Snap.bollinger?.middle.toFixed(2)} />
                <IndicatorRow label="Volume (last bar)" value={c15.data?.candles?.length ? String(c15.data.candles[c15.data.candles.length - 1].volume ?? 0) : undefined} />
                <IndicatorRow label="Open Interest" value={current.options?.rows.find((r) => r.strike === current.options?.atmStrike)?.call.oi?.toLocaleString("en-IN")} />
              </tbody>
            </table>
          </div>
        </GlassCard>
      )}

      {/* MULTI-TIMEFRAME DASHBOARD */}
      <div className="space-y-3">
        <p className="text-xs font-bold uppercase text-[#9AA4B2] px-1">Multi-Timeframe Dashboard — {DISPLAY_NAME[symbol]}</p>
        {current.analyses.map((a, i) => {
          const proj = projections[i];
          const key = `${symbol}-${a.tf}`;
          const log = tradeLogs[key] ?? [];
          const latest = log[log.length - 1];
          const open = latest && !latest.closed ? latest : undefined;
          const liveLtp = open ? liveLtpFor(current.options, open.strike, open.optSide) : null;
          const cardKey = `${key}-${latest?.id ?? "none"}`;
          const isExplainOpen = explainKey === cardKey;
          return (
            <GlassCard key={a.tf}>
              <div className="flex items-center justify-between">
                <p className="text-sm font-bold">{a.label}</p>
                {a.insufficient ? (
                  <span className="text-[10px] font-bold text-[#9AA4B2]">NO DATA</span>
                ) : MARGINAL_DECISIONS.has(a.decision) ? (
                  <span
                    className="text-[11px] font-bold px-2.5 py-1 rounded-full border flex items-center gap-1"
                    style={{ color: DECISION_COLOR[a.decision], borderColor: `${DECISION_COLOR[a.decision]}66`, background: `${DECISION_COLOR[a.decision]}14` }}
                  >
                    {decisionLabelWithScore(a.decision)} {latest ? `${latest.strike} ${latest.optSide}` : ""}
                  </span>
                ) : (
                  <span className="text-[11px] font-bold px-2.5 py-1 rounded-full text-black" style={{ background: DECISION_COLOR[a.decision] }}>
                    {decisionLabelWithScore(a.decision)} {latest ? `${latest.strike} ${latest.optSide}` : ""}
                  </span>
                )}
              </div>
              {a.insufficient ? (
                <p className="text-[11px] text-[#9AA4B2] mt-2">{a.insufficient}</p>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-2 mt-2.5">
                    <StatChip label="Entry" value={latest ? `₹${latest.entry}` : "—"} />
                    <StatChip label="Current" value={liveLtp !== null ? `₹${liveLtp}` : "—"} />
                    <StatChip label="Target 1" value={latest ? `₹${latest.targets[0]}` : "—"} color="#00E676" />
                    <StatChip label="Stop Loss" value={latest ? `₹${latest.stop}` : "—"} color="#FF4D4F" />
                    <StatChip label="Probability" value={a.hitProbability !== null ? `${a.hitProbability}%` : "—"} />
                    <StatChip label="R:R" value={proj?.rr !== null && proj?.rr !== undefined ? `1:${proj.rr}` : "—"} />
                  </div>
                  {liveLtp !== null && latest && (
                    <div className="mt-2">
                      <ProgressTrack entry={latest.entry} stop={latest.stop} target={latest.targets[0]} current={liveLtp} />
                    </div>
                  )}
                  <div className="grid grid-cols-3 gap-2 mt-2.5">
                    <button
                      disabled={!open || loggedKey === cardKey}
                      onClick={() =>
                        open &&
                        createTrade.mutate(
                          {
                            symbol,
                            optSide: open.optSide,
                            strike: open.strike,
                            entryPrice: open.entry,
                            stopLoss: open.stop,
                            target: open.targets[0],
                            quantity: 1,
                            lotSize: LOT_SIZE[symbol],
                            source: "master-ai",
                            notes: `Logged from AI-Test Pro (${a.label})`,
                          },
                          { onSuccess: () => setLoggedKey(cardKey) }
                        )
                      }
                      className="py-2 rounded-lg text-[10px] font-bold text-black disabled:opacity-40"
                      style={{ background: "#00E676" }}
                    >
                      {loggedKey === cardKey ? "Logged ✓" : "Journal"}
                    </button>
                    <button
                      disabled={!open}
                      onClick={() => {
                        if (!open) return;
                        const tip = formatTipCard({
                          symbolLabel: DISPLAY_NAME[symbol],
                          strike: open.strike,
                          optSide: open.optSide,
                          expiryLabel: signal?.expiry ? formatExpiryTip(signal.expiry) : "—",
                          buyZoneLow: open.entry,
                          buyZoneHigh: Number((open.entry * 1.02).toFixed(2)),
                          targets: open.targets,
                          stopLoss: open.stop,
                        });
                        navigator.clipboard.writeText(tip);
                        setCopiedKey(cardKey);
                        setTimeout(() => setCopiedKey(null), 2000);
                      }}
                      className="flex items-center justify-center gap-1 py-2 rounded-lg text-[10px] font-bold border disabled:opacity-40"
                      style={{ background: "#181A24", borderColor: "rgba(255,255,255,.08)" }}
                    >
                      <Copy size={11} /> {copiedKey === cardKey ? "Copied" : "Copy"}
                    </button>
                    <button
                      onClick={() => setExplainKey(isExplainOpen ? null : cardKey)}
                      className="flex items-center justify-center gap-1 py-2 rounded-lg text-[10px] font-bold border"
                      style={{ background: "#181A24", borderColor: "rgba(255,255,255,.08)" }}
                    >
                      AI Explain <ChevronDown size={12} className={`transition-transform ${isExplainOpen ? "rotate-180" : ""}`} />
                    </button>
                  </div>
                  <AnimatePresence>
                    {isExplainOpen && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                        <div className="mt-2.5 rounded-xl p-3 space-y-2" style={{ background: "#0D0E16", border: "1px solid rgba(255,255,255,.06)" }}>
                          {a.reasons.length > 0 && (
                            <div>
                              <p className="text-[9px] font-bold text-[#00E676] uppercase mb-1">Why this signal</p>
                              {a.reasons.slice(0, 6).map((r, ri) => (
                                <p key={ri} className="text-[11px] text-[#9AA4B2]">
                                  • {r}
                                </p>
                              ))}
                            </div>
                          )}
                          {a.vetoes.length > 0 && (
                            <div>
                              <p className="text-[9px] font-bold text-[#FFC107] uppercase mb-1">Risks / invalidation</p>
                              {a.vetoes.map((v, vi) => (
                                <p key={vi} className="text-[11px] text-[#9AA4B2]">
                                  • {v}
                                </p>
                              ))}
                            </div>
                          )}
                          {a.categories && (
                            <div>
                              <p className="text-[9px] font-bold text-[#00C2FF] uppercase mb-1">Category detail</p>
                              {Object.entries(a.categories).map(([cat, res]) =>
                                res.notes.length ? (
                                  <p key={cat} className="text-[11px] text-[#9AA4B2]">
                                    <span className="capitalize font-semibold text-white/70">{cat}:</span> {res.notes[0]}
                                  </p>
                                ) : null
                              )}
                            </div>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </>
              )}
            </GlassCard>
          );
        })}
      </div>

      {/* PERFORMANCE DASHBOARD */}
      <GlassCard title="Performance Dashboard">
        <div className="grid grid-cols-3 gap-2">
          <StatChip label="Today's Signals" value={String(perf.todayClosed)} />
          <StatChip label="Today Wins" value={String(perf.todayWins)} color="#00E676" />
          <StatChip label="Today Losses" value={String(perf.todayLosses)} color="#FF4D4F" />
          <StatChip label="Accuracy" value={perf.accuracyPct !== null ? `${perf.accuracyPct}%` : "—"} />
          <StatChip label="Net Points" value={`${perf.netPoints >= 0 ? "+" : ""}${perf.netPoints}`} color={perf.netPoints >= 0 ? "#00E676" : "#FF4D4F"} />
          <StatChip label="Avg Holding Time" value={perf.avgHoldingMinutes !== null ? formatDuration(perf.avgHoldingMinutes) : "—"} />
          <StatChip label="Best Trade" value={perf.bestTrade ? `+${perf.bestTrade.pnlPoints}` : "—"} color="#00E676" />
          <StatChip label="Worst Trade" value={perf.worstTrade ? `${perf.worstTrade.pnlPoints}` : "—"} color="#FF4D4F" />
          <StatChip
            label="Current Streak"
            value={perf.currentStreak.type === "none" ? "—" : `${perf.currentStreak.count} ${perf.currentStreak.type}${perf.currentStreak.count > 1 ? "s" : ""}`}
            color={perf.currentStreak.type === "win" ? "#00E676" : perf.currentStreak.type === "loss" ? "#FF4D4F" : undefined}
          />
        </div>
      </GlassCard>

      {/* STATISTICS */}
      <GlassCard title="Statistics">
        <div className="grid grid-cols-2 gap-2">
          <StatChip label="Average Win" value={perf.avgWin !== null ? `+${perf.avgWin}` : "—"} color="#00E676" />
          <StatChip label="Average Loss" value={perf.avgLoss !== null ? `-${perf.avgLoss}` : "—"} color="#FF4D4F" />
          <StatChip label="Profit Factor" value={perf.profitFactor !== null ? perf.profitFactor.toFixed(2) : "—"} />
          <StatChip label="Expectancy / Trade" value={perf.expectancy !== null ? `${perf.expectancy >= 0 ? "+" : ""}${perf.expectancy}` : "—"} />
          <StatChip label="Max Drawdown" value={`${perf.maxDrawdown}`} color="#FF4D4F" />
          <StatChip label="Total Closed" value={String(perf.totalClosed)} />
        </div>
        <p className="text-[9px] text-[#9AA4B2] mt-2">Sharpe Ratio isn't shown — it needs a real return time-series and risk-free-rate assumption that isn't meaningful at this trade cadence/sample size.</p>
      </GlassCard>

      {/* DAY-WISE LOG */}
      <GlassCard title="Day-wise Trade Log — Both Symbols">
        <p className="text-[9px] text-[#9AA4B2] mb-2">One MCX session = 9:00am – 11:55pm IST.</p>
        {dayStats.length === 0 ? (
          <p className="text-xs text-[#9AA4B2] text-center py-3">No trades have closed yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[11px] min-w-[380px]">
              <thead>
                <tr className="text-left text-[#9AA4B2]">
                  <th className="font-semibold pb-2">Date</th>
                  <th className="font-semibold pb-2">Target Hit</th>
                  <th className="font-semibold pb-2">Breakeven</th>
                  <th className="font-semibold pb-2">SL Hit</th>
                  <th className="font-semibold pb-2">Total</th>
                </tr>
              </thead>
              <tbody>
                {dayStats.map((d) => (
                  <tr key={d.dateKey} className="border-t" style={{ borderColor: "rgba(255,255,255,.06)" }}>
                    <td className="py-2 font-semibold">{d.label}</td>
                    <td className="py-2 font-bold" style={{ color: "#00E676" }}>{d.targetHit}</td>
                    <td className="py-2 font-bold" style={{ color: "#a3e635" }}>{d.breakeven}</td>
                    <td className="py-2 font-bold" style={{ color: "#FF4D4F" }}>{d.slHit}</td>
                    <td className="py-2 text-[#9AA4B2]">{d.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>

      {/* SIGNAL WIN RATE RANKING */}
      <GlassCard title="Signal Win Rate Ranking — Both Symbols">
        <p className="text-[9px] text-[#9AA4B2] mb-2">Which signal (Strong Buy, Good Buy, Risky Buy, Don't Buy Risky) actually wins more, from real closed trades. Win rate excludes breakeven closes.</p>
        {signalRanking.every((r) => r.total === 0) ? (
          <p className="text-xs text-[#9AA4B2] text-center py-3">No trades have closed yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[11px] min-w-[420px]">
              <thead>
                <tr className="text-left text-[#9AA4B2]">
                  <th className="font-semibold pb-2">Signal</th>
                  <th className="font-semibold pb-2">Win Rate</th>
                  <th className="font-semibold pb-2">Target Hit</th>
                  <th className="font-semibold pb-2">Breakeven</th>
                  <th className="font-semibold pb-2">SL Hit</th>
                  <th className="font-semibold pb-2">Total</th>
                </tr>
              </thead>
              <tbody>
                {signalRanking.map((r, i) => (
                  <tr key={r.label} className="border-t" style={{ borderColor: "rgba(255,255,255,.06)" }}>
                    <td className="py-2 font-semibold">
                      {i === 0 && r.winRate !== null ? "#1 " : ""}
                      {r.label}
                    </td>
                    <td className="py-2 font-bold" style={{ color: r.winRate === null ? "#9AA4B2" : r.winRate >= 50 ? "#00E676" : "#FF4D4F" }}>
                      {r.winRate !== null ? `${r.winRate}%` : "—"}
                    </td>
                    <td className="py-2 font-bold" style={{ color: "#00E676" }}>{r.targetHit}</td>
                    <td className="py-2 font-bold" style={{ color: "#a3e635" }}>{r.breakeven}</td>
                    <td className="py-2 font-bold" style={{ color: "#FF4D4F" }}>{r.slHit}</td>
                    <td className="py-2 text-[#9AA4B2]">{r.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>

      {/* SIGNAL HISTORY */}
      <GlassCard title="Signal History">
        <div className="flex gap-1.5 mb-2">
          {(["all", ...SYMBOLS] as const).map((f) => (
            <button
              key={f}
              onClick={() => setHistoryFilter(f)}
              className="px-2.5 py-1 rounded-full text-[10px] font-bold"
              style={historyFilter === f ? { background: "#00C2FF", color: "#09090F" } : { background: "#181A24", color: "#9AA4B2" }}
            >
              {f === "all" ? "All" : DISPLAY_NAME[f]}
            </button>
          ))}
        </div>
        {filteredHistory.length === 0 ? (
          <p className="text-xs text-[#9AA4B2] text-center py-3">No closed signals yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[11px] min-w-[520px]">
              <thead>
                <tr className="text-left text-[#9AA4B2]">
                  <th className="font-semibold pb-2">Time</th>
                  <th className="font-semibold pb-2">Symbol</th>
                  <th className="font-semibold pb-2">Signal</th>
                  <th className="font-semibold pb-2">Entry</th>
                  <th className="font-semibold pb-2">Exit</th>
                  <th className="font-semibold pb-2">Points</th>
                  <th className="font-semibold pb-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredHistory.map((r) => (
                  <tr key={r.entry.id} className="border-t" style={{ borderColor: "rgba(255,255,255,.06)" }}>
                    <td className="py-2">{r.entry.closedAt ? new Date(r.entry.closedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                    <td className="py-2">{DISPLAY_NAME[r.symbol as TradableSymbol] ?? r.symbol}</td>
                    <td className="py-2">
                      {r.entry.strike} {r.entry.optSide}
                    </td>
                    <td className="py-2">₹{r.entry.entry}</td>
                    <td className="py-2">₹{r.exitPrice}</td>
                    <td className="py-2 font-bold" style={{ color: r.pnlPoints > 0 ? "#00E676" : r.pnlPoints < 0 ? "#FF4D4F" : "#9AA4B2" }}>
                      {r.pnlPoints >= 0 ? "+" : ""}
                      {r.pnlPoints}
                    </td>
                    <td className="py-2 text-[#9AA4B2]">{r.entry.status.replace(/_/g, " ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>

      {/* JOURNAL INTEGRATION NOTE */}
      <GlassCard title="Journal">
        <p className="text-xs text-[#9AA4B2]">
          Trades logged here appear in your <Link to="/journal" className="text-[#00C2FF] font-semibold">Journal</Link>, where you can add notes, emotion, and outcome tags. Screenshot upload
          isn't available yet — no image storage is wired up, so it's left out rather than faked as working.
        </p>
      </GlassCard>

      {/* FOOTER */}
      <footer className="text-center pt-2 pb-4 space-y-1">
        <p className="text-[9px] text-[#9AA4B2]">Powered by Kumar Multi-Timeframe Confluence Engine · v2</p>
        <p className="text-[9px] text-[#9AA4B2]">
          {market ? (market.isOpen ? "Market Open" : "Market Closed") : "…"} · Last updated {new Date(current.dataUpdatedAt || Date.now()).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
        </p>
        <p className="text-[9px] text-[#9AA4B2]/70">Educational reference only, not financial advice. Rule-based scoring — not a language model, no free-text chat behind the assistant below.</p>
      </footer>

      {/* FLOATING AI ASSISTANT */}
      <button
        onClick={() => setAssistantOpen(true)}
        className="fixed bottom-24 right-4 z-30 w-12 h-12 rounded-full flex items-center justify-center shadow-lg"
        style={{ background: "linear-gradient(135deg,#00C2FF,#7C4DFF)" }}
      >
        <Bot size={20} className="text-white" />
      </button>
      <AnimatePresence>
        {assistantOpen && hero && heroEntry && (
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 40 }}
            className="fixed bottom-24 right-4 left-4 z-30 rounded-2xl p-4 max-h-[70vh] overflow-y-auto"
            style={{ background: "#181A24", border: "1px solid rgba(255,255,255,.1)" }}
          >
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-bold flex items-center gap-1.5">
                <Bot size={16} className="text-[#00C2FF]" /> AI Assistant
              </p>
              <button onClick={() => setAssistantOpen(false)}>
                <X size={16} className="text-[#9AA4B2]" />
              </button>
            </div>
            <p className="text-[10px] text-[#9AA4B2] mb-3">Answers below are built from this signal's own real numbers — not a free-text chat model.</p>
            <div className="space-y-3">
              <Faq
                q="Why this signal?"
                a={`${hero.analysis.reasons[0] ?? "Confluence across the scored categories favors this direction right now."} It cleared the same strict bar as AI Elite: ${decisionLabelWithScore(hero.analysis.decision)}, zero vetoes, confirmed by ${eliteHero?.confirmingTimeframes.join(", ") ?? "another timeframe"}, genuine price-action + value-zone + volume confirmation, and a 1:${eliteHero?.rr} reward-to-risk.`}
              />
              <Faq
                q="What if the target fails?"
                a={`Stop loss is set at ₹${heroEntry.stop}. ${
                  heroEntry.targetsHit[0] ? `Since Target 1 was already reached, the trailing stop has moved up to ${heroEntry.targetsHit[1] ? `₹${heroEntry.targets[0]} (locking the Target 1–2 gain)` : `₹${heroEntry.entry} (breakeven)`}.` : "It hasn't reached Target 1 yet, so the original stop still applies."
                }`}
              />
              <Faq
                q="Can I enter now?"
                a={heroLive !== null ? `Current premium is ₹${heroLive} vs a recommended entry of ₹${heroEntry.entry} (${(((heroLive - heroEntry.entry) / heroEntry.entry) * 100).toFixed(1)}% away). Within ~2% is generally still a reasonable entry zone.` : "Live premium isn't available right now to compare against the recommended entry."}
              />
              <Faq q="Risk level?" a={`${rl.label}, based on a volatility score of ${avgVolatility}/100 across the scored timeframes.`} />
              <Faq q="Best exit?" a={`Next target is ₹${heroEntry.targetsHit[1] ? heroEntry.targets[2] : heroEntry.targetsHit[0] ? heroEntry.targets[1] : heroEntry.targets[0]}. Signal validity window: ${remainingMs !== null ? fmtCountdown(remainingMs) : "—"}.`} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Badge({ label, color, dot }: { label: string; color?: string; dot?: boolean }) {
  return (
    <span className="flex items-center gap-1.5 text-[9px] font-semibold px-2 py-1 rounded-full" style={{ background: "#181A24", border: "1px solid rgba(255,255,255,.08)" }}>
      {dot && <span className="w-1.5 h-1.5 rounded-full" style={{ background: color ?? "#00C2FF" }} />}
      <span style={{ color: color ?? "#9AA4B2" }}>{label}</span>
    </span>
  );
}

function GlassCard({ children, title, glow }: { children: React.ReactNode; title?: string; glow?: string }) {
  return (
    <section
      className="rounded-2xl p-4 backdrop-blur-xl"
      style={{
        background: "#181A24",
        border: `1px solid ${glow ? `${glow}44` : "rgba(255,255,255,.08)"}`,
        boxShadow: glow ? `0 0 24px ${glow}22` : undefined,
      }}
    >
      {title && <p className="text-xs font-bold uppercase text-[#9AA4B2] mb-3">{title}</p>}
      {children}
    </section>
  );
}

// The hero card only ever renders once findEliteSignal has already verified
// every one of these -- this checklist makes that verifiable at a glance
// rather than a claim the user has to take on faith.
function ConfluenceChip({ label, ok }: { label: string; ok: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[9px] font-bold"
      style={{ background: ok ? "#00E67622" : "#FF4D4F22", color: ok ? "#00E676" : "#FF4D4F" }}
    >
      {label}
    </span>
  );
}

function StatChip({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-xl px-2.5 py-2" style={{ background: "#12131C", border: "1px solid rgba(255,255,255,.06)" }}>
      <p className="text-[9px] text-[#9AA4B2]">{label}</p>
      <p className="text-xs font-bold" style={{ color: color ?? "#FFFFFF" }}>
        {value}
      </p>
    </div>
  );
}

function ScoreBar({ label, score }: { label: string; score: number }) {
  const color = score >= 65 ? "#00E676" : score >= 40 ? "#FFC107" : "#FF4D4F";
  return (
    <div>
      <div className="flex justify-between text-[10px] mb-1">
        <span className="text-[#9AA4B2]">{label}</span>
        <span className="font-bold" style={{ color }}>
          {Math.round(score)}
        </span>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,.06)" }}>
        <motion.div
          className="h-full rounded-full"
          style={{ background: color }}
          initial={{ width: 0 }}
          animate={{ width: `${Math.min(100, Math.max(0, score))}%` }}
          transition={{ duration: 0.6 }}
        />
      </div>
    </div>
  );
}

function ProgressTrack({ entry, stop, target, current }: { entry: number; stop: number; target: number; current: number }) {
  const span = target - stop;
  const pct = span !== 0 ? Math.min(100, Math.max(0, ((current - stop) / span) * 100)) : 50;
  const entryPct = span !== 0 ? Math.min(100, Math.max(0, ((entry - stop) / span) * 100)) : 50;
  return (
    <div className="relative h-2 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,.06)" }}>
      <motion.div
        className="h-full rounded-full"
        style={{ background: "linear-gradient(90deg,#FF4D4F,#FFC107,#00E676)" }}
        initial={{ width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.5 }}
      />
      <div className="absolute top-0 bottom-0 w-0.5 bg-white/60" style={{ left: `${entryPct}%` }} />
    </div>
  );
}

function IndicatorRow({ label, value, bullish, bearish }: { label: string; value: string | undefined; bullish?: boolean; bearish?: boolean }) {
  const signal = bullish ? "Bullish" : bearish ? "Bearish" : value !== undefined ? "Neutral" : "—";
  const color = bullish ? "#00E676" : bearish ? "#FF4D4F" : "#9AA4B2";
  return (
    <tr className="border-t" style={{ borderColor: "rgba(255,255,255,.06)" }}>
      <td className="py-1.5 font-semibold">{label}</td>
      <td className="py-1.5">{value ?? "—"}</td>
      <td className="py-1.5 font-bold" style={{ color }}>
        {signal}
      </td>
    </tr>
  );
}

function Faq({ q, a }: { q: string; a: string }) {
  return (
    <div>
      <p className="text-xs font-bold text-[#00C2FF]">{q}</p>
      <p className="text-[11px] text-[#9AA4B2] mt-0.5">{a}</p>
    </div>
  );
}
