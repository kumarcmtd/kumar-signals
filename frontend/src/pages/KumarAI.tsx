import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Cpu,
  Sparkles,
  RefreshCw,
  Zap,
  Copy,
  Download,
  Share2,
  Sun,
  Moon,
  ChevronDown,
  TrendingUp,
  TrendingDown,
  Minus,
  Clock,
  Target,
  ShieldAlert,
  Gauge,
  Radar,
  AlertTriangle,
} from "lucide-react";
import { useMarketStatus, usePortfolio, useOptionsAnalytics, useKumarAiAnalyze } from "../api/hooks";
import { computePortfolioSummary } from "../utils/portfolioStats";
import { liveLtpFor } from "../hooks/useTradeLog";
import { useKumarAISuite, KUMAR_AI_TIMEFRAMES, type KumarAiTimeframeSnapshot, type KumarAiTradableSymbol } from "../hooks/useKumarAISuite";
import type { TimeframeAnalysis } from "../utils/timeframeEngine";
import type { Direction, OptionsAnalytics, KumarAiAnalyzeRequest, KumarAiAnalyzeResult } from "../types";

const SYMBOLS: KumarAiTradableSymbol[] = ["NATURALGAS", "CRUDEOIL"];
const DISPLAY_NAME: Record<KumarAiTradableSymbol, string> = { CRUDEOIL: "Crude Oil", NATURALGAS: "Natural Gas" };
const SIGNAL_VALIDITY_MS = 20 * 60 * 1000;

// This page's own plain BUY/SELL/WAIT vocabulary -- deliberately separate
// from the "Very Strong Buy"/"Very Risky Buy" tier labels used on the other
// AI pages, per this page's own spec.
function decisionWord(bias: Direction): "BUY" | "SELL" | "WAIT" {
  return bias === "bullish" ? "BUY" : bias === "bearish" ? "SELL" : "WAIT";
}

function confidenceTier(pct: number | null): { label: string; color: string } {
  if (pct === null) return { label: "—", color: "#94A3B8" };
  if (pct >= 95) return { label: "Very Strong", color: "#16A34A" };
  if (pct >= 85) return { label: "Strong", color: "#22C55E" };
  if (pct >= 70) return { label: "Moderate", color: "#F59E0B" };
  return { label: "Weak", color: "#EF4444" };
}

interface PremiumProjection {
  strike: number;
  optSide: "CE" | "PE";
  entry: number;
  targets: [number, number, number];
  stop: number;
  rr: number | null;
}

// Same delta~=0.5 ATM premium projection every other AI page in this app
// already uses, kept as this page's own independent copy.
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

interface GeneratedSignal {
  strike: number;
  optSide: "CE" | "PE";
  entry: number;
  stop: number;
  targets: [number, number, number];
  rr: number | null;
  confidencePct: number | null;
  bias: Direction;
  generatedAt: number;
  expiresAt: number;
  ai?: KumarAiAnalyzeResult;
  aiLoading: boolean;
  aiError?: string;
}

