import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles,
  Radio,
  Zap,
  CheckCircle2,
  XCircle,
  Clock,
  TrendingUp,
  TrendingDown,
  Minus,
} from "lucide-react";
import { useCandles, useOptionsAnalytics, usePortfolio, useCreateTrade, useUpdateTrade, useMarketStatus, usePrices } from "../api/hooks";
import { useSymbolMasterAI } from "../hooks/useSymbolMasterAI";
import { useAppStore } from "../store/appStore";
import { computeMasterAI } from "../utils/masterEngine";
import { computeIndicatorSnapshot, centralPivotRange } from "../utils/indicators";
import { computePortfolioSummary } from "../utils/portfolioStats";
import { ConfidenceRing } from "../components/ConfidenceRing";
import { TradingViewWidget } from "../components/TradingViewWidget";
import type { Direction, PortfolioTrade } from "../types";

type TradableSymbol = "CRUDEOIL" | "NATURALGAS";
const SYMBOLS: TradableSymbol[] = ["CRUDEOIL", "NATURALGAS"];
const DISPLAY_NAME: Record<TradableSymbol, string> = { CRUDEOIL: "CRUDE OIL", NATURALGAS: "NATURAL GAS" };
const TV_SYMBOL: Record<TradableSymbol, string> = { CRUDEOIL: "MCX:CRUDEOIL1!", NATURALGAS: "MCX:NATURALGAS1!" };
const LOT_SIZE: Record<TradableSymbol, number> = { CRUDEOIL: 100, NATURALGAS: 1250 };
const SIGNAL_VALIDITY_MS = 20 * 60 * 1000;

