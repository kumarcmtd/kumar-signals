import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Inbox, CheckCircle2, Wallet, History, Trophy, NotebookText, Radio, Timer } from "lucide-react";
import { useCandles, useOptionsAnalytics, useSignal, usePortfolio, useCreateTrade, useUpdateTrade, useMarketStatus } from "../api/hooks";
import { useAppStore } from "../store/appStore";
import { computeMasterAI } from "../utils/masterEngine";
import { computePortfolioSummary } from "../utils/portfolioStats";
import { ConfidenceRing } from "../components/ConfidenceRing";
import { CardSkeleton } from "../components/Skeleton";
import type { InstrumentSymbol, PortfolioTrade } from "../types";

const SIGNAL_VALIDITY_MS = 20 * 60 * 1000; // how long a generated call is treated as fresh

function fmtCountdown(ms: number): string {
  if (ms <= 0) return "Expired";
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

function riskLevel(riskScore: number): { label: string; color: string } {
  if (riskScore <= 30) return { label: "Low", color: "text-[var(--color-buy)]" };
  if (riskScore <= 60) return { label: "Medium", color: "text-amber-600" };
  return { label: "High", color: "text-[var(--color-sell)]" };
}

const LOT_SIZE: Record<InstrumentSymbol, number> = { CRUDEOIL: 100, NATURALGAS: 1250, GOLD: 100, SILVER: 30 };
const DISPLAY_NAME: Record<InstrumentSymbol, string> = { CRUDEOIL: "CRUDE OIL", NATURALGAS: "NATURAL GAS", GOLD: "GOLD", SILVER: "SILVER" };

type SignalTier = "STRONG_BUY" | "BUY" | "WAIT" | "SELL" | "STRONG_SELL" | "NONE";

const tierStyle: Record<SignalTier, { bg: string; ring: string; emoji: string; label: string }> = {
  STRONG_BUY: { bg: "from-emerald-600 to-emerald-500", ring: "border-emerald-600", emoji: "🟢", label: "STRONG BUY" },
  BUY: { bg: "from-emerald-400 to-emerald-300", ring: "border-emerald-400", emoji: "🟢", label: "BUY" },
  WAIT: { bg: "from-amber-400 to-amber-300", ring: "border-amber-400", emoji: "🟠", label: "WAIT" },
  SELL: { bg: "from-rose-500 to-rose-400", ring: "border-rose-500", emoji: "🔴", label: "SELL" },
  STRONG_SELL: { bg: "from-rose-700 to-rose-600", ring: "border-rose-700", emoji: "🔴", label: "STRONG SELL" },
  NONE: { bg: "from-slate-300 to-slate-200", ring: "border-slate-300", emoji: "⚪", label: "NO TRADE" },
};

const TABS = [
  { key: "open", label: "Open Calls", icon: Inbox },
  { key: "closed", label: "Closed Calls", icon: CheckCircle2 },
  { key: "today", label: "Today's P&L", icon: Wallet },
  { key: "history", label: "Trade History", icon: History },
  { key: "winrate", label: "Win Rate", icon: Trophy },
  { key: "journal", label: "Journal", icon: NotebookText },
] as const;
type TabKey = (typeof TABS)[number]["key"];

export function AITrade() {
  const [symbol, setSymbol] = useState<InstrumentSymbol>("CRUDEOIL");
  const [tab, setTab] = useState<TabKey>("open");
  const [generatedAt, setGeneratedAt] = useState<Date | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const { risk } = useAppStore();
  const createTrade = useCreateTrade();
  const [logged, setLogged] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const { data: market } = useMarketStatus();
  const c1D = useCandles(symbol, "1D");
  const c30 = useCandles(symbol, "30");
  const c15 = useCandles(symbol, "15");
  const c5 = useCandles(symbol, "5");
  const { data: options, error: optionsError, dataUpdatedAt: optionsUpdatedAt } = useOptionsAnalytics(symbol);
  const { data: signal, error: signalError } = useSignal(symbol);
  const { data: trades } = usePortfolio();

  const candlesReady = !!(c1D.data && c30.data && c15.data && c5.data);
  const loading = c1D.isLoading || c30.isLoading || c15.isLoading || c5.isLoading;

  const liveDataUnavailable = !!signalError || !!optionsError || !!signal?.error || !!options?.error;

  const result = useMemo(() => {
    if (!candlesReady || liveDataUnavailable) return null;
    return computeMasterAI({
      candlesByTf: { "1D": c1D.data!.candles, "30": c30.data!.candles, "15": c15.data!.candles, "5": c5.data!.candles },
      options,
      signal,
    });
  }, [candlesReady, liveDataUnavailable, c1D.data, c30.data, c15.data, c5.data, options, signal]);

  // "AI Trade" enforces a stricter bar than the Master AI analysis page: only
  // ever surface a real trade card above 90% confidence, with a live premium.
  const actionable = !!result && result.bias !== "neutral" && result.overallScore > 90 && result.entry !== null && result.strike !== undefined;

  useEffect(() => {
    if (result) setGeneratedAt(new Date());
    setLogged(false);
  }, [result?.decision, result?.strike, result?.overallScore]);

  const tier: SignalTier = !actionable
    ? "NONE"
    : result!.bias === "bullish"
      ? result!.overallScore >= 95
        ? "STRONG_BUY"
        : "BUY"
      : result!.overallScore >= 95
        ? "STRONG_SELL"
        : "SELL";

  const currentPremium = actionable ? result!.entry! : null;
  const recommendedBuyPrice = currentPremium !== null ? Number((currentPremium * 1.012).toFixed(2)) : null;
  const buyZoneLow = currentPremium !== null ? Number((currentPremium * 0.985).toFixed(2)) : null;
  const buyZoneHigh = currentPremium !== null ? Number((currentPremium * 1.02).toFixed(2)) : null;

  const riskAmount = (risk.capital * risk.riskPercent) / 100;
  const perUnitRisk = actionable && result!.stop !== null ? Math.abs(result!.entry! - result!.stop) : null;
  const lotSize = LOT_SIZE[symbol];
  const quantity = perUnitRisk && perUnitRisk > 0 ? Math.max(1, Math.floor(riskAmount / perUnitRisk / lotSize)) : null;
  const capitalRequired = quantity !== null && recommendedBuyPrice !== null ? recommendedBuyPrice * lotSize * quantity : null;

  const directionLabel = actionable ? (result!.bias === "bullish" ? "BUY CE" : "BUY PE") : "WAIT / NO TRADE";

  const validUntil = generatedAt ? generatedAt.getTime() + SIGNAL_VALIDITY_MS : null;
  const remainingMs = validUntil !== null ? validUntil - now : null;
  const signalAgeSec = generatedAt ? Math.max(0, Math.floor((now - generatedAt.getTime()) / 1000)) : null;
  const optionsLatencySec = optionsUpdatedAt ? Math.max(0, Math.floor((now - optionsUpdatedAt) / 1000)) : null;

  const journalSummary = useMemo(() => computePortfolioSummary(trades ?? []), [trades]);

  const optionRow = actionable ? options?.rows.find((r) => r.strike === result!.strike) : undefined;
  const optionLeg = optionRow ? (result!.optSide === "CE" ? optionRow.call : optionRow.put) : undefined;

  const expectedProfit = actionable && quantity !== null ? Number(((result!.target1! - result!.entry!) * quantity * lotSize).toFixed(0)) : null;
  const maxLoss = actionable && quantity !== null ? Number(((result!.entry! - result!.stop!) * quantity * lotSize).toFixed(0)) : null;
  const rl = actionable ? riskLevel(result!.riskScore) : null;

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {(["CRUDEOIL", "NATURALGAS"] as const).map((sym) => (
          <button
            key={sym}
            onClick={() => setSymbol(sym)}
            className={`flex-1 rounded-2xl py-2.5 text-sm font-bold transition-all ${
              symbol === sym ? "bg-gradient-to-r from-slate-900 to-slate-700 text-white shadow-md" : "bg-white/80 backdrop-blur text-[var(--color-muted)] border border-[var(--color-border)]"
            }`}
          >
            {DISPLAY_NAME[sym]}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between rounded-2xl bg-white/70 backdrop-blur border border-[var(--color-border)] px-3.5 py-2 text-[11px]">
        <span className="flex items-center gap-1.5 font-semibold">
          <Radio size={13} className={market?.isOpen ? "text-[var(--color-buy)]" : "text-[var(--color-sell)]"} />
          {market ? (market.isOpen ? "Market Open" : "Market Closed") : "Loading…"}
          {market?.timeLabel && <span className="text-[var(--color-muted)] font-normal">· {market.timeLabel}</span>}
        </span>
        <span className="flex items-center gap-1.5 text-[var(--color-muted)]">
          <Timer size={13} />
          {optionsLatencySec !== null ? `data ${optionsLatencySec}s ago` : "—"}
        </span>
      </div>

      {loading && <CardSkeleton />}

      {!loading && liveDataUnavailable && (
        <div className="rounded-[20px] bg-white border border-amber-200 p-5 text-center space-y-2 shadow-sm">
          <p className="text-2xl">⚪</p>
          <p className="text-sm font-bold text-amber-800">Signal generation unavailable</p>
          <p className="text-xs text-[var(--color-muted)] leading-relaxed">
            Live option market data is not connected right now ({signal?.error || options?.error || "option chain unreachable"}). No strikes,
            premiums, or targets are fabricated — check back once the market/chain feed is live.
          </p>
        </div>
      )}

      {!loading && !liveDataUnavailable && result && (
        <AnimatePresence mode="wait">
          <motion.div
            key={`${symbol}-${actionable}-${result.strike}`}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="rounded-[20px] bg-white/90 backdrop-blur-xl border border-white shadow-[0_8px_30px_rgba(0,0,0,0.08)] overflow-hidden"
          >
            <div className={`p-5 bg-gradient-to-br ${tierStyle[tier].bg}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-white/80 text-[11px] font-semibold uppercase tracking-wide">{DISPLAY_NAME[symbol]}</p>
                  <p className="text-white text-xl font-black leading-tight mt-0.5">
                    {actionable ? `${result.strike} ${result.optSide}` : "No strike selected"}
                  </p>
                  {actionable && signal && <p className="text-white/80 text-xs mt-0.5">Expiry: {formatExpiry(signal.expiry)}</p>}
                  <p className="text-white font-bold text-sm mt-2">
                    {tierStyle[tier].emoji} {tierStyle[tier].label}
                  </p>
                  <p className="text-white/80 text-[11px] mt-1">Direction: {directionLabel}</p>
                </div>
                <ConfidenceRing score={result.overallScore} size={84} />
              </div>

              {actionable && rl && (
                <div className="grid grid-cols-3 gap-2 mt-4">
                  <MetaChip label="Win Probability" value={result.expectedProbability !== null ? `${result.expectedProbability}%` : "—"} valueClass="text-white" />
                  <MetaChip label="Risk Level" value={rl.label} valueClass="text-white" />
                  <MetaChip label="Trade Quality" value={result.confidenceLabel} valueClass="text-white" />
                </div>
              )}
            </div>

            {actionable && (
              <div className="flex items-center justify-between px-5 py-2.5 bg-slate-900/95 text-white text-[11px]">
                <span>Generated {generatedAt ? generatedAt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "—"}</span>
                <span className="flex items-center gap-1">
                  <Timer size={12} /> Valid for {remainingMs !== null ? fmtCountdown(remainingMs) : "—"}
                </span>
                <span>Signal age {signalAgeSec !== null ? `${signalAgeSec}s` : "—"}</span>
              </div>
            )}

            {actionable ? (
              <div className="p-5 space-y-4">
                <div className="grid grid-cols-2 gap-2.5">
                  <Field label="Current Premium" value={`₹${currentPremium}`} />
                  <Field label="Recommended Buy Price" value={`₹${recommendedBuyPrice}`} />
                  <Field label="Buy Zone" value={`₹${buyZoneLow} – ₹${buyZoneHigh}`} span />
                  <Field label="Stop Loss" value={`₹${result.stop}`} tone="sell" />
                  <Field label="Target 1" value={`₹${result.target1}`} tone="buy" />
                  <Field label="Target 2" value={`₹${result.target2}`} tone="buy" />
                  <Field label="Target 3" value={`₹${result.target3}`} tone="buy" />
                  <Field label="Risk Reward" value={result.rr !== null ? `1 : ${result.rr}` : "—"} />
                  <Field label="Confidence" value={`${result.overallScore}%`} />
                  <Field label="AI Score" value={`${result.overallScore}/100`} />
                  <Field label="Expected Holding Time" value={result.expectedHoldingTime} span />
                  <Field
                    label="Expected Success Probability"
                    value={result.expectedProbability !== null ? `${result.expectedProbability}%` : "—"}
                  />
                  <Field label="Recommended Quantity" value={quantity !== null ? `${quantity} lot(s)` : "—"} />
                  <Field label="Capital Required" value={capitalRequired !== null ? `₹${capitalRequired.toFixed(0)}` : "—"} span />
                </div>

                <div>
                  <p className="text-[11px] font-bold text-[var(--color-muted)] uppercase mb-2">Risk management</p>
                  <div className="grid grid-cols-2 gap-2.5">
                    <Field label="Expected Profit" value={expectedProfit !== null ? `₹${expectedProfit}` : "—"} tone="buy" />
                    <Field label="Maximum Loss" value={maxLoss !== null ? `₹${maxLoss}` : "—"} tone="sell" />
                    <Field label="Break Even" value={`₹${recommendedBuyPrice}`} />
                    <Field label="Lot Size" value={String(lotSize)} />
                  </div>
                  {result.trailingStopNote && <p className="text-[11px] text-[var(--color-muted)] mt-2">{result.trailingStopNote}</p>}
                </div>

                {optionLeg && (
                  <div>
                    <p className="text-[11px] font-bold text-[var(--color-muted)] uppercase mb-2">Live option details</p>
                    <div className="grid grid-cols-3 gap-2.5">
                      <Field label="OI" value={optionLeg.oi !== null ? optionLeg.oi.toLocaleString("en-IN") : "—"} />
                      <Field label="Volume" value={optionLeg.volume !== null ? optionLeg.volume.toLocaleString("en-IN") : "—"} />
                      <Field label="IV" value={optionLeg.iv !== null ? `${optionLeg.iv.toFixed(1)}%` : "—"} />
                      <Field label="Delta" value={optionLeg.delta !== undefined ? optionLeg.delta.toFixed(3) : "—"} />
                      <Field label="Gamma" value={optionLeg.gamma !== undefined ? optionLeg.gamma.toFixed(4) : "—"} />
                      <Field label="Theta" value={optionLeg.theta !== undefined ? optionLeg.theta.toFixed(2) : "—"} />
                      <Field label="Vega" value={optionLeg.vega !== undefined ? optionLeg.vega.toFixed(2) : "—"} />
                      <Field label="PCR" value={options?.pcr !== null && options?.pcr !== undefined ? options.pcr.toFixed(2) : "—"} />
                      <Field
                        label="Premium Chg %"
                        value={optionLeg.changePercent !== null ? `${optionLeg.changePercent >= 0 ? "+" : ""}${optionLeg.changePercent.toFixed(1)}%` : "—"}
                        tone={optionLeg.changePercent !== null ? (optionLeg.changePercent >= 0 ? "buy" : "sell") : undefined}
                      />
                    </div>
                  </div>
                )}

                {journalSummary.closedCount > 0 && (
                  <div className="rounded-2xl bg-[var(--color-surface-soft)] p-3.5">
                    <p className="text-[11px] font-bold text-[var(--color-muted)] uppercase mb-1.5">Historical accuracy (your journal)</p>
                    <p className="text-xs">
                      {journalSummary.winRate?.toFixed(0)}% win rate over {journalSummary.closedCount} closed trade(s) you've logged — not a
                      guarantee, just your own track record so far.
                    </p>
                  </div>
                )}

                {result.reasons.length > 0 && (
                  <div className="rounded-2xl bg-[var(--color-surface-soft)] p-3.5 space-y-1">
                    <p className="text-[11px] font-bold text-[var(--color-muted)] uppercase">Why AI generated this trade</p>
                    {result.reasons.slice(0, 9).map((r, i) => (
                      <p key={i} className="text-xs text-black/70 leading-relaxed">
                        ✅ {r}
                      </p>
                    ))}
                  </div>
                )}

                <button
                  disabled={logged || createTrade.isPending}
                  onClick={() =>
                    createTrade.mutate(
                      {
                        symbol,
                        optSide: result.optSide,
                        strike: result.strike,
                        entryPrice: recommendedBuyPrice!,
                        stopLoss: result.stop ?? undefined,
                        target: result.target1 ?? undefined,
                        quantity: quantity ?? 1,
                        lotSize,
                        source: "master-ai",
                      },
                      { onSuccess: () => setLogged(true) }
                    )
                  }
                  className="w-full py-3 rounded-2xl text-sm font-bold bg-slate-900 text-white disabled:opacity-50"
                >
                  {logged ? "Logged to Journal ✓" : createTrade.isPending ? "Logging…" : "Take this trade → Log to Journal"}
                </button>
              </div>
            ) : (
              <div className="p-5 text-center space-y-1.5">
                <p className="text-sm font-bold text-amber-800">Reason: Market conditions are not favourable.</p>
                <p className="text-xs text-[var(--color-muted)]">
                  Confluence score is {result.overallScore}% — below the 90% bar this page requires before recommending a trade. See the AI
                  Analysis page for the full breakdown.
                </p>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      )}

      <div className="rounded-[20px] bg-white border border-[var(--color-border)] overflow-hidden">
        <div className="flex overflow-x-auto no-scrollbar border-b border-[var(--color-border)]">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex flex-col items-center gap-1 px-4 py-2.5 shrink-0 text-[10px] font-semibold ${
                tab === key ? "text-[var(--color-primary)] border-b-2 border-[var(--color-primary)]" : "text-[var(--color-muted)]"
              }`}
            >
              <Icon size={16} />
              {label}
            </button>
          ))}
        </div>
        <div className="p-4">
          <CallsTabPanel tab={tab} trades={trades ?? []} />
        </div>
      </div>

      <p className="text-[10px] text-[var(--color-muted)] leading-relaxed px-1">
        Educational reference only, not financial advice. This engine only ever recommends buying options (CE or PE) — it does not
        recommend writing/selling options, which carries margin requirements and materially different risk outside this app's model.
        Always verify on the live chart and manage your own risk.
      </p>
    </div>
  );
}

function formatExpiry(expiry: string): string {
  try {
    return new Date(expiry).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }).toUpperCase();
  } catch {
    return expiry;
  }
}