function fmtCountdown(ms: number): string {
  if (ms <= 0) return "Expired";
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function tradeStatus(sig: GeneratedSignal, liveLtp: number | null, now: number): { label: string; color: string } {
  if (now > sig.expiresAt) return { label: "Expired", color: "#64748B" };
  if (liveLtp === null) return { label: "Active", color: "#F59E0B" };
  const bullish = sig.bias === "bullish";
  const slHit = bullish ? liveLtp <= sig.stop : liveLtp >= sig.stop;
  if (slHit) return { label: "Stop Loss Hit", color: "#EF4444" };
  const t3Hit = bullish ? liveLtp >= sig.targets[2] : liveLtp <= sig.targets[2];
  if (t3Hit) return { label: "Target 3 Hit", color: "#16A34A" };
  const t2Hit = bullish ? liveLtp >= sig.targets[1] : liveLtp <= sig.targets[1];
  if (t2Hit) return { label: "Target 2 Hit", color: "#22C55E" };
  const t1Hit = bullish ? liveLtp >= sig.targets[0] : liveLtp <= sig.targets[0];
  if (t1Hit) return { label: "Target 1 Hit", color: "#22C55E" };
  return { label: "Running", color: "#38BDF8" };
}

function formatSignalText(symbol: KumarAiTradableSymbol, snap: KumarAiTimeframeSnapshot, sig: GeneratedSignal): string {
  const tier = confidenceTier(sig.confidencePct);
  return [
    `Kumar AI Signal -- ${DISPLAY_NAME[symbol]} (${snap.label})`,
    `${decisionWord(sig.bias)} ${sig.strike} ${sig.optSide}`,
    `Entry: Rs.${sig.entry}  |  Stop Loss: Rs.${sig.stop}`,
    `Target 1: Rs.${sig.targets[0]}  |  Target 2: Rs.${sig.targets[1]}  |  Target 3: Rs.${sig.targets[2]}`,
    `Risk:Reward: 1:${sig.rr ?? "-"}  |  Confidence: ${sig.confidencePct ?? "-"}% (${tier.label})`,
    `Generated: ${new Date(sig.generatedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`,
    sig.ai?.reasoning ? `\nWhy: ${sig.ai.reasoning}` : "",
    "\nEducational reference only, not financial advice.",
  ]
    .filter(Boolean)
    .join("\n");
}

const DARK_VARS: Record<string, string> = {
  "--ka-bg": "linear-gradient(180deg,#07060C,#0D0B17 40%,#07060C)",
  "--ka-card": "rgba(255,255,255,0.05)",
  "--ka-card-strong": "rgba(255,255,255,0.08)",
  "--ka-border": "rgba(255,255,255,0.1)",
  "--ka-text": "#F1F5F9",
  "--ka-muted": "#94A3B8",
  "--ka-accent": "#22D3EE",
};
const LIGHT_VARS: Record<string, string> = {
  "--ka-bg": "linear-gradient(180deg,#F0F9FF,#FFFFFF 35%)",
  "--ka-card": "rgba(255,255,255,0.85)",
  "--ka-card-strong": "rgba(255,255,255,0.98)",
  "--ka-border": "rgba(15,23,42,0.08)",
  "--ka-text": "#0F172A",
  "--ka-muted": "#64748B",
  "--ka-accent": "#0891B2",
};

export function KumarAI() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [symbol, setSymbol] = useState<KumarAiTradableSymbol>("NATURALGAS");
  const [now, setNow] = useState(Date.now());
  const [signals, setSignals] = useState<Record<string, GeneratedSignal>>({});
  const [expandedTech, setExpandedTech] = useState<Set<string>>(new Set());
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [sharedKey, setSharedKey] = useState<string | null>(null);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const { data: market } = useMarketStatus();
  const { data: trades } = usePortfolio();
  const journalSummary = useMemo(() => computePortfolioSummary(trades ?? []), [trades]);

  const naturalGas = useKumarAISuite("NATURALGAS", journalSummary.winRate);
  const crudeOil = useKumarAISuite("CRUDEOIL", journalSummary.winRate);
  const board: Record<KumarAiTradableSymbol, ReturnType<typeof useKumarAISuite>> = { NATURALGAS: naturalGas, CRUDEOIL: crudeOil };
  const current = board[symbol];
  const { data: options } = useOptionsAnalytics(symbol);
  const aiMutation = useKumarAiAnalyze();

  const keyFor = (sym: KumarAiTradableSymbol, tf: string) => `${sym}-${tf}`;

  async function runAiReasoning(sym: KumarAiTradableSymbol, snap: KumarAiTimeframeSnapshot, sigOverride?: GeneratedSignal) {
    const key = keyFor(sym, snap.tf);
    const sig = sigOverride ?? signals[key];
    if (!sig) return;
    setSignals((prev) => ({ ...prev, [key]: { ...prev[key], aiLoading: true, aiError: undefined } }));
    const req: KumarAiAnalyzeRequest = {
      symbol: sym,
      timeframeLabel: snap.label,
      decision: decisionWord(sig.bias),
      bias: sig.bias,
      optSide: sig.optSide,
      entry: sig.entry,
      stop: sig.stop,
      targets: sig.targets,
      rr: sig.rr,
      confidencePct: sig.confidencePct,
      indicators: {
        ema9: snap.ema9,
        ema20: snap.ema20,
        ema50: snap.ema50,
        ema200: snap.ema200,
        rsi14: snap.rsi14,
        macd: snap.macd,
        vwap: snap.vwap,
        atr14: snap.atr14,
        adx14: snap.adx14,
        bollinger: snap.bollinger,
        superTrend: snap.superTrend,
        volumeRatio: snap.volumeRatio,
      },
      structureLabel: snap.structureLabel,
      patternLabel: snap.patternLabel,
      supportResistanceNote: snap.supportResistanceNote,
      reasons: snap.analysis.reasons,
    };
    try {
      const result = await aiMutation.mutateAsync(req);
      setSignals((prev) => (prev[key] ? { ...prev, [key]: { ...prev[key], ai: result, aiLoading: false, aiError: result.error } } : prev));
    } catch (err) {
      setSignals((prev) => (prev[key] ? { ...prev, [key]: { ...prev[key], aiLoading: false, aiError: err instanceof Error ? err.message : "AI reasoning failed" } } : prev));
    }
  }

  function generateSignal(sym: KumarAiTradableSymbol, snap: KumarAiTimeframeSnapshot, withAi: boolean) {
    const proj = projectPremium(snap.analysis, board[sym].options);
    if (!proj || snap.analysis.bias === "neutral") return;
    const key = keyFor(sym, snap.tf);
    const nowTs = Date.now();
    const sig: GeneratedSignal = {
      strike: proj.strike,
      optSide: proj.optSide,
      entry: proj.entry,
      stop: proj.stop,
      targets: proj.targets,
      rr: proj.rr,
      confidencePct: snap.analysis.hitProbability,
      bias: snap.analysis.bias,
      generatedAt: nowTs,
      expiresAt: nowTs + SIGNAL_VALIDITY_MS,
      aiLoading: false,
    };
    setSignals((prev) => ({ ...prev, [key]: sig }));
    if (withAi) void runAiReasoning(sym, snap, sig);
  }

  function analyzeMarket() {
    for (const snap of current.snapshots) {
      if (snap.analysis.bias !== "neutral") generateSignal(symbol, snap, true);
    }
  }

  function exportSignal(sym: KumarAiTradableSymbol, snap: KumarAiTimeframeSnapshot, sig: GeneratedSignal) {
    const text = formatSignalText(sym, snap, sig);
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `kumar-ai-${sym.toLowerCase()}-${snap.tf}m-${sig.generatedAt}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function shareSignal(key: string, text: string) {
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: "Kumar AI Signal", text });
        return;
      } catch {
        // user cancelled or share failed -- fall through to clipboard
      }
    }
    await navigator.clipboard.writeText(text);
    setSharedKey(key);
    setTimeout(() => setSharedKey(null), 2000);
  }

  // ---- Dashboard stats (scoped to the currently selected symbol) ----
  const validAnalyses = current.snapshots.filter((s) => s.analysis.overallScore !== null);
  const bullishCount = validAnalyses.filter((s) => s.analysis.bias === "bullish").length;
  const bearishCount = validAnalyses.filter((s) => s.analysis.bias === "bearish").length;
  const marketTrend: Direction = bullishCount > bearishCount ? "bullish" : bearishCount > bullishCount ? "bearish" : "neutral";
  const activeSignalKeys = KUMAR_AI_TIMEFRAMES.map(({ tf }) => keyFor(symbol, tf)).filter((k) => signals[k] && now <= signals[k].expiresAt);
  const activeSignals = activeSignalKeys.map((k) => signals[k]);
  const winningProbability = activeSignals.length
    ? Math.round(activeSignals.reduce((s, sig) => s + (sig.confidencePct ?? 0), 0) / activeSignals.length)
    : validAnalyses.length
      ? Math.round(validAnalyses.reduce((s, a) => s + (a.analysis.hitProbability ?? 50), 0) / validAnalyses.length)
      : null;
  const anyAiLoading = Object.values(signals).some((s) => s.aiLoading);

  const vars = theme === "dark" ? DARK_VARS : LIGHT_VARS;
  const isDark = theme === "dark";

  return (
    <div
      className="-mx-4 -mt-4 px-4 pt-4 pb-6 min-h-screen space-y-4 transition-colors"
      style={{ ...(vars as React.CSSProperties), background: "var(--ka-bg)", color: "var(--ka-text)" }}
    >
      {/* HEADER */}
      <section className="text-center pt-2 space-y-1.5 relative">
        <button
          onClick={() => setTheme(isDark ? "light" : "dark")}
          className="absolute right-0 top-2 p-2 rounded-full"
          style={{ background: "var(--ka-card)", border: "1px solid var(--ka-border)" }}
          title="Toggle light/dark theme"
        >
          {isDark ? <Sun size={15} /> : <Moon size={15} />}
        </button>
        <div className="flex items-center justify-center gap-2">
          <Cpu size={22} style={{ color: "var(--ka-accent)" }} />
          <h1 className="text-xl font-black tracking-tight bg-gradient-to-r from-cyan-400 via-blue-400 to-cyan-400 bg-clip-text text-transparent">Kumar AI</h1>
        </div>
        <p className="text-[11px] px-6" style={{ color: "var(--ka-muted)" }}>
          Advanced AI-powered MCX trading assistant — real technical analysis across 6 timeframes, with Cloudflare Workers AI (Llama 4 Scout) reasoning layered on top of numbers this app
          already computes. Every price level is deterministic; the AI explains, it never invents.
        </p>
        <p className="text-[10px] flex items-center justify-center gap-1" style={{ color: "var(--ka-muted)" }}>
          <span className={`w-1.5 h-1.5 rounded-full ${market?.isOpen ? "bg-emerald-500" : "bg-rose-500"}`} />
          {market ? (market.isOpen ? "Market Open" : "Market Closed") : "…"}
        </p>
      </section>

      {/* DASHBOARD CARDS */}
      <section className="grid grid-cols-2 gap-2.5">
        <DashCard label="Market Trend" value={marketTrend === "bullish" ? "Bullish" : marketTrend === "bearish" ? "Bearish" : "Neutral"} icon={marketTrend === "bullish" ? TrendingUp : marketTrend === "bearish" ? TrendingDown : Minus} color={marketTrend === "bullish" ? "#22C55E" : marketTrend === "bearish" ? "#EF4444" : "#94A3B8"} />
        <DashCard label="AI Status" value={anyAiLoading ? "Analyzing…" : "Ready"} icon={Sparkles} color={anyAiLoading ? "#F59E0B" : "#22D3EE"} pulse={anyAiLoading} />
        <DashCard label="Active Signals" value={String(activeSignals.length)} icon={Radar} color="#38BDF8" />
        <DashCard label="Winning Probability" value={winningProbability !== null ? `${winningProbability}%` : "—"} icon={Gauge} color="#A78BFA" />
        <DashCard label="Buy Signals" value={String(bullishCount)} icon={TrendingUp} color="#22C55E" />
        <DashCard label="Sell Signals" value={String(bearishCount)} icon={TrendingDown} color="#EF4444" />
        <DashCard label="Live Price" value={options && !options.error && options.spot ? `₹${options.spot}` : "—"} icon={Zap} color="#FBBF24" />
        <DashCard label="Last Updated" value={current.dataUpdatedAt > 0 ? new Date(current.dataUpdatedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—"} icon={Clock} color="var(--ka-muted)" />
      </section>

      {/* SYMBOL SELECTOR */}
      <div className="flex gap-2">
        {SYMBOLS.map((sym) => (
          <button
            key={sym}
            onClick={() => setSymbol(sym)}
            className="flex-1 rounded-2xl py-2.5 text-sm font-bold border transition-all"
            style={
              symbol === sym
                ? { background: "var(--ka-accent)", color: isDark ? "#07060C" : "#FFFFFF", borderColor: "var(--ka-accent)" }
                : { background: "var(--ka-card)", borderColor: "var(--ka-border)", color: "var(--ka-muted)" }
            }
          >
            {DISPLAY_NAME[sym]}
          </button>
        ))}
      </div>

      {/* ACTION BUTTONS */}
      <div className="grid grid-cols-3 gap-2">
        <ActionButton icon={Zap} label="Analyze Market" onClick={analyzeMarket} accent="var(--ka-accent)" isDark={isDark} />
        <ActionButton icon={RefreshCw} label="Refresh Analysis" onClick={() => current.refetchAll()} spinning={current.isFetching} isDark={isDark} />
        <ActionButton icon={Sparkles} label="Generate AI Signal" onClick={() => current.snapshots.forEach((s) => generateSignal(symbol, s, true))} accent="#A78BFA" isDark={isDark} />
      </div>

      {current.liveDataUnavailable && (
        <div className="rounded-2xl p-4 text-center" style={{ background: "var(--ka-card)", border: "1px solid rgba(239,68,68,0.3)" }}>
          <p className="text-sm font-bold flex items-center justify-center gap-1.5" style={{ color: "#EF4444" }}>
            <AlertTriangle size={14} /> Live data unavailable
          </p>
          <p className="text-xs mt-1" style={{ color: "var(--ka-muted)" }}>
            {current.errorMessage ?? "Option chain unreachable"} — no entry, target, stop loss, or confidence is fabricated while this is down.
          </p>
        </div>
      )}

      {/* PER-TIMEFRAME SIGNAL CARDS */}
      <div className="space-y-3">
        {current.snapshots.map((snap) => {
          const key = keyFor(symbol, snap.tf);
          const sig = signals[key];
          const liveLtp = sig ? liveLtpFor(current.options, sig.strike, sig.optSide) : null;
          const status = sig ? tradeStatus(sig, liveLtp, now) : null;
          const tier = confidenceTier(sig?.confidencePct ?? snap.analysis.hitProbability);
          const techOpen = expandedTech.has(key);
          const word = decisionWord(snap.analysis.bias);
          const wordColor = word === "BUY" ? "#22C55E" : word === "SELL" ? "#EF4444" : "#94A3B8";

          return (
            <section key={snap.tf} className="rounded-2xl overflow-hidden backdrop-blur-xl" style={{ background: "var(--ka-card)", border: "1px solid var(--ka-border)" }}>
              <div className="px-4 py-3 flex items-center justify-between border-b" style={{ borderColor: "var(--ka-border)" }}>
                <p className="text-sm font-bold">{snap.label}</p>
                {snap.analysis.insufficient ? (
                  <span className="text-[10px] font-bold" style={{ color: "var(--ka-muted)" }}>
                    NO DATA
                  </span>
                ) : (
                  <span className="text-[11px] font-black px-2.5 py-1 rounded-full text-white flex items-center gap-1" style={{ background: wordColor }}>
                    {word} {sig ? `${sig.strike} ${sig.optSide}` : snap.analysis.optSide ?? ""}
                  </span>
                )}
              </div>

              {snap.analysis.insufficient ? (
                <p className="text-xs text-center py-4 px-4" style={{ color: "var(--ka-muted)" }}>
                  {snap.analysis.insufficient}
                </p>
              ) : (
                <div className="p-4 space-y-3">
                  {/* Confidence meter */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] font-bold uppercase" style={{ color: "var(--ka-muted)" }}>
                        Confidence
                      </span>
                      <span className="text-xs font-black" style={{ color: tier.color }}>
                        {sig?.confidencePct ?? snap.analysis.hitProbability ?? "—"}% · {tier.label}
                      </span>
                    </div>
                    <div className="h-2 rounded-full overflow-hidden" style={{ background: "var(--ka-border)" }}>
                      <motion.div
                        className="h-full rounded-full"
                        style={{ background: tier.color }}
                        initial={{ width: 0 }}
                        animate={{ width: `${sig?.confidencePct ?? snap.analysis.hitProbability ?? 0}%` }}
                        transition={{ duration: 0.7, ease: "easeOut" }}
                      />
                    </div>
                  </div>

                  {/* Trade fields */}
                  <div className="grid grid-cols-3 gap-2">
                    <Stat label="Entry" value={sig ? `₹${sig.entry}` : "—"} />
                    <Stat label="Current" value={liveLtp !== null ? `₹${liveLtp}` : "—"} />
                    <Stat label="Stop Loss" value={sig ? `₹${sig.stop}` : "—"} color="#EF4444" />
                    <Stat label="Target 1" value={sig ? `₹${sig.targets[0]}` : "—"} color="#22C55E" />
                    <Stat label="Target 2" value={sig ? `₹${sig.targets[1]}` : "—"} color="#22C55E" />
                    <Stat label="Target 3" value={sig ? `₹${sig.targets[2]}` : "—"} color="#22C55E" />
                    <Stat label="Risk:Reward" value={sig?.rr !== null && sig?.rr !== undefined ? `1:${sig.rr}` : "—"} />
                    <Stat label="Trend Direction" value={snap.analysis.bias === "bullish" ? "Bullish" : snap.analysis.bias === "bearish" ? "Bearish" : "Neutral"} color={wordColor} />
                    <Stat label="Trade Status" value={status?.label ?? "Not Generated"} color={status?.color} />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Stat label="Time Generated" value={sig ? new Date(sig.generatedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "—"} />
                    <Stat label="Signal Expiry" value={sig ? fmtCountdown(sig.expiresAt - now) : "—"} />
                  </div>

                  {/* Card actions */}
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => generateSignal(symbol, snap, true)}
                      className="py-2 rounded-xl text-xs font-bold text-white flex items-center justify-center gap-1.5"
                      style={{ background: "var(--ka-accent)" }}
                    >
                      <Sparkles size={13} /> {sig ? "Regenerate" : "Generate AI Signal"}
                    </button>
                    <button
                      onClick={() =>
                        setExpandedTech((prev) => {
                          const n = new Set(prev);
                          if (n.has(key)) n.delete(key);
                          else n.add(key);
                          return n;
                        })
                      }
                      className="py-2 rounded-xl text-xs font-bold border flex items-center justify-center gap-1.5"
                      style={{ borderColor: "var(--ka-border)", color: "var(--ka-text)" }}
                    >
                      Technical Analysis <ChevronDown size={13} className={`transition-transform ${techOpen ? "rotate-180" : ""}`} />
                    </button>
                  </div>

                  {sig && (
                    <div className="grid grid-cols-3 gap-2">
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(formatSignalText(symbol, snap, sig));
                          setCopiedKey(key);
                          setTimeout(() => setCopiedKey(null), 2000);
                        }}
                        className="py-1.5 rounded-lg text-[10px] font-bold border flex items-center justify-center gap-1"
                        style={{ borderColor: "var(--ka-border)", color: "var(--ka-text)" }}
                      >
                        <Copy size={11} /> {copiedKey === key ? "Copied ✓" : "Copy"}
                      </button>
                      <button onClick={() => exportSignal(symbol, snap, sig)} className="py-1.5 rounded-lg text-[10px] font-bold border flex items-center justify-center gap-1" style={{ borderColor: "var(--ka-border)", color: "var(--ka-text)" }}>
                        <Download size={11} /> Export
                      </button>
                      <button
                        onClick={() => shareSignal(key, formatSignalText(symbol, snap, sig))}
                        className="py-1.5 rounded-lg text-[10px] font-bold border flex items-center justify-center gap-1"
                        style={{ borderColor: "var(--ka-border)", color: "var(--ka-text)" }}
                      >
                        <Share2 size={11} /> {sharedKey === key ? "Shared ✓" : "Share"}
                      </button>
                    </div>
                  )}

                  {/* Technical analysis grid (collapsible) */}
                  <AnimatePresence>
                    {techOpen && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                        <div className="rounded-xl p-3 space-y-2" style={{ background: "var(--ka-card-strong)", border: "1px solid var(--ka-border)" }}>
                          <div className="grid grid-cols-3 gap-2">
                            <Stat label="EMA 9" value={snap.ema9?.toFixed(2) ?? "—"} />
                            <Stat label="EMA 20" value={snap.ema20?.toFixed(2) ?? "—"} />
                            <Stat label="EMA 50" value={snap.ema50?.toFixed(2) ?? "—"} />
                            <Stat label="EMA 200" value={snap.ema200?.toFixed(2) ?? "—"} />
                            <Stat label="RSI (14)" value={snap.rsi14?.toFixed(1) ?? "—"} />
                            <Stat label="ADX (14)" value={snap.adx14?.toFixed(1) ?? "—"} />
                            <Stat label="ATR (14)" value={snap.atr14?.toFixed(2) ?? "—"} />
                            <Stat label="VWAP" value={snap.vwap?.toFixed(2) ?? "—"} />
                            <Stat label="Volume vs Avg" value={snap.volumeRatio !== null ? `${snap.volumeRatio}x` : "—"} />
                            <Stat label="MACD Line" value={snap.macd?.line.toFixed(3) ?? "—"} />
                            <Stat label="MACD Signal" value={snap.macd?.signal.toFixed(3) ?? "—"} />
                            <Stat label="MACD Hist" value={snap.macd?.histogram.toFixed(3) ?? "—"} color={snap.macd && snap.macd.histogram > 0 ? "#22C55E" : snap.macd && snap.macd.histogram < 0 ? "#EF4444" : undefined} />
                            <Stat label="Bollinger Upper" value={snap.bollinger?.upper.toFixed(2) ?? "—"} />
                            <Stat label="Bollinger Mid" value={snap.bollinger?.middle.toFixed(2) ?? "—"} />
                            <Stat label="Bollinger Lower" value={snap.bollinger?.lower.toFixed(2) ?? "—"} />
                            <Stat
                              label="SuperTrend"
                              value={snap.superTrend ? snap.superTrend.value.toFixed(2) : "—"}
                              color={snap.superTrend?.direction === "bullish" ? "#22C55E" : snap.superTrend?.direction === "bearish" ? "#EF4444" : undefined}
                            />
                            <Stat label="Momentum" value={snap.analysis.categories ? `${snap.analysis.categories.momentum.score}/100` : "—"} />
                            <Stat label="Volatility" value={snap.analysis.categories ? `${snap.analysis.categories.volatility.score}/100` : "—"} />
                          </div>
                          <div className="pt-2 border-t space-y-1" style={{ borderColor: "var(--ka-border)" }}>
                            <p className="text-[11px]">
                              <span className="font-bold">Structure:</span> {snap.structureLabel ?? "—"}
                              {snap.changeOfCharacter ? " (change of character)" : ""}
                            </p>
                            <p className="text-[11px]">
                              <span className="font-bold">Breakout:</span>{" "}
                              {snap.breakout ? `Confirmed (${snap.breakoutDirection})` : "None detected"}
                            </p>
                            <p className="text-[11px]">
                              <span className="font-bold">Price Action Pattern:</span> {snap.patternLabel ? snap.patternLabel.replace(/_/g, " ") : "None detected"}
                            </p>
                            {snap.supportResistanceNote && (
                              <p className="text-[11px]">
                                <span className="font-bold">Support/Resistance:</span> {snap.supportResistanceNote}
                              </p>
                            )}
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* AI reasoning panel */}
                  {sig && (
                    <div className="rounded-xl p-3 space-y-2" style={{ background: "var(--ka-card-strong)", border: `1px solid ${sig.aiError ? "rgba(239,68,68,0.3)" : "var(--ka-border)"}` }}>
                      <p className="text-[10px] font-bold uppercase flex items-center gap-1.5" style={{ color: "var(--ka-accent)" }}>
                        <Sparkles size={12} /> AI Reasoning (Llama 4 Scout)
                      </p>
                      {sig.aiLoading ? (
                        <p className="text-xs" style={{ color: "var(--ka-muted)" }}>
                          Analyzing market conditions…
                        </p>
                      ) : sig.aiError ? (
                        <p className="text-xs flex items-center gap-1.5" style={{ color: "#EF4444" }}>
                          <ShieldAlert size={12} /> {sig.aiError}
                        </p>
                      ) : sig.ai ? (
                        <div className="space-y-2 text-xs" style={{ color: "var(--ka-text)" }}>
                          <p>{sig.ai.reasoning}</p>
                          {sig.ai.bullishReasons.length > 0 && (
                            <ReasonList label="Bullish reasons" items={sig.ai.bullishReasons} color="#22C55E" />
                          )}
                          {sig.ai.bearishReasons.length > 0 && (
                            <ReasonList label="Bearish reasons" items={sig.ai.bearishReasons} color="#EF4444" />
                          )}
                          {sig.ai.riskFactors.length > 0 && <ReasonList label="Risk factors" items={sig.ai.riskFactors} color="#F59E0B" />}
                          {sig.ai.expectedMovement && (
                            <p>
                              <span className="font-bold">Expected movement:</span> {sig.ai.expectedMovement}
                            </p>
                          )}
                          {sig.ai.holdingDuration && (
                            <p className="flex items-center gap-1.5">
                              <Clock size={11} /> <span className="font-bold">Suggested holding:</span> {sig.ai.holdingDuration}
                            </p>
                          )}
                          {sig.ai.bestTimeframeNote && (
                            <p>
                              <span className="font-bold">Best timeframe:</span> {sig.ai.bestTimeframeNote}
                            </p>
                          )}
                        </div>
                      ) : (
                        <p className="text-xs" style={{ color: "var(--ka-muted)" }}>
                          Tap "Generate AI Signal" to get the AI's reasoning for this call.
                        </p>
                      )}
                    </div>
                  )}

                  {snap.analysis.reasons.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-[10px] font-bold uppercase" style={{ color: "var(--ka-muted)" }}>
                        Technical Factors
                      </p>
                      {snap.analysis.reasons.slice(0, 5).map((r, i) => (
                        <p key={i} className="text-[11px] flex items-start gap-1.5" style={{ color: "var(--ka-muted)" }}>
                          <Target size={11} className="shrink-0 mt-0.5" style={{ color: "var(--ka-accent)" }} /> {r}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>

      <p className="text-[10px] leading-relaxed text-center px-4 pb-2" style={{ color: "var(--ka-muted)" }}>
        Educational reference only, not financial advice. Entry/stop/target/confidence numbers are always computed deterministically from real live data — Workers AI only explains them, it
        never invents or overrides a price level. Signals are independent per browser session and aren't shared with any other page on this site.
      </p>
    </div>
  );
}

function DashCard({ label, value, icon: Icon, color, pulse }: { label: string; value: string; icon: typeof TrendingUp; color: string; pulse?: boolean }) {
  return (
    <div className="rounded-xl p-3" style={{ background: "var(--ka-card)", border: "1px solid var(--ka-border)" }}>
      <p className="text-[9px] uppercase font-bold flex items-center gap-1" style={{ color: "var(--ka-muted)" }}>
        <Icon size={11} className={pulse ? "animate-pulse" : ""} style={{ color }} /> {label}
      </p>
      <p className="text-sm font-black mt-0.5" style={{ color }}>
        {value}
      </p>
    </div>
  );
}

function ActionButton({
  icon: Icon,
  label,
  onClick,
  accent,
  spinning,
  isDark,
}: {
  icon: typeof Zap;
  label: string;
  onClick: () => void;
  accent?: string;
  spinning?: boolean;
  isDark: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className="rounded-xl py-2.5 text-[10px] font-bold flex flex-col items-center justify-center gap-1 border transition-transform active:scale-95"
      style={accent ? { background: accent, color: isDark ? "#07060C" : "#FFFFFF", borderColor: accent } : { background: "var(--ka-card)", borderColor: "var(--ka-border)", color: "var(--ka-text)" }}
    >
      <Icon size={15} className={spinning ? "animate-spin" : ""} />
      {label}
    </button>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-lg px-2.5 py-2" style={{ background: "var(--ka-card-strong)", border: "1px solid var(--ka-border)" }}>
      <p className="text-[9px]" style={{ color: "var(--ka-muted)" }}>
        {label}
      </p>
      <p className="text-xs font-bold" style={{ color: color ?? "var(--ka-text)" }}>
        {value}
      </p>
    </div>
  );
}

function ReasonList({ label, items, color }: { label: string; items: string[]; color: string }) {
  return (
    <div>
      <p className="font-bold text-[11px]" style={{ color }}>
        {label}
      </p>
      {items.map((item, i) => (
        <p key={i} className="text-[11px] pl-2" style={{ color: "var(--ka-text)" }}>
          • {item}
        </p>
      ))}
    </div>
  );
}