function fmtCountdown(ms: number): string {
  if (ms <= 0) return "Expired";
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}m ${(s % 60).toString().padStart(2, "0")}s`;
}

function riskLevel(riskScore: number): { label: string; color: string } {
  if (riskScore <= 30) return { label: "Low Risk", color: "text-[#00E676]" };
  if (riskScore <= 60) return { label: "Medium Risk", color: "text-amber-400" };
  return { label: "High Risk", color: "text-[#FF5252]" };
}

function playBeep() {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.4);
  } catch {
    // Web Audio unsupported/blocked -- silently skip, the visual toast still shows.
  }
}

// Honest, computed-from-real-data readout of trend+momentum agreement per
// timeframe. Deliberately NOT a calibrated "probability price rises in the
// next N minutes" -- this app has no trained forecasting model, so it never
// claims to predict one. It reflects how strongly each timeframe's own
// trend/momentum agrees with the overall bias right now.
function horizonScore(snap: ReturnType<typeof computeIndicatorSnapshot>, bias: Direction): number {
  if (bias === "neutral" || snap.trendDirection === "neutral") return 50;
  const agree = snap.trendDirection === bias;
  const momentumMag = snap.momentumScore !== null ? Math.min(Math.abs(snap.momentumScore), 100) : 30;
  const base = agree ? 55 + momentumMag * 0.4 : 45 - momentumMag * 0.3;
  return Math.round(Math.max(5, Math.min(95, base)));
}

export function AI3V() {
  const [symbol, setSymbol] = useState<TradableSymbol>("NATURALGAS");
  const [now, setNow] = useState(() => Date.now());
  const [generatedAt, setGeneratedAt] = useState<Date | null>(null);
  const [logged, setLogged] = useState(false);
  const [closingTradeId, setClosingTradeId] = useState<string | null>(null);
  const [exitPriceInput, setExitPriceInput] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const prevDecisionRef = useRef<string | null>(null);
  const mountedRef = useRef(false);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const { data: market } = useMarketStatus();
  const { data: prices } = usePrices();
  const { data: trades } = usePortfolio();
  const createTrade = useCreateTrade();
  const updateTrade = useUpdateTrade();
  const { risk } = useAppStore();

  const crudeOil = useSymbolMasterAI("CRUDEOIL");
  const naturalGas = useSymbolMasterAI("NATURALGAS");
  const board = { CRUDEOIL: crudeOil, NATURALGAS: naturalGas } as const;
  const current = board[symbol];
  const { result, loading, liveDataUnavailable, options, signal } = current;

  // Raw per-timeframe candles for the honest timeframe-confluence readout
  // (separate fetch from useSymbolMasterAI, which only exposes the final
  // combined result -- React Query dedupes these against the same queries).
  const c5 = useCandles(symbol, "5");
  const c15 = useCandles(symbol, "15");
  const c30 = useCandles(symbol, "30");
  const c1D = useCandles(symbol, "1D");
  const optionsAnalytics = useOptionsAnalytics(symbol);
  void optionsAnalytics; // already covered by `options` from the shared hook; kept for clarity of intent

  const actionable = !!result && result.bias !== "neutral" && result.overallScore > 90 && result.entry !== null && result.strike !== undefined;

  useEffect(() => {
    if (result) setGeneratedAt(new Date());
    setLogged(false);
  }, [result?.decision, result?.strike, result?.overallScore]);

  useEffect(() => {
    const decisionKey = result ? `${symbol}-${result.decision}-${result.strike ?? ""}` : null;
    // Skip the very first run (page load / symbol switch landing on data that's
    // already there) -- a notification should mean "this just changed", not
    // "this happened to be true when the page opened".
    if (!mountedRef.current) {
      mountedRef.current = true;
      prevDecisionRef.current = decisionKey;
      return;
    }
    if (decisionKey && actionable && decisionKey !== prevDecisionRef.current) {
      setToast(`New signal: ${DISPLAY_NAME[symbol]} ${result!.strike} ${result!.optSide} — ${result!.decision}`);
      playBeep();
      const t = setTimeout(() => setToast(null), 6000);
      prevDecisionRef.current = decisionKey;
      return () => clearTimeout(t);
    }
    prevDecisionRef.current = decisionKey;
  }, [result?.decision, result?.strike, actionable, symbol]);

  const currentPremium = actionable ? result!.entry! : null;
  const recommendedBuyPrice = currentPremium !== null ? Number((currentPremium * 1.012).toFixed(2)) : null;
  const lotSize = LOT_SIZE[symbol];
  const riskAmount = (risk.capital * risk.riskPercent) / 100;
  const perUnitRisk = actionable && result!.stop !== null ? Math.abs(result!.entry! - result!.stop) : null;
  const quantity = perUnitRisk && perUnitRisk > 0 ? Math.max(1, Math.floor(riskAmount / perUnitRisk / lotSize)) : null;
  const capitalRequired = quantity !== null && recommendedBuyPrice !== null ? recommendedBuyPrice * lotSize * quantity : null;
  const expectedProfit = actionable && quantity !== null ? Number(((result!.target1! - result!.entry!) * quantity * lotSize).toFixed(0)) : null;
  const maxLoss = actionable && quantity !== null ? Number(((result!.entry! - result!.stop!) * quantity * lotSize).toFixed(0)) : null;
  const rl = result ? riskLevel(result.riskScore) : null;

  const validUntil = generatedAt ? generatedAt.getTime() + SIGNAL_VALIDITY_MS : null;
  const remainingMs = validUntil !== null ? validUntil - now : null;

  const optionRow = actionable ? options?.rows.find((r) => r.strike === result!.strike) : undefined;
  const optionLeg = optionRow ? (result!.optSide === "CE" ? optionRow.call : optionRow.put) : undefined;

  const priceCard = prices?.find((p) => p.symbol === symbol);
  const otherSymbol = symbol === "CRUDEOIL" ? "NATURALGAS" : "CRUDEOIL";
  const otherPriceCard = prices?.find((p) => p.symbol === otherSymbol);

  const timeframeReadout = useMemo(() => {
    if (!result || result.bias === "neutral") return [];
    const rows: { label: string; score: number; direction: Direction }[] = [];
    const defs: [string, ReturnType<typeof useCandles>][] = [
      ["Short-term (5m)", c5],
      ["Near-term (15m)", c15],
      ["Medium-term (30m)", c30],
      ["Session (Daily)", c1D],
    ];
    for (const [label, q] of defs) {
      if (!q.data || !q.data.candles || q.data.candles.length < 30) continue;
      const snap = computeIndicatorSnapshot(q.data.candles);
      rows.push({ label, score: horizonScore(snap, result.bias), direction: snap.trendDirection });
    }
    return rows;
  }, [result, c5.data, c15.data, c30.data, c1D.data]);

  // `.data` can be a truthy object with no `candles` field -- the backend
  // returns HTTP 200 with just `{ error }` when there isn't enough data yet
  // for a timeframe (e.g. "market may be closed"), so every access below
  // guards `.candles` itself, not just `.data`.
  const c15Candles = c15.data?.candles;
  const c15Snap = c15Candles && c15Candles.length > 0 ? computeIndicatorSnapshot(c15Candles) : null;
  const c1DCandles = c1D.data?.candles;

  const cpr = c1DCandles && c1DCandles.length >= 2 ? centralPivotRange(c1DCandles[c1DCandles.length - 2]) : null;
  const oiChange =
    c15Candles && c15Candles.length >= 2 ? (c15Candles[c15Candles.length - 1].oi ?? 0) - (c15Candles[c15Candles.length - 2].oi ?? 0) : null;

  const openTradeForSymbol = (trades ?? []).find((t) => t.symbol === symbol && t.status === "OPEN");
  const journalSummary = useMemo(() => computePortfolioSummary(trades ?? []), [trades]);
  const perfBuckets = useMemo(() => computePerfBuckets(trades ?? []), [trades]);

  return (
    <div className="-mx-4 -mt-4 px-4 pt-4 pb-6 bg-gradient-to-b from-[#05070A] via-[#0B0F17] to-[#0B0F17] text-white min-h-screen space-y-5">
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed top-3 left-3 right-3 z-50 max-w-lg mx-auto rounded-2xl bg-gradient-to-r from-emerald-600 to-emerald-500 text-white px-4 py-3 shadow-2xl flex items-center gap-2 text-sm font-semibold"
          >
            <Zap size={16} /> {toast}
          </motion.div>
        )}
      </AnimatePresence>

      {/* HERO */}
      <section className="text-center pt-2 space-y-3">
        <div className="flex justify-center">
          <motion.div
            animate={{ boxShadow: ["0 0 20px 4px rgba(0,230,118,0.25)", "0 0 40px 12px rgba(0,230,118,0.45)", "0 0 20px 4px rgba(0,230,118,0.25)"] }}
            transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
            className="h-16 w-16 rounded-full bg-gradient-to-br from-emerald-400 to-sky-500 flex items-center justify-center"
          >
            <Sparkles size={28} className="text-white" />
          </motion.div>
        </div>
        <h1 className="text-2xl font-black tracking-tight bg-gradient-to-r from-emerald-300 via-sky-300 to-emerald-300 bg-clip-text text-transparent">
          AI 3V Commodity Intelligence
        </h1>
        <p className="text-xs text-white/60 px-4 leading-relaxed">
          Professional AI-powered Natural Gas &amp; Crude Oil options trading system
        </p>
        <div className="flex flex-wrap justify-center gap-1.5">
          {["Live MCX Data", "AI Prediction Engine", "Institutional Analysis", "Real-Time Signals"].map((b) => (
            <span key={b} className="text-[10px] font-semibold px-2.5 py-1 rounded-full bg-white/5 border border-white/10 flex items-center gap-1">
              <CheckCircle2 size={11} className="text-[#00E676]" /> {b}
            </span>
          ))}
        </div>
        <div className="flex items-center justify-center gap-3 text-[11px] text-white/50">
          <span>{new Date(now).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "medium" })}</span>
          <span className={`flex items-center gap-1 font-bold ${market?.isOpen ? "text-[#00E676]" : "text-[#FF5252]"}`}>
            <Radio size={12} /> {market ? (market.isOpen ? "MCX OPEN" : "MCX CLOSED") : "…"}
          </span>
        </div>
      </section>

      {/* LIVE MARKET OVERVIEW */}
      <section className="grid grid-cols-2 gap-3">
        {SYMBOLS.map((sym) => {
          const pc = sym === symbol ? priceCard : otherPriceCard;
          const up = (pc?.change ?? 0) >= 0;
          return (
            <button
              key={sym}
              onClick={() => setSymbol(sym)}
              className={`rounded-2xl p-3.5 text-left border backdrop-blur-xl transition-all ${
                symbol === sym ? "bg-white/10 border-emerald-400/40" : "bg-white/5 border-white/10"
              }`}
            >
              <p className="text-[10px] text-white/50 font-semibold uppercase">{DISPLAY_NAME[sym]}</p>
              <p className="text-lg font-black mt-0.5">{pc ? `₹${pc.ltp}` : "—"}</p>
              {pc && (
                <p className={`text-[11px] font-bold flex items-center gap-1 ${up ? "text-[#00E676]" : "text-[#FF5252]"}`}>
                  {up ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                  {up ? "+" : ""}
                  {pc.change} ({up ? "+" : ""}
                  {pc.changePercent}%)
                </p>
              )}
            </button>
          );
        })}
        <GlassStat
          label="Volatility Index (ATR-based)"
          value={result ? `${result.meters.volatility.score}` : "—"}
          sub={result ? (result.meters.volatility.score >= 65 ? "Expanding" : result.meters.volatility.score <= 40 ? "Compressing" : "Normal") : ""}
        />
        <GlassStat
          label="Market Mood"
          value={result ? (result.bias === "bullish" ? "Bullish" : result.bias === "bearish" ? "Bearish" : "Neutral") : "—"}
          sub={result?.sentiment}
          tone={result?.bias}
        />
      </section>

      {loading && <div className="rounded-2xl bg-white/5 border border-white/10 h-40 animate-pulse" />}

      {!loading && liveDataUnavailable && (
        <div className="rounded-2xl bg-white/5 border border-amber-400/30 p-5 text-center space-y-1.5">
          <p className="text-sm font-bold text-amber-300">Signal generation unavailable</p>
          <p className="text-xs text-white/50">
            Live option market data isn't connected right now ({signal?.error || options?.error || "option chain unreachable"}). Nothing is
            fabricated — check back once the feed is live.
          </p>
        </div>
      )}

      {!loading && !liveDataUnavailable && result && (
        <>
          {/* AI SIGNAL CARD */}
          <section className="rounded-2xl bg-white/[0.06] backdrop-blur-xl border border-white/10 overflow-hidden shadow-2xl">
            <div className="p-5 flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] text-white/50 font-semibold uppercase">{DISPLAY_NAME[symbol]}</p>
                <p className="text-xl font-black mt-0.5">{actionable ? `${result.strike} ${result.optSide}` : "No strike selected"}</p>
                <p className={`text-sm font-bold mt-1.5 ${actionable ? (result.bias === "bullish" ? "text-[#00E676]" : "text-[#FF5252]") : "text-white/40"}`}>
                  {actionable ? `${result.bias === "bullish" ? "🟢 BUY" : "🔴 SELL"} ${DISPLAY_NAME[symbol]} ${result.optSide}` : "⚪ NO TRADE"}
                </p>
                {actionable && signal && <p className="text-[11px] text-white/40 mt-1">Expiry: {formatExpiry(signal.expiry)}</p>}
              </div>
              <ConfidenceRing score={result.overallScore} size={88} />
            </div>

            {actionable && (
              <div className="px-5 pb-5 grid grid-cols-2 gap-2.5">
                <DarkField label="Entry Price" value={`₹${currentPremium}`} />
                <DarkField label="Target 1" value={`₹${result.target1}`} tone="up" />
                <DarkField label="Target 2" value={`₹${result.target2}`} tone="up" />
                <DarkField label="Target 3" value={`₹${result.target3}`} tone="up" />
                <DarkField label="Stop Loss" value={`₹${result.stop}`} tone="down" />
                <DarkField label="Risk Reward" value={result.rr !== null ? `1:${result.rr}` : "—"} />
                <DarkField label="Expected Holding Time" value={result.expectedHoldingTime} span />
                <DarkField label="Probability of Success" value={result.expectedProbability !== null ? `${result.expectedProbability}%` : "—"} />
                <DarkField label="Expected Profit" value={expectedProfit !== null ? `₹${expectedProfit}` : "—"} tone="up" />
                <DarkField label="Expected Loss" value={maxLoss !== null ? `₹${maxLoss}` : "—"} tone="down" />
                <DarkField label="Signal Generated" value={generatedAt ? generatedAt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "—"} />
                <DarkField label="Signal Expiry" value={remainingMs !== null ? fmtCountdown(remainingMs) : "—"} />
                <DarkField label="Capital Required" value={capitalRequired !== null ? `₹${capitalRequired.toFixed(0)}` : "—"} span />
              </div>
            )}

            {!actionable && (
              <div className="px-5 pb-5 text-center">
                <p className="text-xs text-white/50">
                  Confluence score is {result.overallScore}% — below the 90% bar this page requires before recommending a trade.
                </p>
              </div>
            )}
          </section>

          {/* AI ANALYSIS REASONS */}
          {result.reasons.length > 0 && (
            <SectionCard title="AI Analysis — Why This Signal">
              <div className="space-y-1.5">
                {result.reasons.slice(0, 10).map((r, i) => (
                  <p key={i} className="text-xs text-white/70 flex items-start gap-2">
                    <CheckCircle2 size={13} className="text-[#00E676] shrink-0 mt-0.5" /> {r}
                  </p>
                ))}
              </div>
              <p className="text-xs text-white/60 leading-relaxed mt-3 pt-3 border-t border-white/10">
                {buildExplanation(result, symbol)}
              </p>
            </SectionCard>
          )}

          {/* TIMEFRAME CONFLUENCE (honest relabel of "market prediction") */}
          {timeframeReadout.length > 0 && (
            <SectionCard
              title="Timeframe Confluence"
              subtitle="Real technical alignment per timeframe — not a calibrated price forecast"
            >
              <div className="space-y-3">
                {timeframeReadout.map((row) => (
                  <div key={row.label}>
                    <div className="flex items-center justify-between text-[11px] mb-1">
                      <span className="text-white/60">{row.label}</span>
                      <span className={`font-bold ${row.direction === "bullish" ? "text-[#00E676]" : row.direction === "bearish" ? "text-[#FF5252]" : "text-white/40"}`}>
                        {row.direction === "bullish" ? "Bullish" : row.direction === "bearish" ? "Bearish" : "Neutral"} {row.score}%
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${row.score}%` }}
                        transition={{ duration: 0.6 }}
                        className={`h-full rounded-full ${row.direction === "bullish" ? "bg-[#00E676]" : row.direction === "bearish" ? "bg-[#FF5252]" : "bg-white/30"}`}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </SectionCard>
          )}

          {/* RISK METER */}
          {rl && (
            <SectionCard title="Risk Meter">
              <div className="flex items-center justify-between">
                <p className={`text-lg font-black ${rl.color}`}>{rl.label}</p>
                <p className="text-xs text-white/50">Risk score {result.riskScore}/100</p>
              </div>
              <div className="h-2 rounded-full bg-white/10 overflow-hidden mt-2">
                <div
                  className={`h-full rounded-full ${result.riskScore <= 30 ? "bg-[#00E676]" : result.riskScore <= 60 ? "bg-amber-400" : "bg-[#FF5252]"}`}
                  style={{ width: `${result.riskScore}%` }}
                />
              </div>
            </SectionCard>
          )}

          {/* TRADE EXECUTION PANEL */}
          <SectionCard title="Trade Execution Panel">
            <div className="grid grid-cols-2 gap-2.5">
              <ExecButton
                label="Buy CE"
                active={actionable && result.optSide === "CE"}
                color="bg-[#00E676] text-black"
                onClick={() =>
                  actionable &&
                  result.optSide === "CE" &&
                  createTrade.mutate(
                    { symbol, optSide: "CE", strike: result.strike, entryPrice: recommendedBuyPrice!, stopLoss: result.stop ?? undefined, target: result.target1 ?? undefined, quantity: quantity ?? 1, lotSize, source: "master-ai" },
                    { onSuccess: () => setLogged(true) }
                  )
                }
                disabled={!(actionable && result.optSide === "CE") || logged}
              />
              <ExecButton
                label="Buy PE"
                active={actionable && result.optSide === "PE"}
                color="bg-[#FF5252] text-white"
                onClick={() =>
                  actionable &&
                  result.optSide === "PE" &&
                  createTrade.mutate(
                    { symbol, optSide: "PE", strike: result.strike, entryPrice: recommendedBuyPrice!, stopLoss: result.stop ?? undefined, target: result.target1 ?? undefined, quantity: quantity ?? 1, lotSize, source: "master-ai" },
                    { onSuccess: () => setLogged(true) }
                  )
                }
                disabled={!(actionable && result.optSide === "PE") || logged}
              />
              <ExecButton label="Avoid Trade" active={result.decision === "NO TRADE"} color="bg-white/15 text-white" onClick={() => {}} disabled />
              <ExecButton label="Wait for Confirmation" active={result.decision === "WAIT"} color="bg-amber-500/80 text-black" onClick={() => {}} disabled />
              <ExecButton
                label="Exit Position"
                active={!!openTradeForSymbol}
                color="bg-sky-500 text-white"
                disabled={!openTradeForSymbol}
                onClick={() => {
                  if (!openTradeForSymbol) return;
                  setClosingTradeId(openTradeForSymbol.id);
                  setExitPriceInput(currentPremium !== null && openTradeForSymbol.strike === result.strike ? String(currentPremium) : "");
                }}
              />
              <ExecButton
                label="Book Partial Profit"
                active={!!openTradeForSymbol && openTradeForSymbol.quantity >= 2}
                color="bg-sky-400/80 text-black"
                disabled={!openTradeForSymbol || openTradeForSymbol.quantity < 2}
                onClick={() => {
                  if (!openTradeForSymbol) return;
                  const exit = currentPremium !== null && openTradeForSymbol.strike === result.strike ? currentPremium : Number(prompt("Exit price for the booked half?") || 0);
                  if (!exit) return;
                  const halfQty = Math.floor(openTradeForSymbol.quantity / 2);
                  const remainingQty = openTradeForSymbol.quantity - halfQty;
                  createTrade.mutate(
                    {
                      symbol: openTradeForSymbol.symbol,
                      optSide: openTradeForSymbol.optSide,
                      strike: openTradeForSymbol.strike,
                      entryPrice: openTradeForSymbol.entryPrice,
                      quantity: halfQty,
                      lotSize: openTradeForSymbol.lotSize,
                      entryDate: openTradeForSymbol.entryDate,
                      source: openTradeForSymbol.source,
                      notes: "Partial profit booked from AI 3V",
                    },
                    {
                      onSuccess: (created) => {
                        updateTrade.mutate({ id: created.id, patch: { exitPrice: exit, status: "CLOSED" } });
                        updateTrade.mutate({ id: openTradeForSymbol.id, patch: { quantity: remainingQty } });
                      },
                    }
                  );
                }}
              />
            </div>

            {closingTradeId && (
              <div className="mt-3 flex gap-2">
                <input
                  type="number"
                  placeholder="Exit price"
                  value={exitPriceInput}
                  onChange={(e) => setExitPriceInput(e.target.value)}
                  className="flex-1 rounded-lg bg-white/10 border border-white/20 px-3 py-2 text-sm text-white placeholder-white/30"
                />
                <button
                  onClick={() => {
                    const price = Number(exitPriceInput);
                    if (!price) return;
                    updateTrade.mutate({ id: closingTradeId, patch: { exitPrice: price, status: "CLOSED" } }, { onSuccess: () => setClosingTradeId(null) });
                  }}
                  className="px-4 py-2 rounded-lg text-xs font-bold bg-[#00E676] text-black"
                >
                  Confirm
                </button>
                <button onClick={() => setClosingTradeId(null)} className="px-4 py-2 rounded-lg text-xs font-bold bg-white/10 text-white">
                  Cancel
                </button>
              </div>
            )}
          </SectionCard>

          {/* INSTITUTIONAL DATA */}
          <SectionCard title="Institutional Data">
            <div className="grid grid-cols-3 gap-2.5">
              <DarkField label="PCR" value={options?.pcr !== null && options?.pcr !== undefined ? options.pcr.toFixed(2) : "—"} />
              <DarkField label="OI Change" value={oiChange !== null ? oiChange.toLocaleString("en-IN") : "—"} />
              <DarkField label="Volume" value={optionLeg?.volume != null ? optionLeg.volume.toLocaleString("en-IN") : "—"} />
              <DarkField label="VWAP" value={c15Snap?.vwap != null ? c15Snap.vwap.toFixed(2) : "—"} />
              <DarkField label="EMA 20" value={c15Snap?.ema20 != null ? c15Snap.ema20.toFixed(2) : "—"} />
              <DarkField label="EMA 50" value={c15Snap?.ema50 != null ? c15Snap.ema50.toFixed(2) : "—"} />
              <DarkField label="RSI" value={c15Snap?.rsi14 != null ? c15Snap.rsi14.toFixed(1) : "—"} />
              <DarkField label="MACD" value={c15Snap?.macd != null ? c15Snap.macd.histogram.toFixed(2) : "—"} />
              <DarkField label="ADX" value={c15Snap?.adx14 != null ? c15Snap.adx14.toFixed(1) : "—"} />
              <DarkField label="ATR" value={c15Snap?.atr14 != null ? c15Snap.atr14.toFixed(2) : "—"} />
              <DarkField label="CPR (BC-TC)" value={cpr ? `${cpr.bc.toFixed(1)}-${cpr.tc.toFixed(1)}` : "—"} span />
              <DarkField label="Trend Strength" value={`${result.meters.trend.score}/100`} />
            </div>
          </SectionCard>

          {/* CHART */}
          <SectionCard title="Chart" subtitle="TradingView continuous-futures chart · EMA/VWAP/Volume/Pivot overlays · use its toolbar to switch timeframe">
            <TradingViewWidget key={symbol} symbol={TV_SYMBOL[symbol]} interval="15" />
          </SectionCard>
        </>
      )}

      {/* PERFORMANCE DASHBOARD */}
      <SectionCard title="Performance Dashboard">
        <div className="grid grid-cols-3 gap-2.5">
          <DarkField label="Today's Accuracy" value={perfBuckets.today.winRate !== null ? `${perfBuckets.today.winRate.toFixed(0)}%` : "—"} />
          <DarkField label="Weekly Accuracy" value={perfBuckets.week.winRate !== null ? `${perfBuckets.week.winRate.toFixed(0)}%` : "—"} />
          <DarkField label="Monthly Accuracy" value={perfBuckets.month.winRate !== null ? `${perfBuckets.month.winRate.toFixed(0)}%` : "—"} />
          <DarkField label="Total Signals" value={String(journalSummary.closedCount + journalSummary.openCount)} />
          <DarkField label="Winning Signals" value={String(Math.round(((journalSummary.winRate ?? 0) / 100) * journalSummary.closedCount))} />
          <DarkField label="Losing Signals" value={String(journalSummary.closedCount - Math.round(((journalSummary.winRate ?? 0) / 100) * journalSummary.closedCount))} />
          <DarkField label="Avg Win" value={journalSummary.avgWin !== null ? `₹${journalSummary.avgWin.toFixed(0)}` : "—"} tone="up" />
          <DarkField label="Avg Loss" value={journalSummary.avgLoss !== null ? `₹${journalSummary.avgLoss.toFixed(0)}` : "—"} tone="down" />
          <DarkField label="Win Rate" value={journalSummary.winRate !== null ? `${journalSummary.winRate.toFixed(0)}%` : "—"} />
          <DarkField label="Largest Profit" value={journalSummary.best !== null ? `₹${journalSummary.best.toFixed(0)}` : "—"} tone="up" />
          <DarkField label="Largest Loss" value={journalSummary.worst !== null ? `₹${journalSummary.worst.toFixed(0)}` : "—"} tone="down" />
          <DarkField
            label="Profit Factor"
            value={journalSummary.profitFactor === null ? "—" : journalSummary.profitFactor === Infinity ? "∞" : journalSummary.profitFactor.toFixed(2)}
          />
        </div>
      </SectionCard>

      {/* SIGNAL HISTORY */}
      <SectionCard title="Signal History">
        {!trades?.length && <p className="text-xs text-white/40 text-center py-4">No trades logged yet.</p>}
        {!!trades?.length && (
          <div className="space-y-2">
            {[...trades]
              .sort((a, b) => new Date(b.entryDate).getTime() - new Date(a.entryDate).getTime())
              .slice(0, 12)
              .map((t) => (
                <HistoryRow key={t.id} t={t} />
              ))}
          </div>
        )}
      </SectionCard>

      {/* NEWS -- honestly not connected, no fabricated headlines */}
      <SectionCard title="Commodity News">
        <p className="text-xs text-white/40 text-center py-3">
          Not connected — this would need a real news API integration. No headlines are invented.
        </p>
      </SectionCard>

      {/* ECONOMIC CALENDAR -- honestly not connected */}
      <SectionCard title="Economic Calendar">
        <p className="text-xs text-white/40 text-center py-3">
          Not connected — US crude/Natural Gas inventory, Fed announcements, and Dollar Index events need a real economic-calendar data
          source. No event times or values are invented.
        </p>
      </SectionCard>

      <p className="text-[10px] text-white/30 leading-relaxed text-center px-4 pb-2">
        This dashboard provides AI-assisted technical analysis for educational purposes only. Commodity trading involves significant market
        risk. Always manage your risk before taking any trade.
      </p>
    </div>
  );
}