function MetaChip({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="rounded-xl bg-white/15 backdrop-blur px-2.5 py-2 text-center">
      <p className={`text-sm font-black ${valueClass ?? ""}`}>{value}</p>
      <p className="text-[9px] text-white/80 mt-0.5">{label}</p>
    </div>
  );
}

function Field({ label, value, tone, span }: { label: string; value: string; tone?: "buy" | "sell"; span?: boolean }) {
  const color = tone === "buy" ? "text-[var(--color-buy)]" : tone === "sell" ? "text-[var(--color-sell)]" : "";
  return (
    <div className={`rounded-2xl bg-[var(--color-surface-soft)] px-3 py-2.5 ${span ? "col-span-2" : ""}`}>
      <p className="text-[10px] text-[var(--color-muted)]">{label}</p>
      <p className={`text-sm font-bold ${color}`}>{value}</p>
    </div>
  );
}

function CallsTabPanel({ tab, trades }: { tab: TabKey; trades: PortfolioTrade[] }) {
  const updateTrade = useUpdateTrade();
  const summary = useMemo(() => computePortfolioSummary(trades), [trades]);

  if (tab === "open") {
    const open = trades.filter((t) => t.status === "OPEN");
    if (!open.length) return <Empty text="No open calls right now." />;
    return (
      <div className="space-y-2">
        {open.map((t) => (
          <TradeRow key={t.id} t={t} />
        ))}
      </div>
    );
  }

  if (tab === "closed") {
    const closed = trades.filter((t) => t.status === "CLOSED");
    if (!closed.length) return <Empty text="No closed calls yet." />;
    return (
      <div className="space-y-2">
        {closed.map((t) => (
          <TradeRow key={t.id} t={t} />
        ))}
      </div>
    );
  }

  if (tab === "today") {
    return (
      <div className="grid grid-cols-2 gap-2">
        <Field label="Today's P&L" value={`₹${summary.todayPnl.toFixed(0)}`} tone={summary.todayPnl >= 0 ? "buy" : "sell"} />
        <Field label="Closed today" value={String(trades.filter((t) => t.exitDate && new Date(t.exitDate).toDateString() === new Date().toDateString()).length)} />
      </div>
    );
  }

  if (tab === "history") {
    const all = [...trades].sort((a, b) => new Date(b.entryDate).getTime() - new Date(a.entryDate).getTime());
    if (!all.length) return <Empty text="No trades logged yet." />;
    return (
      <div className="space-y-2">
        {all.map((t) => (
          <TradeRow key={t.id} t={t} showStatus />
        ))}
      </div>
    );
  }

  if (tab === "winrate") {
    return (
      <div className="grid grid-cols-2 gap-2">
        <Field label="Win rate" value={summary.winRate !== null ? `${summary.winRate.toFixed(0)}%` : "—"} />
        <Field label="Profit factor" value={summary.profitFactor === null ? "—" : summary.profitFactor === Infinity ? "∞" : summary.profitFactor.toFixed(2)} />
        <Field label="Avg win" value={summary.avgWin !== null ? `₹${summary.avgWin.toFixed(0)}` : "—"} tone="buy" />
        <Field label="Avg loss" value={summary.avgLoss !== null ? `₹${summary.avgLoss.toFixed(0)}` : "—"} tone="sell" />
        <Field label="Best trade" value={summary.best !== null ? `₹${summary.best.toFixed(0)}` : "—"} tone="buy" />
        <Field label="Worst trade" value={summary.worst !== null ? `₹${summary.worst.toFixed(0)}` : "—"} tone="sell" />
      </div>
    );
  }

  // journal
  if (!trades.length) return <Empty text="Nothing logged yet." />;
  return (
    <div className="space-y-2">
      {trades.map((t) => (
        <div key={t.id} className="rounded-xl bg-[var(--color-surface-soft)] p-3 space-y-1.5">
          <p className="text-xs font-semibold">
            {t.symbol}
            {t.strike ? ` ${t.strike} ${t.optSide}` : ""} · {t.status}
          </p>
          <textarea
            defaultValue={t.notes ?? ""}
            placeholder="Add a note about this trade…"
            onBlur={(e) => {
              if (e.target.value !== (t.notes ?? "")) updateTrade.mutate({ id: t.id, patch: { notes: e.target.value } });
            }}
            className="w-full text-xs rounded-lg border border-[var(--color-border)] px-2 py-1.5 resize-none"
            rows={2}
          />
        </div>
      ))}
    </div>
  );
}

function TradeRow({ t, showStatus }: { t: PortfolioTrade; showStatus?: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-xl bg-[var(--color-surface-soft)] px-3 py-2.5">
      <div>
        <p className="text-xs font-bold">
          {t.symbol}
          {t.strike ? ` ${t.strike} ${t.optSide}` : ""}
        </p>
        <p className="text-[10px] text-[var(--color-muted)]">
          ₹{t.entryPrice}
          {t.exitPrice !== undefined ? ` → ₹${t.exitPrice}` : ""} · {t.quantity} lot(s)
          {showStatus ? ` · ${t.status}` : ""}
        </p>
      </div>
      {t.pnl !== undefined && (
        <p className={`text-sm font-black ${t.pnl >= 0 ? "text-[var(--color-buy)]" : "text-[var(--color-sell)]"}`}>
          {t.pnl >= 0 ? "+" : ""}
          ₹{t.pnl.toFixed(0)}
        </p>
      )}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="text-xs text-[var(--color-muted)] text-center py-4">{text}</p>;
}