function buildExplanation(result: ReturnType<typeof computeMasterAI>, symbol: TradableSymbol): string {
  const top = result.reasons.slice(0, 4);
  const biasWord = result.bias === "bullish" ? "bullish" : "bearish";
  const side = result.bias === "bullish" ? "a call (CE)" : "a put (PE)";
  if (!top.length) {
    return `No single dominant confluence was found for ${DISPLAY_NAME[symbol]} right now, so the AI is not proposing a directional read.`;
  }
  return `The AI detected a ${biasWord} confluence for ${DISPLAY_NAME[symbol]}: ${top.join("; ")}. Combined, this pushed the overall score to ${result.overallScore}% (${result.confidenceLabel}), which is why buying ${side} is being surfaced${result.overallScore > 90 ? "" : " on the Analysis page, though not yet above this page's 90% action bar"}.`;
}

function computePerfBuckets(trades: PortfolioTrade[]) {
  const now = new Date();
  const inRange = (dateStr: string | undefined, days: number) => {
    if (!dateStr) return false;
    const d = new Date(dateStr);
    if (days === 0) return d.toDateString() === now.toDateString();
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() - days);
    return d >= cutoff;
  };
  const bucket = (days: number) => computePortfolioSummary(trades.filter((t) => inRange(t.exitDate ?? t.entryDate, days)));
  return { today: bucket(0), week: bucket(7), month: bucket(30) };
}

function formatExpiry(expiry: string): string {
  try {
    return new Date(expiry).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }).toUpperCase();
  } catch {
    return expiry;
  }
}

function SectionCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl bg-white/[0.05] backdrop-blur-xl border border-white/10 p-4">
      <p className="text-xs font-bold uppercase tracking-wide text-white/70">{title}</p>
      {subtitle && <p className="text-[10px] text-white/40 mt-0.5 mb-3">{subtitle}</p>}
      <div className={subtitle ? "" : "mt-3"}>{children}</div>
    </section>
  );
}

function GlassStat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: Direction }) {
  const color = tone === "bullish" ? "text-[#00E676]" : tone === "bearish" ? "text-[#FF5252]" : "text-white";
  return (
    <div className="rounded-2xl p-3.5 bg-white/5 border border-white/10">
      <p className="text-[10px] text-white/50 font-semibold uppercase">{label}</p>
      <p className={`text-lg font-black mt-0.5 ${color}`}>{value}</p>
      {sub && <p className="text-[11px] text-white/40">{sub}</p>}
    </div>
  );
}

function DarkField({ label, value, tone, span }: { label: string; value: string; tone?: "up" | "down"; span?: boolean }) {
  const color = tone === "up" ? "text-[#00E676]" : tone === "down" ? "text-[#FF5252]" : "text-white";
  return (
    <div className={`rounded-xl bg-white/5 border border-white/10 px-3 py-2.5 ${span ? "col-span-2" : ""}`}>
      <p className="text-[9px] text-white/40">{label}</p>
      <p className={`text-sm font-bold ${color}`}>{value}</p>
    </div>
  );
}

function ExecButton({
  label,
  active,
  color,
  onClick,
  disabled,
}: {
  label: string;
  active: boolean;
  color: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-xl py-3 text-xs font-bold transition-all ${active ? color : "bg-white/5 text-white/40"} disabled:opacity-50`}
    >
      {label}
    </button>
  );
}

function HistoryRow({ t }: { t: PortfolioTrade }) {
  const win = t.pnl !== undefined && t.pnl >= 0;
  return (
    <div className="flex items-center justify-between rounded-xl bg-white/5 border border-white/10 px-3 py-2.5">
      <div>
        <p className="text-xs font-bold flex items-center gap-1.5">
          {t.status === "CLOSED" ? win ? <CheckCircle2 size={12} className="text-[#00E676]" /> : <XCircle size={12} className="text-[#FF5252]" /> : <Clock size={12} className="text-amber-400" />}
          {t.symbol} {t.strike ? `${t.strike} ${t.optSide}` : ""}
        </p>
        <p className="text-[10px] text-white/40 mt-0.5">
          {new Date(t.entryDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })} · ₹{t.entryPrice}
          {t.exitPrice !== undefined ? ` → ₹${t.exitPrice}` : ""}
        </p>
      </div>
      {t.pnl !== undefined ? (
        <p className={`text-sm font-black ${win ? "text-[#00E676]" : "text-[#FF5252]"}`}>
          {win ? "+" : ""}₹{t.pnl.toFixed(0)}
        </p>
      ) : (
        <span className="text-[10px] font-bold text-amber-400 flex items-center gap-1">
          <Minus size={10} /> OPEN
        </span>
      )}
    </div>
  );
}
